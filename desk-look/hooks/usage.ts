import type { ModelUsage, SessionUsage } from 'claude-code'

import type { ContextCompaction, ContextPoint, TokenSplit, UsageBreakdown, UsageInfo } from '../types'
import { T } from './i18n'

// 컨텍스트 칩: 데스크톱 입력창 옆의 컨텍스트 표시. 설정(contextChip)으로 언제 보일지 고른다.
// auto 는 반을 넘겼을 때만 보인다: 상태 줄이나 다른 플러그인이 이미 늘 보여 주는 경우가 많아서다.
export type ContextChipMode = 'auto' | 'always' | 'off'
export const CHIP_FROM = 50

export function contextChipMode(options: Record<string, unknown>): ContextChipMode {
  return options.contextChip === 'always' || options.contextChip === 'off' ? options.contextChip : 'auto'
}

export function showsChip(mode: ContextChipMode, percent: number | null): percent is number {
  if (percent === null || mode === 'off') return false
  return mode === 'always' || percent >= CHIP_FROM
}

const RINGS = ['○', '◔', '◑', '◕', '●'] as const

export function ring(percent: number): string {
  return RINGS[Math.min(4, Math.max(0, Math.round(percent / 25)))] ?? '○'
}

// 75% 부터 주의, 90% 부터 위험(자동 압축이 가까움).
export function meterLevel(percent: number): 'muted' | 'warning' | 'danger' {
  return percent >= 90 ? 'danger' : percent >= 75 ? 'warning' : 'muted'
}

export function meterBar(percent: number, width: number): string {
  const filled = Math.min(width, Math.max(0, Math.round((percent / 100) * width)))
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

export function limitName(kind: string): string {
  return T.limitNames[kind] ?? kind
}

// 초기화까지 남은 시간: "1일 5시간", "4시간 7분", "12분". 모르거나 지났으면 null.
export function resetIn(resetsAt: string | null, now: number): string | null {
  const at = resetsAt === null ? Number.NaN : Date.parse(resetsAt)
  const left = Math.floor((at - now) / 60_000)
  if (!Number.isFinite(left) || left <= 0) return null
  const days = Math.floor(left / 1440)
  const hours = Math.floor((left % 1440) / 60)
  const minutes = left % 60
  return T.duration(days, hours, minutes)
}

export function toUsage(raw: SessionUsage, at: number): UsageInfo {
  return {
    percent: raw.context.percent ?? null,
    tokens: raw.context.tokens ?? null,
    window: raw.context.window,
    limits: raw.rateLimits.map(limit => ({ kind: limit.kind, percentUsed: limit.percentUsed, resetsAt: limit.resetsAt ?? null })),
    costUsd: raw.cost?.usd ?? null,
    at,
  }
}

export function toBreakdown(raw: SessionUsage, at: number): UsageBreakdown | null {
  const breakdown = raw.context.breakdown
  if (!breakdown) return null
  const byTokens = <V extends { tokens: number }>(list: V[]) => list.sort((a, b) => b.tokens - a.tokens)
  // MCP 도구는 서버별로 묶는다. 필요할 때 싣는 도구(isLoaded false)는 창 밖이라 토큰에 넣지 않고 수만 센다.
  const servers = new Map<string, { name: string; tools: number; onDemand: number; tokens: number }>()
  for (const tool of breakdown.mcpTools ?? []) {
    const server = servers.get(tool.serverName) ?? { name: tool.serverName, tools: 0, onDemand: 0, tokens: 0 }
    server.tools += 1
    if (tool.isLoaded) server.tokens += tool.tokens
    else server.onDemand += 1
    servers.set(tool.serverName, server)
  }
  const skills = breakdown.skills
  return {
    categories: breakdown.categories
      .filter(category => category.kind !== 'deferred')
      .map(category => ({ name: category.name, tokens: category.tokens, kind: category.kind, color: category.color })),
    total: breakdown.totalTokens,
    max: breakdown.rawMaxTokens,
    compactAt: breakdown.autoCompactThreshold ?? null,
    model: breakdown.model,
    at,
    memoryFiles: byTokens((breakdown.memoryFiles ?? []).map(file => ({ path: file.path, type: file.type, tokens: file.tokens }))),
    mcpServers: byTokens([...servers.values()]),
    skills: skills
      ? { included: skills.includedSkills, total: skills.totalSkills, tokens: skills.tokens, list: byTokens(skills.skillFrontmatter.map(skill => ({ name: skill.name, tokens: skill.tokens }))) }
      : null,
    agents: byTokens((breakdown.agents ?? []).map(agent => ({ name: agent.agentType, tokens: agent.tokens }))),
  }
}

export function splitOf(usage: ModelUsage | null | undefined): TokenSplit | null {
  if (!usage) return null
  return { input: usage.input_tokens, cacheRead: usage.cache_read_input_tokens, cacheWrite: usage.cache_creation_input_tokens, output: usage.output_tokens }
}

// 입력 쪽에서 캐시에서 읽은 몫·캐시에 쓴 몫·캐시 밖 몫(%). 셋을 더하면 100. 입력이 없으면 null.
export function cacheShares(split: TokenSplit): { read: number; write: number; fresh: number } | null {
  const total = split.input + split.cacheRead + split.cacheWrite
  if (total <= 0) return null
  const read = Math.round((split.cacheRead / total) * 100)
  const write = Math.min(100 - read, Math.round((split.cacheWrite / total) * 100))
  return { read, write, fresh: 100 - read - write }
}

export function sumSplits(list: ReadonlyArray<TokenSplit>): TokenSplit {
  return list.reduce((sum, split) => ({ input: sum.input + split.input, cacheRead: sum.cacheRead + split.cacheRead, cacheWrite: sum.cacheWrite + split.cacheWrite, output: sum.output + split.output }), { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 })
}

// 막대 한 줄. 조각을 1/8 칸 단위로 놓고, 칸 안에서 조각이 바뀌면 왼쪽 조각 색 ▏▎▍▌▋▊▉ 를 그린다.
// 오른쪽도 꽉 찬 조각이면 그 색을 바탕에 깔고, 선 조각(남은 자리 ─, 압축 여유분 ┄)이면 바탕 없이 둔다.
// 선 조각에서 시작하는 칸은 바탕에 선을 깔 수 없어 더 많이 덮은 쪽으로 반올림한다.
// 0 이 아닌 조각은 적어도 1/8 칸. 같은 색이 이어지는 칸은 한 덩어리(Text 하나)로 묶는다.
export type BarPart = { value: number; color: string; glyph?: string }
export type BarRun = { text: string; color: string | null; background: string | null }
const LEFT_EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'] as const

export function barRuns(parts: ReadonlyArray<BarPart>, total: number, width: number): BarRun[] {
  const eighths = Math.max(0, width) * 8
  const scale = Math.max(total, parts.reduce((sum, part) => sum + Math.max(0, part.value), 0))
  const spans: Array<{ part: BarPart; from: number; to: number }> = []
  let sum = 0
  let edge = 0
  for (const part of parts) {
    const value = Math.max(0, part.value)
    sum += value
    if (value === 0 || scale === 0) continue
    const to = Math.min(eighths, Math.max(edge + 1, Math.round((sum / scale) * eighths)))
    if (to > edge) spans.push({ part, from: edge, to })
    edge = Math.max(edge, to)
  }
  const at = (x: number) => spans.find(span => span.from <= x && x < span.to)
  const cells: BarRun[] = []
  const whole = (span: { part: BarPart } | undefined): BarRun => (span ? { text: span.part.glyph ?? '█', color: span.part.color, background: null } : { text: ' ', color: null, background: null })
  for (let cell = 0; cell < width; cell++) {
    const left = at(cell * 8)
    const right = at(cell * 8 + 7)
    if (left === right || !left) cells.push(whole(left ?? right))
    else {
      const cut = left.to - cell * 8
      if (left.part.glyph) cells.push(whole(cut >= 4 ? left : right))
      else cells.push({ text: LEFT_EIGHTHS[cut] ?? '█', color: left.part.color, background: right && !right.part.glyph ? right.part.color : null })
    }
  }
  const runs: BarRun[] = []
  for (const cell of cells) {
    const last = runs[runs.length - 1]
    if (last && last.color === cell.color && last.background === cell.background) last.text += cell.text
    else runs.push({ ...cell })
  }
  return runs
}

// 세션 흐름 그래프: 턴마다의 채움(%)을 칸 수에 맞춘다. 턴이 칸보다 적으면 턴마다 칸을 나눠 폭을 채우고,
// 많으면 한 칸에 든 턴 중 가장 높은 값.
export function chartColumns(values: ReadonlyArray<number | null>, columns: number): Array<number | null> {
  if (values.length === 0) return []
  if (values.length <= columns) return Array.from({ length: columns }, (_, column) => values[Math.floor((column * values.length) / columns)] ?? null)
  return Array.from({ length: columns }, (_, column) => {
    const slice = values.slice(Math.floor((column * values.length) / columns), Math.floor(((column + 1) * values.length) / columns))
    const known = slice.filter((value): value is number => value !== null)
    return known.length > 0 ? Math.max(...known) : null
  })
}

// 몇 번째 점(턴)이 그래프의 몇 번째 칸에서 시작하는지: chartColumns 와 같은 나눔.
export function columnOf(index: number, count: number, columns: number): number {
  return Math.min(columns - 1, Math.floor((index * columns) / Math.max(1, count)))
}

// 그래프 위 끝(%): 가장 높은 점이 들어가는 가장 낮은 눈금. 백만 토큰 창에서 몇 %만 쓰는 세션도 모양이 보이게.
export function chartTop(values: ReadonlyArray<number | null>): number {
  const top = Math.max(0, ...values.filter((value): value is number => value !== null))
  return [10, 25, 50].find(mark => top <= mark) ?? 100
}

// 그래프 줄(위부터): 칸마다 ▁▂▃▄▅▆▇█ 로 rows 줄 높이(1/8 줄 단위). 0 보다 크면 적어도 ▁.
// 맨 위 칸(값이 닿은 칸)만 그 값의 단계 색(meterLevel)이고 그 아래는 옅은 채움(fill)이라, 턴이 적어 칸이 넓어도 선으로 읽힌다.
// guide 는 자동 압축이 도는 높이(%): 그 줄의 빈칸에 ┈ 를 그린다.
export type ChartRun = { text: string; level: 'muted' | 'warning' | 'danger' | 'fill' | 'guide' | 'empty' }
const LEVELS = ' ▁▂▃▄▅▆▇█'

export function chartRows(columns: ReadonlyArray<number | null>, rows: number, max: number, guide: number | null): ChartRun[][] {
  const height = (value: number | null) => (value === null || value <= 0 ? 0 : Math.max(1, Math.min(rows * 8, Math.round((value / max) * rows * 8))))
  const guideRow = guide === null ? -1 : rows - 1 - Math.min(rows - 1, Math.floor(((guide / max) * rows * 8) / 8))
  return Array.from({ length: rows }, (_, row) => {
    const base = (rows - 1 - row) * 8
    const runs: ChartRun[] = []
    for (const value of columns) {
      const fill = Math.max(0, Math.min(8, height(value) - base))
      const isTop = rows - 1 - Math.floor((height(value) - 1) / 8) === row
      const cell: ChartRun =
        fill > 0 ? { text: LEVELS[fill] ?? '█', level: isTop ? meterLevel(value ?? 0) : 'fill' } : row === guideRow ? { text: '┈', level: 'guide' } : { text: ' ', level: 'empty' }
      const last = runs[runs.length - 1]
      if (last && last.level === cell.level) last.text += cell.text
      else runs.push(cell)
    }
    return runs
  })
}

// 턴마다 비용 그래프 한 줄. 가장 비싼 턴이 █, 0 보다 크면 적어도 ▁.
export function sparkline(values: ReadonlyArray<number>): string {
  const top = Math.max(0, ...values)
  return values.map(value => (top <= 0 || value <= 0 ? '▁' : LEVELS[Math.max(1, Math.round((value / top) * 8))] ?? '█')).join('')
}

// 턴마다 비용: 앞 점과의 세션 비용 차. 앞 점이 없는 첫 점(다시 올린 뒤의 첫 턴 등)은 알 수 없어 뺀다.
export function turnCosts(points: ReadonlyArray<ContextPoint>): number[] {
  const costs: number[] = []
  for (let index = 1; index < points.length; index++) {
    const before = points[index - 1]?.costUsd
    const after = points[index]?.costUsd
    if (before != null && after != null) costs.push(Math.max(0, after - before))
  }
  return costs
}

// 압축이 그래프의 어느 점 앞에서 일어났는지: 압축 뒤 처음 끝난 턴. 아직 끝난 턴이 없으면 null.
export function compactionPoints(points: ReadonlyArray<ContextPoint>, compactions: ReadonlyArray<ContextCompaction>): number[] {
  return compactions.map(compaction => points.findIndex(point => point.at >= compaction.at)).filter(index => index >= 0)
}

// 그래프 아래의 시각(로컬 시계 HH:MM).
export function hhmm(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
