export type FileDiff = { path: string; added: number; removed: number; patch: string; isNew: boolean }

// root: 저장소 최상위 절대 경로(저장소가 아니면 없다).
// ignored: 이 세션이 고친 저장소 안 파일 중 git 이 무시하는 것(절대 경로). git diff 에 안 잡혀 세션 기록으로 보인다.
export type RepoInfo = { name: string; branch: string | null; isRepo: boolean; root?: string; ignored?: string[] }

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

// 이 세션에서 도구로 고친 파일 하나와 편집마다의 diff 헌크. git 밖 파일을 diff 패널에 보일 때 쓴다.
export type SessionEdit = TurnEdit & { patches: string[] }

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

// 미리보기 패널에 열린 문서. 못 읽었으면 error 에 사유.
export type PreviewFile = { path: string; text: string; error?: string }

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

// PR 바: 지금 브랜치의 GitHub PR(gh) 또는 GitLab MR(glab). checks 는 체크(GitLab 은 파이프라인 job) 하나하나,
// threads 는 안 풀린 리뷰 스레드(GitLab 은 토론). added·removed 는 모르면 null(GitLab 은 로컬 git 으로 센다).
export type PrCheck = { name: string; state: 'pass' | 'fail' | 'pending' | 'skip'; url: string | null }
export type PrThread = { path: string; line: number | null; author: string; body: string; url: string | null; isOutdated: boolean }
export type PrInfo = {
  provider: 'github' | 'gitlab'
  number: number
  title: string
  url: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  reviewDecision: string | null
  mergeState: string | null
  head: string
  base: string
  added: number | null
  removed: number | null
  checks: PrCheck[]
  threads: PrThread[] | null
  // 머지 버튼: 패널이 본 head 커밋(그 사이 푸시되면 머지가 거절된다), 자동 머지가 걸렸는지, GitLab 프로젝트 id.
  headSha: string | null
  autoMerge: boolean
  projectId?: number
}
// status: none 은 PR 이 없는 브랜치, off 는 읽지 못한 경우. at 은 읽은 시각(ms).
// isSticky: off 의 원인이 로컬이라(도구가 없음, 그 호스트의 저장소가 아님) 다시 물어도 같은 경우.
// 네트워크·인증 오류는 false 라 다음 턴에 다시 읽는다.
export type PrState = { status: 'loading' | 'ok' | 'none' | 'off'; branch: string | null; pr: PrInfo | null; at: number; error?: string; isSticky?: boolean }

// diff 패널의 범위: 커밋 안 한 변경, 기본 브랜치에서 갈라진 뒤 전부, 커밋 하나씩.
export type DiffScope = 'uncommitted' | 'branch' | 'commits'
export type CommitInfo = { sha: string; short: string; subject: string; author: string; ago: string }
// base: 비교 기준(브랜치 이름과 merge-base), 못 찾으면 null. commit: 커밋별에서 펼친 커밋.
export type DiffView = { scope: DiffScope; base: { ref: string; sha: string } | null; files: FileDiff[]; commits: CommitInfo[]; commitFiles: Record<string, FileDiff[]> }

// 백그라운드 작업 패널 한 줄. kind 가 없으면 에이전트: $.agent.list() 의 행에 이 세션이 이벤트로 모은 수치를 더한 것.
// shell(백그라운드로 넘어간 Bash)·monitor(Monitor)는 엔진이 목록을 주지 않아 도구 결과와 끝남 알림으로만 안다.
// command: 셸·모니터의 명령. outputFile·summary: 끝남 알림이 알려 준 출력 파일과 한 줄 요약.
// 엔진 목록은 끝난 에이전트를 곧 지우므로 끝난 것도 여기 남는다. tokens 는 마지막 요청의 컨텍스트 크기.
// activity: 지금 도는 도구(Fetching 등), 없으면 없다. startedAt·endedAt 은 ms. listed: 엔진 목록에 한 번이라도 있었는지.
export type AgentRecord = {
  id: string
  description: string
  type: string
  status: string
  name?: string
  model?: string
  startedAt?: number
  endedAt?: number
  tokens?: number
  toolUses: number
  activity?: string
  listed?: boolean
  kind?: 'agent' | 'shell' | 'monitor'
  command?: string
  outputFile?: string
  summary?: string
  // 사용자가 목록에서 뺀 끝난 작업. 기록은 남겨 엔진 목록을 다시 합쳐도 되살아나지 않는다.
  dismissed?: boolean
}

// 에이전트 상세: 처음 받은 지시(prompt)와 그 뒤의 답변 글·도구 묶음·사용자 메시지 차례.
export type AgentItem = { kind: 'text'; text: string } | { kind: 'user'; text: string } | { kind: 'run'; id: string; calls: RunCall[] }
export type AgentDetail = { id: string; prompt: string; items: AgentItem[] }

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
      // 마지막 사람 입력이 온 곳: 터미널(composer) 또는 Remote Control(bridge). 아직 없으면 null.
      promptOrigin: 'composer' | 'bridge' | null
      // 컨텍스트·사용 한도(턴이 끝날 때마다), 그리고 컨텍스트 패널을 열 때 계산한 항목별 내역.
      usage: UsageInfo | null
      usageBreakdown: UsageBreakdown | null
      // 지금 브랜치의 PR(PR 바·/desk-pr 패널).
      pr: PrState | null
      // /desk-diff 패널이 보여 주는 범위와 그 diff.
      diffView: DiffView
      // /desk-agents 패널: 이 세션의 에이전트, 상세로 연 에이전트 id(목록이면 null)와 그 대화, 경과 시간 시계(ms).
      agents: Record<string, AgentRecord>
      agentView: string | null
      agentDetail: AgentDetail | null
      agentClock: number
      // 셸·모니터 상세에서 보이는 출력 끝부분(끝남 알림의 출력 파일에서). 없으면 null.
      taskOutput: { id: string; text: string | null } | null
      // 미리보기 패널에 열린 문서와, 이번 턴에 Write 로 쓴 문서(턴 끝에 연다). 없으면 null.
      preview: PreviewFile | null
      previewWritten: string | null
    }
  }
}
