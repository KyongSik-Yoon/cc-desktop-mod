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

// /desk-asana: 엔진에 붙은 Asana MCP 서버로 읽는 내 태스크. v2 는 Asana 공식 v2 서버(get_my_tasks),
// v1 은 claude.ai 커넥터(asana_* 도구). name 은 $.mcp.call 이 받는 서버 이름(도구 이름의 가운데).
export type AsanaServer = { name: string; dialect: 'v2' | 'v1' }
// assignee 는 검색 결과에만 있다(내 태스크 목록은 모두 나).
// isDone: Asana 에서 완료(작업 유형의 보류·배포 대기 같은 상태도 완료일 수 있다). status 는 작업 유형의 상태 이름.
export type AsanaTask = { gid: string; name: string; dueOn: string | null; project: string | null; section: string | null; url: string | null; assignee: string | null; isDone: boolean; status: string | null }
export type AsanaComment = { gid: string; author: string; authorGid: string | null; at: string; text: string }
// 드롭다운(enum) 필드만 options 가 있다(패널에서 바꿀 수 있는 것). 수식 필드는 바꾸지 않는다.
export type AsanaField = { gid: string; name: string; value: string | null; options: Array<{ gid: string; name: string }> | null }
export type AsanaDetail = {
  gid: string
  name: string
  notes: string
  assignee: { gid: string; name: string } | null
  dueOn: string | null
  completed: boolean
  // 사용자 지정 작업 유형의 상태(Open·In Progress…)와 고를 수 있는 상태들. MCP 로는 바꿀 수 없어 개인 토큰이 있을 때만 REST 로 바꾼다.
  status: string | null
  statuses: Array<{ gid: string; name: string }>
  places: string[]
  url: string | null
  fields: AsanaField[]
  comments: AsanaComment[]
}
// status: none 은 Asana 서버가 연결돼 있지 않음, failed 는 읽지 못함(error).
// unruled: 패널이 부르는 도구 중 allow 규칙이 없어 엔진이 물어보거나 막을 것(paneTools).
export type AsanaState = { status: 'loading' | 'ok' | 'none' | 'failed'; server: AsanaServer | null; tasks: AsanaTask[]; unruled: string[]; error?: string }
export type AsanaView = { gid: string; status: 'loading' | 'ok' | 'failed'; task: AsanaDetail | null; error?: string }
export type AsanaUser = { gid: string; name: string; email: string | null }
// 패널 검색창: 이 글자로 찾은 워크스페이스 태스크. null 이면 내 태스크 목록.
export type AsanaSearch = { query: string; status: 'loading' | 'ok' | 'failed'; tasks: AsanaTask[]; error?: string }
// 프로젝트 탭. isMine: 프로젝트 멤버에 내가 있다. open: 열린 태스크 수(v2 만, v1 은 null). modifiedAt 은 정렬용 ISO 시각.
export type AsanaTab = 'mine' | 'projects'
export type AsanaProject = { gid: string; name: string; url: string | null; members: number; open: number | null; isMine: boolean; modifiedAt: string }
export type AsanaProjects = { status: 'loading' | 'ok' | 'failed'; projects: AsanaProject[]; error?: string }
// 펼친 프로젝트의 열린 태스크(섹션은 task.section). isPartial: 읽는 쪽 수 한도에 걸려 뒤가 더 있다.
// 댓글 고치기(PAT 가 있을 때만): notoken 은 토큰을 넣으라는 안내, loading 은 REST 로 원문을 읽는 중, saving 은 PUT 중.
// story 는 원문 html_text 와 거기서 만든 고칠 글(저장할 때 둘을 견줘 바뀐 글자만 끼운다).
export type AsanaEdit = { comment: string; status: 'notoken' | 'loading' | 'ready' | 'saving'; story: { text: string; html: string } | null }
export type AsanaProjectView = { project: AsanaProject; status: 'loading' | 'ok' | 'failed'; tasks: AsanaTask[]; isPartial: boolean; error?: string }

// /desk-slack: 엔진에 붙은 Slack MCP 서버(claude.ai 커넥터)로 읽는 나에게 온 DM·그룹 DM.
export type SlackServer = { name: string }
export type SlackPerson = { id: string; name: string }
// 검색으로 받은 메시지 하나(남이 나에게 보낸 것). ts 는 Slack 의 "1792131860.241069".
export type SlackMessage = { channel: string; kind: 'dm' | 'group'; participants: SlackPerson[]; from: SlackPerson; ts: string; text: string; permalink: string | null }
// 방 안 기록의 글 하나. at 은 Slack 이 적어 준 시각 글자.
export type SlackPost = { ts: string; from: SlackPerson; at: string; text: string }
// 대화방. title 은 나를 뺀 참가자, lastFrom 은 마지막 글쓴이(내 답장이면 null), link 는 Slack 에서 여는 채널 주소.
export type SlackRoom = { id: string; kind: 'dm' | 'group'; title: string; lastTs: string; lastFrom: string | null; preview: string; unread: number; link: string | null }
// $.store 에 두는 받은 편지(세션을 넘어 남고 떠 있는 세션끼리 같이 본다). watermark: 마지막으로 넣은 메시지 ts.
// 닫은 방은 rooms 에서 지운다: 워터마크가 앞으로만 가니 새 메시지가 와야 다시 생긴다.
export type SlackInbox = { watermark: string | null; notified: string | null; rooms: Record<string, SlackRoom> }
// 받은 편지를 읽는 세션(임대). at 은 마지막으로 읽은 시각(ms).
export type SlackPoller = { session: string; at: number }
// status: none 은 Slack 서버가 없음. unruled: allow 규칙이 없는 도구(있으면 Slack 을 부르지 않는다).
export type SlackState = { status: 'loading' | 'ok' | 'none' | 'failed'; server: SlackServer | null; unruled: string[]; inbox: SlackInbox; error?: string }
export type SlackView = { channel: string; status: 'loading' | 'ok' | 'failed'; posts: SlackPost[]; error?: string }

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
      // /desk-fold 로 접어 둔 패널, 접은 게 없으면 null.
      folded: FoldedPane[] | null
      // 지금 브랜치의 PR(PR 바·/desk-pr 패널).
      pr: PrState | null
      asana: AsanaState | null
      asanaView: AsanaView | null
      asanaUsers: { query: string; status: 'loading' | 'ok' | 'failed'; users: AsanaUser[] } | null
      asanaSearch: AsanaSearch | null
      asanaTab: AsanaTab
      asanaProjects: AsanaProjects | null
      asanaProject: AsanaProjectView | null
      asanaEdit: AsanaEdit | null
      // /desk-slack: 받은 편지(store 를 비춘 것)와 펼친 대화방(null 이면 목록).
      slack: SlackState | null
      slackView: SlackView | null
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
      // diff 줄 댓글: 쓰는 중인 것(고른 줄 범위, 없으면 null)과 다음 프롬프트에 context 로 붙일 것.
      commentDraft: CommentDraft | null
      lineComments: LineComment[]
      // 미리보기 패널에 열린 문서와, 이번 턴에 Write 로 쓴 문서(턴 끝에 연다). 없으면 null.
      preview: PreviewFile | null
      previewWritten: string | null
    }
  }
}
