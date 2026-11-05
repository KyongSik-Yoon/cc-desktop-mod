# desk-review: 정리하고 리뷰하고, 결과는 대화 옆에서

[English](README.md) | **한국어**

desk-review 는 스킬 하나와 옆 패널 하나를 가진 Claude Code 플러그인(mod)입니다. `/desk-review:simplify-review` 는 변경분에 `/simplify` 를 돌린 뒤 그 결과에 `/code-review medium` 을 돌립니다. 그래서 정리가 바꾼 코드도 리뷰가 봅니다. 결과는 옆 패널에 열립니다. 정리는 고침·안 고침, 리뷰는 찾음·버림으로, 항목마다 파일·줄·이유가 붙습니다. 항목을 누르면 그 자리에서 펼쳐집니다. 고친 항목은 그 diff 가, 나머지는 그 줄 둘레의 지금 소스가 보입니다. Claude Code 를 벗어나지 않습니다. 거기서 desk-look 의 diff 패널로 그 파일을 열 수도 있습니다. [desk-look](../README.ko.md) 과 같은 마켓에서 받고, diff 패널 때문에 desk-look 이 있어야 합니다.

## 설치

Claude Code 터미널 세션의 입력창에서(desk-look 이 없으면 함께 설치됩니다):

```
/plugin install desk-review@cc-desktop-mod
```

desk-look 처럼 Claude Code 최신 버전에 맞춰 만듭니다. desk-look 의 `/desk-update` 가 이 플러그인도 올립니다.

## 쓰기

- `/desk-review:simplify-review [대상]`: 정리 → 리뷰 → 패널에 결과. 대상을 빼면 지금 diff 를 보고, 주면 두 스킬에 그대로 넘깁니다
- `/desk-review`: 마지막 결과를 다시 엽니다

패널은 위에서부터 한 줄 결론(개수 포함), `1. 정리`, `2. 리뷰`, `3. 확인 못 한 것`, `4. 다음 할 일` 입니다. 빈 절은 `없음` 이라고 적습니다. 항목을 누르면 패널 안에서 펼쳐집니다. 고친 항목은 커밋 안 한 변경 가운데 그 줄을 담은 헌크를 `+`/`−` 줄로 보여 줍니다. 나머지 항목과, 변경을 이미 커밋한 고친 항목은 결과를 쓴 때가 아니라 **지금** 파일에서 그 줄 둘레를 읽어 줄 번호·색과 함께 보여 줍니다. `◫ 변경 사항 탭에서 열기` 는 desk-look 의 diff 패널을 그 파일에서, 이 패널 옆 `변경 사항` 탭으로 엽니다. 커밋 안 한 변경이 없는 파일은 diff 에 없어서 desk-look 이 그렇다고 알려 줍니다. 패널을 못 쓰면(도구가 없거나 거절) 스킬이 같은 결과를 Markdown 파일로 쓰고, desk-look 이 그걸 미리보기 패널에 엽니다.

## 설정

`/plugin configure desk-review@cc-desktop-mod`:

- `language`: `auto`(기본), `en`, `ko`. `auto` 는 desk-look 의 언어를 따릅니다

## 실행하고 읽는 것

- `git diff HEAD -- <파일>`(첫 커밋 전에는 `git diff -- <파일>`): 고친 항목을 펼 때 그 변경을 보이려고
- 항목을 펼 때 그 파일을 읽고, desk-look 의 언어를 읽습니다
- 네트워크로 아무것도 보내지 않습니다

## 훅과 도구

- 도구 `review_report`(`mcp__desk-review__review_report`): 스킬이 결과를 넘깁니다. `tool.call` 훅이 검사해 담아 두고 패널을 엽니다. 이유가 빠졌거나 상태가 틀렸거나 줄이 없으면 고칠 곳과 함께 거절합니다
- `command.run`(`desk-review`): 마지막 결과를 엽니다
- `ui.render`(`Pane`, `desk-review`): 결과를 그립니다
- `session.start`, `state.set`(desk-look 의 `lang`): 도구·명령을 걸고 desk-look 의 언어를 따릅니다
- `◫ 변경 사항 탭에서 열기` 를 누르면 자기 상태 `diffAt` 을 씁니다. desk-look 이 그 `state.set` 을 훅해 diff 패널을 엽니다

## 라이선스

MIT
