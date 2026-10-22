// 화면 문구 사전: 영어(기본)와 한국어. desk-look 이 고른 언어(desk-look.lang 상태)를 따르고, desk-look 이
// 없으면 Claude Code 의 /config 언어(language)를 따른다. T 는 한 객체를 계속 쓰고 setLang 이 내용만 바꾼다.

export type Lang = 'en' | 'ko'

const ko = {
  cancel: '취소',
  // 여러 줄 입력칸 뒤 버튼: 쓴 글을 한 번에 비운다(엔진 칸의 ^U 는 한 줄씩만 지운다)
  inputClear: '지우기',
  foldAll: '모두 접기',
  unfoldAll: '모두 펴기',
  asanaNoServer: 'Asana MCP 서버가 연결돼 있지 않아요. /mcp 에서 Asana 를 연결하세요.',
  asanaLoading: 'Asana 를 읽는 중이에요…',
  asanaFailed: (reason: string) => `Asana 를 읽지 못했어요: ${reason}`,
  asanaEmpty: '할당된 열린 태스크가 없어요.',
  asanaMine: (count: number) => `내 태스크 ${count}`,
  asanaRecentDone: (days: number, count: number) => `최근 ${days}일 완료 · ${count}`,
  asanaNoProject: '프로젝트 없음',
  asanaUnruled: '허용 규칙이 없어 Claude Code 가 패널의 Asana 호출을 물어보거나 막아요(auto mode). ~/.claude/settings.json 의 permissions.allow 에 넣으세요:',
  asanaTabMine: '내 태스크',
  asanaTabProjects: '프로젝트',
  asanaMyProjects: (count: number) => `내 프로젝트 ${count}`,
  asanaNoProjects: '멤버로 들어간 프로젝트가 없어요.',
  asanaProjectMeta: (members: number, open: number | null) => (open === null ? `멤버 ${members}` : `멤버 ${members} · 열린 ${open}`),
  asanaProjectsBack: '← 프로젝트',
  asanaOpenCount: (count: number) => `열린 태스크 ${count}`,
  asanaProjectEmpty: '열린 태스크가 없어요.',
  asanaNoSection: '섹션 없음',
  asanaProjectPartial: (count: number) => `처음 ${count}개만 읽었어요. 나머지는 Asana 에서.`,
  asanaSearchLabel: '검색',
  asanaSearchPlaceholder: '워크스페이스의 열린 태스크를 이름·설명·댓글로',
  asanaSearching: '찾는 중…',
  asanaNoMatch: '맞는 열린 태스크가 없어요.',
  asanaFound: (query: string, count: number) => `검색 "${query}" ${count}`,
  asanaSearchClear: '✕ 내 태스크',
  asanaBack: '← 목록',
  asanaDone: '✓ 완료',
  asanaOpenOn: 'Asana에서 열기',
  asanaAssignee: '담당',
  asanaNobody: '없음',
  asanaChange: '바꾸기',
  asanaFindLabel: '이름',
  asanaFindPlaceholder: '이름이나 이메일로 찾기',
  asanaFind: '찾기',
  asanaMe: '나',
  asanaFinding: '찾는 중…',
  asanaFindFailed: '사람을 찾지 못했어요.',
  asanaNoPeople: '맞는 사람이 없어요.',
  asanaAssignConfirm: (name: string) => `${name} 에게 넘길까요? 다시 누르세요`,
  asanaAssigned: (name: string) => `${name} 에게 할당했어요`,
  asanaUpdateFailed: (reason: string) => `바꾸지 못했어요: ${reason}`,
  asanaDueLabel: '마감',
  asanaToday: '오늘',
  asanaComments: (count: number) => `댓글 ${count}`,
  asanaCommentLabel: '댓글',
  asanaCommentPlaceholder: 'Asana 에 남길 댓글',
  asanaSend: '보내기',
  asanaMention: '@ 멘션',
  asanaEdit: '✎ 고치기',
  asanaEditLabel: '고치기',
  asanaEditSave: '저장',
  asanaEdited: '댓글을 고쳤어요',
  asanaEditFailed: (reason: string) => `댓글을 고치지 못했어요: ${reason}`,
  asanaEditNotMine: '내가 쓴 댓글만 고칠 수 있어요',
  asanaEditFormatted: '목록 기호·이미지·멘션 글자 같은 서식 자리는 여기서 못 바꿔요. 그 부분은 Asana 에서 고치세요',
  asanaImage: '[이미지]',
  asanaTokenRejected: 'Asana 개인 토큰이 맞지 않아요(만료·취소). 새로 넣으세요',
  asanaEditWhat: '댓글 고치기',
  asanaStatusWhat: '상태 바꾸기',
  asanaNeedToken: (what: string) =>
    `${what}는 Asana 개인 토큰(PAT)이 있어야 해요. Asana MCP 서버로는 할 수 없어서예요.\n1. https://app.asana.com/0/my-apps 에서 Personal access token 을 만든다\n2. /plugin configure desk-asana@cc-desktop-mod 의 Asana personal access token 에 넣고 Save configuration(저장하면 바로 적용돼요)`,
  asanaCommented: '댓글을 달았어요',
  asanaCommentFailed: (reason: string) => `댓글을 달지 못했어요: ${reason}`,
  asanaPromptHead: (name: string) => `Asana 태스크 "${name}" 을(를) 함께 봐 주세요.`,
  asanaPromptComments: '최근 댓글:',
  handToClaude: 'Claude에게 맡기기',
  // Asana 패널
  cmdAsana: '내게 할당된 Asana 태스크와 내 프로젝트의 섹션별 태스크를 패널로 연다: 상세·댓글·댓글 달기·담당자·드롭다운 필드 (Asana MCP 서버 필요)',
  asanaOpened: 'Asana 패널을 열었습니다.',
  justNow: '방금',
  minutesShort: (count: number) => `${count}분`,
  hoursShort: (count: number) => `${count}시간`,
  daysShort: (count: number) => `${count}일`,
  filled: '입력창에 채웠어요. 고쳐서 Enter 로 보내세요.',
  fillFailed: '입력창에 채우지 못했어요.',
}

export type Strings = typeof ko

const en: Strings = {
  cancel: 'Cancel',
  inputClear: 'Clear',
  foldAll: 'Collapse all',
  unfoldAll: 'Expand all',
  asanaNoServer: 'No Asana MCP server is connected. Connect Asana in /mcp.',
  asanaLoading: 'Reading Asana…',
  asanaFailed: reason => `Could not read Asana: ${reason}`,
  asanaEmpty: 'No open tasks are assigned to you.',
  asanaMine: count => `My tasks ${count}`,
  asanaRecentDone: (days, count) => `Done in the last ${days} days · ${count}`,
  asanaNoProject: 'No project',
  asanaUnruled: 'With no allow rule, Claude Code asks about the pane\'s Asana calls (auto mode refuses them). Add these to permissions.allow in ~/.claude/settings.json:',
  asanaTabMine: 'My tasks',
  asanaTabProjects: 'Projects',
  asanaMyProjects: count => `My projects ${count}`,
  asanaNoProjects: 'You are not a member of any project.',
  asanaProjectMeta: (members, open) => {
    const people = members === 1 ? '1 member' : `${members} members`
    return open === null ? people : `${people} · ${open} open`
  },
  asanaProjectsBack: '← Projects',
  asanaOpenCount: count => `${count} open`,
  asanaProjectEmpty: 'No open tasks.',
  asanaNoSection: 'No section',
  asanaProjectPartial: count => `Only the first ${count} were read; see the rest on Asana.`,
  asanaSearchLabel: 'Search',
  asanaSearchPlaceholder: 'Open tasks in the workspace, by name, description or comment',
  asanaSearching: 'Searching…',
  asanaNoMatch: 'No open task matches.',
  asanaFound: (query, count) => `Search "${query}" ${count}`,
  asanaSearchClear: '✕ My tasks',
  asanaBack: '← Tasks',
  asanaDone: '✓ Done',
  asanaOpenOn: 'Open on Asana',
  asanaAssignee: 'Assignee',
  asanaNobody: 'None',
  asanaChange: 'Change',
  asanaFindLabel: 'Name',
  asanaFindPlaceholder: 'Find by name or email',
  asanaFind: 'Find',
  asanaMe: 'Me',
  asanaFinding: 'Finding…',
  asanaFindFailed: 'Could not look people up.',
  asanaNoPeople: 'Nobody matches.',
  asanaAssignConfirm: name => `Hand it to ${name}? Press again`,
  asanaAssigned: name => `Assigned to ${name}`,
  asanaUpdateFailed: reason => `Could not change it: ${reason}`,
  asanaDueLabel: 'Due',
  asanaToday: 'today',
  asanaComments: count => `Comments ${count}`,
  asanaCommentLabel: 'Comment',
  asanaCommentPlaceholder: 'A comment to leave on Asana',
  asanaSend: 'Send',
  asanaMention: '@ Mention',
  asanaEdit: '✎ Edit',
  asanaEditLabel: 'Edit',
  asanaEditSave: 'Save',
  asanaEdited: 'Comment edited',
  asanaEditFailed: reason => `Could not edit the comment: ${reason}`,
  asanaEditNotMine: 'Only your own comments can be edited',
  asanaEditFormatted: 'List marks, images and the letters of a mention cannot be changed here; change those on Asana',
  asanaImage: '[image]',
  asanaTokenRejected: 'The Asana personal access token was refused (expired or revoked). Put in a new one',
  asanaEditWhat: 'Editing comments',
  asanaStatusWhat: 'Changing the status',
  asanaNeedToken: what =>
    `${what} needs an Asana personal access token (PAT): the Asana MCP servers cannot do it.\n1. Create a personal access token at https://app.asana.com/0/my-apps\n2. Put it in Asana personal access token under /plugin configure desk-asana@cc-desktop-mod and Save configuration (it applies at once)`,
  asanaCommented: 'Comment added',
  asanaCommentFailed: reason => `Could not add the comment: ${reason}`,
  asanaPromptHead: name => `Let's look at the Asana task "${name}" together.`,
  asanaPromptComments: 'Recent comments:',
  handToClaude: 'Hand to Claude',
  // Asana pane
  cmdAsana: 'Open the Asana tasks assigned to you, and your projects\' tasks by section, in a pane: details, comments, adding a comment, assignee and dropdown fields (needs an Asana MCP server)',
  asanaOpened: 'Opened the Asana pane.',
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
