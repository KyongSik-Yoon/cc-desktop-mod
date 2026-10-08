import type { SessionMessage } from 'claude-code'

import type { RunCall, Runs } from '../types'

// $.state 에 도구 출력 전문(Read 파일 내용, 긴 stdout)을 쌓지 않는다. 펼친 행은 30줄 남짓만 보여 준다.
const LIMIT = 4000

const clip = (text: string) => (text.length > LIMIT ? `${text.slice(0, LIMIT)}\n…` : text)

function outputOf(value: unknown): string | { structuredPatch: unknown[] } | { answers: object } | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return clip(value)
  const fields = value as Record<string, unknown>
  if (typeof fields.stdout === 'string') {
    return clip([fields.stdout, typeof fields.stderr === 'string' ? fields.stderr : ''].filter(Boolean).join('\n'))
  }
  // 편집 결과: 파일 전문(originalFile)은 버리고 실제 줄 번호가 붙은 헌크만 둔다.
  if (Array.isArray(fields.structuredPatch)) return { structuredPatch: fields.structuredPatch.slice(0, 20) }
  // 질문 결과: 질문 전문은 입력에 있으니 답만 둔다.
  if (typeof fields.answers === 'object' && fields.answers !== null) return { answers: fields.answers }
  const file = (fields.file ?? {}) as Record<string, unknown>
  const content = typeof file.content === 'string' ? file.content : typeof fields.content === 'string' ? fields.content : undefined
  if (content !== undefined) return clip(content)
  try {
    return clip(JSON.stringify(value, null, 2))
  } catch {
    return clip(String(value))
  }
}

function clipInput(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, typeof value === 'string' ? clip(value) : value]))
}

// 답변 텍스트나 사용자 프롬프트가 끼기 전까지 이어진 도구 호출을 한 묶음으로 본다.
// 데스크톱이 "Ran 2 commands, edited 3 files" 한 줄로 접는 단위와 같다.
export function computeRuns(messages: ReadonlyArray<SessionMessage>): Runs {
  const results = new Map<string, { isError: boolean; result: unknown; text: string }>()
  for (const message of messages) {
    for (const result of message.toolResults ?? []) {
      results.set(result.tool_use_id, { isError: result.isError, result: result.result, text: result.text })
    }
  }

  const firstOf: Record<string, string> = {}
  const calls: Record<string, RunCall[]> = {}
  let current: string | null = null

  for (const message of messages) {
    const isPrompt = message.role === 'user' && (message.toolResults ?? []).length === 0 && message.text.trim() !== ''
    if (isPrompt || (message.role === 'assistant' && message.text.trim() !== '')) {
      current = null
    }
    if (message.role !== 'assistant') continue
    for (const use of message.toolUses) {
      const settled = results.get(use.tool_use_id)
      const output = outputOf(use.result ?? settled?.result ?? settled?.text)
      const isErrored = use.isError === true || settled?.isError === true
      const text = settled?.text ?? ''
      const call: RunCall = {
        tool_use_id: use.tool_use_id,
        tool: use.tool,
        input: clipInput(use.input),
        isRunning: output === undefined && !isErrored,
        isErrored,
        isInterrupted: isErrored && /interrupt/i.test(text),
        output,
      }
      if (current === null) {
        current = use.tool_use_id
        calls[current] = []
      }
      calls[current]?.push(call)
      firstOf[use.tool_use_id] = current
    }
  }
  return { firstOf, calls }
}
