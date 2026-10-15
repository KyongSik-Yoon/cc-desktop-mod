import type { SessionEntry } from '../types'
import { cellWidth } from './markdown'
import { T } from './i18n'

// ~/.claude/projects/<프로젝트>/<세션>.jsonl 하나에서 세션 줄 하나. 작업 폴더는 파일 앞(head)의 첫 값,
// 사용자가 붙인 제목·자동 제목·마지막 프롬프트는 파일 끝(tail)의 마지막 값을 쓴다(기록 파일은 수십 MB 까지 커진다).
// 제목도 프롬프트도 없는 세션은 대화가 한 번도 없었던 빈 세션이라 null.
export function sessionOf(id: string, updatedAt: number, head: string, tail: string): SessionEntry | null {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null
  const field = (key: string) => new RegExp(`"${key}":"([^"]*)"`, 'g')
  const last = (key: string) => [...tail.matchAll(field(key))].at(-1)?.[1] ?? ''
  const title = last('customTitle') || last('aiTitle') || last('lastPrompt').slice(0, 120)
  if (!title) return null
  return { id, updatedAt, cwd: field('cwd').exec(head)?.[1] ?? '', title }
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
    const key = entry.cwd || T.unknownFolder
    groups.set(key, [...(groups.get(key) ?? []), entry])
  }
  return [...groups]
    .map(([cwd, sessions]) => ({ cwd, sessions }))
    .sort((a, b) => (a.cwd === currentCwd ? -1 : b.cwd === currentCwd ? 1 : 0))
}

export function ago(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000))
  if (minutes < 1) return T.justNow
  if (minutes < 60) return T.minutesShort(minutes)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return T.hoursShort(hours)
  return T.daysShort(Math.floor(hours / 24))
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
