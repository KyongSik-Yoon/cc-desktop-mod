// 계획 카드: ExitPlanMode 를 엔진 승인 창 대신 입력창 위 카드로 묻는다(질문 카드와 같은 자리, 같은 기다리기).
// 엔진 창은 화면 폭 전체를 아래 끝까지 덮어 옆 패널도 가린다. 카드는 띠만 차지하고 계획 본문은 미리보기 패널에 연다.
// 엔진은 ExitPlanMode 처럼 사람이 답해야 하는 도구의 훅 승인을 updatedInput 이 있을 때만 받는다(2.1.312 실측, 2.1.316 에서 다시 확인).
// 그래서 classic.PreToolUse 에서 답을 기다렸다가 allow 와 함께 입력을 그대로 돌려준다. 그러면 엔진이 도구 본체를 돌려
// 권한 모드를 계획 전 모드로 되돌린다(엔진 창의 첫 선택지와 같다). tool.check·PermissionRequest 의 allow 만으로는 창이 그대로 뜨고,
// tool.call 이 결과를 직접 주면 모드가 plan 에 남는다. 다른 모드로 나가는 선택지는 PermissionRequest 의 setMode 로만 되는데
// 그 훅은 엔진 창과 함께 불려 창이 잠깐 깜빡이므로 두지 않았다(그럴 땐 9 기본 창).
// 엔진을 부르는 부분($)은 register.tsx 에 있고, 여기는 순수 함수만 둔다($ 는 다른 파일 함수로 넘기지 않는다).
// 계획 본문은 desk-look 의 미리보기 패널에 연다(desk-plan.preview 에 쓰면 desk-look 이 state.set 훅으로 받는다).
// 미리보기 패널 원문 줄 보기에서 계획 파일에 단 줄 댓글은 고쳐 달라는 답에 실어 보내고, 보낸 것은 desk-plan.sent 로 알려 desk-look 이 지운다.

import type { CommentLine, LineComment } from '../types'

export type PlanReply = { kind: 'approve' } | { kind: 'revise'; text: string } | { kind: 'engine' } | { kind: 'dismiss' } | { kind: 'cancel' }

// 도구 입력(classic.PreToolUse 의 e 에서 tool·tool_use_id 를 뺀 것). 승인할 때 updatedInput 으로 그대로 돌려준다.
export function planInput(e: Record<string, unknown>): Record<string, unknown> {
  const { tool: _tool, tool_use_id: _id, ...input } = e
  return input
}

// 카드 제목: 계획의 첫 제목, 없으면 글이 있는 첫 줄. 마크다운 표시는 걷는다.
export function planTitle(plan: string): string {
  const lines = plan.split('\n').map(line => line.trim()).filter(line => line !== '')
  const line = lines.find(item => /^#{1,6}\s/.test(item)) ?? lines[0] ?? ''
  return line.replace(/^#{1,6}\s+/, '').replace(/[*_`]/g, '').trim()
}

// 고칠 점을 받았을 때 모델이 읽는 거절 사유. 엔진 창의 "Tell Claude what to change" 처럼 plan 모드에 남아 다시 묻게 한다.
// 계획 파일 줄 댓글(desk-look 미리보기 패널 원문 줄 보기)이 있으면 파일:줄, 그 줄 원문, 댓글을 함께 싣는다.
export function reviseReason(text: string, comments: ReadonlyArray<LineComment> = []): string {
  const wish = text.trim()
  const notes =
    comments.length > 0
      ? [`Comments on lines of the plan file (line numbers are the file's, each quoting the lines as they were):`, ...comments.map(commentBlock)].join('\n\n')
      : ''
  const body = [notes, wish && notes ? `Also:\n\n${wish}` : wish].filter(part => part !== '').join('\n\n')
  return `The user reviewed the plan and wants changes before you start:\n\n${body}\n\nStay in plan mode, revise the plan, and call ExitPlanMode again.`
}

const shownNo = (line: CommentLine) => (line.kind === '-' ? line.oldNo : line.newNo)

// desk-look comments.ts 의 docBlock 과 같은 모양: 파일:줄(범위), 그 줄 원문, 댓글.
function commentBlock(comment: LineComment): string {
  const numbers = comment.lines.map(shownNo)
  const first = numbers[0] ?? 0
  const last = numbers[numbers.length - 1] ?? first
  const width = String(Math.max(...numbers)).length
  const quoted = comment.lines.map(line => `${String(shownNo(line)).padStart(width)} ${line.text}`).join('\n')
  return `${comment.path}:${first === last ? first : `${first}–${last}`}\n\`\`\`\n${quoted}\n\`\`\`\n${comment.body}`
}

// 이 계획 파일에 단 줄 댓글(desk-look 이 미리보기 패널에서 연 실제 경로 기준). paths 는 계획 파일 경로와 그 실제 경로.
export function planComments(list: ReadonlyArray<LineComment> | null | undefined, paths: ReadonlyArray<string>): LineComment[] {
  if (!Array.isArray(list)) return []
  return list.filter(comment => typeof comment?.patch === 'string' && paths.some(path => comment.patch === `p:${path}`) && Array.isArray(comment.lines) && comment.lines.length > 0)
}

export const DISMISS_REASON = 'The user closed the plan without approving it. Stay in plan mode and wait for the user.'
export const CANCEL_REASON = 'The plan approval was cancelled before the user answered.'

// 계획 파일이 마크다운인지(미리보기 패널이 펼칠 수 있는 것만 카드로 묻는다). desk-look preview.ts 의 isMarkdown 과 같다.
export const isMarkdown = (path: unknown): path is string => typeof path === 'string' && /\.(md|markdown|mdx)$/i.test(path)

// Remote Control 이 붙어 있는 세션 상태 파일인지(desk-look ask.tsx 의 isBridgedRecord 와 같다).
export function isBridgedRecord(text: string, sessionId: string): boolean {
  return sessionId !== '' && text.includes(`"sessionId":"${sessionId}"`) && text.includes('"bridgeSessionId":"')
}

const isWide = (code: number) =>
  (code >= 0x1100 && code <= 0x115f) ||
  (code >= 0x2e80 && code <= 0xa4cf) ||
  (code >= 0xac00 && code <= 0xd7a3) ||
  (code >= 0xf900 && code <= 0xfaff) ||
  (code >= 0xfe30 && code <= 0xfe6f) ||
  (code >= 0xff00 && code <= 0xff60) ||
  (code >= 0xffe0 && code <= 0xffe6) ||
  (code >= 0x1f300 && code <= 0x1faff)

function cells(text: string): number {
  let total = 0
  for (const char of text) total += isWide(char.codePointAt(0) ?? 0) ? 2 : 1
  return total
}

// 엔진이 입력칸 글을 접는 폭. 엔진은 칸이 놓인 띠의 폭에서 라벨과 끝의 Enter 안내를 빼서 정한다(2.1.319 InputField).
// 이 폭은 칸을 감싼 테두리·여백을 모르므로 칸은 테두리 밖, 띠 폭 그대로 놓는다. 안에 넣으면 글이 칸을 넘어 잘린다.
export function planFieldColumns(columns: number, label: string, submitLabel: string): number {
  const room = columns - cells(`${label}: `)
  const short = ` ⏎ ${submitLabel}`
  const long = `${short} · \\⏎ new line`
  return Math.max(12, room - cells(room - cells(long) >= columns / 2 ? long : short))
}

// 고칠 점 입력칸 높이: 접힌 줄까지 세어 두 줄에서 PLAN_TEXT_ROWS 까지 자란다. 넘치면 칸이 커서를 따라 스크롤한다.
// 한 줄 칸에서는 엔진이 \⏎ 도 제출로 받아 줄바꿈을 시작할 수 없어 두 줄부터다.
const PLAN_TEXT_ROWS = 8
export function planTextRows(text: string, fieldColumns: number): number {
  const rows = text.split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(cells(line) / fieldColumns)), 0)
  return Math.min(PLAN_TEXT_ROWS, Math.max(2, rows))
}

// 띠 줄 수에 맞는 카드 모양. 다 들어가면 full: 테두리 2, 제목·물음 2, 버튼 줄과 그 위 빈 줄 2, 고칠 점 칸, 아래 버튼 줄 1.
// 모자라면 고칠 점 칸 없는 테두리 카드(compact, 4줄), 그것도 안 되면 테두리 없는 두 줄(inline).
export type PlanMode = 'full' | 'compact' | 'inline'
const PLAN_FULL_FRAME = 7
export function planAskMode(room: number, textRows: number): PlanMode {
  if (PLAN_FULL_FRAME + textRows <= room) return 'full'
  return 4 <= room ? 'compact' : 'inline'
}

// 칸이 띠에 들어가도록 줄인 높이. 카드 틀을 뺀 만큼까지, 두 줄 아래로는 줄이지 않는다.
export function fitTextRows(textRows: number, room: number): number {
  return Math.max(2, Math.min(textRows, room - PLAN_FULL_FRAME))
}
