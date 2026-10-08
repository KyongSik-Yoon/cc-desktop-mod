import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AskQuestion, AskState } from '../types'

// 질문 카드: AskUserQuestion 을 엔진 창 대신 입력창 위 띠의 카드로 묻는다(데스크톱과 같은 자리).
// 도구 호출 훅이 답을 기다리며 결과를 직접 돌려주고, 엔진은 그 결과를 도구의 원래 변환기로 모델에게 넘긴다.
// 입력창이 비어 있으면 숫자 키가 띠의 버튼을 바로 누른다: 1-8 선택지, 0 제출(여러 개 고르기), 9 엔진 창.
// 터미널 말고 다른 화면이 붙은 세션은 엔진 창 그대로.

type On = Parameters<Register>[0]

const asking = atom({ plugin: 'desk-look', key: 'ask' } as const, null as AskState | null)

// 훅은 자기 코드 시간 10초 안에 끝나야 하지만, 엔진 호출($)을 기다리는 동안은 시계가 멈춘다.
// 그래서 답 파일이 생길 때까지 도는 셸을 띄워 두고 그 실행을 기다린다. 버튼이 그 파일을 쓴다.
// process.run 은 한 번에 10분까지라, 9분마다 빈손(종료 코드 3)으로 돌아와 다시 기다린다.
const WAIT = 'end=$(( $(date +%s) + 540 )); while [ ! -e "$1/answer" ]; do [ "$(date +%s)" -ge "$end" ] && exit 3; sleep 0.1; done; cat "$1/answer"; rm -rf "$1"'
export const WRITE = 'printf %s "$2" > "$1/answer.tmp" && mv "$1/answer.tmp" "$1/answer"'
const WAIT_ROUND_MS = 570_000
const WAIT_ROUNDS = 40

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
  if (text.trim() === '' || !Number.isFinite(value)) return '숫자를 입력해 주세요'
  if (question.min !== undefined && value < question.min) return `${question.min} 이상이어야 해요`
  if (question.max !== undefined && value > question.max) return `${question.max} 이하여야 해요`
  return null
}

async function reply($: EngineInterface, dir: string, payload: AskReply) {
  await $.process.run(['sh', '-c', WRITE, 'sh', dir, JSON.stringify(payload)], { timeoutMs: 3000 })
}

export function registerAsk(on: On) {
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const questions = parseQuestions(e.questions)
    if (questions === null) return next(e)
    const surfaces = await $.session.surfaces()
    if (surfaces.length !== 1 || surfaces[0] !== 'terminal') return next(e)
    if ((await read($, asking)) !== null) return next(e)

    const made = await $.process.run(['mktemp', '-d'], { timeoutMs: 3000 }).catch(() => null)
    const dir = made?.exitCode === 0 ? made.stdout.trim() : ''
    if (dir === '') return next(e)
    const id = e.tool_use_id ?? dir
    const shownAt = await $.clock.now()
    await update($, asking, () => ({ id, dir, questions, step: 0, picks: questions.map(() => []), texts: questions.map(() => ''), shownAt }))

    // 턴을 중단하면(Esc) 기다리던 셸을 끝낸다.
    const onAbort = () => void reply($, dir, { kind: 'cancel' }).catch(() => undefined)
    next.signal.addEventListener('abort', onAbort)
    let ran: { exitCode: number; stdout: string } | null = null
    for (let round = 0; round < WAIT_ROUNDS && !next.signal.aborted; round++) {
      ran = await $.process.run(['sh', '-c', WAIT, 'sh', dir], { timeoutMs: WAIT_ROUND_MS }).catch(() => null)
      if (ran?.exitCode !== 3) break
    }
    next.signal.removeEventListener('abort', onAbort)
    await update($, asking, () => null)

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

