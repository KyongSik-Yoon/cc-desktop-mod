// 화면 문구 사전: 영어(기본)와 한국어. desk-look 이 고른 언어(desk-look.lang 상태)를 따르고, desk-look 이
// 없으면 Claude Code 의 /config 언어(language)를 따른다. T 는 한 객체를 계속 쓰고 setLang 이 내용만 바꾼다.

export type Lang = 'en' | 'ko'

const ko = {
  // 여러 줄 입력칸 뒤 버튼: 쓴 글을 한 번에 비운다(엔진 칸의 ^U 는 한 줄씩만 지운다)
  inputClear: '지우기',
  slackNoServer: 'Slack MCP 서버가 연결돼 있지 않아요. /mcp 에서 Slack 을 연결하세요.',
  slackLoading: 'Slack 을 읽는 중이에요…',
  slackFailed: (reason: string) => `Slack 을 읽지 못했어요: ${reason}`,
  slackNoUser: '내 Slack 사용자 ID 를 읽지 못했어요.',
  slackEmpty: '최근 3일 동안 나에게 온 DM 이 없어요. 새로 오면 여기에 대화방이 생겨요.',
  slackInbox: (rooms: number, unread: number) => (unread > 0 ? `대화방 ${rooms} · 안 읽음 ${unread}` : `대화방 ${rooms}`),
  slackUnruled: 'desk-grant 가 이 패널의 Slack 호출을 허용하지 않아 desk-slack 이 Slack 을 부르지 않아요(새 메시지 확인·알림도 멈춤). desk-grant 를 desk-slack 과 같은 버전으로 올리세요: /desk-update 뒤 /reload-plugins.',
  slackBack: '← 대화방',
  slackCloseConfirm: '✕ 닫을까요?',
  slackCloseAll: '모두 닫기',
  slackCloseAllConfirm: '모두 닫을까요?',
  slackOpenOn: 'Slack에서 열기',
  slackMe: '나',
  slackReplyLabel: '답장',
  slackReplyPlaceholder: (title: string) => `${title} 에게 보낼 메시지`,
  slackThreadPlaceholder: '이 스레드에 보낼 답글',
  slackReplies: (count: number) => `답글 ${count}개`,
  slackToday: '오늘',
  slackYesterday: '어제',
  slackDay: (year: number | null, month: number, day: number) => `${year === null ? '' : `${year}년 `}${month}월 ${day}일`,
  slackSend: '보내기',
  slackSent: 'Slack 에 보냈어요.',
  slackSendFailed: (reason: string) => `보내지 못했어요: ${reason}`,
  slackMore: (count: number) => ` (외 ${count}개)`,
  slackPromptHead: (title: string) => `Slack 대화: ${title}`,
  handToClaude: 'Claude에게 맡기기',
  // Slack 패널
  cmdSlack: '나에게 온 Slack DM·그룹 DM 을 대화방으로 패널에 연다: 최근 대화·답장·닫기, 새 메시지는 알림 (Slack MCP 서버 필요)',
  slackOpened: 'Slack 패널을 열었습니다.',
  justNow: '방금',
  minutesShort: (count: number) => `${count}분`,
  hoursShort: (count: number) => `${count}시간`,
  daysShort: (count: number) => `${count}일`,
  filled: '입력창에 채웠어요. 고쳐서 Enter 로 보내세요.',
  fillFailed: '입력창에 채우지 못했어요.',
}

export type Strings = typeof ko

const en: Strings = {
  inputClear: 'Clear',
  slackNoServer: 'No Slack MCP server is connected. Connect Slack in /mcp.',
  slackLoading: 'Reading Slack…',
  slackFailed: (reason: string) => `Could not read Slack: ${reason}`,
  slackNoUser: 'Could not read your Slack user ID.',
  slackEmpty: 'No DMs to you in the last 3 days. A conversation shows up here when one arrives.',
  slackInbox: (rooms: number, unread: number) => (unread > 0 ? `${rooms} conversations · ${unread} unread` : `${rooms} conversations`),
  slackUnruled: 'desk-grant does not allow this pane\'s Slack calls, so desk-slack does not call Slack (checking for new messages and notifications stop too). Bring desk-grant to the same version as desk-slack: /desk-update, then /reload-plugins.',
  slackBack: '← Conversations',
  slackCloseConfirm: '✕ Close?',
  slackCloseAll: 'Close all',
  slackCloseAllConfirm: 'Close all?',
  slackOpenOn: 'Open in Slack',
  slackMe: 'You',
  slackReplyLabel: 'Reply',
  slackReplyPlaceholder: (title: string) => `Message to ${title}`,
  slackThreadPlaceholder: 'Reply in this thread',
  slackReplies: (count: number) => (count === 1 ? '1 reply' : `${count} replies`),
  slackToday: 'Today',
  slackYesterday: 'Yesterday',
  slackDay: (year: number | null, month: number, day: number) =>
    `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1]} ${day}${year === null ? '' : `, ${year}`}`,
  slackSend: 'Send',
  slackSent: 'Sent to Slack.',
  slackSendFailed: (reason: string) => `Could not send: ${reason}`,
  slackMore: (count: number) => ` (+${count} more)`,
  slackPromptHead: (title: string) => `Slack conversation: ${title}`,
  handToClaude: 'Hand to Claude',
  // Slack pane
  cmdSlack: 'Open the Slack DMs and group DMs sent to you as conversations in a pane: recent messages, replying, closing, and a notification for new ones (needs a Slack MCP server)',
  slackOpened: 'Opened the Slack pane.',
  justNow: 'now',
  minutesShort: count => `${count}m`,
  hoursShort: count => `${count}h`,
  daysShort: count => `${count}d`,
  filled: 'Put it in the prompt. Edit it and press Enter to send.',
  fillFailed: "Couldn't fill the prompt.",
}

export const T: Strings = { ...en }
let current: Lang = 'en'

export function setLang(lang: Lang): boolean {
  if (lang === current) return false
  current = lang
  Object.assign(T, lang === 'ko' ? ko : en)
  return true
}

// Claude Code /config 의 language 값(자유 글: "Korean", "한국어", "ko" …). 모르면 영어.
export function langFromConfig(value: unknown): Lang {
  return typeof value === 'string' && /korean|한국|^ko(\b|[-_])/i.test(value.trim()) ? 'ko' : 'en'
}

// 설정 language: en·ko 면 그것, 그 밖은 auto(desk-look 의 언어, 없으면 Claude Code /config 의 language).
export function langSetting(options: Record<string, unknown>): Lang | 'auto' {
  return options.language === 'en' || options.language === 'ko' ? options.language : 'auto'
}
