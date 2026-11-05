// 리뷰 보고: 모델이 review_report 도구로 넘긴 입력을 검사해 패널이 그릴 모양으로 바꾸고,
// 항목 줄 둘레의 소스를 잘라 준다. 엔진($)을 쓰지 않는 순수 함수만 둔다(register.tsx 가 부른다).

import type { ReviewItem, ReviewReport, Snippet, Stage, Status } from '../types'

export const STAGES = ['simplify', 'review'] as const
// fixed·skipped 는 정리(simplify) 단계, found·dismissed 는 리뷰(code-review) 단계의 상태.
export const STATUSES = { simplify: ['fixed', 'skipped'], review: ['found', 'dismissed'] } as const

// 항목 줄 위아래로 보여 줄 줄 수.
export const AROUND = 5

export const REVIEW_TOOL_NAME = 'review_report'
// on('tool.call', { tool: … }) 에는 이 이름을 글자 그대로 쓴다(validate 가 매처를 읽을 수 있게).
export const REVIEW_TOOL = 'mcp__desk-review__review_report'

export function reviewTool() {
  const item = {
    type: 'object' as const,
    properties: {
      stage: { type: 'string', enum: [...STAGES], description: 'simplify (cleanup pass) or review (bug review pass).' },
      status: {
        type: 'string',
        enum: ['fixed', 'skipped', 'found', 'dismissed'],
        description: 'simplify: fixed or skipped. review: found (a real defect) or dismissed (rejected on verification).',
      },
      file: { type: 'string', description: 'File path, relative to the working directory or absolute. Never shortened.' },
      line: { type: 'integer', minimum: 1, description: '1-based line the item is about.' },
      reason: { type: 'string', description: 'Why: what was simplified, why it was left alone, how it breaks, or why it was rejected.' },
    },
    required: ['stage', 'status', 'file', 'line', 'reason'],
  }
  return {
    name: REVIEW_TOOL_NAME,
    description: [
      "Shows a simplify-and-review report in desk-review's side pane: every cleanup fixed or skipped, every review finding found or dismissed, each with its file, line and reason.",
      'The person presses an item to read its current source and opens the file in the diff pane from there.',
      'Use it for the final report of the simplify-review skill; put only the one-line summary in your reply.',
    ].join(' '),
    inputSchema: {
      type: 'object' as const,
      properties: {
        summary: { type: 'string', description: 'One sentence: what changed and what the review found.' },
        items: { type: 'array', items: item, description: 'Every cleanup and review item. Empty when there were none.' },
        unverified: { type: 'string', description: 'Tests not run, files not read, doubts left. Empty when there are none.' },
        next: { type: 'string', description: 'What the person has to decide next (two options and a recommendation), or empty.' },
      },
      required: ['summary', 'items'],
    },
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

// 세션 폴더 기준 절대 경로. 이미 절대 경로면 그대로, ./ 는 떼어 낸다.
export function absPath(cwd: string, file: string): string {
  if (file.startsWith('/')) return file
  const rest = file.replace(/^(\.\/)+/, '')
  return `${cwd.replace(/\/+$/, '')}/${rest}`
}

// 도구 입력을 보고서로. 틀린 곳이 있으면 모델이 고쳐 다시 부를 수 있게 사유 하나를 돌려준다.
export function parseReport(input: Record<string, unknown>, cwd: string, id: number): { report: ReviewReport } | { error: string } {
  const summary = text(input.summary)
  if (summary === '') return { error: 'Give summary: one sentence on what changed and what the review found.' }
  if (!Array.isArray(input.items)) return { error: 'Give items: an array of { stage, status, file, line, reason } (empty when there were none).' }
  const items: ReviewItem[] = []
  for (const [index, raw] of input.items.entries()) {
    const fields = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const stage = fields.stage
    const status = fields.status
    const at = `items[${index}]`
    if (stage !== 'simplify' && stage !== 'review') return { error: `${at}.stage must be simplify or review.` }
    if (!(STATUSES[stage] as readonly unknown[]).includes(status)) return { error: `${at}.status must be ${STATUSES[stage].join(' or ')} for stage ${stage}.` }
    const file = text(fields.file)
    if (file === '') return { error: `${at}.file is empty: give the full path.` }
    const line = typeof fields.line === 'number' ? Math.floor(fields.line) : Number.NaN
    if (!(line >= 1)) return { error: `${at}.line must be a 1-based line number.` }
    const reason = text(fields.reason)
    if (reason === '') return { error: `${at}.reason is empty: every item needs a reason.` }
    items.push({ stage, status: status as Status, file, path: absPath(cwd, file), line, reason })
  }
  return { report: { id, summary, items, unverified: text(input.unverified), next: text(input.next) } }
}

// 단계별 항목(원래 순서와 번호를 지킨다). 번호는 펼침·조각의 키다.
export function itemsOf(report: ReviewReport, stage: Stage): Array<{ item: ReviewItem; index: number }> {
  return report.items.flatMap((item, index) => (item.stage === stage ? [{ item, index }] : []))
}

// 파일 글에서 line 둘레 around 줄. 줄이 파일보다 뒤면 끝 쪽을 보여 주고 line 은 마지막 줄로 붙인다.
export function sourceWindow(fileText: string, line: number, around = AROUND): Snippet {
  const lines = fileText.replace(/\n$/, '').split('\n')
  if (fileText === '') return { error: 'empty' }
  const at = Math.min(Math.max(1, line), lines.length)
  const start = Math.max(1, at - around)
  const end = Math.min(lines.length, at + around)
  return { kind: 'source', source: lines.slice(start - 1, end).join('\n'), startLine: start, line: at }
}

// 한 파일의 `git diff` 출력에서 line(고친 뒤 줄 번호)을 담은 헌크. 담은 헌크가 없으면 그 줄에 가장 가까운 헌크,
// 헌크가 하나도 없으면(바뀐 게 없음) null. Code format: 'diff' 는 @@ 헌크부터 받으므로 파일 머리는 뺀다.
export function hunkAt(diffText: string, line: number): string | null {
  const lines = diffText.replace(/\n$/, '').split('\n')
  const hunks: Array<{ start: number; end: number; text: string }> = []
  let at = -1
  for (const [index, row] of lines.entries()) {
    if (!row.startsWith('@@')) continue
    if (at >= 0) hunks.push(hunkOf(lines, at, index))
    at = index
  }
  if (at >= 0) hunks.push(hunkOf(lines, at, lines.length))
  const distance = (hunk: { start: number; end: number }) => (line < hunk.start ? hunk.start - line : line > hunk.end ? line - hunk.end : 0)
  const best = hunks.reduce<(typeof hunks)[number] | null>((pick, hunk) => (pick === null || distance(hunk) < distance(pick) ? hunk : pick), null)
  return best?.text ?? null
}

// @@ -a,b +c,d @@ 줄(from)부터 to 앞까지 한 헌크. start·end 는 고친 뒤 쪽 줄 범위(d 가 0 이면 c 한 줄로 친다).
function hunkOf(lines: string[], from: number, to: number) {
  const head = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(lines[from]!)
  const start = Number(head?.[1] ?? 0)
  const count = head?.[2] === undefined ? 1 : Number(head[2])
  return { start, end: start + Math.max(count, 1) - 1, text: lines.slice(from, to).join('\n') }
}

// 보고서 아래 한 줄 요약: 단계별 상태 수.
export function counts(report: ReviewReport): Record<Status, number> {
  const out: Record<Status, number> = { fixed: 0, skipped: 0, found: 0, dismissed: 0 }
  for (const item of report.items) out[item.status]++
  return out
}
