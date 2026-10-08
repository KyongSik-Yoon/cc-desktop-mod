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

export type TurnCard = { durationMs: number; files: TurnEdit[]; text?: string }

// 세션 패널 한 줄: ~/.claude/projects 의 기록 파일 하나.
export type SessionEntry = { id: string; updatedAt: number; cwd: string; title: string }

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
      // 지금 턴이 시작된 시각(ms), 턴 밖이면 null.
      turnStartedAt: number | null
      // 스피너를 다시 그리게 하는 시계(ms).
      tick: number
      // 지금의 할 일 목록.
      tasks: TaskItem[]
    }
  }
}
