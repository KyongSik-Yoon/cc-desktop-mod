export type FileDiff = { path: string; added: number; removed: number; patch: string; isNew: boolean }

export type RepoInfo = { name: string; branch: string | null; isRepo: boolean }

// 터미널 배경에서 계산한 데스크톱식 회색 면. omarchy 테마를 못 읽으면 null.
export type Surface = { mode: 'light' | 'dark'; background: string; bubble: string }

export type RunCall = {
  tool_use_id: string
  tool: string
  input: unknown
  isRunning: boolean
  isErrored: boolean
  isInterrupted: boolean
  output?: unknown
}

// 답변 텍스트 없이 이어진 도구 호출 묶음. firstOf: 호출 id → 묶음 첫 호출 id.
export type Runs = { firstOf: Record<string, string>; calls: Record<string, RunCall[]> }

// 붙여 넣은 이미지 파일과 PNG 헤더의 크기. 키는 [Image #N] 의 N.
export type ImageInfo = { path: string; width: number; height: number }

// 한 턴에 편집 도구로 바꾼 파일. 턴이 끝나면 소요 시간과 함께 카드로 남는다.
export type TurnEdit = { path: string; added: number; removed: number }

// text: 그 턴의 답변(턴 끝 줄의 복사 버튼용). 예전 기록에는 없다.
// 할 일 목록 한 줄(TodoWrite·TaskCreate 에서).
export type TaskItem = { id: string; subject: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string }

// 질문 카드: AskUserQuestion 질문 하나와 지금 묻는 상태.
export type AskQuestion = {
  question: string
  header: string
  kind: 'choice' | 'text' | 'number'
  description?: string
  options: { label: string; description?: string; preview?: string }[]
  multiSelect: boolean
  placeholder?: string
  min?: number
  max?: number
  unit?: string
}
// dir: 답 파일을 주고받는 임시 폴더. picks·texts 는 질문마다 고른 라벨과 입력한 글.
// shownAt: 지금 질문을 띄운 시각(ms). 질문이 바뀐 직후의 숫자 키는 무시한다.
export type AskState = { id: string; dir: string; questions: AskQuestion[]; step: number; picks: string[][]; texts: string[]; shownAt: number }

export type TurnCard = { durationMs: number; files: TurnEdit[]; text?: string }

// 세션 패널 한 줄: ~/.claude/projects 의 기록 파일 하나.
export type SessionEntry = { id: string; updatedAt: number; cwd: string; title: string }

// 컨텍스트 칩·패널: $.session.usage() 에서 그릴 것만 옮겨 둔 것. at 은 읽은 시각(ms).
export type UsageInfo = {
  percent: number | null
  tokens: number | null
  window: number
  limits: Array<{ kind: string; percentUsed: number; resetsAt: string | null }>
  costUsd: number | null
  at: number
}

// /context 와 같은 항목별 내역(로컬 추정). compactAt 은 자동 압축이 도는 토큰 수, 꺼져 있으면 null.
export type UsageBreakdown = {
  categories: Array<{ name: string; tokens: number; kind: string; color: string }>
  total: number
  max: number
  compactAt: number | null
  model: string
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'desk-look': {
      open: Record<string, boolean>
      diff: FileDiff[]
      repo: RepoInfo | null
      surface: Surface | null
      runs: Runs
      images: Record<string, ImageInfo>
      // 터미널이 kitty 그래픽을 그리는지(멀티플렉서 밖의 kitty·Ghostty).
      graphics: boolean
      pendingEdits: TurnEdit[]
      turnCards: TurnCard[]
      sessions: SessionEntry[]
      // 세션 패널 검색어.
      sessionQuery: string
      // 지금 턴이 시작된 시각(ms), 턴 밖이면 null.
      turnStartedAt: number | null
      // 스피너를 다시 그리게 하는 시계(ms).
      tick: number
      // 지금의 할 일 목록.
      tasks: TaskItem[]
      // 지금 desk-look 패널로 묻고 있는 질문, 없으면 null.
      ask: AskState | null
      // 컨텍스트·사용 한도(턴이 끝날 때마다), 그리고 컨텍스트 패널을 열 때 계산한 항목별 내역.
      usage: UsageInfo | null
      usageBreakdown: UsageBreakdown | null
    }
  }
}
