#!/usr/bin/env bash
# 다섯 플러그인을 `claude plugin validate --strict` 로 본다. 그동안 엔진이 적어 둔 MCP 도구 타입을 비워 둔다.
# .claude-plugin/types/claude-code-mcp/index.d.ts 는 저장할 때 연결돼 있던 MCP 도구의 입력 타입이고(git 에 없음),
# 도구가 수백 개면 `$.tool.call`·`on('tool.call', …)` 한 줄만으로 검증기의 타입 검사가 2048 MiB 한도를 넘어
# "not type-checked" 경고가 나고 --strict 가 실패한다(548개일 때 desk-look 1.85GB, 비우면 0.27GB).
# 코드 탓이 아니고 디렉터리 검사와도 무관하다. 호출을 좁은 타입으로 캐스트하면 줄지만 `$` 를 그대로 쓰는
# 디렉터리 규칙을 벗어나서 하지 않는다. 끝나면(실패·중단해도) 원래 파일을 되돌린다.
set -euo pipefail
cd "$(dirname "$0")/.."

plugins=(desk-look desk-asana desk-slack desk-plan desk-review)
kept=$(mktemp -d)
restore() {
  for plugin in "${plugins[@]}"; do
    [ -f "$kept/$plugin.d.ts" ] && cp "$kept/$plugin.d.ts" "$plugin/.claude-plugin/types/claude-code-mcp/index.d.ts"
  done
  rm -rf "$kept"
}
trap restore EXIT

failed=0
for plugin in "${plugins[@]}"; do
  types="$plugin/.claude-plugin/types/claude-code-mcp/index.d.ts"
  if [ -f "$types" ]; then
    cp "$types" "$kept/$plugin.d.ts"
    printf 'export {}\n' > "$types"
  fi
  if out=$(claude plugin validate "$plugin" --strict 2>&1); then
    echo "✔ $plugin"
  else
    failed=1
    echo "✘ $plugin"
    printf '%s\n' "$out" | grep -A3 -E '^(⚠|✘) Found' || printf '%s\n' "$out" | tail -5
  fi
done
exit "$failed"
