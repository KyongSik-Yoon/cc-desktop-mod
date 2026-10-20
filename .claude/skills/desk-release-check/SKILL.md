---
name: desk-release-check
description: Claude Code 새 릴리즈를 훑어 desk-look 에 개선·추가할 거리를 찾는다. 릴리즈 노트와 플러그인 API 타입(claude-code.d.ts) 버전 diff 를 함께 본다. 사용자가 "릴리즈 노트 확인", "새 버전 나왔는데 desk-look 에 쓸 거 있어?", "release check", "업데이트 점검" 이라고 할 때 사용. 구현은 하지 않고 후보 목록까지만.
---

# desk-look 릴리즈 점검

desk-look 은 Claude Code 최신 버전만 지원한다. 옛 엔진을 위한 분기는 만들지도 남기지도 않는다.

목표: 마지막으로 본 버전 이후 Claude Code 가 바뀐 것 중 **desk-look 이 쓸 수 있거나, 고쳐야 하거나, 걷어낼 수 있는 것**을 찾는다.
릴리즈 노트보다 API 타입 diff 가 더 믿을 만하다. 노트에 없는 mod API 변화가 많고, 됨/안 됨 판단은 결국 타입으로 한다.

## 1. 재료 모으기

```bash
python3 .claude/skills/desk-release-check/scripts/release_check.py gather            # 마지막으로 본 버전 이후
python3 .claude/skills/desk-release-check/scripts/release_check.py gather --since 2.1.290
```

출력은 세 부분이다.
- 설치 버전, 마지막으로 본 버전, 이 기계에 모인 타입 스냅숏
- 그 구간의 릴리즈 노트(VSCode·Slack·클라우드·Windows 처럼 터미널 mod 와 무관한 표면은 걸러져 있다)
- 플러그인 API diff 요약: 새로 생기거나 없어진 export 타입, 이벤트/op 키, `$` 멤버. 전체 diff 파일 경로도 함께 나온다

스냅숏은 `~/.cache/desk-release-check/types/` 에 버전별로 모인다. 엔진이 mod 를 불러올 때 써 두는 타입 파일을 모으는 방식이라, 설치 버전으로 한 번도 mod 를 불러오지 않았으면 그 버전 스냅숏이 없다. 출력에 그렇다고 나오면 세션을 한 번 띄운 뒤 다시 돌린다.

## 2. 후보 고르기

요약에서 이름만 보고 판단하지 말고, 후보마다 전체 diff 나 최신 스냅숏에서 그 선언과 doc 주석을 읽는다. 컴포넌트 props 변화(예: `Button` 이 children 을 받게 된 것)는 이름 요약에 안 잡히니, diff 에서 `props`, `ui.render`, 컴포넌트 이름 근처를 따로 훑는다.

후보마다 이 질문에 대어 본다.
1. **데스크톱 Code 탭에 있는데 desk-look 에 없던 것을 이제 만들 수 있나?** README 의 "한계" 문구와 지난 결정이 출발점이다. 예: 도는 셸의 출력을 끝나기 전에 읽기(`/desk-tasks` 는 출력 파일을 끝남 알림으로만 안다), 패널에서 키보드로 누르기.
2. **지금 우회하고 있는 코드를 걷어낼 수 있나?** desk-look 은 최신 Claude Code 만 지원하므로, 새 버전이 해결한 우회 코드·버전 분기·옛 엔진용 fallback 은 기본으로 **바로 할 것**이다. `hooks/` 에서 버전 번호(`2.1.`)나 "엔진이 … 못 해서" 류 주석을 grep 한다.
3. **엔진 기본 그림이 바뀌어 desk-look 이 덮어쓰는 곳이 어긋나나?** desk-look 이 `ui.render` 로 가로채는 컴포넌트(AssistantMessage, UserMessage, ToolUse, ToolGroup, AbovePrompt, TurnDuration, Spinner, PromptHint, Pane 등)의 props 변화나 노트의 화면 변경을 본다.
4. **고쳐진 엔진 버그 때문에 desk-look 쪽 방어 코드가 불필요해졌거나, 반대로 새 동작에 맞춰야 하나?**

## 3. 보고

구현하지 않는다. 사용자가 고른 것만 이후에 진행한다. 형식:

- **바로 할 것**: 근거가 분명하고 범위가 작은 것. 항목마다 근거(버전과 노트 줄 또는 API 이름), desk-look 어디를 어떻게 바꿀지 한두 줄
- **검토할 것**: 쓸 수 있을 것 같지만 확인이 필요한 것. 무엇을 확인해야 하는지
- **해당 없음**: 몇 건 훑었고 왜 무관한지 한 줄로 묶어서. 항목을 늘어놓지 않는다

## 4. 기준점 갱신

사용자가 보고를 받은 뒤(그 구간을 다 봤다고 할 때) 설치 버전으로 표시한다.

```bash
python3 .claude/skills/desk-release-check/scripts/release_check.py mark <설치 버전>
```

기준점은 `~/.cache/desk-release-check/last-checked` 에 있다. 저장소에도 메모리에도 적지 않는다.
클라우드에서 도는 예약 루틴만 예외다. `~/.cache` 가 없어 원격 `cc-checked` 브랜치 하나에 둔다: 빈 트리 커밋 하나를 force-push 하고, 커밋 메시지 첫 줄이 `cc-checked X.Y.Z` 다.
