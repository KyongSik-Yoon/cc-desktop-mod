// /desk-asana: 엔진에 붙은 Asana MCP 서버로 읽는 내 태스크. v2 는 Asana 공식 v2 서버(get_my_tasks),
// v1 은 claude.ai 커넥터(asana_* 도구). name 은 $.mcp.call 이 받는 서버 이름(도구 이름의 가운데).
export type AsanaServer = { name: string; dialect: 'v2' | 'v1' }
// assignee 는 검색 결과에만 있다(내 태스크 목록은 모두 나).
// isDone: Asana 에서 완료(작업 유형의 보류·배포 대기 같은 상태도 완료일 수 있다). status 는 작업 유형의 상태 이름.
export type AsanaTask = { gid: string; name: string; dueOn: string | null; project: string | null; section: string | null; url: string | null; assignee: string | null; isDone: boolean; status: string | null }
export type AsanaComment = {
  gid: string
  author: string
  authorGid: string | null
  at: string
  text: string
  // html_text 를 옮긴 마크다운(notesMarkdown). stories 를 못 읽어 html_text 가 없으면 null 이고 text 평문을 그린다.
  richText: string | null
}
// 드롭다운(enum) 필드만 options 가 있다(패널에서 바꿀 수 있는 것). 수식 필드는 바꾸지 않는다.
export type AsanaField = { gid: string; name: string; value: string | null; options: Array<{ gid: string; name: string }> | null }
export type AsanaDetail = {
  gid: string
  name: string
  notes: string
  // html_notes 를 옮긴 마크다운(notesMarkdown). 서버가 html_notes 를 주지 않으면 null 이고 notes 평문을 그린다.
  richNotes: string | null
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

// /desk-fold 로 접어 둔 패널(desk-look 의 FoldedPane 과 같은 모양): 다시 열 때의 제목, 앞에 있던 것인지, 스크롤 위치.
export type FoldedPane = { id: string; title: string; isShown: boolean; offset: number }

declare module 'claude-code' {
  interface PluginState {
    'desk-asana': {
      asana: AsanaState | null
      asanaView: AsanaView | null
      asanaUsers: { query: string; status: 'loading' | 'ok' | 'failed'; users: AsanaUser[] } | null
      asanaSearch: AsanaSearch | null
      asanaTab: AsanaTab
      asanaProjects: AsanaProjects | null
      asanaProject: AsanaProjectView | null
      asanaEdit: AsanaEdit | null
      // 펼친 묶음·담당자 확인처럼 켜고 끄는 것.
      open: Record<string, boolean>
      // desk-look 이 읽는 값: 이 세션에 떠 있음, /desk-fold 로 접어 둔 패널.
      ready: boolean
      folded: FoldedPane[] | null
    }
    // desk-look 의 값 가운데 이 플러그인이 읽는 것(그쪽 types 와 같은 모양): 화면 언어, 접어 둔 desk-look 패널.
    'desk-look': {
      lang: 'en' | 'ko'
      folded: FoldedPane[] | null
    }
  }
}
