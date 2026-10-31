// 계획 카드: ExitPlanMode 를 엔진 승인 창 대신 입력창 위 카드로 묻는다(질문 카드와 같은 자리, 같은 기다리기).
// 엔진 창은 화면 폭 전체를 아래 끝까지 덮어 옆 패널도 가린다. 카드는 띠만 차지하고 계획 본문은 미리보기 패널에 연다.
// 엔진은 ExitPlanMode 처럼 사람이 답해야 하는 도구의 훅 승인을 updatedInput 이 있을 때만 받는다(2.1.312 실측, 2.1.316 에서 다시 확인).
// 그래서 classic.PreToolUse 에서 답을 기다렸다가 allow 와 함께 입력을 그대로 돌려준다. 그러면 엔진이 도구 본체를 돌려
// 권한 모드를 계획 전 모드로 되돌린다(엔진 창의 첫 선택지와 같다). tool.check·PermissionRequest 의 allow 만으로는 창이 그대로 뜨고,
// tool.call 이 결과를 직접 주면 모드가 plan 에 남는다. 다른 모드로 나가는 선택지는 PermissionRequest 의 setMode 로만 되는데
// 그 훅은 엔진 창과 함께 불려 창이 잠깐 깜빡이므로 두지 않았다(그럴 땐 9 기본 창).
// 엔진을 부르는 부분($)은 register.tsx 에 있고, 여기는 순수 함수만 둔다($ 는 다른 파일 함수로 넘기지 않는다).
// 계획 본문은 desk-look 의 미리보기 패널에 연다(desk-plan.preview 에 쓰면 desk-look 이 state.set 훅으로 받는다).

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
export function reviseReason(text: string): string {
  return `The user reviewed the plan and wants changes before you start:\n\n${text.trim()}\n\nStay in plan mode, revise the plan, and call ExitPlanMode again.`
}

export const DISMISS_REASON = 'The user closed the plan without approving it. Stay in plan mode and wait for the user.'
export const CANCEL_REASON = 'The plan approval was cancelled before the user answered.'

// 계획 파일이 마크다운인지(미리보기 패널이 펼칠 수 있는 것만 카드로 묻는다). desk-look preview.ts 의 isMarkdown 과 같다.
export const isMarkdown = (path: unknown): path is string => typeof path === 'string' && /\.(md|markdown|mdx)$/i.test(path)

// Remote Control 이 붙어 있는 세션 상태 파일인지(desk-look ask.tsx 의 isBridgedRecord 와 같다).
export function isBridgedRecord(text: string, sessionId: string): boolean {
  return sessionId !== '' && text.includes(`"sessionId":"${sessionId}"`) && text.includes('"bridgeSessionId":"')
}

// 고칠 점 입력칸 높이: 두 줄에서 쓴 줄 수만큼 4줄까지 자란다. 한 줄 칸에서는 엔진이 \⏎ 도 제출로 받아 줄바꿈을 시작할 수 없다.
export function planTextRows(text: string): number {
  return Math.min(4, Math.max(2, text.split('\n').length))
}

// 계획 카드가 차지할 줄 수: 테두리 2, 제목·물음 2, 버튼 줄과 그 위 빈 줄 2, 고칠 점 칸과 그 위 빈 줄, 아래 버튼 줄 1.
// 띠가 모자라면 고칠 점 칸 없는 테두리 카드(4줄), 그것도 안 되면 테두리 없는 두 줄.
export type PlanMode = 'full' | 'compact' | 'inline'
export function planAskMode(room: number, textRows: number): { mode: PlanMode; rows: number } {
  const full = 2 + 2 + 2 + 1 + textRows + 1
  if (full <= room) return { mode: 'full', rows: full }
  if (4 <= room) return { mode: 'compact', rows: 4 }
  return { mode: 'inline', rows: 2 }
}
