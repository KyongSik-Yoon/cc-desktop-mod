import type { SessionEntry } from '../types'
import { cellWidth } from './markdown'

// ~/.claude/projects/<프로젝트>/<세션>.jsonl 에서 최근 세션을 뽑는다.
// 한 줄에 세션 id, 마지막 활동(초), 작업 폴더, 사용자가 붙인 제목, 자동 제목, 마지막 프롬프트를 탭으로 나눠 출력한다.
// 기록 파일은 수십 MB 까지 커지므로 제목은 끝에서부터(tac) 첫 일치만 읽는다.
export const LIST_SESSIONS = `ls -t "$HOME"/.claude/projects/*/*.jsonl 2>/dev/null | head -n "$1" | while IFS= read -r f; do
  id=$(basename "$f" .jsonl)
  mtime=$(stat -c %Y "$f")
  cwd=$(grep -m1 -o '"cwd":"[^"]*"' "$f" | cut -d'"' -f4)
  custom=$(tac "$f" | grep -m1 -o '"customTitle":"[^"]*"' | cut -d'"' -f4)
  ai=$(tac "$f" | grep -m1 -o '"aiTitle":"[^"]*"' | cut -d'"' -f4)
  last=$(tac "$f" | grep -m1 -o '"lastPrompt":"[^"]*"' | cut -d'"' -f4 | cut -c1-120)
  printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$id" "$mtime" "$cwd" "$custom" "$ai" "$last"
done`

export function parseSessions(listing: string): SessionEntry[] {
  const out: SessionEntry[] = []
  for (const line of listing.split('\n')) {
    const [id, mtime, cwd, custom, ai, last] = line.split('\t')
    if (!id || !mtime || !/^[0-9a-f-]{36}$/.test(id)) continue
    // 제목도 프롬프트도 없는 세션은 대화가 한 번도 없었던 빈 세션이라 목록에서 뺀다
    const title = custom || ai || last
    if (!title) continue
    out.push({ id, updatedAt: Number(mtime) * 1000, cwd: cwd ?? '', title })
  }
  return out
}

// 패널에 그리는 순서(묶음 순서)대로 번호를 매긴다. 현재 세션은 번호 없이 ● 로 그리므로 뺀다.
// `/desk-sessions <번호>` 가 이 순서를 쓴다.
export function numbered(list: SessionEntry[], currentCwd: string, perGroup: number, currentId = ''): SessionEntry[] {
  return groupSessions(list, currentCwd)
    .flatMap(group => group.sessions.slice(0, perGroup))
    .filter(entry => entry.id !== currentId)
}

// 프로젝트(작업 폴더)별로 묶는다. 현재 폴더가 맨 위, 나머지는 최근 활동 순.
export function groupSessions(list: SessionEntry[], currentCwd: string): Array<{ cwd: string; sessions: SessionEntry[] }> {
  const groups = new Map<string, SessionEntry[]>()
  for (const entry of list) {
    const key = entry.cwd || '(알 수 없음)'
    groups.set(key, [...(groups.get(key) ?? []), entry])
  }
  return [...groups]
    .map(([cwd, sessions]) => ({ cwd, sessions }))
    .sort((a, b) => (a.cwd === currentCwd ? -1 : b.cwd === currentCwd ? 1 : 0))
}

export function ago(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000))
  if (minutes < 1) return '방금'
  if (minutes < 60) return `${minutes}분`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}시간`
  return `${Math.floor(hours / 24)}일`
}

// 칸 수 기준으로 자르고 말줄임표를 붙인다.
export function clip(text: string, width: number): string {
  if (cellWidth(text) <= width) return text
  let out = ''
  for (const ch of text) {
    if (cellWidth(out + ch) > width - 1) break
    out += ch
  }
  return `${out}…`
}

// 검색: 띄어 쓴 낱말이 모두 제목이나 폴더에 들어 있는 세션만(대소문자 무시).
export function filterSessions(list: SessionEntry[], query: string): SessionEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return list
  return list.filter(entry => {
    const hay = `${entry.title} ${entry.cwd}`.toLowerCase()
    return words.every(word => hay.includes(word))
  })
}
