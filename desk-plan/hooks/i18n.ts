// 화면 문구 사전: 영어(기본)와 한국어. desk-look 이 고른 언어(desk-look.lang 상태)를 따르고, 아직 못 읽으면
// Claude Code 의 /config 언어(language)를 따른다(desk-slack 의 i18n 과 같다).
// T 는 한 객체를 계속 쓰고 setLang 이 내용만 바꾼다.

export type Lang = 'en' | 'ko'

const ko = {
  planAskTitle: 'Claude 계획',
  planAskQuestion: '계획이 준비됐어요. 이대로 진행할까요?',
  planApprove: '승인하고 시작',
  planView: '◫ 계획 보기',
  planReviseLabel: '고칠 점',
  planRevise: '고쳐 달라고 하기',
  planReviseEmpty: '고칠 점을 적거나 계획 줄에 댓글을 달아 주세요',
  // 계획 파일 줄 댓글(미리보기 패널 c)로 고쳐 달라고 하기
  planSendComments: (count: number) => `✎ 줄 댓글 ${count}개로 고치기`,
  // 줄 댓글이 있으면 3, 없으면 패널에서 다는 법
  planHint: (noted: number) => `1 승인 · 2 계획 보기${noted > 0 ? ' · 3 줄 댓글로 고치기' : '(c 줄 댓글)'} · ctrl+x tab 고칠 점 쓰기 · 9 기본 창 · Esc 취소`,
  // 띠가 낮아 고칠 점 칸이 없을 때의 힌트
  planHintNoField: (noted: number) => `1 승인 · 2 계획 보기${noted > 0 ? ' · 3 줄 댓글로 고치기' : '(c 줄 댓글)'} · 9 기본 창 · Esc 취소`,
  // 띠를 접어 카드가 안 보일 때 펴는 키(desk-look 의 질문 카드 힌트와 같다)
  bandToggle: '안 보이면 ctrl+x ctrl+a',
  toDefault: '기본 창으로',
  close: '닫기',
  revisePlaceholder: '▸ 클릭하거나 ctrl+x tab 을 눌러 입력',
}

export type Strings = typeof ko

const en: Strings = {
  planAskTitle: 'Claude plan',
  planAskQuestion: 'The plan is ready. Proceed with it?',
  planApprove: 'Approve and start',
  planView: '◫ View plan',
  planReviseLabel: 'Changes',
  planRevise: 'Ask for changes',
  planReviseEmpty: 'Write what to change, or comment on plan lines',
  planSendComments: count => `✎ Revise from ${count} line comment${count === 1 ? '' : 's'}`,
  planHint: noted => `1 approve · 2 view plan${noted > 0 ? ' · 3 revise from comments' : ' (c comment lines)'} · ctrl+x tab write changes · 9 default dialog · Esc cancel`,
  planHintNoField: noted => `1 approve · 2 view plan${noted > 0 ? ' · 3 revise from comments' : ' (c comment lines)'} · 9 default dialog · Esc cancel`,
  bandToggle: 'hidden? ctrl+x ctrl+a',
  toDefault: 'Default dialog',
  close: 'Close',
  revisePlaceholder: '▸ click or press ctrl+x tab to write what to change',
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

// 설정 language: en·ko 면 그것, 그 밖은 auto(desk-look 의 언어, 못 읽으면 Claude Code /config 의 language).
export function langSetting(options: Record<string, unknown>): Lang | 'auto' {
  return options.language === 'en' || options.language === 'ko' ? options.language : 'auto'
}
