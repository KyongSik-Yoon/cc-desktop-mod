# desk-slack: Claude Code 오른쪽 패널의 Slack DM

[English](README.md) | **한국어**

desk-slack 은 나에게 온 Slack DM 을 대화 옆 패널로 여는 Claude Code 플러그인(mod)입니다. Claude Code 터미널을 Claude 데스크톱 앱처럼 그리는 [desk-look](../README.ko.md) 과 같은 마켓에서 받습니다. 혼자서도 동작하고, desk-look 이 있으면 안 읽은 수가 desk-look 띠의 `✉ N` 칩으로 나오고, `/desk-fold` 가 이 패널도 함께 접고, desk-look 의 언어를 따릅니다.

## 설치

Claude Code 터미널 세션의 입력창에서:

```
/plugin install desk-slack --marketplace KyongSik-Yoon/cc-desktop-mod
```

desk-look 처럼 Claude Code 최신 버전에 맞춰 만듭니다. desk-look 의 `/desk-update` 가 이 플러그인도 올립니다. desk-look 없이는 `claude plugin update desk-slack` 을 실행합니다.

## `/desk-slack`: Slack DM

남이 나에게 보낸 DM·그룹 DM 을 Slack 클라이언트처럼 대화방으로 모아 둔다. Claude Code 에 이미 연결된 Slack MCP 서버(claude.ai Slack 커넥터)로 읽는다(따로 토큰·설정 없음). 채널의 메시지·@멘션·스레드 답글은 넣지 않는다(DM 안의 스레드 답글은 넣는다). Slack 서버가 없으면 `/mcp` 에서 Slack 을 연결하라고 알린다.

- 목록은 대화방마다 한 줄, 최근 것부터: desk-slack 에서 아직 열지 않은 메시지가 있으면 `●`, 참가자, 마지막 메시지, 얼마 전인지. 처음에는 최근 3일 치를 읽은 것으로 채운다
- 대화방을 누르면 양쪽 대화 최근 30개. 맨 아래 칸에 쓰고 Enter 로 그 방에 답장한다. `↻` 다시 읽기(어느 화면이든 `r`), `← 대화방`(`b`, 답장 칸 아래에도 있음)은 목록으로
- 메시지는 Slack 처럼 그린다: 굵게·기울임·취소선, 코드 블록, 링크·멘션, 날짜가 바뀌는 자리에 날짜 줄, 한 사람이 이어 보낸 글은 이름을 한 번만, 첨부는 `📎 이름 · 크기`. 터미널에서 붙여 넣은 표(`│`·`─┼─` 로 그린 것)는 패널 폭에 맞춰 다시 그리고, 칸이 좁아 낱말이 잘리면 행마다 카드로 그린다
- 답글이 달린 글 아래 `답글 N개` 를 누르면 그 스레드(원글과 최근 답글 30개)가 열리고, 거기서 쓴 답장은 그 스레드로 간다. `← 이름`(`b`) 은 대화방으로. 대화방의 마지막 메시지가 스레드 답글이면 목록에서 누를 때 그 스레드로 바로 열린다
- `✕` 는 대화방 닫기, 맨 위 `모두 닫기` 는 목록의 모든 방 닫기(둘 다 5초 안에 한 번 더 눌러야 한다). 닫은 방은 새 메시지가 오면 다시 생긴다
- `Claude에게 맡기기` 는 최근 대화를 입력창에 채우고, `Slack에서 열기` 는 Slack 에서 연다
- Claude Code 세션이 하나라도 떠 있으면 1분마다 새 메시지를 확인하고, 대화방마다 알림을 하나씩 보낸다(알림 채널로, `slackNotify` 로 끔). desk-look 이 있으면 입력창 띠의 `✉ N` 칩이 안 읽은 수이고 누르면 패널이 열린다. 세션이 여럿이면 하나만 확인하고 나머지는 그 결과를 같이 본다
- 안 읽음은 desk-slack 안에서만 센다: 여기서 열어도 Slack 에서 읽음이 되지 않고, Slack 에서 읽어도 여기서는 지워지지 않는다
- Slack 커넥터는 이걸로 보낸 메시지 끝에 "Sent using Claude" 줄을 붙인다
- 네 Slack 도구가 모두 `~/.claude/settings.json` 의 `permissions.allow` 에 있을 때만 Slack 을 부른다. 그 전에는 아무것도 부르지 않고(확인·알림도 없음) 패널이 빠진 규칙을 보여 준다. 확인은 권한 창에 답할 사람이 없는 백그라운드에서 돌기 때문이다:

  ```json
  "mcp__claude_ai_Slack__slack_search_public_and_private", "mcp__claude_ai_Slack__slack_read_channel",
  "mcp__claude_ai_Slack__slack_send_message", "mcp__claude_ai_Slack__slack_read_user_profile"
  ```

  스레드를 열려면 `"mcp__claude_ai_Slack__slack_read_thread"` 도 넣는다. 이 규칙만 없으면 확인·알림·대화방은 그대로 돌고, 스레드만 열지 않고 대화방에 넣을 규칙을 보여 준다

  이 규칙은 Claude 가 부르는 같은 도구도 허용한다: Claude 가 Slack 을 보낼 때도 묻지 않는다

## 설정

`/config` 에서 `desk-slack` 으로 찾으면 아래 항목이 나옵니다.

- `language`: `auto` (기본), `en`, `ko`. 플러그인 자신의 문구 언어. `auto` 는 desk-look 의 언어를, desk-look 이 없으면 Claude Code `/config` 의 `language` 를 따른다: 한국어를 가리키면 한국어, 아니면 영어
- `slackNotify`: `on` (기본), `off`. 새 Slack DM 이 오면 알림(`/desk-slack` 참고). `off` 여도 패널과 desk-look 의 `✉` 칩을 위한 확인은 계속

## 라이선스

MIT (`LICENSE`)

`hooks/shared/` 는 메시지를 그리는 desk-look 마크다운 렌더러의 복사본이고, `hooks/shared/vendor/lovely-mermaid.js` 는 [lovely-mermaid](https://github.com/xl0/lovely-mermaid) 0.3.3(Apache-2.0, `hooks/shared/vendor/LICENSE.lovely-mermaid`)을 줄이지 않고 넣은 것이다. 프로그램을 실행하거나 요청을 보내지 않는다.
