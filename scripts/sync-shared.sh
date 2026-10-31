#!/usr/bin/env bash
# 플러그인끼리 같은 코드를 복사해 둔 것을 맞춘다. 플러그인은 자기 디렉터리만 설치되므로 서로의 파일을 가져올 수 없다.
# - desk-look 의 마크다운 렌더러 → desk-asana/hooks/shared/, desk-slack/hooks/shared/
# - desk-slack/hooks/util.tsx(형제 플러그인 공용 도우미) → desk-asana/hooks/util.tsx
# 원본을 고쳤으면 이 스크립트를 돌려 함께 커밋한다. --check 는 어긋났는지만 본다(릴리즈 워크플로가 돌린다.
# 플러그인 테스트는 파일을 읽을 수 없어 거기서는 못 본다). util.tsx 의 cellWidth 는 desk-look markdown.tsx 의
# 것과 같아야 해서 --check 가 함께 보고, 다르면 손으로 맞춘다. desk-grant 가 허용하는 도구 이름도 desk-asana ASANA_TOOLS·
# desk-slack SLACK_TOOLS 와 같아야 해서 --check 가 함께 본다(복사가 아니라 목록이라 손으로 맞춘다).
set -euo pipefail
cd "$(dirname "$0")/.."

pairs=(
  "desk-look/hooks/markdown.tsx desk-asana/hooks/shared/markdown.tsx"
  "desk-look/hooks/diagram.ts desk-asana/hooks/shared/diagram.ts"
  "desk-look/hooks/vendor/lovely-mermaid.js desk-asana/hooks/shared/vendor/lovely-mermaid.js"
  "desk-look/hooks/vendor/lovely-mermaid.d.ts desk-asana/hooks/shared/vendor/lovely-mermaid.d.ts"
  "desk-look/hooks/vendor/LICENSE.lovely-mermaid desk-asana/hooks/shared/vendor/LICENSE.lovely-mermaid"
  "desk-look/hooks/markdown.tsx desk-slack/hooks/shared/markdown.tsx"
  "desk-look/hooks/diagram.ts desk-slack/hooks/shared/diagram.ts"
  "desk-look/hooks/vendor/lovely-mermaid.js desk-slack/hooks/shared/vendor/lovely-mermaid.js"
  "desk-look/hooks/vendor/lovely-mermaid.d.ts desk-slack/hooks/shared/vendor/lovely-mermaid.d.ts"
  "desk-look/hooks/vendor/LICENSE.lovely-mermaid desk-slack/hooks/shared/vendor/LICENSE.lovely-mermaid"
  "desk-slack/hooks/util.tsx desk-asana/hooks/util.tsx"
)

cell_width() {
  sed -n '/^export function cellWidth/,/^}/p' "$1"
}

# 블록 안의 '이름' 들을 정렬해 한 줄에 하나씩. $1 파일, $2 블록 첫 줄, $3 블록 끝 줄
tool_names() {
  sed -n "/$2/,/$3/p" "$1" | grep -oE "'[a-z_]+'" | grep -vE "^'desk-" | tr -d "'" | sort -u
}

if [ "${1:-}" = "--check" ]; then
  stale=0
  for pair in "${pairs[@]}"; do
    read -r from to <<< "$pair"
    if ! cmp -s "$from" "$to"; then
      echo "::error::$to differs from $from; run scripts/sync-shared.sh"
      stale=1
    fi
  done
  if [ "$(cell_width desk-look/hooks/markdown.tsx)" != "$(cell_width desk-slack/hooks/util.tsx)" ]; then
    echo "::error::cellWidth in desk-slack/hooks/util.tsx differs from desk-look/hooks/markdown.tsx; copy it over"
    stale=1
  fi
  if [ "$(tool_names desk-asana/hooks/asana.ts '^export const ASANA_TOOLS' '^}')" != "$(tool_names desk-grant/hooks/register.ts "^  'desk-asana'" '^  \],')" ]; then
    echo "::error::desk-grant/hooks/register.ts desk-asana tools differ from ASANA_TOOLS in desk-asana/hooks/asana.ts; copy them over"
    stale=1
  fi
  if [ "$(tool_names desk-slack/hooks/slack.ts '^export const SLACK_TOOLS' '^}')" != "$(tool_names desk-grant/hooks/register.ts "^  'desk-slack'" '^  \],')" ]; then
    echo "::error::desk-grant/hooks/register.ts desk-slack tools differ from SLACK_TOOLS in desk-slack/hooks/slack.ts; copy them over"
    stale=1
  fi
  exit "$stale"
fi

for pair in "${pairs[@]}"; do
  read -r from to <<< "$pair"
  mkdir -p "$(dirname "$to")"
  cp "$from" "$to"
done
echo "synced ${#pairs[@]} files"
