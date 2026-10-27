import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface, Timer } from 'claude-code'

import type { FoldedPane, SlackInbox, SlackPoller, SlackRoom, SlackServer, SlackState, SlackView } from '../types'
import {
  FIRST_FILL_S,
  closeRoom,
  emptyInbox,
  findSlackServer,
  historyCall,
  holdsLease,
  inboxCall,
  mergeInbox,
  notices,
  parseHistory,
  parseThread,
  parseMe,
  parseSearch,
  profileCall,
  readRoom,
  resultText,
  roomList,
  sendCall,
  sendProblem,
  slackPrompt,
  threadCall,
  slackText,
  slackThreadTool,
  slackTools,
  tsCompare,
  unreadCount,
} from './slack'
import type { SlackCall } from './slack'
import { T, langFromConfig, langSetting, setLang } from './i18n'
import { COLORS, ago, cellWidth, clip, fillPrompt, rowButton } from './util'

const SLACK_PANE = 'desk-slack'
// 답장 입력칸이 자랄 수 있는 줄 수(desk-look 의 diff 줄 댓글 칸과 같다).
const COMMENT_ROWS = 3

// 받은 편지(store 를 비춘 것)와 펼친 대화방. 답장 글은 Input 이 갖고, 보내거나 지우면 키를 바꿔 비운다.
const slack = atom({ plugin: 'desk-slack', key: 'slack' } as const, null as SlackState | null)
const slackView = atom({ plugin: 'desk-slack', key: 'slackView' } as const, null as SlackView | null)
// 방 닫기 확인처럼 잠깐 켜 두는 것.
const open = atom({ plugin: 'desk-slack', key: 'open' } as const, {} as Record<string, boolean>)
// desk-look 이 읽는 값: 아래턱 ✉ 칩의 안 읽은 수, 이 세션에 떠 있음(옮김 안내), /desk-fold 로 접어 둔 패널.
const unread = atom({ plugin: 'desk-slack', key: 'unread' } as const, 0)
const ready = atom({ plugin: 'desk-slack', key: 'ready' } as const, false)
const folded = atom({ plugin: 'desk-slack', key: 'folded' } as const, null as FoldedPane[] | null)
// 이 플러그인의 패널이 지금 열려 있는지(ui.open·ui.close 훅이 맞춘다). desk-look 의 /desk-fold 가 접을지 펼지 고른다.
const shown = atom({ plugin: 'desk-slack', key: 'shown' } as const, false)
let slackDraft = ''
let slackSent = 0
let slackWatch: Timer | null = null
let slackNotify = true

// 받은 편지 상태를 바꾸고, desk-look 의 ✉ 칩이 읽는 안 읽은 수를 같이 맞춘다.
async function setSlack($: EngineInterface, change: (state: SlackState | null) => SlackState) {
  await update($, slack, change)
  const state = await read($, slack)
  await update($, unread, () => (state ? unreadCount(state.inbox) : 0))
}

// /desk-slack 의 Slack 호출(slack.ts 참고). 엔진이 거절하면(서버가 끊김, 권한) 던지는 대신 오류 글로 돌려준다.
const SLACK_POLL_MS = 60_000
const CLOSE_ARM_MS = 5000

async function callSlack($: EngineInterface, server: SlackServer, call: SlackCall, key: string) {
  try {
    return resultText(await $.mcp.call(server.name, call.tool, call.args), key)
  } catch (error) {
    return { ok: false as const, error: (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '' }
  }
}

async function findSlack($: EngineInterface): Promise<SlackServer | null> {
  const tools = await $.tool.list().catch(() => [])
  return findSlackServer(tools.filter(tool => tool.mcp).map(tool => tool.name))
}

// allow 규칙이 없는 Slack 도구. unruled 에 하나라도 있으면 Slack 을 부르지 않는다(받은 편지 확인은 타이머라 물어볼 사람이 없다).
// 스레드 도구는 따로: 없으면 threadUnruled 에 이름이 들고 스레드만 열지 않는다.
async function slackUnruled($: EngineInterface, server: SlackServer): Promise<{ unruled: string[]; threadUnruled?: string }> {
  const tools = [...slackTools(server), slackThreadTool(server)]
  const verdicts = await Promise.all(tools.map(tool => $.tool.check({ tool, input: {} }).catch(() => null)))
  const missing = tools.filter((_, index) => verdicts[index]?.decision !== 'allow')
  const thread = slackThreadTool(server)
  return { unruled: missing.filter(tool => tool !== thread), ...(missing.includes(thread) ? { threadUnruled: thread } : {}) }
}

// $.store 는 떠 있는 세션끼리 같이 본다(2.1.302 실측). 모양이 다르면 빈 받은 편지.
async function readInbox($: EngineInterface): Promise<SlackInbox> {
  const kept = (await $.store.get('slackInbox').catch(() => undefined)) as SlackInbox | undefined
  return kept && typeof kept === 'object' && kept.rooms && typeof kept.rooms === 'object' ? kept : emptyInbox()
}

async function saveInbox($: EngineInterface, inbox: SlackInbox) {
  await $.store.set('slackInbox', inbox)
  await setSlack($, (state): SlackState => ({ status: state?.status ?? 'ok', server: state?.server ?? null, unruled: state?.unruled ?? [], threadUnruled: state?.threadUnruled, inbox, error: state?.error }))
}

// 내 Slack UID. 서버마다 한 번 읽어 둔다.
async function slackMe($: EngineInterface, server: SlackServer): Promise<string | null> {
  const kept = (await $.store.get('slackMe').catch(() => undefined)) as { server?: string; id?: string } | undefined
  if (kept?.server === server.name && typeof kept.id === 'string') return kept.id
  const got = await callSlack($, server, profileCall(), 'result')
  const me = got.ok ? parseMe(got.text) : null
  if (me) await $.store.set('slackMe', { server: server.name, id: me })
  return me
}

let slackPoll: Promise<void> | null = null

// 받은 편지 확인. 타이머(force false)는 맡은 세션 하나만 Slack 을 읽고 나머지는 store 만 비춘다.
// 패널을 열거나 ↻(force)는 맡은 세션이 아니어도 읽는다. 알림은 store 의 notified 뒤의 것만(세션끼리 겹치지 않게).
async function pollSlack($: EngineInterface, force: boolean) {
  if (slackPoll) return slackPoll
  slackPoll = (async () => {
    const shown = await read($, slack)
    const server = shown?.server ?? (await findSlack($))
    const kept = await readInbox($)
    const put = (state: Omit<SlackState, 'inbox'>, inbox = kept) => setSlack($, (): SlackState => ({ ...state, inbox }))
    if (server === null) return void (await put({ status: 'none', server: null, unruled: [] }))
    const rules = await slackUnruled($, server)
    if (rules.unruled.length > 0) return void (await put({ status: 'ok', server, ...rules }))
    const [session, now, surfaces] = await Promise.all([$.session.id().catch(() => ''), $.clock.now(), $.session.surfaces().catch((): readonly RenderSurface[] => [])])
    const poller = (await $.store.get('slackPoller').catch(() => undefined)) as SlackPoller | undefined
    // 터미널이 없는 세션(SDK 등)은 알림을 띄울 곳이 없어 맡지 않는다: 맡으면 아무도 알리지 않게 된다
    const canWatch = surfaces.includes('terminal')
    if (!force && (!canWatch || !holdsLease(poller ?? null, session, now))) return void (await put({ status: shown?.status === 'loading' ? 'ok' : (shown?.status ?? 'ok'), server, ...rules }))
    await $.store.set('slackPoller', { session, at: now })
    if (force) await put({ status: 'loading', server, ...rules })
    const me = await slackMe($, server)
    if (me === null) return void (await put({ status: 'failed', server, ...rules, error: T.slackNoUser }))
    const nowS = Math.floor(now / 1000)
    const afterS = kept.watermark === null ? nowS - FIRST_FILL_S : Number(kept.watermark.split('.')[0])
    const got = await callSlack($, server, inboxCall(me, afterS), 'results')
    if (!got.ok) return void (await put({ status: 'failed', server, ...rules, error: got.error }))
    // 그사이 다른 세션·패널이 방을 닫았을 수 있어 넣기 바로 앞에서 다시 읽는다
    const latest = await readInbox($)
    const merged = mergeInbox(latest, parseSearch(got.text), me, nowS)
    const fresh = merged.fresh.filter(message => latest.notified === null || tsCompare(message.ts, latest.notified) > 0)
    const inbox: SlackInbox = { ...merged.inbox, notified: fresh.length > 0 ? fresh[fresh.length - 1]!.ts : (latest.notified ?? merged.inbox.watermark) }
    await $.store.set('slackInbox', inbox)
    await put({ status: 'ok', server, ...rules }, inbox)
    if (!slackNotify) return
    for (const notice of notices(fresh, inbox, T.slackMore)) {
      void $.ui.notify(notice.text, { title: notice.title }).catch(() => undefined)
    }
  })().finally(() => {
    slackPoll = null
  })
  return slackPoll
}

async function openSlack($: EngineInterface) {
  const shown = pollSlack($, true).catch(() => undefined)
  await $.ui.open({ id: SLACK_PANE, title: 'Slack', focus: true })
  await shown
}

// 방을 열면(다시 읽어도) 기록을 읽고 그 방 안 읽음을 지운다. thread 가 있으면 채널 기록 대신 그 스레드(부모와 답글).
async function openSlackRoom($: EngineInterface, server: SlackServer, channel: string, thread: string | null = null) {
  const isSame = (view: SlackView | null) => view?.channel === channel && view.thread === thread
  // 방과 스레드를 오가면 쓰던 답장이 다른 곳으로 가지 않게 비운다
  if (!isSame(await read($, slackView))) slackDraft = ''
  await update($, slackView, (view): SlackView => ({ channel, thread, status: 'loading', posts: isSame(view) ? view!.posts : [] }))
  const got = await callSlack($, server, thread === null ? historyCall(channel) : threadCall(channel, thread), 'messages')
  const posts = got.ok ? (thread === null ? parseHistory(got.text) : parseThread(got.text)) : []
  await update($, slackView, (view): SlackView | null =>
    !isSame(view) ? view : got.ok ? { channel, thread, status: 'ok', posts } : { channel, thread, status: 'failed', posts: view!.posts, error: got.error },
  )
  if (!got.ok) return
  const me = (await $.store.get('slackMe').catch(() => undefined)) as { id?: string } | undefined
  await saveInbox($, readRoom(await readInbox($), channel, posts, me?.id ?? '', thread))
}

async function closeSlackView($: EngineInterface) {
  slackDraft = ''
  await update($, slackView, () => null)
}

async function clearSlackDraft($: EngineInterface, channel: string, thread: string | null) {
  slackDraft = ''
  slackSent++
  await update($, slackView, view => (view ? { ...view } : view))
  await $.ui.open({ id: SLACK_PANE, title: 'Slack', focus: true })
  await $.ui.focus({ requestId: SLACK_PANE, key: `slack-write-${channel}-${thread ?? 'room'}-${slackSent}` }).catch(() => undefined)
}

async function sendSlack($: EngineInterface, server: SlackServer, channel: string, thread: string | null, value: string) {
  const text = value.trim()
  if (text === '') return
  const call = sendCall(channel, text, thread)
  const problem = await $.mcp.call(server.name, call.tool, call.args).then(sendProblem, (error: unknown) => (error instanceof Error ? error.message : String(error)).split('\n')[0] || 'error')
  if (problem !== null) {
    $.ui.toast(T.slackSendFailed(problem))
    return
  }
  slackDraft = ''
  slackSent++
  $.ui.toast(T.slackSent)
  await openSlackRoom($, server, channel, thread)
}

// ✕ 는 두 번 눌러 닫는다(Asana 담당자 넘기기와 같은 무장). channel 이 null 이면 모든 방(모두 닫기).
async function armSlackClose($: EngineInterface, channel: string | null, isArmed: boolean) {
  const key = `slack:close:${channel ?? '*'}`
  if (!isArmed) {
    await update($, open, state => ({ ...state, [key]: true }))
    $.clock.after(CLOSE_ARM_MS, () => void update($, open, state => ({ ...state, [key]: false })))
    return
  }
  await update($, open, state => ({ ...state, [key]: false }))
  const inbox = await readInbox($)
  await saveInbox($, channel === null ? { ...inbox, rooms: {} } : closeRoom(inbox, channel))
  const view = await read($, slackView)
  if (view !== null && (channel === null || view.channel === channel)) await closeSlackView($)
}

// 세션마다 비워지는 상태를 다시 채운다: 세션이 시작될 때와 창 안에서 다른 세션으로 넘어간 뒤(/resume·/clear).
function refreshSessionState($: EngineInterface) {
  void update($, ready, () => true).catch(() => undefined)
  // 받은 편지 칩은 store 에서 바로.
  void readInbox($)
    .then(inbox => setSlack($, (state): SlackState => state ?? { status: 'loading', server: null, unruled: [], inbox }))
    .catch(() => undefined)
}

// desk-look 의 /desk-fold 를 따라 접고 편다: desk-look 이 folded 에 목록을 쓰면(접을 desk-look 패널이 없으면 빈 목록)
// 이 플러그인의 패널도 접고, null 을 쓰면 접어 둔 것을 다시 연다. 엔진은 다른 플러그인의 패널을 닫게 하지 않는다.
async function followFold($: EngineInterface, isFolding: boolean) {
  if (isFolding) {
    const panes = (await $.ui.panes()).filter(pane => pane.isPlaced)
    if (panes.length === 0) return
    // 이미 접어 둔 것이 있으면 새로 접는 것을 더한다(desk-look 의 toggleFold 와 같다).
    const saved = await read($, folded)
    const fresh = panes.map(pane => ({ id: pane.id, title: pane.title, isShown: pane.isShown, offset: 0 }))
    await update($, folded, () => [...(saved ?? []).filter(pane => !fresh.some(item => item.id === pane.id)), ...fresh])
    for (const pane of panes) await $.ui.close({ id: pane.id }).catch(() => undefined)
    return
  }
  const saved = await read($, folded)
  await update($, folded, () => null)
  for (const pane of saved ?? []) await $.ui.open({ id: pane.id, title: pane.title, ...(pane.isShown ? { focus: true as const } : {}) })
}

// 설정 language 가 auto 일 때: desk-look 이 있으면 desk-look 이 고른 언어, 없으면 Claude Code /config 의 language.
async function pickLang($: EngineInterface) {
  const { value } = await $.state.get({ plugin: 'desk-look', key: 'lang' })
  if (value === 'en' || value === 'ko') return setLang(value)
  const row = (await $.config.list().catch(() => [])).find(item => item.key === 'language')
  return setLang(langFromConfig(row?.value))
}

export const register: Register = (on, options) => {
  const language = langSetting(options)
  setLang(language === 'auto' ? 'en' : language)
  slackNotify = options.slackNotify !== 'off'

  on('session.start', async ($, e, next) => {
    if (language === 'auto' && (await pickLang($).catch(() => false))) $.ui.invalidate('ui.render')
    // 패널만 여는 명령은 턴 중에도 바로 연다(immediate).
    await $.command.register({ name: 'desk-slack', description: T.cmdSlack, immediate: true })
    refreshSessionState($)
    // Slack 확인은 1분마다(MCP 서버는 시작 뒤에 붙는다).
    slackWatch?.cancel()
    slackWatch = $.clock.every(SLACK_POLL_MS, () => void pollSlack($, false).catch(() => undefined))
    return next(e)
  })

  // 창 안의 /resume·/clear 는 상태(atom)를 비우고 session.start 없이 이어 간다. 넘어간 뒤 다시 채운다.
  on('session.end', async ($, e, next) => {
    const done = await next(e)
    if (e.reason === 'resume' || e.reason === 'clear') $.clock.after(300, () => refreshSessionState($))
    return done
  })

  on('state.set', { plugin: 'desk-look', key: 'lang' }, async ($, e, next) => {
    const done = await next(e)
    if (language === 'auto' && (e.value === 'en' || e.value === 'ko') && setLang(e.value)) $.ui.invalidate('ui.render')
    return done
  }).catch(($, e, next) => next(e))

  on('state.set', { plugin: 'desk-look', key: 'folded' }, async ($, e, next) => {
    const done = await next(e)
    await followFold($, e.value !== null).catch(() => undefined)
    return done
  }).catch(($, e, next) => next(e))

  // desk-look 아래턱의 ✉ 칩: 누를 때마다 slackOpen 이 오른다. $.command.run('desk-slack') 은 턴이 끝날 때까지
  // 줄을 서서 턴 중에는 열리지 않았다.
  on('state.set', { plugin: 'desk-look', key: 'slackOpen' }, async ($, e, next) => {
    const done = await next(e)
    await openSlack($).catch(() => undefined)
    return done
  }).catch(($, e, next) => next(e))

  // 패널이 열려 있는지 desk-look 에 알린다. 사람이 ✕ 로 닫아도, 플러그인을 내려도 ui.close 가 온다.
  on('ui.open', { id: SLACK_PANE }, async ($, e, next) => {
    const opened = await next(e)
    if (opened.value?.isPlaced) await update($, shown, () => true).catch(() => undefined)
    return opened
  })

  on('ui.close', { id: SLACK_PANE }, async ($, e, next) => {
    const done = await next(e)
    await update($, shown, () => false).catch(() => undefined)
    return done
  })

  on('command.run', { command: 'desk-slack' }, async $ => {
    await openSlack($)
    const state = await read($, slack)
    return { text: state?.status === 'none' ? T.slackNoServer : T.slackOpened }
  })

  // Slack 패널: 나에게 온 DM·그룹 DM 을 대화방으로(최근 방부터), 하나를 누르면 그 방의 최근 대화와 답장.
  // 마지막 글이 스레드 답글인 방은 그 스레드로 열린다. 방 안의 "답글 N개" 를 누르면 그 스레드, ← 는 방으로.
  on('ui.render', { component: 'Pane', requestId: SLACK_PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Input, Link } = els
    const [state, view, armed, now, me] = await Promise.all([read($, slack), read($, slackView), read($, open), $.clock.now(), $.store.get('slackMe').catch(() => undefined)])
    const columns = Math.max(24, e.props.bodyColumns)
    const server = state?.server ?? null
    const myId = (me as { id?: string } | undefined)?.id ?? ''
    const when = (ts: string) => ago(Number(ts.split('.')[0]) * 1000, now)
    // 스레드 도구에 규칙이 없으면 "답글 N개" 는 글자만, 방 위에 넣을 규칙
    const canThread = state?.threadUnruled === undefined
    const closer = (room: SlackRoom) => {
      const isArmed = armed[`slack:close:${room.id}`] ?? false
      return <Button key={`slack-close-${room.id}`} plain dimColor={!isArmed} label={isArmed ? T.slackCloseConfirm : '✕'} onPress={() => void armSlackClose($, room.id, isArmed)} />
    }

    const room = view === null ? undefined : state?.inbox.rooms[view.channel]
    if (view !== null && server !== null) {
      const title = room?.title ?? view.channel
      // 글이 길게 쌓이면 위로 되돌아가지 않도록 답장 칸 아래에도 같은 버튼을 둔다.
      const back = (key: string) => (
        <Button
          key={key}
          plain
          dimColor
          hotkey={key === 'slack-back' ? 'b' : undefined}
          label={view.thread === null ? T.slackBack : `← ${title}`}
          onPress={() => void (view.thread === null ? closeSlackView($) : openSlackRoom($, server, view.channel))}
        />
      )
      return (
        <Box flexDirection="column" rowGap={1}>
          <Box columnGap={1}>
            {back('slack-back')}
            <Button key="slack-reload" plain dimColor hotkey="r" label={view.status === 'loading' ? '…' : '↻'} onPress={() => void openSlackRoom($, server, view.channel, view.thread)} />
          </Box>
          <Box flexDirection="column">
            <Text color={COLORS.text} weight="semibold">
              {title}
            </Text>
            <Box columnGap={2}>
              {room && <Button key="slack-claude" plain label={T.handToClaude} onPress={() => void fillPrompt($, slackPrompt(room, view.posts, T.slackPromptHead(title)))} />}
              {room?.link && <Link href={room.link}>{T.slackOpenOn}</Link>}
              {room && closer(room)}
            </Box>
          </Box>
          {view.status === 'failed' && <Text color={COLORS.danger}>{T.slackFailed(view.error ?? '')}</Text>}
          {!canThread && view.posts.some(post => post.replies > 0) && (
            <Box flexDirection="column">
              <Text color={COLORS.warning}>{T.slackThreadUnruled}</Text>
              <Text color={COLORS.muted}>{`"${state?.threadUnruled}",`}</Text>
            </Box>
          )}
          {view.posts.length === 0 && view.status === 'loading' && <Text color={COLORS.muted}>{T.slackLoading}</Text>}
          {view.posts.map(post => (
            <Box key={`slack-post-${post.ts}`} flexDirection="column">
              <Box columnGap={1}>
                <Text color={post.from.id === myId ? COLORS.muted : COLORS.accent}>{post.from.id === myId ? T.slackMe : post.from.name}</Text>
                <Text color={COLORS.muted}>{when(post.ts)}</Text>
              </Box>
              <Text color={COLORS.text}>{slackText(post.text)}</Text>
              {view.thread === null && post.replies > 0 && (
                <Box>
                  {canThread ? (
                    <Button key={`slack-thread-${post.ts}`} plain label={T.slackReplies(post.replies)} onPress={() => void openSlackRoom($, server, view.channel, post.ts)} />
                  ) : (
                    <Text color={COLORS.muted}>{T.slackReplies(post.replies)}</Text>
                  )}
                </Box>
              )}
            </Box>
          ))}
          <Input
            key={`slack-write-${view.channel}-${view.thread ?? 'room'}-${slackSent}`}
            label={T.slackReplyLabel}
            placeholder={view.thread === null ? T.slackReplyPlaceholder(title) : T.slackThreadPlaceholder}
            rows={COMMENT_ROWS}
            value={slackDraft}
            submitLabel={T.slackSend}
            onInput={value => (slackDraft = value)}
            onSubmit={value => void sendSlack($, server, view.channel, view.thread, value)}
          />
          <Box columnGap={2}>
            {back('slack-back-end')}
            <Button key="slack-clear" plain dimColor label={T.inputClear} onPress={() => void clearSlackDraft($, view.channel, view.thread)} />
          </Box>
        </Box>
      )
    }

    const rooms = state ? roomList(state.inbox) : []
    const unread = state ? unreadCount(state.inbox) : 0
    const isLoading = state === null || state.status === 'loading'
    const head = (
      <Box columnGap={1}>
        <Text color={COLORS.text} weight="semibold">
          {T.slackInbox(rooms.length, unread)}
        </Text>
        <Button key="slack-refresh" plain dimColor hotkey="r" label={isLoading ? '…' : '↻'} onPress={() => void pollSlack($, true).catch(() => undefined)} />
        {rooms.length > 0 && (
          <Button
            key="slack-close-all"
            plain
            dimColor={!(armed['slack:close:*'] ?? false)}
            label={(armed['slack:close:*'] ?? false) ? T.slackCloseAllConfirm : T.slackCloseAll}
            onPress={() => void armSlackClose($, null, armed['slack:close:*'] ?? false)}
          />
        )}
      </Box>
    )
    const unruled = (state?.unruled.length ?? 0) > 0 && (
      <Box flexDirection="column">
        <Text color={COLORS.warning}>{T.slackUnruled}</Text>
        <Text color={COLORS.muted}>{state?.unruled.map(tool => `"${tool}",`).join('\n')}</Text>
      </Box>
    )
    const message =
      state?.status === 'none'
        ? T.slackNoServer
        : state?.status === 'failed'
          ? T.slackFailed(state.error ?? '')
          : rooms.length === 0
            ? isLoading
              ? T.slackLoading
              : T.slackEmpty
            : null
    // 줄: "● 이름  미리보기  3분 전" 한 줄 전체가 버튼, 끝에 ✕(닫기). 이름은 열의 1/4, 나머지를 미리보기에.
    const nameRoom = Math.max(8, Math.floor(columns / 4))
    const rows = rooms.map(item => {
      const age = when(item.lastTs)
      const lead = item.lastFrom === null ? `${T.slackMe}: ` : item.kind === 'group' ? `${item.lastFrom}: ` : ''
      const room = Math.max(8, columns - nameRoom - cellWidth(age) - 10)
      return (
        <Box key={`slack-row-${item.id}`} columnGap={1}>
          {rowButton(
            els,
            { key: `slack-room-${item.id}`, dimColor: item.unread === 0, onPress: () => void (server && openSlackRoom($, server, item.id, canThread ? (item.lastThread ?? null) : null)) },
            `${item.unread > 0 ? '●' : ' '} ${clip(item.title, nameRoom)}`,
            <Text color={COLORS.muted}>{`  ${clip(`${lead}${item.preview}`, room)}`}</Text>,
            <Text color={COLORS.muted}>{` ${age}`}</Text>,
          )}
          {closer(item)}
        </Box>
      )
    })
    return (
      <Box flexDirection="column" rowGap={1}>
        {head}
        {unruled}
        {message !== null && <Text color={state?.status === 'failed' ? COLORS.danger : COLORS.muted}>{message}</Text>}
        {rows.length > 0 && <Box flexDirection="column">{rows}</Box>}
      </Box>
    )
  })
}
