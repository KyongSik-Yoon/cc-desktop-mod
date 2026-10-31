import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { PlanAskState, PlanPreview } from '../types'
import { CANCEL_REASON, DISMISS_REASON, isBridgedRecord, isMarkdown, planAskMode, planInput, planTextRows, planTitle, reviseReason } from './plan'
import type { PlanReply } from './plan'
import { T, langSetting, setLang } from './i18n'

// 엔진 테마 키(desk-look 의 COLORS 와 같은 역할). hex 를 박으면 터미널 테마와 어긋난다.
const COLORS = {
  text: 'text',
  muted: 'inactive',
  clay: 'claude',
} as const

const planAsking = atom({ plugin: 'desk-plan', key: 'planAsk' } as const, null as PlanAskState | null)
const preview = atom({ plugin: 'desk-plan', key: 'preview' } as const, null as PlanPreview | null)
// desk-look 의 값: 떠 있는 질문 카드(겹쳐 띄우지 않는다), 마지막 사람 입력이 온 곳(폰·Remote Control 이면 엔진 창).
const asking = atom({ plugin: 'desk-look', key: 'ask' } as const, null as { id: string } | null)
const promptOrigin = atom({ plugin: 'desk-look', key: 'promptOrigin' } as const, null as 'composer' | 'bridge' | 'phone' | null)

// 띄운 직후의 숫자 키는 카드가 뜨기 전에 누른 것이라 버린다(desk-look 질문 카드의 ASK_SETTLE 과 같다).
const SETTLE_MS = 350

// 답을 기다리는 법은 desk-look 질문 카드와 같다. 훅은 자기 코드 시간 10초 안에 끝나야 하지만, 엔진 호출($)을 기다리는
// 동안은 시계가 멈춘다($.clock.sleep 은 예외라 못 쓴다). 그래서 임시 폴더에 이름 있는 파이프(answer)를 만들고 cat 으로 읽으며
// 기다린다. 카드 버튼이 tee 로 답을 써 넣으면 cat 이 끝난다. process.run 은 한 번에 10분까지라 9분마다 다시 기다린다.
// 셸은 쓰지 않는다.
const WAIT_ROUND_S = 540
const WAIT_ROUNDS = 40

// Remote Control 이 붙어 있는지: 세션 상태 파일(~/.claude/sessions/*.json) 중 이 세션의 것에 bridgeSessionId 가 있으면.
async function isBridged($: EngineInterface, sessionId: string): Promise<boolean> {
  const [configDir, home] = await Promise.all([$.env.get('CLAUDE_CONFIG_DIR'), $.env.get('HOME')])
  const base = configDir || (home ? `${home}/.claude` : '')
  if (!base || sessionId === '') return false
  for (const entry of await $.fs.list(`${base}/sessions`).catch(() => [])) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    if (isBridgedRecord(await $.fs.read(`${base}/sessions/${entry.name}`).catch(() => ''), sessionId)) return true
  }
  return false
}

// 카드로 물어도 되는 세션인지: 터미널 하나만 붙어 있고, 다른 카드(desk-look 질문·이 계획)가 떠 있지 않고,
// 마지막 사람 입력이 터미널에서 왔어야 한다. 입력이 어디서 왔는지는 desk-look 이 적는다.
async function cardSession($: EngineInterface): Promise<boolean> {
  const surfaces = await $.session.surfaces()
  if (surfaces.length !== 1 || surfaces[0] !== 'terminal') return false
  if ((await read($, asking)) !== null || (await read($, planAsking)) !== null) return false
  const origin = await read($, promptOrigin)
  if (origin !== null) return origin === 'composer'
  // 입력이 없었을 때만 세션 상태 파일로 Remote Control 을 본다. 파일은 엔진이 지우기도 한다.
  const sessionId = await $.session.id().catch(() => '')
  return !(await isBridged($, sessionId).catch(() => false))
}

// 답을 받을 임시 폴더와 그 안의 이름 있는 파이프(answer). 못 만들면 ''.
async function openReplyPipe($: EngineInterface): Promise<string> {
  const made = await $.process.run(['mktemp', '-d'], { timeoutMs: 3000 }).catch(() => null)
  const dir = made?.exitCode === 0 ? made.stdout.trim() : ''
  if (dir === '') return ''
  const piped = await $.process.run(['mkfifo', `${dir}/answer`], { timeoutMs: 3000 }).catch(() => null)
  if (piped?.exitCode === 0) return dir
  await $.process.run(['rm', '-rf', dir], { timeoutMs: 3000 }).catch(() => undefined)
  return ''
}

// 카드 버튼이 파이프에 쓴 답(JSON 글)을 기다린다. 엔진 창으로 넘겨야 하면 null. 끝나면 폴더를 지운다.
// 턴을 중단하면(Esc) {"kind":"cancel"} 을 써서 기다리던 cat 을 끝낸다.
async function awaitReply($: EngineInterface, signal: AbortSignal, dir: string): Promise<string | null> {
  const onAbort = () => void replyPlan($, dir, { kind: 'cancel' }).catch(() => undefined)
  signal.addEventListener('abort', onAbort)
  let answered: string | null = JSON.stringify({ kind: 'cancel' })
  for (let round = 0; round < WAIT_ROUNDS && !signal.aborted; round++) {
    const startedAt = await $.clock.now()
    // 시간이 다 되면 cat 이 죽고 호출은 거절된다(null): 한 바퀴가 끝난 것
    const ran = await $.process.run(['cat', `${dir}/answer`], { timeoutMs: WAIT_ROUND_S * 1000 }).catch(() => null)
    if (ran !== null && ran.exitCode === 0 && ran.stdout.trim() !== '') {
      answered = ran.stdout
      break
    }
    const now = await $.clock.now()
    // 기다리지 못하고 곧바로 끝났으면(파이프가 사라졌다) 헛돌지 않고 엔진 창에 넘긴다
    if (now - startedAt < 1000) {
      answered = null
      break
    }
  }
  signal.removeEventListener('abort', onAbort)
  await $.process.run(['rm', '-rf', dir], { timeoutMs: 3000 }).catch(() => undefined)
  return answered
}

async function replyPlan($: EngineInterface, dir: string, payload: PlanReply) {
  await $.process.run(['tee', `${dir}/answer`], { stdin: JSON.stringify(payload), timeoutMs: 3000 })
}

// 계획 파일을 desk-look 의 미리보기 패널로. 매번 n 을 올려 같은 파일을 다시 열 때도 state.set 이 불리게 한다.
async function showPlan($: EngineInterface, path: string, focus: boolean) {
  await update($, preview, current => ({ path, focus, n: (current?.n ?? 0) + 1 }))
}

async function approvePlan($: EngineInterface, state: PlanAskState) {
  if ((await $.clock.now()) - state.shownAt < SETTLE_MS) return
  await replyPlan($, state.dir, { kind: 'approve' })
}

async function revisePlan($: EngineInterface, state: PlanAskState, text: string) {
  if (text.trim() === '') {
    $.ui.toast(T.planReviseEmpty)
    return
  }
  await replyPlan($, state.dir, { kind: 'revise', text })
}

// 힌트 줄 끝에 붙이는 키. 입력칸에 글이 있으면 숫자 키가 버튼을 누르지 않으니 펴는 키만.
function hintTail(keys: string, isDraft: boolean): string {
  return `  ${T.bandToggle}${isDraft ? '' : ` · ${keys}`}`
}

async function planAskCard($: EngineInterface, els: Elements['terminal'], state: PlanAskState, columns: number, room: number) {
  const { Box, Text, Button, Input } = els
  const k = state.id
  const title = planTitle(state.plan)
  const width = Math.max(30, Math.min(columns, 100))
  const textRows = planTextRows(state.text)
  const mode = planAskMode(room, textRows)
  const setText = (value: string) => {
    return update($, planAsking, current => (current && current.id === state.id ? { ...current, text: value } : current))
  }
  const head = (
    <Text wrap="truncate-end">
      <Text color={COLORS.clay}>◇ </Text>
      <Text color={COLORS.text} weight="semibold">
        {title || 'Plan'}
      </Text>
    </Text>
  )
  const actions = (
    <Box columnGap={2}>
      <Button key={`plan-approve-${k}`} hotkey="1" label={T.planApprove} onPress={() => void approvePlan($, state)} />
      <Button key={`plan-view-${k}`} plain hotkey="2" label={T.planView} onPress={() => void showPlan($, state.path, true)} />
      {mode !== 'full' && <Button key={`plan-engine-${k}`} plain dimColor hotkey="9" label={T.toDefault} onPress={() => void replyPlan($, state.dir, { kind: 'engine' })} />}
    </Box>
  )
  if (mode !== 'full') {
    return (
      <Box flexDirection="column" width={width} paddingX={1} {...(mode === 'compact' ? { borderStyle: 'round' as const, borderColor: COLORS.clay } : {})}>
        {head}
        {actions}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" width={width} borderStyle="round" borderColor={COLORS.clay} paddingX={1}>
      {head}
      <Text color={COLORS.muted}>{T.planAskQuestion}</Text>
      <Box marginTop={1}>{actions}</Box>
      <Box marginTop={1}>
        <Input
          key={`plan-text-${k}`}
          label={T.planReviseLabel}
          placeholder={T.otherPlaceholder}
          rows={textRows}
          value={state.text}
          submitLabel={T.planRevise}
          onInput={value => void setText(value)}
          onSubmit={value => void revisePlan($, state, value)}
        />
      </Box>
      <Box columnGap={2}>
        <Button key={`plan-engine-${k}`} plain dimColor hotkey="9" label={T.toDefault} onPress={() => void replyPlan($, state.dir, { kind: 'engine' })} />
        <Button key={`plan-close-${k}`} plain dimColor label={T.close} onPress={() => void replyPlan($, state.dir, { kind: 'dismiss' })} />
      </Box>
    </Box>
  )
}

export const register: Register = (on, options) => {
  const language = langSetting(options)
  setLang(language === 'auto' ? 'en' : language)
  const notify = options.notify !== 'off'

  // 언어: auto 면 desk-look 이 고른 언어를 따른다.
  on('session.start', async ($, e, next) => {
    if (language === 'auto') {
      const { value } = await $.state.get({ plugin: 'desk-look', key: 'lang' }).catch(() => ({ value: null }))
      if ((value === 'en' || value === 'ko') && setLang(value)) $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('state.set', { plugin: 'desk-look', key: 'lang' }, async ($, e, next) => {
    const done = await next(e)
    if (language === 'auto' && (e.value === 'en' || e.value === 'ko') && setLang(e.value)) $.ui.invalidate('ui.render')
    return done
  }).catch(($, e, next) => next(e))

  // ExitPlanMode 를 카드로 묻고, 승인이면 입력을 그대로 돌려줘 엔진이 도구 본체를 돌리게 한다(plan.ts 참고).
  // 계획 파일이 없으면(계획을 인자로만 받는 세션) 펼쳐 볼 곳이 없어 엔진 창 그대로.
  on('classic.PreToolUse', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    const input = planInput(e as unknown as Record<string, unknown>)
    const plan = typeof input.plan === 'string' ? input.plan : ''
    const path = isMarkdown(input.planFilePath) ? input.planFilePath : ''
    if (plan.trim() === '' || path === '') return next(e)
    if (!(await cardSession($))) return next(e)
    const dir = await openReplyPipe($)
    if (dir === '') return next(e)
    const shownAt = await $.clock.now()
    await update($, planAsking, () => ({ id: e.tool_use_id ?? dir, dir, plan, path, text: '', shownAt }))
    if (notify) void $.ui.notify(planTitle(plan) || T.planAskQuestion, { title: T.planAskTitle }).catch(() => undefined)
    await showPlan($, path, false).catch(() => undefined)
    const answered = await awaitReply($, next.signal, dir)
    await update($, planAsking, () => null)
    if (answered === null) return next(e)
    let answer: PlanReply = { kind: 'cancel' }
    try {
      answer = JSON.parse(answered) as PlanReply
    } catch {}
    switch (answer.kind) {
      case 'approve':
        return { allow: true, updatedInput: input }
      case 'revise':
        return { deny: reviseReason(answer.text) }
      case 'engine':
        return next(e)
      case 'dismiss':
        return { deny: DISMISS_REASON }
      case 'cancel':
        return { deny: CANCEL_REASON }
    }
  })

  // 입력창 위 띠: 카드가 떠 있으면 카드만(엔진 설문처럼 띠를 차지한다). desk-look 의 같은 훅은 카드가 떠 있으면
  // 받은 것을 그대로 넘겨서, 어느 쪽이 바깥에 놓여도 띠에는 카드만 남는다.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    const state = await read($, planAsking)
    if (!state) return next(e)
    return planAskCard($, $.ui.resolve(e), state, e.props.bodyColumns, e.props.maxRows)
  })

  // 힌트 줄: 카드가 떠 있으면 답하는 키를 엔진 줄 끝에 덧붙인다. 띠를 접어 카드가 안 보일 때 펴는 키를 맨 앞에 둔다.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || (await read($, planAsking)) === null) return next(e)
    return next({ ...e, props: { ...e.props, tail: hintTail(T.planHint, e.props.isDraft) } })
  })
}
