// large: 너무 커서 내용(patch)을 비우고 +/− 수만 남긴 파일(아주 긴 줄·아주 큰 diff).
export type FileDiff = { path: string; added: number; removed: number; patch: string; isNew: boolean; large?: boolean }

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

// 엔진이 그림을 그리는 길. kitty: kitty 그래픽 프로토콜(그림 파일 이름도 넘긴다). iterm: iTerm2 3.5 이상의
// 인라인 그림(2.1.305): 전체 화면 그리기에서만, png·rgba 바이트만 그리고 파일 이름은 alt 글자로 둔다.
// kitty-bytes: tmux 안의 kitty 그래픽(2.1.310): 바이트만 넘어가 파일 이름은 alt 글자로 둔다.
export type Graphics = 'kitty' | 'kitty-bytes' | 'iterm' | null

// diff 줄 댓글(hooks/comments.ts). 줄은 종류·옛 번호·새 번호로 기억한다(diffview 의 DiffLine 과 같은 모양).
export type CommentLine = { kind: ' ' | '+' | '-'; text: string; oldNo: number; newNo: number }
export type LineRef = Omit<CommentLine, 'text'>
// patch: 패널 안 패치 하나의 키. scope: 모델에게 알릴 diff 범위(커밋 안 한 변경, 커밋 abc… 등).
export type CommentDraft = { patch: string; path: string; scope: string; anchor: LineRef; end: LineRef }
export type LineComment = { id: string; patch: string; path: string; scope: string; end: LineRef; lines: CommentLine[]; body: string }

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

// stats: 진행 띠를 띄운 긴 턴의 요약(명령 수·실패·에이전트·할 일). 짧은 턴과 옛 카드는 없다.
export type TurnStats = { commands: number; failed: number; agents: number; tasksDone: number; tasksTotal: number }
export type TurnCard = { durationMs: number; files: TurnEdit[]; text?: string; stats?: TurnStats }

// 진행 띠의 "지금" 줄: 메인 대화에서 도는 도구 호출, 도구가 끝나 모델이 응답을 쓰기 시작한 시각,
// Bash 가 띄운 프로세스의 모습, 하는 중인 할 일마다 시작 시각, 이번 턴의 셈.
export type ActivityCall = { id: string; tool: string; label: string; startedAt: number }
export type ActivityProc = { name: string; cpu: number | null; quietSince: number | null; isNetwork: boolean }
// /desk-activity 패널의 턴 기록: 도구 호출마다 한 줄(loop 는 서브에이전트 id, 메인이면 없음)과 모델이 쓴 설명 글.
// endedAt 은 턴이 끝난 시각(끝난 뒤에도 다음 턴까지 지난 턴으로 보여 준다).
export type ActivityKind = 'explore' | 'edit' | 'command' | 'test' | 'agent' | 'other'
export type ActivityEvent = {
  id: string
  loop?: string
  tool: string
  label: string
  kind: ActivityKind
  start: number
  end?: number
  isError?: boolean
  added?: number
  removed?: number
}
export type ActivityLog = { startedAt: number; endedAt: number | null; events: ActivityEvent[]; says: { at: number; text: string }[] }

// say: 할 일 도구가 없을 때 윗줄에 쓰는 이번 턴의 가장 늦은 설명 글(첫 문장)과 설명 수.
export type ActivitySay = { text: string; count: number }
export type ActivityState = {
  calls: ActivityCall[]
  say?: ActivitySay | null
  idleSince: number | null
  proc: ActivityProc | null
  taskSince: Record<string, number>
  commands: number
  failed: number
  agents: number
}

// 미리보기 패널에 열린 문서. 못 읽었으면 error 에 사유.
export type PreviewFile = { path: string; text: string; error?: string }

// 세션 패널 한 줄: ~/.claude/projects 의 기록 파일 하나.
export type SessionEntry = { id: string; updatedAt: number; cwd: string; title: string }

// 지금 떠 있는 세션 하나(`claude agents --json` 의 pid 있는 항목). job 은 백그라운드 세션의 짧은 id(attach·stop 이 받는 것).
export type LiveSession = { kind: 'background' | 'interactive'; job: string | null; status: 'busy' | 'idle' | 'waiting' }

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
// 아래 목록들은 0.62.0 에 더했다: 다시 올리기 전 atom 에는 없으니 읽는 쪽이 undefined 를 견딘다.
export type UsageBreakdown = {
  categories: Array<{ name: string; tokens: number; kind: string; color: string }>
  total: number
  max: number
  compactAt: number | null
  model: string
  at: number
  memoryFiles?: Array<{ path: string; type: string; tokens: number }>
  mcpServers?: Array<{ name: string; tools: number; onDemand: number; tokens: number }>
  skills?: { included: number; total: number; tokens: number; list: Array<{ name: string; tokens: number }> } | null
  agents?: Array<{ name: string; tokens: number }>
}

// 입력 쪽 토큰 세 갈래와 출력.
export type TokenSplit = { input: number; cacheRead: number; cacheWrite: number; output: number }

// 컨텍스트 패널의 세션 흐름. 메인 턴이 끝날 때 칩을 위해 이미 읽은 값을 한 점씩 적는다(따로 묻지 않는다).
// costUsd 는 그때까지의 세션 비용 합계, turn 은 그 턴의 토큰(엔진이 못 셌으면 null).
export type ContextPoint = { at: number; tokens: number | null; percent: number | null; costUsd: number | null; turn: TokenSplit | null }
export type ContextCompaction = { at: number; trigger: string; before: number | null; after: number | null }

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
// baseRef: 사람이 고른 기준 브랜치(null 이면 자동). bases: 기준 고르기 목록이 열려 있으면 그 후보, 닫혀 있으면 null.
export type DiffView = {
  scope: DiffScope
  base: { ref: string; sha: string } | null
  baseRef: string | null
  bases: string[] | null
  files: FileDiff[]
  commits: CommitInfo[]
  commitFiles: Record<string, FileDiff[]>
}
// diff 패널에서 편 안 바뀐 구간: 펼 때의 패치 글(바뀌면 버린다)과, 구간 첫 줄 새 번호마다 그 줄들.
export type OpenedGaps = { patch: string; lines: Record<number, string[]> }
// diff 패널 파일 이름 거르기: 거르기 줄이 보이는지와 걸러 낼 글.
export type DiffFilter = { isOpen: boolean; query: string }

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
// /desk-fold 로 접어 둔 패널: 다시 펼 때의 제목, 앞에 있던 것인지, 스크롤 위치.
export type FoldedPane = { id: string; title: string; isShown: boolean; offset: number }

declare module 'claude-code' {
  // desk-look 이 $.tool.register 로 거는 도구(preview.ts previewTool). 연결된 서버에서 뽑는 MCP 타입에는 없다.
  interface McpToolInputs {
    'mcp__desk-look__preview': { path: string }
  }
  interface PluginState {
    'desk-look': {
      open: Record<string, boolean>
      diff: FileDiff[]
      repo: RepoInfo | null
      surface: Surface | null
      runs: Runs
      images: Record<string, ImageInfo>
      // 터미널이 그림을 그리는 길(멀티플렉서 밖의 kitty·Ghostty, 전체 화면의 iTerm2). 못 그리면 null.
      graphics: Graphics
      pendingEdits: TurnEdit[]
      turnCards: TurnCard[]
      sessions: SessionEntry[]
      // 세션 패널 검색어.
      sessionQuery: string
      // 세션 id → 지금 떠 있는 세션의 종류·상태.
      liveSessions: Record<string, LiveSession>
      // 지금 턴이 시작된 시각(ms), 턴 밖이면 null.
      turnStartedAt: number | null
      bandDoneAt: number | null
      // 스피너를 다시 그리게 하는 시계(ms).
      tick: number
      // 지금의 할 일 목록.
      tasks: TaskItem[]
      // 입력창 위 진행 띠의 "지금" 줄.
      activity: ActivityState
      // /desk-activity 패널: 이번(또는 지난) 턴의 기록. 아직 턴이 없으면 null.
      activityLog: ActivityLog | null
      // /desk-activity 패널을 다시 그리게 하는 시계(ms).
      activityClock: number
      // /desk-activity 패널 몸통의 첫 줄(머리 아래를 패널이 스스로 스크롤한다). 끝을 따라가면 Number.MAX_SAFE_INTEGER.
      activityTop: number
      // 지금 desk-look 패널로 묻고 있는 질문, 없으면 null.
      ask: AskState | null
      // 마지막 사람 입력이 온 곳: 터미널(composer) 또는 Remote Control(bridge). 아직 없으면 null.
      promptOrigin: 'composer' | 'bridge' | null
      // 컨텍스트·사용 한도(턴이 끝날 때마다), 그리고 컨텍스트 패널을 열 때 계산한 항목별 내역.
      usage: UsageInfo | null
      usageBreakdown: UsageBreakdown | null
      // /desk-fold 로 접어 둔 패널, 접은 게 없으면 null.
      folded: FoldedPane[] | null
      // 지금 화면 언어(desk-asana·desk-slack 이 따른다).
      lang: 'en' | 'ko'
      // 아래턱 ✉ 칩을 누른 횟수(desk-slack 이 바뀔 때 Slack 패널을 연다).
      slackOpen: number
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
      // /desk-diff 패널 창 위치(ui.scroll 이 알려 준 첫 행과 보이는 행 수). 보이는 곳만 그리는 데 쓴다.
      diffWindow: { offset: number; bodyRows: number }
      // diff 패널에서 편 안 바뀐 구간(패치 키마다)과 파일 이름 거르기.
      diffGaps: Record<string, OpenedGaps>
      diffFilter: DiffFilter
      // diff 줄 댓글: 쓰는 중인 것(고른 줄 범위, 없으면 null)과 다음 프롬프트에 context 로 붙일 것.
      commentDraft: CommentDraft | null
      lineComments: LineComment[]
      // 미리보기 패널에 열린 문서와, 이번 턴에 Write 로 쓴 문서(턴 끝에 연다). 없으면 null.
      preview: PreviewFile | null
      previewWritten: string | null
    }
    // 같은 마켓의 desk-asana·desk-slack 이 쓰는 값 가운데 desk-look 이 읽는 것(그쪽 types 와 같은 모양).
    // folded: /desk-fold 로 접어 둔 자기 패널, ready: 이 세션에 떠 있음, shown: 자기 패널이 열려 있음, unread: 안 읽은 Slack 메시지 수.
    'desk-asana': {
      folded: FoldedPane[] | null
      ready: boolean
      shown: boolean
    }
    'desk-slack': {
      folded: FoldedPane[] | null
      ready: boolean
      shown: boolean
      unread: number
    }
  }
}
