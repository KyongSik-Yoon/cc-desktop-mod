# cc-desktop-mod

## 지원하는 Claude Code

desk-look 은 설치된 최신 Claude Code 만 지원한다. 옛 엔진을 위한 버전 감지·분기·fallback 을 만들지 않고, 새 버전이 해결한 우회 코드는 걷어낸다(`desk-release-check` 스킬은 이를 "바로 할 것"으로 분류한다).
mod API 는 EARLY ACCESS 라 버전마다 바뀌고, 분기는 코드와 테스트를 두 벌로 만들며, 검증은 최신 엔진에서만 할 수 있기 때문이다. 옛 엔진은 받아들이지 못하는 트리를 거부하고 기본 그림을 그리므로 크게 망가지지 않는다. `plugin.json` 에는 최소 엔진 버전 필드가 없어 README 로만 알린다.

## 버전과 릴리즈

desk-look 의 `desk-look/.claude-plugin/plugin.json` 버전을 올리는 커밋에 그 버전의 릴리즈 노트 `.github/release-notes/vX.Y.Z.md` 를 함께 넣는다. 커밋이 main 에 들어오면 `.github/workflows/release.yml` 이 그 버전 커밋에 태그 `vX.Y.Z` 를 달고 GitHub 릴리즈를 만든다. 버전 하나에 릴리즈 하나이고, 여러 버전을 쌓았다가 묶어 올리지 않는다.
클라우드 세션은 태그·릴리즈를 직접 만들 수 없어서(403) 이렇게 Actions 에 맡긴다. 노트 파일이 없으면 워크플로가 빨갛게 실패하니, 노트를 더해 main 에 넣으면 다시 돈다. 이미 있는 태그는 건드리지 않는다.

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
