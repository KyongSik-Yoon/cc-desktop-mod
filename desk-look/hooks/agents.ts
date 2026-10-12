import type { AgentInfo, ModelUsage, SessionMessage } from 'claude-code'

import type { AgentDetail, AgentItem, AgentRecord } from '../types'
import { computeRuns } from './runs'
import { T } from './i18n'

// 상세에 남길 만큼: 최근 항목 AGENT_ITEMS 개, 글은 항목마다 TEXT_LIMIT 자.
const AGENT_ITEMS = 200
const TEXT_LIMIT = 8000
const clipText = (text: string) => (text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}\n…` : text)

export const isLive = (status: string) => status === 'pending' || status === 'running' || status === 'waiting'

// 데스크톱이 "69.2k tokens" 로 보이는 값: 마지막 요청이 실은 컨텍스트(입력·캐시·출력 합).
export const stepTokens = (usage: ModelUsage) =>
  usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens + usage.output_tokens

// "claude-haiku-5-5" → "Haiku 5.5". 모르는 모양은 그대로.
export function modelLabel(model: string | undefined): string | undefined {
  if (!model) return undefined
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/.exec(model)
  if (!match) return model
  const [, family = '', major, minor] = match
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${minor ? `${major}.${minor}` : major}`
}

// 데스크톱 카드 끝의 지금 하는 일: Fetching, Searching web …
export function activityOf(tool: string): string {
  switch (tool) {
    case 'WebFetch':
      return T.actFetching
    case 'WebSearch':
      return T.actSearchingWeb
    case 'Bash':
    case 'PowerShell':
      return T.actRunning
    case 'Read':
    case 'NotebookRead':
      return T.actReading
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return T.actEditing
    case 'Grep':
    case 'Glob':
    case 'LS':
    case 'ToolSearch':
      return T.actSearching
    case 'Agent':
    case 'Task':
      return T.actDelegating
    default:
      return T.actUsingTool
  }
}

// 엔진 목록을 기록에 합친다: 이름·종류·상태는 목록이 정본, 수치는 기록이 가진 것을 둔다.
// 목록에서 사라진 것(끝난 지 좀 된 에이전트)은 기록 그대로 남는다. 엔진은 도는 에이전트를 빼지 않으므로,
// 목록에 있다가 사라졌는데 기록이 아직 도는 중이면 끝을 놓친 것(도중의 /reload-plugins 등)이라 끝난 것으로 둔다.
export function mergeAgents(records: Readonly<Record<string, AgentRecord>>, list: ReadonlyArray<AgentInfo>, now: number): Record<string, AgentRecord> {
  const next = { ...records }
  for (const info of list) {
    const old = next[info.id]
    const isEnded = !isLive(info.status)
    next[info.id] = {
      toolUses: 0,
      startedAt: now,
      ...old,
      id: info.id,
      description: info.description || old?.description || info.type,
      type: info.type,
      status: info.status,
      ...(info.name ? { name: info.name } : {}),
      listed: true,
      // 한 번의 실행이 끝나도(turn.complete) 엔진이 아직 살아 있다고 하면 시간은 계속 간다.
      ...(isEnded ? { endedAt: old?.endedAt ?? now, activity: undefined } : { endedAt: undefined }),
    }
  }
  const present = new Set(list.map(info => info.id))
  for (const agent of Object.values(next)) {
    if (agent.listed && !present.has(agent.id) && isLive(agent.status)) {
      next[agent.id] = { ...agent, status: 'completed', endedAt: agent.endedAt ?? now, activity: undefined }
    }
  }
  return next
}

// 목록 순서: 도는 것 먼저, 그 안에서는 늦게 시작한 것이 위.
export function orderAgents(records: Readonly<Record<string, AgentRecord>>): { live: AgentRecord[]; done: AgentRecord[] } {
  const all = Object.values(records).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
  return { live: all.filter(agent => isLive(agent.status)), done: all.filter(agent => !isLive(agent.status)) }
}

// 에이전트 대화를 상세 화면 차례로: 첫 사용자 메시지는 지시, 그 뒤는 답변 글·도구 묶음·사용자 메시지.
// 서브에이전트가 보고를 넘기는 도구. 데스크톱처럼 도구 줄이 아니라 답변 글로 보인다.
const HANDBACK = 'SubagentHandback'

const handbackOf = (input: Record<string, unknown>) => (typeof input.message === 'string' ? input.message.trim() : '')

export function agentDetailOf(id: string, messages: ReadonlyArray<SessionMessage>): AgentDetail {
  const reports = messages.map(message => message.toolUses.filter(use => use.tool === HANDBACK).map(use => handbackOf(use.input)))
  const plain = messages.map(message => ({ ...message, toolUses: message.toolUses.filter(use => use.tool !== HANDBACK) }))
  const runs = computeRuns(plain)
  const items: AgentItem[] = []
  let prompt = ''
  plain.forEach((message, index) => {
    if (message.role === 'user') {
      const isPrompt = (message.toolResults ?? []).length === 0 && message.text.trim() !== ''
      if (!isPrompt) return
      if (index === 0) prompt = clipText(message.text.trim())
      else items.push({ kind: 'user', text: clipText(message.text.trim()) })
      return
    }
    if (message.text.trim() !== '') items.push({ kind: 'text', text: clipText(message.text.trim()) })
    for (const use of message.toolUses) {
      if (runs.firstOf[use.tool_use_id] === use.tool_use_id) {
        items.push({ kind: 'run', id: use.tool_use_id, calls: runs.calls[use.tool_use_id] ?? [] })
      }
    }
    for (const report of reports[index] ?? []) if (report !== '') items.push({ kind: 'text', text: clipText(report) })
  })
  return { id, prompt, items: items.slice(-AGENT_ITEMS) }
}
