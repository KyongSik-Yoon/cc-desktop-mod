# desk-grant: desk-asana·desk-slack 가 자기 도구를 부르게 허용

[English](README.md) | **한국어**

desk-grant 는 패널도 설정도 없는 Claude Code 플러그인(mod)입니다. [desk-asana](../desk-asana/README.ko.md)·[desk-slack](../desk-slack/README.ko.md) 패널이 부르는 Asana·Slack MCP 도구를 허용해, `permissions.allow` 규칙을 넣지 않아도 되게 합니다. [desk-look](../README.ko.md) 과 같은 마켓에서 받습니다.

플러그인의 MCP 호출도 Claude 의 호출처럼 Claude Code 권한 검사를 거칩니다. auto mode 는 거절하고 기본 모드는 매번 묻습니다. 플러그인 자신의 권한 훅은 버튼·입력칸·타이머에서 부른 호출에는 돌지 않고 다른 플러그인의 훅은 돌기 때문에, 허용을 별도 플러그인으로 뒀습니다. desk-grant 는 Claude 플러그인 디렉터리에 올리지 않습니다.

## 설치

desk-asana 나 desk-slack 을 설치하면 함께 설치됩니다. 0.70.0 전에 desk-asana·desk-slack 을 쓰고 있었다면 업데이트로는 새 의존성이 들어오지 않으니 한 번 설치하고 다시 읽습니다:

```
/plugin install desk-grant@cc-desktop-mod
/reload-plugins
```

desk-asana·desk-slack 은 desk-grant 를 의존 플러그인으로 적습니다. 없으면 Claude Code 가 두 플러그인을 끄고 `/plugin` 의 Errors 에 띄웁니다. 이 도구들의 예전 `permissions.allow` 규칙(`mcp__asana-v2__…`, `mcp__claude_ai_Slack__…`)은 지워도 됩니다. 남겨 두면 Claude 가 같은 도구를 부를 때도 묻지 않습니다. desk-look 의 `/desk-update` 가 desk-grant 도 올립니다(설치하지는 않습니다).

## 실행하고 읽고 보내는 것

없습니다. 프로그램을 실행하지 않고, 아무것도 읽지 않고, 네트워크로 아무것도 보내지 않습니다. 훅은 `tool.check` 하나이고, 둘 다 맞을 때만 `allow` 로 답합니다:

- 호출(또는 `$.tool.check` 질의)을 desk-asana 나 desk-slack 이 냈다. 엔진이 `next.origin.plugin` 에 적어 줍니다
- 도구가 `mcp__<아무 서버>__<이름>` 이고 `<이름>` 이 그 플러그인 자신의 목록에 있다: desk-asana 가 쓰는 Asana v2·v1 도구, desk-slack 의 Slack 도구 다섯 개

나머지는 `next(e)` 로 그대로 넘기므로, Claude 가 같은 도구를 부를 때는 Claude Code 의 평소 권한 검사를 받습니다.

## 라이선스

MIT
