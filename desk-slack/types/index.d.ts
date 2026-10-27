// /desk-slack: 엔진에 붙은 Slack MCP 서버(claude.ai 커넥터)로 읽는 나에게 온 DM·그룹 DM.
export type SlackServer = { name: string }
export type SlackPerson = { id: string; name: string }
// 검색으로 받은 메시지 하나(남이 나에게 보낸 것). ts 는 Slack 의 "1792131860.241069", thread 는 스레드 답글이면 부모 ts.
export type SlackMessage = { channel: string; kind: 'dm' | 'group'; participants: SlackPerson[]; from: SlackPerson; ts: string; text: string; permalink: string | null; thread: string | null }
// 방 안 기록의 글 하나. at 은 Slack 이 적어 준 시각 글자, replies 는 스레드 답글 수(스레드 안의 글은 0).
export type SlackPost = { ts: string; from: SlackPerson; at: string; text: string; replies: number }
// 대화방. title 은 나를 뺀 참가자, lastFrom 은 마지막 글쓴이(내 답장이면 null), link 는 Slack 에서 여는 채널 주소.
// lastThread 는 마지막 글이 스레드 답글이면 그 부모 ts(방을 열면 그 스레드로). 이 필드 전에 저장된 방에는 없다.
export type SlackRoom = { id: string; kind: 'dm' | 'group'; title: string; lastTs: string; lastFrom: string | null; lastThread?: string | null; preview: string; unread: number; link: string | null }
// $.store 에 두는 받은 편지(세션을 넘어 남고 떠 있는 세션끼리 같이 본다). watermark: 마지막으로 넣은 메시지 ts.
// 닫은 방은 rooms 에서 지운다: 워터마크가 앞으로만 가니 새 메시지가 와야 다시 생긴다.
export type SlackInbox = { watermark: string | null; notified: string | null; rooms: Record<string, SlackRoom> }
// 받은 편지를 읽는 세션(임대). at 은 마지막으로 읽은 시각(ms).
export type SlackPoller = { session: string; at: number }
// status: none 은 Slack 서버가 없음. unruled: allow 규칙이 없는 도구(있으면 Slack 을 부르지 않는다).
// threadUnruled: 스레드 도구에 allow 규칙이 없으면 그 이름(스레드만 열지 않는다).
export type SlackState = { status: 'loading' | 'ok' | 'none' | 'failed'; server: SlackServer | null; unruled: string[]; threadUnruled?: string; inbox: SlackInbox; error?: string }
// thread 는 스레드를 보고 있으면 부모 ts(posts 는 부모와 답글), 아니면 null(채널 기록).
export type SlackView = { channel: string; thread: string | null; status: 'loading' | 'ok' | 'failed'; posts: SlackPost[]; error?: string }

// /desk-fold 로 접어 둔 패널(desk-look 의 FoldedPane 과 같은 모양): 다시 열 때의 제목, 앞에 있던 것인지, 스크롤 위치.
export type FoldedPane = { id: string; title: string; isShown: boolean; offset: number }

declare module 'claude-code' {
  interface PluginState {
    'desk-slack': {
      // 받은 편지(store 를 비춘 것)와 펼친 대화방(null 이면 목록).
      slack: SlackState | null
      slackView: SlackView | null
      // 방 닫기 확인처럼 잠깐 켜 두는 것.
      open: Record<string, boolean>
      // desk-look 이 읽는 값: 안 읽은 메시지 수(아래턱 ✉ 칩), 이 세션에 떠 있음, /desk-fold 로 접어 둔 패널.
      unread: number
      ready: boolean
      folded: FoldedPane[] | null
      // 패널이 지금 열려 있음(desk-look 의 /desk-fold 가 읽는다).
      shown: boolean
    }
    // desk-look 의 값 가운데 이 플러그인이 읽는 것(그쪽 types 와 같은 모양): 화면 언어, 접어 둔 desk-look 패널, ✉ 칩을 누른 횟수.
    'desk-look': {
      lang: 'en' | 'ko'
      folded: FoldedPane[] | null
      slackOpen: number
    }
  }
}
