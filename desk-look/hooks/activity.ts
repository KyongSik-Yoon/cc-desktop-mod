import type { SessionMessage } from 'claude-code'

import type { ActivityEvent, ActivityKind, ActivityLog, TaskItem } from '../types'
import { cellWidth } from './markdown'

// 입력창 위 진행 띠: 할 일 단계 한 줄과 지금 도는 일 한 줄. 모델에게 따로 신고를 받지 않고
// 도구 호출·할 일 목록·도구가 띄운 프로세스만 본다. 여기는 계산만 두고 그리기와 $ 호출은 register.tsx 에.

// 띠의 "지금" 줄은 턴이 이만큼 지나야 띄운다(질문 하나에 답하는 짧은 턴마다 줄이 생겼다 사라지지 않게).
export const NOW_AFTER_MS = 10_000
// 도구가 띄운 프로세스를 읽는 간격. 이보다 짧은 명령은 읽지 않는다.
export const PROC_POLL_MS = 3000
// 프로세스의 CPU·입출력이 이만큼 그대로면 "변화 없음"을 단다.
export const QUIET_AFTER_MS = 180_000
// /proc/<pid>/stat 의 utime·stime 단위(리눅스 CLK_TCK).
const CLK_TCK = 100

// etimes: 뜬 뒤 지난 초.
export type ProcRow = { pid: number; ppid: number; etimes: number; name: string }

// 프로세스 트리를 따라 내려가는 깊이(셸 래퍼 → 명령 → 그 자식 …).
export const PROC_DEPTH = 6

// Bash 도구는 명령을 늘 셸(bash -c …)로 감싸 띄운다. 같은 때 desk-look 이 띄운 git·gh 같은 자식은 이 이름이 아니다.
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'fish'])

// claude 의 자식 가운데 이 호출의 셸 래퍼인가: 호출이 시작된 뒤 뜬 셸. 시각이 초 단위라 시작 직전에 뜬 래퍼도 받도록 1초를 더 준다.
export const isCallRoot = (row: Pick<ProcRow, 'etimes' | 'name'>, sinceSec: number) => row.etimes <= sinceSec + 1 && SHELLS.has(row.name)

// 도구 호출이 시작된 뒤 claude 아래에 생긴 셸 래퍼와 그 자손. MCP 서버처럼 먼저 떠 있던 자식과
// desk-look 자신이 띄운 프로그램은 뺀다. leaves 는 자식이 없는 것(실제로 일하는 명령), 늦게 뜬 것이 앞.
export function callProcesses(rows: ReadonlyArray<ProcRow>, claudePid: number, sinceSec: number): { pids: number[]; leaves: ProcRow[] } {
  const children = new Map<number, ProcRow[]>()
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row])
  const roots = (children.get(claudePid) ?? []).filter(row => isCallRoot(row, sinceSec))
  const pids: number[] = []
  const leaves: ProcRow[] = []
  const walk = (row: ProcRow) => {
    pids.push(row.pid)
    const kids = children.get(row.pid) ?? []
    if (kids.length === 0) leaves.push(row)
    kids.forEach(walk)
  }
  roots.forEach(walk)
  leaves.sort((a, b) => a.etimes - b.etimes)
  return { pids, leaves }
}

// /proc/<pid>/stat 의 utime+stime(틱). 이름(comm)은 괄호 안에 공백·괄호를 품을 수 있어 마지막 ')' 뒤부터 센다.
export function statTicks(text: string): number | null {
  const fields = text.slice(text.lastIndexOf(')') + 2).split(' ')
  // ')' 뒤 첫 칸이 3번째 필드(state)라 utime(14)·stime(15)은 11·12번째.
  const utime = Number(fields[11])
  const stime = Number(fields[12])
  return Number.isFinite(utime) && Number.isFinite(stime) && fields.length > 12 ? utime + stime : null
}

// /proc/<pid>/stat 한 줄에서 트리를 세우는 데 쓸 것: pid, 이름(comm), 부모, 시작 시각(부팅 뒤 틱), CPU 틱.
export function statRow(text: string): { pid: number; name: string; ppid: number; startTicks: number; ticks: number } | null {
  const open = text.indexOf('(')
  const close = text.lastIndexOf(')')
  if (open < 0 || close < open) return null
  const fields = text.slice(close + 2).split(' ')
  const pid = Number(text.slice(0, open).trim())
  const ppid = Number(fields[1])
  const startTicks = Number(fields[19])
  const ticks = statTicks(text)
  if (!Number.isInteger(pid) || !Number.isFinite(ppid) || !Number.isFinite(startTicks) || ticks === null) return null
  return { pid, name: text.slice(open + 1, close), ppid, startTicks, ticks }
}

// /proc/uptime 의 첫 값(부팅 뒤 초)을 틱으로.
export function uptimeTicks(text: string): number | null {
  const seconds = Number(text.split(' ')[0])
  return text.trim() !== '' && Number.isFinite(seconds) ? Math.round(seconds * CLK_TCK) : null
}

// /proc/<pid>/task/<pid>/children: 그 프로세스(메인 스레드)가 띄운 자식 pid 들.
export const childPids = (text: string): number[] => text.split(/\s+/).filter(Boolean).map(Number).filter(Number.isInteger)

// 틱 단위 시작 시각을 ps 의 etimes(초)로.
export const etimesOf = (uptime: number, startTicks: number) => Math.floor((uptime - startTicks) / CLK_TCK)

// /proc/self/stat 의 첫 필드: 이 훅이 도는 claude 의 pid.
export function statPid(text: string): number | null {
  const pid = Number(text.split(' ')[0])
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

// /proc/<pid>/io 의 rchar+wchar: 파이프·소켓까지 센 읽고 쓴 바이트.
export function ioBytes(text: string): number | null {
  const value = (key: string) => Number(new RegExp(`^${key}:\\s*(\\d+)`, 'm').exec(text)?.[1] ?? NaN)
  const total = value('rchar') + value('wchar')
  return Number.isFinite(total) ? total : null
}

export type ProcSample = { at: number; ticks: number; io: number }
export type ProcView = { name: string; cpu: number | null; quietSince: number | null; isNetwork: boolean }

// 원격이 일하는 동안 로컬은 조용한 명령: 오래 조용해도 경고 대신 흐린 사실만 단다.
const NETWORK = new Set(['ssh', 'scp', 'sftp', 'rsync', 'mosh-client', 'curl', 'wget', 'gh', 'glab', 'git', 'kubectl', 'psql', 'mysql', 'redis-cli', 'nc', 'telnet'])

// 직전 표본과 비교해 CPU%·조용해진 시각을 정한다. 첫 표본이면 아직 움직임을 모르니 CPU 는 null, 조용하지 않은 것으로.
export function procView(name: string, prev: ProcSample | null, sample: ProcSample, prevView: ProcView | null): ProcView {
  const isNetwork = NETWORK.has(name)
  if (prev === null || sample.at <= prev.at) return { name, cpu: null, quietSince: null, isNetwork }
  const ticks = Math.max(0, sample.ticks - prev.ticks)
  const cpu = Math.round((ticks / CLK_TCK / ((sample.at - prev.at) / 1000)) * 100)
  const isMoving = ticks > 0 || sample.io > prev.io
  const quietSince = isMoving ? null : (prevView?.quietSince ?? prev.at)
  return { name, cpu, quietSince, isNetwork }
}

export type StripPart = { kind: 'completed' | 'in_progress' | 'pending' | 'more'; text: string }

// 할 일 목록을 한 줄 칸으로. 넘치면 끝난 일을 "✓ N" 하나로, 남은 일을 첫 하나와 "+N" 으로 접고,
// 그래도 넘치면 하는 중인 일의 글을 줄인다. label 은 하는 중인 일의 글(진행형 문구·시간).
export function stepStrip(list: ReadonlyArray<TaskItem>, columns: number, label: (item: TaskItem) => string): StripPart[] {
  const mark = { completed: '✓', in_progress: '◉', pending: '○' } as const
  const partOf = (item: TaskItem): StripPart => ({
    kind: item.status,
    text: `${mark[item.status]} ${item.status === 'in_progress' ? label(item) : item.subject}`,
  })
  const width = (parts: ReadonlyArray<StripPart>) => parts.reduce((sum, part) => sum + cellWidth(part.text) + 2, 0)
  let parts = list.map(partOf)
  if (width(parts) <= columns) return parts
  const done = list.filter(item => item.status === 'completed').length
  const open = list.filter(item => item.status !== 'completed')
  const doneParts: StripPart[] = done > 0 ? [{ kind: 'completed', text: `✓ ${done}` }] : []
  parts = [...doneParts, ...open.map(partOf)]
  if (width(parts) <= columns) return parts
  const active = open.filter(item => item.status === 'in_progress').map(partOf)
  const pending = open.filter(item => item.status === 'pending')
  const rest = pending.length - 1
  parts = [...doneParts, ...active, ...pending.slice(0, 1).map(partOf), ...(rest > 0 ? [{ kind: 'more' as const, text: `+${rest}` }] : [])]
  if (width(parts) <= columns) return parts
  // 남은 폭에 맞춰 긴 글부터 자른다(하는 중인 일이 먼저, 그다음 다음 일).
  const over = width(parts) - columns
  return clipParts(parts, over)
}

// 할 일 도구가 없을 때(Claude 5 모델은 엔진이 꺼 둔다) 윗줄의 재료: 이번 턴에 모델이 도구를 부르며 쓴 설명 글.
// 턴의 경계는 마지막 사람 프롬프트(도구 결과가 아닌 글 있는 user 메시지). 가장 늦은 설명의 첫 문장과 설명 수,
// 그리고 그 설명 뒤에 부른 도구 호출 id(패널 흐름에서 설명을 그 호출들 앞에 두려고). 기록은 글 블록과
// 도구 호출 블록을 따로 붙이므로 설명 메시지 자신과 그 뒤 assistant 메시지들의 호출을 모은다.
export function turnNarration(messages: ReadonlyArray<SessionMessage>): { text: string; count: number; ids: string[] } | null {
  let start = 0
  messages.forEach((message, index) => {
    if (message.role === 'user' && message.text.trim() !== '' && (message.toolResults ?? []).length === 0) start = index + 1
  })
  const turn = messages.slice(start)
  const said = turn.filter(message => message.role === 'assistant' && message.text.trim() !== '')
  const last = said[said.length - 1]
  if (!last) return null
  const ids = turn
    .slice(turn.indexOf(last))
    .filter(message => message.role === 'assistant')
    .flatMap(message => message.toolUses.map(use => use.tool_use_id))
  return { text: firstSentence(last.text), count: said.length, ids }
}

export function firstSentence(text: string): string {
  const line =
    text
      .split('\n')
      .map(row => row.replace(/^\s*(?:#+|>|[-*+]|\d+\.)\s+/, '').replace(/\*\*|__|`/g, '').trim())
      .find(row => row !== '') ?? ''
  return /^(.+?[.!?。])(?:\s|$)/.exec(line)?.[1] ?? line
}

// 설명 글 단계 칸: 앞선 설명은 "✓ N" 하나로, 지금 설명은 ◉ 로. 넘치면 지금 설명을 줄인다.
export function sayStrip(text: string, done: number, columns: number): StripPart[] {
  const parts: StripPart[] = [...(done > 0 ? [{ kind: 'completed' as const, text: `✓ ${done}` }] : []), { kind: 'in_progress', text: `◉ ${text}` }]
  const over = parts.reduce((sum, part) => sum + cellWidth(part.text) + 2, 0) - columns
  return over > 0 ? clipParts(parts, over) : parts
}

function clipParts(parts: StripPart[], over: number): StripPart[] {
  let left = over
  return parts.map(part => {
    if (left <= 0 || (part.kind !== 'in_progress' && part.kind !== 'pending')) return part
    const keep = Math.max(4, cellWidth(part.text) - left - 1)
    const clipped = clipWidth(part.text, keep)
    left -= cellWidth(part.text) - cellWidth(clipped)
    return { ...part, text: clipped }
  })
}

export function clipWidth(text: string, room: number): string {
  if (cellWidth(text) <= room) return text
  let out = ''
  for (const ch of text) {
    if (cellWidth(out + ch) > room - 1) break
    out += ch
  }
  return `${out}…`
}

// ── /desk-activity 패널 ──

export const LOG_EVENTS = 400

const EXPLORE = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'NotebookRead', 'ToolSearch', 'LSP'])
const EDIT = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
// 테스트로 보는 명령: 흔한 테스트 실행기와 claude plugin test.
const TEST = /(^|[\s;&|(])(bun test|npm (run )?test|pnpm (run )?test|yarn test|npx (jest|vitest)|jest|vitest|pytest|go test|cargo test|mvn\b.*\btest|gradle\w*\b.*\btest|tox|rspec|phpunit|claude plugin test|make test)\b/

export function kindOf(tool: string, command?: string): ActivityKind {
  if (EXPLORE.has(tool)) return 'explore'
  if (EDIT.has(tool)) return 'edit'
  if (tool === 'Agent' || tool === 'Task') return 'agent'
  if (tool === 'Bash') return command !== undefined && TEST.test(command) ? 'test' : 'command'
  return 'other'
}

// 막대에서 한 칸을 무엇으로 칠할지: 같은 칸에 여럿이 겹치면 짧은 사건(편집·테스트·탐색)이 이겨 긴 명령에 묻히지 않는다.
const PRIORITY: ActivityKind[] = ['edit', 'test', 'explore', 'agent', 'command', 'other']
// 오래 걸리는 일(명령·위임)은 굵은 선, 짧은 사건은 블록. 응답 중(idle)은 가는 선.
// 위임은 겹선: 사용자 테마가 두 색(claude·planMode)을 같게 잡아도 명령과 갈리게.
export const KIND_GLYPH: Record<ActivityKind, string> = { explore: '░', edit: '▓', test: '▒', command: '━', agent: '═', other: '▪' }

export type LaneSegment = { kind: ActivityKind | 'idle' | 'none' | 'gap'; text: string }

// 막대의 한 칸이 맡는 시간. gap 은 아무 줄도 살아 있지 않아 한 칸으로 접은 시간(ms).
export type LaneCell = { from: number; to: number; gap?: number }

// 이보다 짧은 빈 시간은 접지 않는다(칸 몇 개짜리 쉼은 그대로 보여도 막대를 누르지 않는다).
export const GAP_MIN_MS = 60_000
export const GAP_GLYPH = '┆'

const evenCells = (from: number, to: number, width: number): LaneCell[] =>
  Array.from({ length: width }, (_, cell) => ({ from: from + ((to - from) * cell) / width, to: from + ((to - from) * (cell + 1)) / width }))

// 막대들이 함께 쓰는 시간 축: from~to 를 width 칸으로. 어느 줄도 살아 있지 않은 긴 시간(턴이 끝난 뒤 사람이
// 에이전트를 띄우기까지 등)은 한 칸으로 접고, 남은 칸을 일한 시간에 비례해 나눈다.
export function laneCells(alive: ReadonlyArray<{ start: number; end: number }>, from: number, to: number, width: number): LaneCell[] {
  const span = Math.max(1, to - from)
  const spans = alive
    .map(range => ({ start: Math.max(from, range.start), end: Math.min(to, range.end) }))
    .filter(range => range.end >= range.start)
    .sort((a, b) => a.start - b.start)
  const gaps: { start: number; end: number }[] = []
  let reach = from
  for (const range of spans) {
    if (range.start - reach >= Math.max(GAP_MIN_MS, (span / width) * 3)) gaps.push({ start: reach, end: range.start })
    reach = Math.max(reach, range.end)
  }
  if (gaps.length === 0 || width < gaps.length * 4) return evenCells(from, to, width)
  const busy = span - gaps.reduce((sum, gap) => sum + gap.end - gap.start, 0)
  const room = width - gaps.length
  const cells: LaneCell[] = []
  let at = from
  let done = 0
  let used = 0
  const take = (end: number) => {
    done += end - at
    const count = Math.max(1, Math.round((done / busy) * room) - used)
    used += count
    cells.push(...evenCells(at, end, count))
  }
  for (const gap of gaps) {
    take(gap.start)
    cells.push({ from: gap.start, to: gap.end, gap: gap.end - gap.start })
    at = gap.end
  }
  take(to)
  return cells.slice(0, width)
}

// 한 줄 시간 막대: 칸마다 겹친 호출의 종류(없고 살아 있으면 idle, 아니면 none, 접은 시간이면 gap).
// alive 는 그 줄의 주인이 살아 있던 구간(메인은 턴 전체, 에이전트는 시작~끝). cells 를 안 주면 from~to 를 고르게 나눈다.
export function laneSegments(
  events: ReadonlyArray<Pick<ActivityEvent, 'kind' | 'start' | 'end'>>,
  alive: { start: number; end: number },
  from: number,
  to: number,
  width: number,
  cells: ReadonlyArray<LaneCell> = evenCells(from, to, Math.max(1, width)),
): LaneSegment[] {
  const kinds = cells.map((cell): LaneSegment['kind'] => {
    if (cell.gap !== undefined) return 'gap'
    const hits = events.filter(event => event.start < cell.to && (event.end ?? to) >= cell.from).map(event => event.kind)
    const best = PRIORITY.find(kind => hits.includes(kind))
    return best ?? (alive.start < cell.to && alive.end >= cell.from ? 'idle' : 'none')
  })
  const segments: LaneSegment[] = []
  for (const kind of kinds) {
    const glyph = kind === 'idle' ? '─' : kind === 'none' ? ' ' : kind === 'gap' ? GAP_GLYPH : KIND_GLYPH[kind]
    const last = segments[segments.length - 1]
    if (last && last.kind === kind) last.text += glyph
    else segments.push({ kind, text: glyph })
  }
  return segments
}

export type FlowRow =
  | { at: number; kind: 'say'; text: string }
  | { at: number; kind: 'explore'; text: string }
  | { at: number; kind: 'edit'; text: string; added: number; removed: number; isError: boolean }
  | { at: number; kind: 'command' | 'test' | 'agent' | 'other'; text: string; ms: number | null; isError: boolean }

// 패널의 흐름: 메인 대화의 설명 글과 호출을 시간 순으로. 이어진 탐색은 "Read 6 · Grep 3" 한 줄로,
// 같은 파일을 잇달아 고친 것은 한 줄로 합친다. 도는 중인 호출은 ms 가 null.
// loop 를 주면 그 에이전트의 호출만(설명 글은 메인 대화의 것이라 뺀다).
export function flowRows(log: ActivityLog, loop?: string): FlowRow[] {
  const items = [
    ...(loop === undefined ? log.says : []).map(say => ({ at: say.at, say })),
    ...log.events.filter(event => event.loop === loop).map(event => ({ at: event.start, event })),
  ].sort((a, b) => a.at - b.at || ('say' in a ? -1 : 0) - ('say' in b ? -1 : 0))
  const rows: FlowRow[] = []
  let tally: Map<string, number> | null = null
  for (const item of items) {
    if ('say' in item) {
      tally = null
      rows.push({ at: item.at, kind: 'say', text: item.say.text })
      continue
    }
    const event = item.event
    const last = rows[rows.length - 1]
    if (event.kind === 'explore') {
      if (!tally || last?.kind !== 'explore') {
        tally = new Map()
        rows.push({ at: event.start, kind: 'explore', text: '' })
      }
      tally.set(event.tool, (tally.get(event.tool) ?? 0) + 1)
      const row = rows[rows.length - 1] as Extract<FlowRow, { kind: 'explore' }>
      row.text = [...tally].map(([tool, count]) => (count > 1 ? `${tool} ${count}` : tool)).join(' · ')
      continue
    }
    tally = null
    if (event.kind === 'edit') {
      if (last?.kind === 'edit' && last.text === event.label) {
        last.added += event.added ?? 0
        last.removed += event.removed ?? 0
        last.isError = last.isError && event.isError === true
        continue
      }
      rows.push({ at: event.start, kind: 'edit', text: event.label, added: event.added ?? 0, removed: event.removed ?? 0, isError: event.isError === true })
      continue
    }
    rows.push({ at: event.start, kind: event.kind, text: event.label, ms: event.end === undefined ? null : event.end - event.start, isError: event.isError === true })
  }
  return rows
}

// 턴 시작부터의 시각: 12:05 처럼 분:초(한 시간을 넘으면 1:02:05).
export function clockOf(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const pad = (value: number) => String(value).padStart(2, '0')
  const hours = Math.floor(total / 3600)
  const rest = `${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
  return hours > 0 ? `${hours}:${rest}` : rest
}
