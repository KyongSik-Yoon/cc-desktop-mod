import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AskQuestion, AskState } from '../types'
import { T } from './i18n'

// 질문 카드: AskUserQuestion 을 엔진 창 대신 입력창 위 띠의 카드로 묻는다(데스크톱과 같은 자리).
// 도구 호출 훅이 답을 기다리며 결과를 직접 돌려주고, 엔진은 그 결과를 도구의 원래 변환기로 모델에게 넘긴다.
// 입력창이 비어 있으면 숫자 키가 띠의 버튼을 바로 누른다: 1-8 선택지, 0 제출(여러 개 고르기), 9 엔진 창.
// 터미널 말고 다른 화면이 붙은 세션은 엔진 창 그대로. Remote Control 세션은 아래 REMOTE 참고.
// 엔진 창은 뜰 때 알림(permission_prompt)을 보내지만 카드는 도구가 도는 중이라 엔진이 보내지 않는다. 그래서 카드가 직접 알린다(askNotify).

type On = Parameters<Register>[0]

const asking = atom({ plugin: 'desk-look', key: 'ask' } as const, null as AskState | null)
const promptOrigin = atom({ plugin: 'desk-look', key: 'promptOrigin' } as const, null as 'composer' | 'bridge' | null)

// 훅은 자기 코드 시간 10초 안에 끝나야 하지만, 엔진 호출($)을 기다리는 동안은 시계가 멈춘다.
// 그래서 답 파일이 생길 때까지 도는 셸을 띄워 두고 그 실행을 기다린다. 버튼이 그 파일을 쓴다.
// process.run 은 한 번에 10분까지라, $2 초(9분)마다 빈손(종료 코드 3)으로 돌아와 다시 기다린다.
// 빈손일 때 그사이 카드를 건드렸으면(touched 파일, TOUCH) touched 를 찍는다.
const WAIT =
  'end=$(( $(date +%s) + $2 )); while [ ! -e "$1/answer" ]; do [ "$(date +%s)" -ge "$end" ] && { rm "$1/touched" 2>/dev/null && echo touched; exit 3; }; sleep 0.1; done; cat "$1/answer"; rm -rf "$1"'
export const WRITE = 'printf %s "$2" > "$1/answer.tmp" && mv "$1/answer.tmp" "$1/answer"'
// 카드를 건드렸다는 표시. 기다리는 도구 훅은 그동안 바뀐 상태를 읽지 못해(훅이 시작할 때 값을 본다) 파일로 알린다.
export const TOUCH = 'touch "$1/touched"'
const WAIT_ROUND_S = 540
const WAIT_ROUNDS = 40
// Remote Control(Claude 앱)은 surfaces() 에 잡히지 않는다(앱이 attach 하지 않는다). 카드를 띄우면 엔진이
// 원격 응답 요청을 보내지 않아 앱에서 답할 수 없다. 그래서 세션 상태 파일에 bridgeSessionId 가 있으면
// 마지막 사람 입력이 터미널에서 왔을 때만 카드를 띄우고, 카드를 HANDOVER_MS 동안 아무도 건드리지 않으면
// (자리를 떠 앱으로 보는 중) 엔진 창에 넘겨 앱에도 묻게 한다. 그동안은 HANDOVER_ROUND_S 초마다 돌아와 살핀다.
export const HANDOVER_MS = 60_000
const HANDOVER_ROUND_S = 5
export const REMOTE = 'for f in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/sessions/*.json; do grep -q "\\"sessionId\\":\\"$1\\"" "$f" 2>/dev/null && grep -q "\\"bridgeSessionId\\":\\"" "$f" && { echo remote; exit 0; }; done; exit 0'

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

async function reply($: EngineInterface, dir: string, payload: AskReply) {
  await $.process.run(['sh', '-c', WRITE, 'sh', dir, JSON.stringify(payload)], { timeoutMs: 3000 })
}

// 알림 본문: 첫 질문, 여러 개면 "외 N개".
export function askNotice(questions: readonly AskQuestion[]): string {
  const first = questions[0]?.question ?? ''
  return questions.length > 1 ? T.moreQuestions(first, questions.length - 1) : first
}

export function registerAsk(on: On, notify: boolean) {
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const questions = parseQuestions(e.questions)
    if (questions === null) return next(e)
    const surfaces = await $.session.surfaces()
    if (surfaces.length !== 1 || surfaces[0] !== 'terminal') return next(e)
    if ((await read($, asking)) !== null) return next(e)
    const sessionId = await $.session.id().catch(() => '')
    const bridged = await $.process.run(['sh', '-c', REMOTE, 'sh', sessionId], { timeoutMs: 3000 }).catch(() => null)
    const isRemote = bridged?.stdout.trim() === 'remote'
    if (isRemote && (await read($, promptOrigin)) !== 'composer') return next(e)

    const made = await $.process.run(['mktemp', '-d'], { timeoutMs: 3000 }).catch(() => null)
    const dir = made?.exitCode === 0 ? made.stdout.trim() : ''
    if (dir === '') return next(e)
    const id = e.tool_use_id ?? dir
    const shownAt = await $.clock.now()
    await update($, asking, () => ({ id, dir, questions, step: 0, picks: questions.map(() => []), texts: questions.map(() => ''), shownAt }))
    if (notify) {
      void $.ui.notify(askNotice(questions), { title: T.askTitle }).catch(() => undefined)
    }

    // 턴을 중단하면(Esc) 기다리던 셸을 끝낸다.
    const onAbort = () => void reply($, dir, { kind: 'cancel' }).catch(() => undefined)
    next.signal.addEventListener('abort', onAbort)
    const roundS = isRemote ? HANDOVER_ROUND_S : WAIT_ROUND_S
    const rounds = Math.ceil((WAIT_ROUNDS * WAIT_ROUND_S) / roundS)
    let touchedAt = shownAt
    let isHandedOver = false
    let ran: { exitCode: number; stdout: string } | null = null
    for (let round = 0; round < rounds && !next.signal.aborted; round++) {
      ran = await $.process.run(['sh', '-c', WAIT, 'sh', dir, String(roundS)], { timeoutMs: (roundS + 30) * 1000 }).catch(() => null)
      if (ran?.exitCode !== 3) break
      if (!isRemote) continue
      const now = await $.clock.now()
      if (ran.stdout.includes('touched')) touchedAt = now
      else if (now - touchedAt >= HANDOVER_MS) {
        isHandedOver = true
        break
      }
    }
    next.signal.removeEventListener('abort', onAbort)
    await update($, asking, () => null)
    if (isHandedOver) {
      await $.process.run(['rm', '-rf', dir], { timeoutMs: 3000 }).catch(() => undefined)
      return next(e)
    }

    let answer: AskReply = { kind: 'cancel' }
    try {
      answer = JSON.parse(ran?.stdout ?? '') as AskReply
    } catch {
      await $.process.run(['rm', '-rf', dir], { timeoutMs: 3000 }).catch(() => undefined)
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

