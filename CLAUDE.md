# cc-desktop-mod

## 지원하는 Claude Code

desk-look 은 설치된 최신 Claude Code 만 지원한다. 옛 엔진을 위한 버전 감지·분기·fallback 을 만들지 않고, 새 버전이 해결한 우회 코드는 걷어낸다(`desk-release-check` 스킬은 이를 "바로 할 것"으로 분류한다).
mod API 는 EARLY ACCESS 라 버전마다 바뀌고, 분기는 코드와 테스트를 두 벌로 만들며, 검증은 최신 엔진에서만 할 수 있기 때문이다. 옛 엔진은 받아들이지 못하는 트리를 거부하고 기본 그림을 그리므로 크게 망가지지 않는다. `plugin.json` 에는 최소 엔진 버전 필드가 없어 README 로만 알린다.

## 버전과 릴리즈

desk-look 의 `desk-look/.claude-plugin/plugin.json` 버전을 올리는 커밋에 그 버전의 릴리즈 노트 `.github/release-notes/vX.Y.Z.md` 를 함께 넣는다. 커밋이 main 에 들어오면 `.github/workflows/release.yml` 이 그 버전 커밋에 태그 `vX.Y.Z` 를 달고 GitHub 릴리즈를 만든다. 버전 하나에 릴리즈 하나이고, 여러 버전을 쌓았다가 묶어 올리지 않는다.
클라우드 세션은 태그·릴리즈를 직접 만들 수 없어서(403) 이렇게 Actions 에 맡긴다. 노트 파일이 없으면 워크플로가 빨갛게 실패하니, 노트를 더해 main 에 넣으면 다시 돈다. 이미 있는 태그는 건드리지 않는다.

같은 마켓의 `desk-asana`·`desk-slack`·`desk-plan` 은 desk-look 과 같은 버전으로 함께 올린다(0.55.0 에서 Asana·Slack 패널을, 0.69.0 에서 계획 카드를 desk-look 에서 떼어 냄). 태그·릴리즈는 desk-look 버전 하나이고, 버전이 하나라도 다르면 워크플로가 실패한다.
따로 올리면 `/desk-update` 와 릴리즈 노트가 플러그인마다 갈라지고, 플러그인들이 서로의 상태(`desk-look.lang`·`folded`, `desk-slack.unread`, `desk-plan.planAsk` 등)를 읽어 함께 바뀌기 때문이다.
Anthropic 플러그인 디렉터리에는 desk-look 만 제출한다. 권한 창에 대신 답하는 계획 카드(`classic.PreToolUse` allow)는 디렉터리가 막는 모양이라 desk-plan 으로 떼어 냈고, 디렉터리가 막거나 리뷰어에게 넘기는 코드는 desk-look 에 다시 넣지 않는다.
desk-asana·desk-slack 은 desk-look 의 `markdown.tsx`·`diagram.ts`·`vendor/lovely-mermaid*` 를 각자의 `hooks/shared/` 에 복사해 쓴다(설치본은 플러그인 폴더만 받으므로 `../desk-look` 을 가져올 수 없다). 형제 공용 도우미 `desk-slack/hooks/util.tsx` 도 desk-asana 로 복사하고, 그 `cellWidth` 는 desk-look `markdown.tsx` 의 것과 같아야 한다. 원본을 고친 커밋에는 `scripts/sync-shared.sh` 로 복사본도 함께 넣는다. 어긋나면 워크플로의 `--check` 가 실패한다.

손으로 만들어야 할 때(Actions 가 막혔을 때):

```bash
git tag vX.Y.Z <커밋>
git push origin vX.Y.Z
gh release create vX.Y.Z --verify-tag --title "desk-look X.Y.Z" --notes-file .github/release-notes/vX.Y.Z.md --latest
```

- 태그를 먼저 푸시한다. `--target` 에 짧은 SHA 를 주면 GitHub 가 422 로 거부한다.
- 노트는 영어로, 기존 릴리즈 형식을 따른다: 첫 줄 한 문장 요약, 바뀐 점 불릿, 끝에 `## Install`
  (`/plugin install desk-look --marketplace KyongSik-Yoon/cc-desktop-mod`, 이미 설치했으면 `/desk-update` 후 `/reload-plugins`).
- 버전을 올리지 않는 커밋(문서, `.claude/skills` 등)은 릴리즈하지 않는다.
- 기능의 완성 여부는 실제 클로드를 실행하여 눈으로 확인 후 판단한다. 단, 시스템은 화면이 잠겨있을 가능성을 사전 고려한다. 

## 디렉터리 검사를 통과하는 코드 (desk-look)

디렉터리(claude.ai/directory/manage)는 main 에 들어간 버전마다 desk-look 을 정적으로 검사한다. 로컬 `validate --strict`·테스트로는 미리 볼 수 없다. 막히면(Blocking) 다음 버전을 내야 풀리고, 리뷰어 대기(Held)면 버전마다 사람 리뷰를 기한 없이 기다린다. 검사기는 코드를 실행하지 않고 이름과 모양으로 읽으므로, 뜻이 같아도 아래 모양을 벗어나면 막힌다. 괄호는 그 규칙으로 막힌 버전이다.

**막히는 것 — `$` 쓰기(MOD_CAPABILITY_USE_NOT_PLAIN)**
- `$.noun.method(...)` 는 한 줄로 쓴다. `$.process` 와 `.run(...)` 을 포매터처럼 두 줄로 나누면 막힌다(0.26.0).
- `$` 는 `register.tsx` 최상위에 선언한 함수에 인자 하나로 통째로만 넘긴다.
  - import 한 함수에 넘기면 막힌다(0.26.0 `pr.ts`, 0.67.0 `ask.tsx`). 다른 파일 함수가 받은 콜백에 넘기는 것도 같다.
  - 그래서 `$` 를 쓰는 코드는 `register.tsx` 에 모으고, 다른 파일에는 순수 함수만 둔다.
  - `on` 은 다른 파일 함수에 넘겨도 통과했다(`registerAsk(on)`).
- `$` 를 받는 최상위 함수의 이름을 지역 함수·변수·구조 분해 이름으로 다시 쓰지 않는다(0.59.1 `agentRow`, 0.69.0 `planCard`). 검사기는 이름으로 함수를 찾기 때문에 어느 쪽인지 못 가린다.
- `yield*` 안에서 `$` 를 넘기지 않는다(0.55.3 `return yield* placeCalls($, …)`). 생성기 도우미에는 `$` 를 쓰는 클로저를 넘긴다(`() => $.clock.sleep(…)` 는 통과).
- `.tsx` 에서 `h`·`Fragment` 를 JSX 말고 다른 뜻으로 쓰지 않는다(`ReturnType<typeof h>`, `const h`). 엔진이 JSX 를 이름 `h` 의 호출로 바꾸기 때문이다.

**막히는 것 — 훅과 권한**
- 플러그인이 권한을 스스로 정하면 막힌다.
  - `tool.check` 훅이 돌려줄 수 있는 것은 `return next(e)` 와 고정된 `'deny'`·`'ask'` 뿐이다. allow 는 어떤 모양이든 실패한다(0.29.0 Asana 자기 허용).
  - `const v = await next(e); …; return v` 처럼 판정을 엿보는 관찰 훅도 막힌다(MOD_PERMISSION_ANSWER_UNREAD, 0.67.2~0.68.5).
  - `classic.PreToolUse` 가 allow·`updatedInput` 을 돌려주는 것도 막힌다(0.68.6). 그래서 계획 카드를 desk-plan 으로 떼어 냈다.
  - 권한 검사를 받는 호출(`$.mcp.call` 등)은 사용자의 `permissions.allow` 규칙을 전제로 한다. 빠진 규칙은 `$.tool.check` 로 찾아 안내한다.
- `f('*', …)` 꼴 호출은 모든 도구에 거는 훅 등록으로 읽힌다(0.54.0 `wrapInline('*', text)`). `'*'` 를 첫 인자로 두지 않는다.
- 디렉터리가 모르는 이벤트에 훅을 걸면 엔진 타입에 있어도 막힌다(MOD_HOOKS_UNKNOWN_EVENT, `prompt.change`, 0.65.0 에서 뺌). 새 이벤트는 쓰기 전에 디렉터리가 아는지부터 본다. `state.set` 은 통과했다(0.69.1).

**리뷰어 대기(Held)로 넘어가는 것**
- `sh -c` 인라인 스크립트, 그리고 변수로 만든 명령(`['git', ...args]`, `run(argv)`). 명령은 호출 자리에 고정된 배열 리터럴로 쓰고, 바뀌는 인자는 stdin 으로 넘긴다(0.26.0 에서 셸 7개를 `$.fs` 와 고정 프로그램으로 바꿈).
- `agent.spawn` 훅. 권한 결정으로 본다.
- 압축된 번들. `vendor/lovely-mermaid.js` 는 압축 없이 묶는다.
- 네트워크와 명령 실행을 함께 쓰면 경고(Other findings)가 남는다. desk-look README 에 실행하는 프로그램, 보내는 곳, 훅마다 하는 일을 적어 리뷰어가 읽을 수 있게 한다.

**올리기 전 점검** — 아래가 모두 아무것도 출력하지 않아야 한다. 예전에 막힌 커밋에 돌려 실제로 잡히는 것을 확인했다.

```bash
cd desk-look/hooks
grep -nE '\$\.[a-z]+$' *.ts*                                  # 나뉜 $ 체인
grep -nE '^[^/]*[(,] *\$: ' *.ts* | grep -v '^register.tsx:'   # 다른 파일 함수가 $ 를 받음
grep -nE "\w\('\*'," *.ts* | grep -v "on('"                   # '*' 를 첫 인자로
grep -nE 'yield\* *\w+\(\$' *.ts*                              # yield* 안의 $
for n in $(grep -oP '^(export )?(async )?function \K\w+(?=\([^)]*\$)' register.tsx | sort -u); do grep -nP "^\s+(const|let|var|function)\s+$n\b|[\[{,]\s*$n\s*[,\]}]" register.tsx; done   # $ 받는 함수 이름 가림
```

**막혔을 때**: 포털에서 플러그인 → 버전 → 펼치기로 들어가 Blocking 항목과 줄 번호를 본다. 처음 막힌 버전과 그 앞 통과본의 diff 에서 원인을 찾는다. 고친 뒤에는 위 릴리즈 규칙대로 버전을 올린다. "Validation didn't finish" 경고는 고칠 것이 없다.
