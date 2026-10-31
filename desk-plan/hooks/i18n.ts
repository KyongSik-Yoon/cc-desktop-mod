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
  planReviseEmpty: '고칠 점을 적어 주세요',
  planHint: '1 승인 · 2 계획 보기 · 9 기본 창 · Esc 취소',
  // 띠를 접어 카드가 안 보일 때 펴는 키(desk-look 의 질문 카드 힌트와 같다)
  bandToggle: '안 보이면 ctrl+x ctrl+a',
  toDefault: '기본 창으로',
  close: '닫기',
  otherPlaceholder: '두 번 클릭해서 입력',
}

export type Strings = typeof ko

const en: Strings = {
  planAskTitle: 'Claude plan',
  planAskQuestion: 'The plan is ready. Proceed with it?',
  planApprove: 'Approve and start',
  planView: '◫ View plan',
  planReviseLabel: 'Changes',
  planRevise: 'Ask for changes',
  planReviseEmpty: 'Write what to change first',
  planHint: '1 approve · 2 view plan · 9 default dialog · Esc cancel',
  bandToggle: 'hidden? ctrl+x ctrl+a',
  toDefault: 'Default dialog',
  close: 'Close',
  otherPlaceholder: 'double-click to type',
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
