# desk-plan: 계획 승인을 카드로

[English](README.md) | **한국어**

desk-plan 은 계획 승인(`ExitPlanMode`)을 화면을 덮는 엔진 창 대신 입력창 위 카드로 묻는 Claude Code 플러그인(mod)입니다. 계획은 옆 패널에 열려, 읽으면서 고를 수 있습니다. [desk-look](../README.ko.md) 과 같은 마켓에서 받고, desk-look 이 있어야 합니다. 카드는 desk-look 의 띠에 놓이고 계획은 desk-look 의 미리보기 패널에 열립니다.

0.68.6 까지 이 카드는 desk-look 의 일부였습니다. 카드가 Claude Code 의 권한 창에 대신 답하는데, Claude 플러그인 디렉터리에 올리는 플러그인은 그렇게 할 수 없어서 desk-look 을 디렉터리에 올릴 수 있게 여기로 옮겼습니다. desk-plan 은 디렉터리에 올리지 않습니다.

## 설치

desk-look 을 설치한 Claude Code 터미널 세션의 입력창에서:

```
/plugin install desk-plan@cc-desktop-mod
```

desk-look 처럼 Claude Code 최신 버전에 맞춰 만듭니다. desk-look 의 `/desk-update` 가 이 플러그인도 올립니다.

## 계획 카드

Claude 가 계획 파일(`~/.claude/plans/`)과 함께 `ExitPlanMode` 를 부르면 카드에 계획 제목이 뜨고, 계획은 desk-look 의 미리보기 패널에 열립니다. 입력창이 비어 있으면:

- `1` 승인. 엔진 창의 첫 선택지처럼 계획 전 모드로 돌아갑니다
- `2` 패널에서 계획을 보고 포커스도 그리로 옮깁니다
- `고칠 점` 을 두 번 클릭해 적고 Enter: Claude 가 plan 모드에 남아 계획을 고쳐 다시 묻습니다
- `9` 엔진 창으로 넘깁니다(편집을 하나씩 승인하기 같은 나머지 선택지). `닫기` 는 고칠 점 없이 거절하고, Esc 는 턴을 멈추므로 카드도 취소됩니다

카드가 떠 있는 동안 desk-look 의 띠는 카드가 차지하고, 스피너 아래 진행 띠는 숨으며, 힌트 줄 끝에 답하는 키가 붙습니다. 카드가 뜰 때 알림을 보냅니다(`notify`). 카드가 엔진 창을 대신하는 동안엔 엔진이 알림을 보내지 않기 때문입니다.

카드는 터미널 하나만 붙은 세션에서만 쓰고, desk-look 의 질문 카드처럼 마지막으로 입력한 곳을 따릅니다. 터미널이면 카드, Claude 앱(Remote Control)이나 collie 로 폰에서 입력했으면 엔진 창을 띄워 거기서 답할 수 있게 합니다. 계획 파일이 없거나 desk-look 의 질문 카드가 떠 있을 때도 엔진 창입니다.

## 설정

`/plugin configure desk-plan@cc-desktop-mod`:

- `language`: `auto` (기본), `en`, `ko`. `auto` 는 desk-look 의 언어를 따릅니다
- `notify`: `on` (기본), `off`. 계획 카드가 뜰 때 알림(desk-look 의 `askNotify` 는 이제 질문 카드만 다룹니다)

## 실행하고 읽는 것

- `mktemp -d`, `mkfifo`, `cat`, `tee`, `rm -rf`: 임시 폴더의 이름 있는 파이프로 답을 기다리고(`cat` 이 읽고 카드 버튼이 `tee` 로 씀) 끝나면 폴더를 지웁니다
- Remote Control 이 붙었는지 보려고 세션 상태 파일(`~/.claude/sessions`)을, 그리고 desk-look 의 값(언어, 질문 카드가 떠 있는지, 마지막 입력이 온 곳)을 읽습니다
- 네트워크로는 아무것도 보내지 않습니다

## 훅

- `classic.PreToolUse` (`ExitPlanMode` 만): 카드를 띄우고 기다립니다. 승인하면 호출 입력을 그대로 `allow` 와 함께 돌려줘 Claude Code 가 도구를 돌리고 엔진 창처럼 plan 모드를 나갑니다. 고칠 점이나 `닫기` 는 Claude 가 읽을 사유와 함께 거절하고, `9` 는 `next(e)` 로 엔진 창에 넘깁니다
- `ui.render` (`AbovePrompt`, `PromptHint`): 카드가 떠 있는 동안 카드와 힌트 키를 그리고, 나머지는 그대로 넘깁니다
- `session.start`, `state.set` (desk-look 의 `lang`): desk-look 의 언어를 따릅니다

## 라이선스

MIT
