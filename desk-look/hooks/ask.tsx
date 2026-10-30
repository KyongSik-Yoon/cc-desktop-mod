import type { AskQuestion } from '../types'
import { T } from './i18n'

// 질문 카드: AskUserQuestion 을 엔진 창 대신 입력창 위 띠의 카드로 묻는다(데스크톱과 같은 자리).
// 도구 호출 훅이 답을 기다리며 결과를 직접 돌려주고, 엔진은 그 결과를 도구의 원래 변환기로 모델에게 넘긴다.
// 입력창이 비어 있으면 숫자 키가 띠의 버튼을 바로 누른다: 1-8 선택지, 0 제출(여러 개 고르기), 9 엔진 창.
// 터미널 말고 다른 화면이 붙은 세션은 엔진 창 그대로. 폰에서 입력한 세션은 아래 PHONE 참고.
// 엔진 창은 뜰 때 알림(permission_prompt)을 보내지만 카드는 도구가 도는 중이라 엔진이 보내지 않는다. 그래서 카드가 직접 알린다(askNotify).
// 엔진을 부르는 부분($: 훅, 기다리기)은 register.tsx 에 있고, 여기는 순수 함수만 둔다($ 는 다른 파일 함수로 넘기지 못한다).

// PHONE: 카드는 폰에서 답할 수 없다. Remote Control(Claude 앱)은 surfaces() 에 잡히지 않고(앱이 attach 하지 않는다),
// 카드를 띄우면 엔진이 앱에 응답 요청을 보내지 않는다. collie(herdr 화면을 폰에 비추는 플러그인)는 폰 입력을 터미널 키로
// 넣어 엔진에겐 터미널(composer) 입력으로 보인다. 그래서 마지막 사람 입력이 어디서 왔는지로 고른다:
// 앱(bridge)이나 collie 면 엔진 창, 터미널이면 카드를 시간 제한 없이 띄운다. 다음 입력 전까지 그대로라,
// 책상에서 묻고 자리를 뜨면 폰에는 질문이 가지 않는다(사용자가 고른 타협).
// 입력이 없었으면(다시 연 세션에 알림이 턴을 연 경우 등) Remote Control 이 붙어 있을 때만 엔진 창.
export type PromptOrigin = 'composer' | 'bridge' | 'phone'

// collie 는 폰에서 보낸 글을 받으면 sends/<id>.json 을 쓰고, 보내기(mode "send")면 Enter 를 넣을 때 submitSentAt 을 찍는다
// (엔진이 프롬프트를 보기 전). 이 패널(paneId = HERDR_PANE_ID)로 PHONE_SEND_MS 안에 Enter 까지 넣은 기록이면 그 입력은 폰에서 왔다.
// 세션 id(paneGeneration)로는 맞추지 않는다: herdr 가 아직 모르면(새 세션, /clear·/resume 직후) collie 는 "claude:-" 로 쓴다.
// 글만 넣는 append·replace 는 Enter 를 사람이 책상에서 칠 수 있어 보지 않는다.
export const PHONE_SEND_MS = 20_000
export const PHONE_SENDS_READ = 5

export function isPhoneSend(text: string, paneId: string, now: number): boolean {
  let record: { paneId?: unknown; mode?: unknown; submitSentAt?: unknown }
  try {
    record = JSON.parse(text) as typeof record
  } catch {
    return false
  }
  if (paneId === '' || record?.paneId !== paneId || record.mode !== 'send' || typeof record.submitSentAt !== 'number') return false
  return now - record.submitSentAt >= 0 && now - record.submitSentAt < PHONE_SEND_MS
}

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

// 알림 본문: 첫 질문, 여러 개면 "외 N개".
export function askNotice(questions: readonly AskQuestion[]): string {
  const first = questions[0]?.question ?? ''
  return questions.length > 1 ? T.moreQuestions(first, questions.length - 1) : first
}
