#!/usr/bin/env bash
# desk-look 의 마크다운 렌더러를 desk-asana 로 복사한다. 플러그인은 자기 디렉터리만 설치되므로
# desk-asana 가 ../desk-look 을 가져올 수 없어 같은 파일을 hooks/shared/ 에 둔다.
# desk-look 쪽을 고쳤으면 이 스크립트를 돌려 함께 커밋한다. --check 는 복사본이 어긋났는지만 본다
# (릴리즈 워크플로가 돌린다. 플러그인 테스트는 파일을 읽을 수 없어 거기서는 못 본다).
set -euo pipefail
cd "$(dirname "$0")/.."

from=desk-look/hooks
to=desk-asana/hooks/shared
files=(markdown.tsx diagram.ts vendor/lovely-mermaid.js vendor/lovely-mermaid.d.ts vendor/LICENSE.lovely-mermaid)

if [ "${1:-}" = "--check" ]; then
  stale=0
  for file in "${files[@]}"; do
    if ! cmp -s "$from/$file" "$to/$file"; then
      echo "::error::$to/$file differs from $from/$file; run scripts/sync-shared.sh"
      stale=1
    fi
  done
  exit "$stale"
fi

mkdir -p "$to/vendor"
for file in "${files[@]}"; do
  cp "$from/$file" "$to/$file"
done
echo "synced $from → $to"
