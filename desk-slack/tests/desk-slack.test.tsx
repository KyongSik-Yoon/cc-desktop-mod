import type { On, RenderSurface } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { LEASE_MS, closeRoom, emptyInbox, findSlackServer, holdsLease, inboxCall, mergeInbox, notices, parseHistory, parseMe, parseSearch, parseThread, readRoom, resultText, roomList, sendCall, slackText, tsCompare, unreadCount } from '../hooks/slack'

const KO = { options: { language: 'ko' } }
const VIEWPORT = { columns: 100, rows: 40 }
// 테스트 환경의 실제 시간 대기(타입 정의에 setTimeout 이 없어 globalThis 로).
const wait = (ms: number) =>
  new Promise<void>(resolve => (globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => void }).setTimeout(resolve, ms))

describe('Slack 패널', () => {
  // claude.ai Slack 커넥터가 주는 글 모양 그대로(이름·주소는 가짜).
  const ME = 'U0ME'
  const result = (i: number, n: number, m: { channel: string; kind: 'DM' | 'Group DM'; people: string; from: string; fromId: string; ts: string; text: string; thread?: string }) =>
    [
      `### Result ${i} of ${n}`,
      `Channel: ${m.kind} (ID: ${m.channel})`,
      `Participants: ${m.people}`,
      `From: ${m.from} (ID: ${m.fromId}) `,
      'Time: 2026-10-16 15:24:20 KST',
      `Message_ts: ${m.ts}`,
      `Permalink: [link](https://example.slack.com/archives/${m.channel}/p${m.ts.replace('.', '')}${m.thread ? `?thread_ts=${m.thread}&cid=${m.channel}` : ''})`,
      'Text: ',
      m.text,
      '',
      '---',
      '',
    ].join('\n')
  const KEVIN = { channel: 'D01', kind: 'DM' as const, people: 'Me Myself (ID: U0ME), kevin (ID: U0KV)', from: 'kevin <kevin@example.com>', fromId: 'U0KV' }
  const GROUP = { channel: 'C02', kind: 'Group DM' as const, people: 'alvin (ID: U0AL), Me Myself (ID: U0ME), bot-x (ID: U0BX)', from: 'alvin <alvin@example.com>', fromId: 'U0AL' }
  const search = (...items: Array<Parameters<typeof result>[2]>) =>
    `# Search Results for: \n\n## Messages (${items.length} results)\n${items.map((item, index) => result(index + 1, items.length, item)).join('\n')}`
  const HISTORY = [
    'Channel: DM (D01)',
    '',
    '=== Message from me <me@example.com> (U0ME) at 2026-10-16 15:34:52 KST === ',
    'Message TS: 1792132492.915909',
    '오오... <https://example.com/a|링크>',
    '',
    '=== Message from kevin <kevin@example.com> (U0KV) at 2026-10-16 15:24:20 KST === ',
    'Message TS: 1792131860.241069',
    '{"pid":12029}',
    'Files: a.jpg (ID: F01, image/jpeg, 1.0 KB)',
    'Thread: 2 replies (latest: 2026-10-16 15:40:00 KST)',
  ].join('\n')
  const THREAD = [
    '=== THREAD PARENT MESSAGE ===',
    'From: kevin <kevin@example.com> (U0KV)',
    'Time: 2026-10-16 15:24:20 KST',
    'Message TS: 1792131860.241069',
    '{"pid":12029}',
    '',
    '=== THREAD REPLIES (2 total) ===',
    '',
    '--- Reply 1 of 2 ---',
    'From: me <me@example.com> (U0ME)',
    'Time: 2026-10-16 15:30:00 KST',
    'Message TS: 1792132200.000001',
    '봤어요',
    '',
    '--- Reply 2 of 2 ---',
    'From: kevin <kevin@example.com> (U0KV)',
    'Time: 2026-10-16 15:40:00 KST',
    'Message TS: 1792132800.000001',
    '스레드 새 글',
    '',
  ].join('\n')

  test('응답 읽기: 검색은 DM·그룹 DM 만, 기록은 오래된 것부터, 링크 글, ts 비교', async () => {
    const got = parseSearch(search({ ...KEVIN, ts: '1792131860.241069', text: '{"a":1}\n둘째 줄' }, { ...GROUP, ts: '1790756351.080449', text: '이거봐요' }))
    expect(got).toHaveLength(2)
    expect(got[0]).toEqual({
      channel: 'D01',
      kind: 'dm',
      participants: [
        { id: 'U0ME', name: 'Me Myself' },
        { id: 'U0KV', name: 'kevin' },
      ],
      from: { id: 'U0KV', name: 'kevin' },
      ts: '1792131860.241069',
      text: '{"a":1}\n둘째 줄',
      permalink: 'https://example.slack.com/archives/D01/p1792131860241069',
      thread: null,
    })
    // 스레드 답글은 Permalink 의 thread_ts 로 부모를 안다
    expect(parseSearch(search({ ...KEVIN, ts: '1792132800.000001', text: 'x', thread: '1792131860.241069' }))[0]?.thread).toBe('1792131860.241069')
    expect(got[1]?.kind).toBe('group')
    // 채널 메시지는 범위 밖이라 버린다
    expect(parseSearch(search({ ...KEVIN, kind: 'DM', ts: '1.1', text: 'x' }).replace('Channel: DM (ID: D01)', 'Channel: #general (ID: C9)'))).toEqual([])
    const posts = parseHistory(HISTORY)
    expect(posts.map(post => [post.from.name, post.ts])).toEqual([
      ['kevin', '1792131860.241069'],
      ['me', '1792132492.915909'],
    ])
    // 답글 수 줄은 본문에서 빠져 replies 로
    expect(posts[0]?.text).toBe('{"pid":12029}\nFiles: a.jpg (ID: F01, image/jpeg, 1.0 KB)')
    expect(posts.map(post => post.replies)).toEqual([2, 0])
    expect(parseThread(THREAD).map(post => [post.from.name, post.ts, post.text, post.at])).toEqual([
      ['kevin', '1792131860.241069', '{"pid":12029}', '2026-10-16 15:24:20 KST'],
      ['me', '1792132200.000001', '봤어요', '2026-10-16 15:30:00 KST'],
      ['kevin', '1792132800.000001', '스레드 새 글', '2026-10-16 15:40:00 KST'],
    ])
    expect(sendCall('D01', 'a', '1.2').args).toEqual({ channel_id: 'D01', message: 'a', thread_ts: '1.2' })
    expect(slackText(posts[1]!.text)).toBe('오오... 링크')
    expect(parseMe('User ID: U0ME\nUsername: me\n')).toBe('U0ME')
    expect(resultText({ content: [{ type: 'text', text: JSON.stringify({ messages: HISTORY }) }], isError: false }, 'messages')).toEqual({ ok: true, text: HISTORY })
    expect(resultText({ content: [{ type: 'text', text: 'channel_not_found' }], isError: true }, 'messages')).toEqual({ ok: false, error: 'channel_not_found' })
    expect(tsCompare('1792131860.241069', '1792131860.24107')).toBeLessThan(0)
    expect(tsCompare('999.9', '1000.0')).toBeLessThan(0)
    expect(findSlackServer(['mcp__claude_ai_Slack__slack_read_channel', 'mcp__asana-v2__get_me'])).toBeNull()
    // deny 규칙이 걸린 도구는 목록에 없어도 서버는 찾는다(빠진 도구는 규칙 안내로)
    expect(findSlackServer(['mcp__claude_ai_Slack__slack_search_public_and_private', 'mcp__claude_ai_Slack__slack_read_channel'])).toEqual({ name: 'claude_ai_Slack' })
  })

  test('대화방: 처음 채우기는 알리지 않고, 그 뒤 새 메시지만 방에, 닫은 방은 새 메시지가 와야 다시', () => {
    const now = 1792200000
    const first = mergeInbox(emptyInbox(), parseSearch(search({ ...KEVIN, ts: '1792131860.241069', text: 'a' })), ME, now)
    expect(first.fresh).toEqual([])
    expect(first.inbox.watermark).toBe('1792131860.241069')
    expect(first.inbox.rooms.D01).toMatchObject({ title: 'kevin', unread: 0, link: 'https://example.slack.com/archives/D01' })
    // 받은 게 없어도 워터마크는 지금으로: 다음 메시지는 알린다
    expect(mergeInbox(emptyInbox(), [], ME, now).inbox.watermark).toBe(`${now}.000000`)

    const again = parseSearch(search({ ...GROUP, ts: '1792131900.000001', text: '새 글' }, { ...KEVIN, ts: '1792131860.241069', text: 'a' }))
    const second = mergeInbox(first.inbox, again, ME, now)
    expect(second.fresh.map(message => message.ts)).toEqual(['1792131900.000001'])
    expect(second.inbox.rooms.C02).toMatchObject({ title: 'alvin, bot-x', lastFrom: 'alvin', preview: '새 글', unread: 1 })
    expect(roomList(second.inbox).map(room => room.id)).toEqual(['C02', 'D01'])
    expect(unreadCount(second.inbox)).toBe(1)
    expect(notices(second.fresh, second.inbox, n => ` +${n}`)).toEqual([{ title: 'alvin, bot-x', text: 'alvin: 새 글' }])

    const closed = closeRoom(second.inbox, 'D01')
    expect(closed.rooms.D01).toBeUndefined()
    // 같은 메시지를 다시 받아도 닫은 방은 그대로 닫혀 있고, 새 메시지면 다시 생긴다
    expect(mergeInbox(closed, again, ME, now).inbox.rooms.D01).toBeUndefined()
    const reopened = mergeInbox(closed, parseSearch(search({ ...KEVIN, ts: '1792132000.5', text: '또' })), ME, now)
    expect(reopened.inbox.rooms.D01).toMatchObject({ unread: 1, preview: '또' })

    // 방을 읽으면 안 읽음 0, 기록의 마지막 글이 내 답장이면 lastFrom null
    const read = readRoom(reopened.inbox, 'D01', [{ ts: '1792132100.1', from: { id: ME, name: 'me' }, at: '', text: '답장', replies: 0 }], ME)
    expect(read.rooms.D01).toMatchObject({ unread: 0, lastFrom: null, lastThread: null, preview: '답장' })

    // 마지막 글이 스레드 답글이면 방이 그 스레드를 기억한다
    const threaded = mergeInbox(read, parseSearch(search({ ...KEVIN, ts: '1792132800.000001', text: '스레드 새 글', thread: '1792131860.241069' })), ME, now)
    expect(threaded.inbox.rooms.D01).toMatchObject({ unread: 1, lastThread: '1792131860.241069', preview: '스레드 새 글' })
  })

  test('받은 편지를 읽을 세션(임대)과 받은 편지 호출 모양', () => {
    expect(holdsLease(null, 's1', 0)).toBe(true)
    expect(holdsLease({ session: 's1', at: 0 }, 's1', 10)).toBe(true)
    expect(holdsLease({ session: 's2', at: 0 }, 's1', LEASE_MS)).toBe(false)
    expect(holdsLease({ session: 's2', at: 0 }, 's1', LEASE_MS + 1)).toBe(true)
    expect(inboxCall(ME, 100).args).toMatchObject({ filters: 'to:<@U0ME>', channel_types: 'im,mpim', after: '100', sort: 'timestamp' })
  })

  // 엔진 흉내: 도구 목록·규칙·MCP 응답. rules 가 false 인 도구는 allow 규칙이 없다.
  // isClockMocked: 시계는 테스트가 mock.clock 으로 따로 돌린다.
  function slackEngine(on: On, inbox: () => string, options: { rules?: (tool: string) => boolean; surfaces?: () => RenderSurface[]; isClockMocked?: boolean; store?: Record<string, unknown> } = {}) {
    const { rules = () => true, surfaces = () => ['terminal'] } = options
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = []
    const notified: Array<{ text: string; title?: string }> = []
    const text = (value: unknown, isError = false) => ({ value: { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], isError } })
    // 받은 편지·내 UID·임대는 $.store 에
    mock.store(on, options.store)
    if (!options.isClockMocked) {
      on('clock.now', () => ({ value: 1792200000 * 1000 }))
      on('clock.after', () => new Promise(() => undefined) as never)
    }
    on('session.id', () => ({ value: 'sess-1' }))
    on('session.surfaces', () => ({ value: surfaces() }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.toast', () => ({ value: undefined as never }))
    on('ui.notify', ($, e) => {
      notified.push(e)
      return { value: { isSent: true, channel: 'ghostty' } }
    })
    on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
    on('tool.list', () => ({
      value: ['slack_search_public_and_private', 'slack_read_channel', 'slack_read_thread', 'slack_send_message', 'slack_read_user_profile'].map(name => ({ name: `mcp__claude_ai_Slack__${name}`, description: '', mcp: true })),
    }))
    on('tool.check', ($, e) => ({ decision: rules(e.tool) ? 'allow' : 'ask' }) as never)
    on('mcp.call', ($, e) => {
      calls.push({ tool: e.tool, args: e.args })
      switch (e.tool) {
        case 'slack_read_user_profile':
          return text({ result: `User ID: ${ME}\nUsername: me\n` })
        case 'slack_search_public_and_private':
          return text({ results: inbox() })
        case 'slack_read_channel':
          return text({ messages: HISTORY })
        case 'slack_read_thread':
          return text({ messages: THREAD })
        default:
          return text({ ok: true })
      }
    })
    return { calls, notified }
  }

  test('allow 규칙이 하나라도 없으면 Slack 을 부르지 않고 넣을 규칙을 보인다', KO, async ($, on) => {
    const { calls } = slackEngine(on, () => search(), { rules: tool => !tool.endsWith('slack_send_message') })
    await $.command.run({ command: 'desk-slack', args: '' } as never)
    expect(calls).toEqual([])
    const pane = await $.ui.mount({ plugin: 'desk-slack', surface: 'terminal', component: 'Pane', requestId: 'desk-slack', viewport: VIEWPORT, props: { title: 'Slack', isFocused: true, bodyColumns: 96 } as never })
    const drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('허용 규칙이 없어')
    expect(drawn).toContain('\\"mcp__claude_ai_Slack__slack_send_message\\",')
    expect(drawn).not.toContain('slack_read_channel\\"')
    await pane.unmount()
  })

  test('스레드 도구만 규칙이 없으면 확인·방 상세는 돌고 스레드는 열지 않고 넣을 규칙을 보인다', KO, async ($, on) => {
    const inbox = search({ ...KEVIN, ts: '1792131860.241069', text: 'a' })
    const { calls } = slackEngine(on, () => inbox, { rules: tool => !tool.endsWith('slack_read_thread') })
    await $.command.run({ command: 'desk-slack', args: '' } as never)
    expect(calls.map(call => call.tool)).toEqual(['slack_read_user_profile', 'slack_search_public_and_private'])
    const pane = await $.ui.mount({ plugin: 'desk-slack', surface: 'terminal', component: 'Pane', requestId: 'desk-slack', viewport: VIEWPORT, props: { title: 'Slack', isFocused: true, bodyColumns: 96 } as never })
    expect(JSON.stringify(await pane.drawn())).not.toContain('허용 규칙이 없어')
    await pane.press({ key: 'slack-room-D01' })
    await wait(50)
    expect(calls.at(-1)?.tool).toBe('slack_read_channel')
    const drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('답글 2개')
    expect(drawn).toContain('스레드 답글은 열지 않아요')
    expect(drawn).toContain('\\"mcp__claude_ai_Slack__slack_read_thread\\",')
    await expect(pane.press({ key: 'slack-thread-1792131860.241069' })).rejects.toThrow()
    expect(calls.some(call => call.tool === 'slack_read_thread')).toBe(false)
    await pane.unmount()
  })

  test('1분 확인: 맡은 세션이 3분 넘게 소식이 없으면 넘겨받되, 터미널이 없는 세션은 맡지 않는다', KO, async ($, on) => {
    let surfaces: RenderSurface[] = []
    const clock = mock.clock(on, { now: 1792200000 * 1000 })
    const { calls } = slackEngine(on, () => search(), { surfaces: () => surfaces, isClockMocked: true, store: { slackPoller: { session: 'other', at: 0 } } })
    on('command.register', () => ({ value: undefined as never }))
    on('session.start', ($, e) => e as never)
    await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal' } as never)
    await clock.advance(60_000)
    expect(calls).toEqual([])
    surfaces = ['terminal']
    await clock.advance(60_000)
    expect(calls.map(call => call.tool)).toEqual(['slack_read_user_profile', 'slack_search_public_and_private'])
  })

  test('목록 → 대화방 → 답장, 닫기는 두 번, 새 메시지는 알림과 칩', KO, async ($, on) => {
    let inbox = search({ ...KEVIN, ts: '1792131860.241069', text: '등록이 안 돼요' })
    const { calls, notified } = slackEngine(on, () => inbox)
    // desk-look 의 아래턱 ✉ 칩이 읽는 안 읽은 수: desk-slack 이 쓴 마지막 값
    let unread: unknown = undefined
    on('state.set', { plugin: 'desk-slack', key: 'unread' }, ($, e, next) => {
      unread = e.value
      return next(e)
    })
    await $.command.run({ command: 'desk-slack', args: '' } as never)
    expect(calls.map(call => call.tool)).toEqual(['slack_read_user_profile', 'slack_search_public_and_private'])
    // 처음 채우기는 알리지 않는다
    expect(notified).toEqual([])
    const pane = await $.ui.mount({ plugin: 'desk-slack', surface: 'terminal', component: 'Pane', requestId: 'desk-slack', viewport: VIEWPORT, props: { title: 'Slack', isFocused: true, bodyColumns: 96 } as never })
    let drawn = JSON.stringify(await pane.drawn())
    // 처음 채운 것은 읽은 것으로(Slack 의 읽음을 알 수 없다): 안 읽음 표시·칩 없음
    expect(drawn).toContain('대화방 1')
    expect(drawn).not.toContain('안 읽음')
    expect(drawn).toContain('  kevin')
    expect(drawn).toContain('등록이 안 돼요')
    expect(unread).toBe(0)

    await pane.press({ key: 'slack-room-D01' })
    await wait(50)
    drawn = JSON.stringify(await pane.drawn())
    expect(calls.at(-1)).toEqual({ tool: 'slack_read_channel', args: { channel_id: 'D01', limit: 30, response_format: 'detailed' } })
    expect(drawn).toContain('{\\"pid\\":12029}')
    expect(drawn).toContain('오오... 링크')
    // 패널을 골라도 답장 칸이 고리를 가져가지 않아야 r·b 가 눌린다
    expect(drawn).not.toContain('autoFocus')

    // 답글이 달린 글은 "답글 N개" 버튼, 누르면 스레드, ← 는 방으로
    expect(drawn).toContain('답글 2개')
    await pane.press({ key: 'slack-thread-1792131860.241069' })
    await wait(50)
    expect(calls.at(-1)).toEqual({ tool: 'slack_read_thread', args: { channel_id: 'D01', message_ts: '1792131860.241069', limit: 30, response_format: 'detailed' } })
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('스레드 새 글')
    expect(drawn).toContain('← kevin')
    await pane.input({ key: 'slack-write-D01-1792131860.241069-0', text: '스레드 답장' })
    await wait(50)
    expect(calls.findLast(call => call.tool === 'slack_send_message')?.args).toEqual({ channel_id: 'D01', message: '스레드 답장', thread_ts: '1792131860.241069' })
    expect(calls.at(-1)?.tool).toBe('slack_read_thread')
    await pane.press({ key: 'slack-back-end' })
    await wait(50)
    expect(calls.at(-1)?.tool).toBe('slack_read_channel')

    await pane.input({ key: 'slack-write-D01-room-1', text: '확인해 볼게요\n잠시만요' })
    await wait(50)
    expect(calls.findLast(call => call.tool === 'slack_send_message')?.args).toEqual({ channel_id: 'D01', message: '확인해 볼게요\n잠시만요' })
    // 지우기: 쓴 답장을 비운 칸을 새 키로 그린다
    await pane.input({ key: 'slack-write-D01-room-2', text: '붙여 넣은\n긴 글', kind: 'change' })
    await pane.press({ key: 'slack-clear' })
    expect(JSON.stringify(await pane.find({ key: 'slack-write-D01-room-3' }))).toContain('"value":""')

    // 새 글이 스레드 답글이면 목록에서 방을 눌러도 그 스레드로 바로 연다(채널 기록에는 답글이 없다)
    inbox = search({ ...KEVIN, ts: '1792198500.000001', text: '스레드 새 글', thread: '1792131860.241069' })
    await pane.press({ key: 'slack-back' })
    await pane.press({ key: 'slack-refresh' })
    await wait(50)
    expect(notified).toEqual([{ text: '스레드 새 글', title: 'kevin' }])
    await pane.press({ key: 'slack-room-D01' })
    await wait(50)
    expect(calls.at(-1)?.tool).toBe('slack_read_thread')
    await pane.press({ key: 'slack-back' })
    await wait(50)

    // 새 메시지: 방마다 알림 하나
    inbox = search({ ...GROUP, ts: '1792199000.000001', text: '이거봐요' }, { ...GROUP, ts: '1792199100.000001', text: '<https://example.com|여기>' })
    await pane.press({ key: 'slack-back' })
    await pane.press({ key: 'slack-refresh' })
    await wait(50)
    expect(notified.slice(1)).toEqual([{ text: 'alvin: 여기 (외 1개)', title: 'alvin, bot-x' }])
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('대화방 2 · 안 읽음 2')
    expect(drawn).toContain('● alvin, bot-x')
    // desk-look 의 아래턱 칩이 읽는 안 읽음 수
    expect(unread).toBe(2)
    // 같은 결과를 다시 받아도 또 알리지 않는다
    await pane.press({ key: 'slack-refresh' })
    await wait(50)
    expect(notified).toHaveLength(2)

    // 닫기: 한 번 누르면 확인 문구, 다시 눌러야 닫힌다
    await pane.press({ key: 'slack-close-C02' })
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('닫을까요?')
    await pane.press({ key: 'slack-close-C02' })
    await wait(50)
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).not.toContain('alvin')
    expect(drawn).toContain('kevin')

    // 모두 닫기도 두 번 눌러야, 닫은 방은 새 메시지가 와야 다시 뜬다
    await pane.press({ key: 'slack-close-all' })
    expect(JSON.stringify(await pane.drawn())).toContain('모두 닫을까요?')
    await pane.press({ key: 'slack-close-all' })
    await wait(50)
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).not.toContain('kevin')
    expect(drawn).toContain('대화방 0')
    expect(await pane.find({ type: 'Button', key: 'slack-close-all' })).toBeUndefined()
    inbox = search({ ...KEVIN, ts: '1792199200.000001', text: '다시 왔어요' })
    await pane.press({ key: 'slack-refresh' })
    await wait(50)
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('kevin')
    expect(drawn).not.toContain('alvin')
    await pane.unmount()
  })
})
