export type Stage = 'simplify' | 'review'
export type Status = 'fixed' | 'skipped' | 'found' | 'dismissed'
// 보고서 항목. file 은 사람에게 보이는 그대로(모델이 준 경로), path 는 세션 폴더 기준으로 푼 절대 경로.
export type ReviewItem = { stage: Stage; status: Status; file: string; path: string; line: number; reason: string }
// review_report 도구로 받은 보고서. id 는 받을 때마다 오른다.
export type ReviewReport = { id: number; summary: string; items: ReviewItem[]; unverified: string; next: string }
// desk-look 에 diff 패널을 이 파일에서 열어 달라는 요청. n 은 쓸 때마다 올려 같은 파일을 다시 열 때도 값이 바뀌게 한다.
export type DiffAt = { path: string; n: number }

declare module 'claude-code' {
  interface PluginState {
    'desk-review': {
      // 마지막 review_report 보고서, 없으면 null.
      report: ReviewReport | null
      // desk-look 이 state.set 훅으로 받아 diff 패널을 연다.
      diffAt: DiffAt | null
    }
    // desk-look 의 값 가운데 이 플러그인이 읽는 것: 화면 언어.
    'desk-look': {
      lang: 'en' | 'ko'
    }
  }
}
