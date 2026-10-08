# cc-desktop-mod

Claude Code 터미널 UI 를 Claude 데스크톱 앱 Code 탭처럼 보이게 만드는 mod 모음입니다.
mod 는 Claude Code 의 함수 훅 플러그인이라, 엔진은 그대로 두고 화면에 그리는 방식만 바꿉니다.

## desk-look

| 영역 | 터미널 기본 | desk-look |
|---|---|---|
| 내 프롬프트 | `>` 로 시작하는 줄 | 오른쪽 정렬 회색 말풍선 (한 줄은 알약, 여러 줄은 모서리만 둥근 상자) |
| 답변 | `●` 불릿 + 엔진 마크다운 | 데스크톱 산문 스타일 마크다운 렌더러 |
| 표 | 격자 표 | 폭을 채우는 표, 헤더 회색 바탕, 행 구분선 |
| mermaid | 코드 블록 | 박스 그림 ([lovely-mermaid](https://github.com/xl0/lovely-mermaid)), 화살촉이 상자에 꽂힘 |
| `> [!NOTE]` 알림 | 인용문 | 종류별 색 테두리 박스 |
| 도구 호출 | 호출마다 행 + 결과 블록 | 이어진 호출을 `Ran 2 commands, edited a file +3 −1 ›` 한 줄로 접고, 누르면 펼침. 펼치면 편집 diff 가 바로 보임(바뀐 줄만 색, 앞뒤 두 줄 문맥) |
| 턴 끝 | 소요 시간 줄 | 그 턴에 고친 파일 카드 `Edited N files +N −M`, 오른쪽 끝에 답변 복사 `⧉ copy` |
| 할 일 | 도구 줄 | 입력창 위 체크리스트 카드 `Tasks 2/5` (✓ 끝남, ◉ 하는 중, ○ 남음). `TodoWrite`·`TaskCreate` 가 있는 세션에서만 |
| 입력창 위 | — | 데스크톱 입력창 아래턱 같은 둥근 회색 띠: 왼쪽 `저장소  브랜치`, 오른쪽 `+N −M` |
| 진행 표시 | `✻ Simmering… (12s · ↓ 300 tokens)` | `●·· Running…  2m 29s` (하는 일에 맞춘 낱말, 클레이색 점) |
| 코드 블록 | 복사 수단 없음 | 마우스를 올리면 위 테두리 오른쪽에 `⧉ copy`, 누르면 `/copy` 와 같은 길로 복사 |
| `/desk-diff` | — | 오른쪽 패널에 커밋되지 않은 변경의 파일별 diff |
| `/desk-sessions` | — | 오른쪽 패널에 최근 세션을 프로젝트별로. 줄을 누르거나 `/desk-sessions <번호>` 로 이동 |

데스크톱 앱 Code 탭(`desktop` 화면)에서는 아무것도 바꾸지 않습니다.

### 설치

Claude Code 터미널 세션의 프롬프트에서:

```
/plugin install desk-look --marketplace KyongSik-Yoon/cc-desktop-mod
```

마켓플레이스 추가를 물으면 `y`, 범위는 user 를 고르면 됩니다.

### 업데이트

```bash
claude plugin update desk-look
```

그다음 세션에서 `/reload-plugins` 를 실행합니다.

### 세션 이동

`/desk-sessions` 패널의 줄을 누르거나 `/desk-sessions 3` 처럼 번호를 주면:

- **같은 폴더의 세션**: 지금 창에서 바로 그 세션으로 넘어갑니다(`/resume <id>` 실행). 실행이 막히면 입력창에 채워 두니 Enter 를 누르면 됩니다.
- **다른 폴더의 세션**: `cd <폴더> && claude --resume <id>` 명령을 클립보드에 복사합니다(`wl-copy`).

### 환경별 동작

- **색**: 엔진 테마 키(`text`, `inactive`, `claude` …)를 써서 밝은·어두운 테마를 모두 따라갑니다.
- **말풍선 회색 면**: [omarchy](https://omarchy.org) 테마(`~/.local/state/omarchy/current/theme/colors.toml`)를 읽을 수 있을 때만 그립니다. 그 밖의 환경에서는 둥근 테두리 말풍선입니다. 둥근 끝은 Nerd Font 반원 글리프와 Symbols for Legacy Computing 블록을 씁니다. 입력창 아래턱 띠도 같아서, 테마를 못 읽으면 회색 띠 없이 칩만 그립니다.
- **이미지 썸네일**: 멀티플렉서(tmux, zellij, herdr) 밖의 kitty·Ghostty 에서만 말풍선 위에 그립니다.
- **링크**: OSC 8 하이퍼링크를 통과시키지 않는 멀티플렉서 안에서는 이름 뒤에 URL 이 흐리게 붙습니다.

## 개발

```bash
cd desk-look
claude plugin validate .   # 매니페스트와 훅 모듈 검사
claude plugin test .       # tests/*.test.tsx 실행
```

로컬 폴더를 그대로 마켓플레이스로 붙이면 저장소를 고치고 `/reload-plugins` 만 하면 됩니다.

```bash
claude plugin marketplace add ~/dev/git-repo/cc-desktop-mod
```

`desk-look/.claude-plugin/types/` 는 엔진이 mod 를 로드할 때마다 다시 까는 타입 정의라 커밋하지 않습니다.

## 서드파티

- `desk-look/hooks/vendor/lovely-mermaid.js` — [lovely-mermaid](https://github.com/xl0/lovely-mermaid) 를 묶은 파일, Apache-2.0 (`LICENSE.lovely-mermaid`)
