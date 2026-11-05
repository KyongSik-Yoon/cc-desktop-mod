// 화면 문구 사전: 영어(기본)와 한국어. desk-look 이 고른 언어(desk-look.lang 상태)를 따르고, 아직 못 읽으면
// Claude Code 의 /config 언어(language)를 따른다(desk-plan 의 i18n 과 같다).
// T 는 한 객체를 계속 쓰고 setLang 이 내용만 바꾼다.

export type Lang = 'en' | 'ko'

const ko = {
  paneTitle: '리뷰 결과',
  cmdReview: '마지막 정리·리뷰 결과를 옆 패널로 엽니다',
  noReport: '아직 리뷰 결과가 없어요. /desk-review:simplify-review 로 만드세요.',
  opened: '리뷰 결과를 옆 패널에 펼쳤어요.',
  summary: '한 줄 결론',
  simplify: '1. 정리 (simplify)',
  review: '2. 리뷰 (code-review)',
  unverified: '3. 확인 못 한 것',
  next: '4. 다음 할 일',
  none: '없음',
  fixed: '고침',
  skipped: '안 고침',
  found: '찾음',
  dismissed: '버림',
  openDiff: '◫ diff 에서 보기',
  loading: '읽는 중…',
  unreadable: (error: string) => `파일을 못 읽었어요 (${error})`,
  shifted: (asked: number, shown: number) => `${asked}번째 줄이 없어서 마지막 줄 ${shown} 을 보여요`,
  counts: (fixed: number, skipped: number, found: number, dismissed: number) => `고침 ${fixed} · 안 고침 ${skipped} · 찾음 ${found} · 버림 ${dismissed}`,
}

export type Strings = typeof ko

const en: Strings = {
  paneTitle: 'Review',
  cmdReview: 'Open the last simplify-and-review report in a side pane',
  noReport: 'No review report yet. Make one with /desk-review:simplify-review.',
  opened: 'Opened the review report in the side pane.',
  summary: 'In one line',
  simplify: '1. Cleanup (simplify)',
  review: '2. Review (code-review)',
  unverified: '3. Not verified',
  next: '4. Next',
  none: 'None',
  fixed: 'Fixed',
  skipped: 'Skipped',
  found: 'Found',
  dismissed: 'Dismissed',
  openDiff: '◫ Open in diff',
  loading: 'Reading…',
  unreadable: error => `Couldn't read the file (${error})`,
  shifted: (asked, shown) => `There is no line ${asked}; showing the last line, ${shown}`,
  counts: (fixed, skipped, found, dismissed) => `${fixed} fixed · ${skipped} skipped · ${found} found · ${dismissed} dismissed`,
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
