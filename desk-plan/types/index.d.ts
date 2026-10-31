// 계획 카드: 엔진 승인 창 대신 입력창 위 카드로 묻는 ExitPlanMode 계획. path 는 계획 파일(미리보기 패널로 연다).
// dir: 답 파일을 주고받는 임시 폴더. text: 고칠 점 입력칸의 글. shownAt: 띄운 시각(ms), 띄운 직후의 숫자 키는 무시한다.
export type PlanAskState = { id: string; dir: string; plan: string; path: string; text: string; shownAt: number }
// desk-look 에 미리보기 패널로 열어 달라는 문서. n 은 쓸 때마다 올려 같은 문서를 다시 열 때도 값이 바뀌게 한다.
export type PlanPreview = { path: string; focus: boolean; n: number }

declare module 'claude-code' {
  interface PluginState {
    'desk-plan': {
      // 지금 카드로 묻고 있는 계획, 없으면 null(desk-look 이 읽어 스피너 진행 띠·질문 카드·입력창 위 띠를 비킨다).
      planAsk: PlanAskState | null
      // desk-look 이 state.set 훅으로 받아 미리보기 패널을 연다.
      preview: PlanPreview | null
    }
    // desk-look 의 값 가운데 이 플러그인이 읽는 것(그쪽 types 와 같은 모양): 화면 언어, 떠 있는 질문 카드, 마지막 사람 입력이 온 곳.
    'desk-look': {
      lang: 'en' | 'ko'
      ask: { id: string } | null
      promptOrigin: 'composer' | 'bridge' | 'phone' | null
    }
  }
}
