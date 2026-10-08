import type { SessionUsage } from 'claude-code'

import type { UsageBreakdown, UsageInfo } from '../types'

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

export const LIMIT_NAMES: Record<string, string> = { five_hour: '5시간', seven_day: '7일', spend_limit: '지출 한도' }

// 초기화까지 남은 시간: "1일 5시간", "4시간 7분", "12분". 모르거나 지났으면 null.
export function resetIn(resetsAt: string | null, now: number): string | null {
  const at = resetsAt === null ? Number.NaN : Date.parse(resetsAt)
  const left = Math.floor((at - now) / 60_000)
  if (!Number.isFinite(left) || left <= 0) return null
  const days = Math.floor(left / 1440)
  const hours = Math.floor((left % 1440) / 60)
  const minutes = left % 60
  if (days > 0) return hours > 0 ? `${days}일 ${hours}시간` : `${days}일`
  if (hours > 0) return minutes > 0 ? `${hours}시간 ${minutes}분` : `${hours}시간`
  return `${minutes}분`
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
  return {
    categories: breakdown.categories
      .filter(category => category.kind !== 'deferred')
      .map(category => ({ name: category.name, tokens: category.tokens, kind: category.kind, color: category.color })),
    total: breakdown.totalTokens,
    max: breakdown.rawMaxTokens,
    compactAt: breakdown.autoCompactThreshold ?? null,
    model: breakdown.model,
    at,
  }
}
