import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AskQuestion, AskState, PlanAskState } from '../types'
import { T } from './i18n'

// 질문 카드: AskUserQuestion 을 엔진 창 대신 입력창 위 띠의 카드로 묻는다(데스크톱과 같은 자리).
// 도구 호출 훅이 답을 기다리며 결과를 직접 돌려주고, 엔진은 그 결과를 도구의 원래 변환기로 모델에게 넘긴다.
// 입력창이 비어 있으면 숫자 키가 띠의 버튼을 바로 누른다: 1-8 선택지, 0 제출(여러 개 고르기), 9 엔진 창.
// 터미널 말고 다른 화면이 붙은 세션은 엔진 창 그대로. Remote Control 세션은 아래 REMOTE 참고.
// 엔진 창은 뜰 때 알림(permission_prompt)을 보내지만 카드는 도구가 도는 중이라 엔진이 보내지 않는다. 그래서 카드가 직접 알린다(askNotify).

type On = Parameters<Register>[0]

const asking = atom({ plugin: 'desk-look', key: 'ask' } as const, null as AskState | null)
const planAsking = atom({ plugin: 'desk-look', key: 'planAsk' } as const, null as PlanAskState | null)
const promptOrigin = atom({ plugin: 'desk-look', key: 'promptOrigin' } as const, null as 'composer' | 'bridge' | null)

// 훅은 자기 코드 시간 10초 안에 끝나야 하지만, 엔진 호출($)을 기다리는 동안은 시계가 멈춘다($.clock.sleep 은 예외라 못 쓴다).
// 그래서 임시 폴더에 이름 있는 파이프(answer)를 만들고 cat 으로 읽으며 기다린다. 카드 버튼이 tee 로 답을 써 넣으면 cat 이 끝난다.
// process.run 은 한 번에 10분까지라, WAIT_ROUND_S 초(9분)마다 시간이 다 돼 끊기면 다시 기다린다.
// 셸은 쓰지 않는다: 디렉터리 검사가 셸·인라인 스크립트를 리뷰어에게 넘긴다.
const WAIT_ROUND_S = 540
const WAIT_ROUNDS = 40
// 카드를 건드렸다는 표시(touched 파일). 기다리는 도구 훅은 그동안 바뀐 상태를 읽지 못해(훅이 시작할 때 값을 본다) 파일로 알린다.
// 버튼이 매번 다른 글을 써서, 훅은 글이 바뀌었는지로 안다.
// Remote Control(Claude 앱)은 surfaces() 에 잡히지 않는다(앱이 attach 하지 않는다). 카드를 띄우면 엔진이
// 원격 응답 요청을 보내지 않아 앱에서 답할 수 없다. 그래서 마지막 사람 입력이 앱에서 왔으면 엔진 창이고,
// 세션 상태 파일에 bridgeSessionId 가 있으면 마지막 사람 입력이 터미널에서 왔을 때만 카드를 띄우고, 카드를 HANDOVER_MS 동안 아무도 건드리지 않으면
// (자리를 떠 앱으로 보는 중) 엔진 창에 넘겨 앱에도 묻게 한다. 그동안은 HANDOVER_ROUND_S 초마다 돌아와 살핀다.
export const HANDOVER_MS = 60_000
const HANDOVER_ROUND_S = 5

// 세션 상태 파일(~/.claude/sessions/*.json) 하나가 이 세션의 것이고 Remote Control 이 붙어 있는지.
export function isBridgedRecord(text: string, sessionId: string): boolean {
  return sessionId !== '' && text.includes(`"sessionId":"${sessionId}"`) && text.includes('"bridgeSessionId":"')
}

export type AskReply =
  | { kind: 'answer'; answers: Record<string, string> }
  | { kind: 'engine' }
  | { kind: 'dismiss' }
  | { kind: 'cancel' }

const str = (value: unknown) => (typeof value === 'string' ? value : undefined)
const num = (value: unknown) => (typeof value === 'number' ? value : undefined)

// 도구 입력을 읽는다. 그릴 수 없는 질문이 하나라도 있으면 null(엔진 창).
// 미리보기(preview)는 선택지에 마우스를 올리면 카드 아래에 보인다.
export function parseQuestions(value: unknown): AskQuestion[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const out: AskQuestion[] = []
  for (const raw of value as Array<Record<string, unknown>>) {
    const question = str(raw?.question)
    if (!question) return null
    const kind = raw.kind === 'text' || raw.kind === 'number' ? raw.kind : 'choice'
    const options = Array.isArray(raw.options) ? (raw.options as Array<Record<string, unknown>>) : []
    if (kind === 'choice' && options.length === 0) return null
    out.push({
      question,
      header: str(raw.header) ?? '',
      kind,
      description: str(raw.description),
      options: options.map(option => ({ label: str(option.label) ?? '', description: str(option.description), preview: str(option.preview) })),
      multiSelect: raw.multiSelect === true,
      placeholder: str(raw.placeholder),
      min: num(raw.min),
      max: num(raw.max),
      unit: str(raw.unit),
    })
  }
  return out
}

// 한 질문의 답: 직접 입력한 글이 있으면 그것(여러 개 고르기면 고른 것 뒤에), 아니면 고른 라벨.
export function answerOf(question: AskQuestion, picks: readonly string[], text: string): string {
  const typed = text.trim()
  if (question.kind !== 'choice') return typed
  // 여러 개 고르기는 누른 순서가 아니라 선택지 순서로(엔진 창과 같게)
  const ordered = question.options.map(option => option.label).filter(label => picks.includes(label))
  if (question.multiSelect) return [...ordered, ...(typed ? [typed] : [])].join(', ')
  return typed || picks[0] || ''
}

// 숫자 답 검사: 틀리면 이유, 맞으면 null.
export function numberProblem(question: AskQuestion, text: string): string | null {
  if (question.kind !== 'number') return null
  const value = Number(text.trim())
  if (text.trim() === '' || !Number.isFinite(value)) return T.needNumber
  if (question.min !== undefined && value < question.min) return T.atLeast(question.min)
  if (question.max !== undefined && value > question.max) return T.atMost(question.max)
  return null
}

// 기다리는 cat 에 답을 넘긴다(register.tsx 의 replyAsk 와 같다: $ 는 파일을 넘지 못한다).
async function reply($: EngineInterface, dir: string, payload: AskReply | { kind: 'cancel' }) {
  await $.process.run(['tee', `${dir}/answer`], { stdin: JSON.stringify(payload), timeoutMs: 3000 })
}

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

// 알림 본문: 첫 질문, 여러 개면 "외 N개".
export function askNotice(questions: readonly AskQuestion[]): string {
  const first = questions[0]?.question ?? ''
  return questions.length > 1 ? T.moreQuestions(first, questions.length - 1) : first
}

// 카드로 물어도 되는 세션인지: 터미널 하나만 붙어 있고, 다른 카드(질문·계획)가 떠 있지 않고, 마지막 사람 입력이 앱에서 오지 않았어야 한다.
// 되면 Remote Control 이 붙어 있는지(무반응이면 엔진 창으로 넘긴다)를, 안 되면 null(엔진 창).
export async function cardSession($: EngineInterface): Promise<{ isRemote: boolean } | null> {
  const surfaces = await $.session.surfaces()
  if (surfaces.length !== 1 || surfaces[0] !== 'terminal') return null
  if ((await read($, asking)) !== null || (await read($, planAsking)) !== null) return null
  // 앱(bridge)에서 온 입력이면 세션 상태 파일 없이도 Remote Control 이다. 파일은 엔진이 지우기도 한다.
  const origin = await read($, promptOrigin)
  if (origin === 'bridge') return null
  const sessionId = await $.session.id().catch(() => '')
  const isRemote = await isBridged($, sessionId).catch(() => false)
  if (isRemote && origin !== 'composer') return null
  return { isRemote }
}

// 답을 받을 임시 폴더와 그 안의 이름 있는 파이프(answer). 못 만들면 ''.
export async function openReplyPipe($: EngineInterface): Promise<string> {
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
export async function awaitReply($: EngineInterface, signal: AbortSignal, dir: string, isRemote: boolean, shownAt: number): Promise<string | null> {
  const onAbort = () => void reply($, dir, { kind: 'cancel' }).catch(() => undefined)
  signal.addEventListener('abort', onAbort)
  const roundS = isRemote ? HANDOVER_ROUND_S : WAIT_ROUND_S
  const rounds = Math.ceil((WAIT_ROUNDS * WAIT_ROUND_S) / roundS)
  let touchedAt = shownAt
  let touch = ''
  let answered: string | null = JSON.stringify({ kind: 'cancel' })
  for (let round = 0; round < rounds && !signal.aborted; round++) {
    const startedAt = await $.clock.now()
    // 시간이 다 되면 cat 이 죽고 호출은 거절된다(null): 한 바퀴가 끝난 것
    const ran = await $.process.run(['cat', `${dir}/answer`], { timeoutMs: roundS * 1000 }).catch(() => null)
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
    if (!isRemote) continue
    const touched = await $.fs.read(`${dir}/touched`).catch(() => '')
    if (touched !== touch) {
      touch = touched
      touchedAt = now
    } else if (now - touchedAt >= HANDOVER_MS) {
      answered = null
      break
    }
  }
  signal.removeEventListener('abort', onAbort)
  await $.process.run(['rm', '-rf', dir], { timeoutMs: 3000 }).catch(() => undefined)
  return answered
}

export function registerAsk(on: On, notify: boolean) {
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const questions = parseQuestions(e.questions)
    if (questions === null) return next(e)
    const session = await cardSession($)
    if (session === null) return next(e)
    const dir = await openReplyPipe($)
    if (dir === '') return next(e)
    const id = e.tool_use_id ?? dir
    const shownAt = await $.clock.now()
    await update($, asking, () => ({ id, dir, questions, step: 0, picks: questions.map(() => []), texts: questions.map(() => ''), shownAt }))
    if (notify) {
      void $.ui.notify(askNotice(questions), { title: T.askTitle }).catch(() => undefined)
    }
    const answered = await awaitReply($, next.signal, dir, session.isRemote, shownAt)
    await update($, asking, () => null)
    if (answered === null) return next(e)

    let answer: AskReply = { kind: 'cancel' }
    try {
      answer = JSON.parse(answered) as AskReply
    } catch {
      answer = { kind: 'cancel' }
    }
    switch (answer.kind) {
      case 'answer':
        return { result: { questions: e.questions, answers: answer.answers } }
      case 'engine':
        return next(e)
      case 'dismiss':
        return { deny: 'The user closed the question without answering.' }
      case 'cancel':
        return { deny: 'The question was cancelled before the user answered.' }
    }
  })
}
