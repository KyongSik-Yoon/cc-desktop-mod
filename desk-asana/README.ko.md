# desk-asana: Claude Code 오른쪽 패널의 Asana 태스크

[English](README.md) | **한국어**

desk-asana 는 내 Asana 태스크를 대화 옆 패널로 여는 Claude Code 플러그인(mod)입니다. Claude Code 터미널을 Claude 데스크톱 앱처럼 그리는 [desk-look](../README.ko.md) 과 같은 마켓에서 받습니다. 혼자서도 동작하고, desk-look 이 있으면 `/desk-fold` 가 이 패널도 함께 접고 desk-look 의 언어를 따릅니다.

## 설치

Claude Code 터미널 세션의 입력창에서:

```
/plugin install desk-asana --marketplace KyongSik-Yoon/cc-desktop-mod
```

desk-look 처럼 Claude Code 최신 버전에 맞춰 만듭니다. desk-look 의 `/desk-update` 가 이 플러그인도 올립니다. desk-look 없이는 `claude plugin update desk-asana` 을 실행합니다.

## `/desk-asana`: Asana 태스크

Claude Code 에 이미 연결된 Asana MCP 서버로 내 열린 태스크를 읽는다(따로 토큰·설정 없음). Asana 공식 V2 서버(`https://mcp.asana.com/v2/mcp`, `get_my_tasks` 가 있는 것)가 붙어 있으면 그것을, 없으면 claude.ai Asana 커넥터를 쓴다. 커넥터로 내 태스크를 읽으려면 Premium 워크스페이스여야 한다(Asana 태스크 검색). 둘 다 없으면 `/mcp` 에서 Asana 를 연결하라고 알린다.

- 목록은 끝내지 않은 내 태스크를 프로젝트별로 묶고, 줄 끝에 마감일(지났으면 빨강). 그 아래 `최근 14일 완료` 묶음에 14일 안에 완료된 태스크를 상태(`● 보류`)와 함께 흐리게 둔다. 작업 유형에 따라 보류·배포 대기 같은 상태도 Asana 에선 완료라, 그런 상태로 바꾼 태스크도 패널에서 다시 열 수 있다
- 맨 위 `● 내 태스크 ○ 프로젝트` 탭으로 바꾼다. `프로젝트` 탭은 내가 멤버인 프로젝트를 최근에 바뀐 것부터(멤버 수, V2 서버면 열린 태스크 수). 누르면 그 프로젝트의 열린 태스크를 담당자와 상관없이 섹션별로 묶어 담당자·마감일과 함께 보인다(열린 태스크가 없는 섹션은 빠진다). 14일 안에 완료된 태스크는 끝의 `최근 14일 완료` 묶음에 둔다. 섹션 줄을 누르면 접히고 `모두 접기`(`z`)는 모든 섹션을 접거나 편다. 한 프로젝트는 열린 태스크 300개까지 읽는다. 위와 맨 아래의 `← 프로젝트` 로 목록에 돌아온다
- 목록 위 `검색` 칸은 내가 볼 수 있는 워크스페이스의 열린 태스크를 이름·설명·댓글로 찾는다(최근에 바뀐 50개). 같은 모양에 담당자를 붙여 보이고, `✕ 내 태스크` 나 빈 검색으로 돌아온다. 검색은 Premium 워크스페이스여야 한다(Asana 태스크 검색)
- 태스크를 누르면 상세: 작업 유형의 상태(`● Open`), 프로젝트·섹션, 담당자, 마감일, 사용자 정의 필드, 웹과 같은 서식의 설명(제목·굵게·목록·인라인 코드·코드 블록·링크·태스크 멘션), 같은 서식에 멘션을 이름으로 보이는 최근 댓글 30개(claude.ai 커넥터는 태스크 활동 첫 100개 안의 댓글). `↻` 다시 읽기(어느 화면이든 `r`), `← 목록`(맨 아래에도 있음)은 목록·검색·프로젝트로 돌아가기
- 맨 아래 칸에 댓글을 쓰고 Enter 로 Asana 에 단다. 그 아래 `@ 멘션` 으로 이름·이메일로 사람을 찾아 누르면 댓글에 `@이름` 이 들어가고, 보낼 때 글에 `@이름` 이 남아 있으면 Asana 멘션(상대에게 알림)으로 단다
- 내가 쓴 댓글 옆 `✎ 고치기` 로 그 자리에서 고친다(Enter 로 저장). Asana MCP 서버에 댓글을 고치는 도구가 없어, 이것만은 사람이 직접 넣은 개인 토큰으로 Asana REST API 를 부른다: https://app.asana.com/0/my-apps 에서 Personal access token 을 만들어 `/plugin configure desk-asana@cc-desktop-mod` 의 `Asana personal access token` 에 넣고(보안 저장소에 둔다) `Save configuration` 을 누르면 바로 적용된다. 토큰이 없으면 `✎ 고치기` 가 이 방법을 알려 주기만 하고 아무것도 부르지 않는다. 바꾼 글자만 댓글의 원래 서식 글(html_text)에 끼워 넣어, 손대지 않은 멘션·링크·굵게·목록·코드 블록·이미지는 그대로 남는다. 목록 기호(`• `, `1. `)·이미지(`[이미지]`)·멘션과 링크의 글자는 보이기만 하고 여기서 못 바꾼다(멘션 하나를 통째로 지우는 것은 된다). 그런 자리를 건드린 고침은 보내지 않고 고치던 글을 칸에 둔다. 토큰 주인이 쓴 댓글만 고친다
- 담당자 옆 `바꾸기` 로 이름·이메일로 사람을 찾는다(또는 `나`). 다른 사람에게 넘기기는 5초 안에 한 번 더 눌러야 한다
- 드롭다운 사용자 정의 필드 옆 `›` 로 선택지를 펼쳐 하나를 누르면 바뀐다
- `Claude에게 맡기기` 는 태스크 제목·링크·상태·설명·최근 댓글을 입력창에 채운다
- 작업 유형의 상태(Open, In Progress…) 옆 `바꾸기` 로 그 유형의 상태들을 펼쳐 골라 바꾼다. 두 Asana MCP 서버 모두 이 키를 버려서, `✎ 고치기` 처럼 개인 토큰을 넣었을 때만 Asana REST API 를 부른다. 토큰이 없으면 `바꾸기` 가 넣는 법을 알려 주기만 하고 아무것도 부르지 않는다
- 이 Asana 호출은 패널을 열거나 무언가를 눌렀을 때만 하고, Claude 의 호출처럼 Claude Code 권한 검사를 거친다. allow 규칙이 없으면 auto mode 는 거절하고 기본 모드는 매번 묻는다. 패널이 쓰는 도구를 `~/.claude/settings.json` 의 `permissions.allow` 에 넣는다. 빠진 것이 있으면 패널이 그 목록을 보여 준다. V2 서버라면:

  ```json
  "mcp__asana-v2__get_my_tasks", "mcp__asana-v2__search_tasks", "mcp__asana-v2__get_task",
  "mcp__asana-v2__get_task_stories", "mcp__asana-v2__add_comment", "mcp__asana-v2__update_tasks", "mcp__asana-v2__search_objects",
  "mcp__asana-v2__get_me", "mcp__asana-v2__get_projects", "mcp__asana-v2__get_tasks"
  ```

  이 규칙은 Claude 가 부르는 같은 도구(댓글 달기·태스크 바꾸기 포함)도 허용한다

## 설정

`/config` 에서 `desk-asana` 으로 찾으면 아래 항목이 나옵니다.

- `language`: `auto` (기본), `en`, `ko`. 플러그인 자신의 문구 언어. `auto` 는 desk-look 의 언어를, desk-look 이 없으면 Claude Code `/config` 의 `language` 를 따른다: 한국어를 가리키면 한국어, 아니면 영어
- `asanaToken`: 비어 있음(기본). 선택. Asana 개인 토큰. 내 Asana 댓글의 `✎ 고치기` 와 작업 유형 상태 바꾸기만 쓴다(`/desk-asana` 참고). `/plugin configure desk-asana@cc-desktop-mod` 에서 넣는다
- `asanaKeyField`: 비어 있음(기본). 선택. 태스크 키로 쓸 Asana 사용자 정의 필드 이름(예: `JKD-1630` 을 주는 ID 필드 `JKD`). 넣으면 목록의 각 태스크 제목 뒤에 키를 흐리게 붙이고, 검색칸에 키(`JKD-1630`)를 넣으면 그 열린 태스크를 맨 앞에 찾고, `Claude에게 맡기기` 글에 키를 넣는다. 쉼표로 여러 개(`JKD, J5S`)면 태스크에 값이 있는 앞의 것. 비우면 제목만

## 라이선스

MIT (`LICENSE`)
