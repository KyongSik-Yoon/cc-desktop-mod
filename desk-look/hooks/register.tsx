import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, TextHoverProps, Timer, ToolGroupCall, UiPressArgument } from 'claude-code'

import type { AgentDetail, AgentRecord, CommentDraft, LineComment, DiffScope, DiffView, FileDiff, ImageInfo, PrCheck, PrInfo, PrState, PrThread, RepoInfo, RunCall, Runs, AskState, CommitInfo, SessionEdit, SessionEntry, PreviewFile, Surface, TaskItem, TurnCard, TurnEdit, UsageBreakdown, UsageInfo } from '../types'
import { CORNER_SIZE, IMAGE_TOKEN, cornerPixels, herdrGraphicsOn, imageNumber, pngSize, supportsGraphics, thumbnailSize, type Corner } from './images'
import { cellWidth, parseBlocks, renderMarkdown } from './markdown'
import { blockHeight, diffBlock, diffBlocks, diffPalette, diffRows, gutterWidth, isTruecolor, parseHunks, patchBlocks, windowPlan } from './diffview'
import type { DiffBlock, DiffLine, DiffPalette, DiffRow } from './diffview'
import { commentContext, draftKey, lineRef, linesIn, pressLine, rangeLabel, rangeOf, rowOf } from './comments'
import type { LinePress } from './comments'
import { agentOf, computeRuns, isAgentTool, isPlanTool, planOf } from './runs'
import { activityOf, agentDetailOf, applyNotices, backgroundTaskOf, dismissAgents, isLive, mergeAgents, modelLabel, orderAgents, parseNotices, stepTokens, tailOf } from './agents'
import { ago, clip, filterSessions, groupSessions, numbered, sessionOf } from './sessions'
import { answerOf, numberProblem, registerAsk } from './ask'
import type { AskReply } from './ask'
import { computeTasks, visibleTasks } from './tasks'
import { OMARCHY_COLORS, parseSurface } from './theme'
import { limitName, contextChipMode, meterBar, meterLevel, resetIn, ring, showsChip, toBreakdown, toUsage } from './usage'
import type { ContextChipMode } from './usage'
import { PR_FIELDS, THREADS_QUERY, checkPrompt, checkSummary, isLocalFailure, jobState, mergeAction, mergeLevel, mergeName, prChipParts, prNumber, prRef, prRepo, reviewName, shortStat, threadPrompt, toDiscussions, toJobs, toMr, toPr, toThreads } from './pr'
import type { MergeAction, MergeResult, Ran } from './pr'
import { LOG_FORMAT, MAX_COMMITS, SCOPES, baseCandidates, parseCommits, scopeLabel, scopeOf } from './gitview'
import { T, langFromConfig, langSetting, setLang } from './i18n'
import { PREVIEW_PANE, PREVIEW_ROOM, PREVIEW_TOOL, fileName, isMarkdown, isPrivate, previewOf, previewTool } from './preview'

export { cellWidth } from './markdown'

// 데스크톱 앱 CDS 토큰의 역할을 엔진 테마 키에 대응시킨다.
// hex 를 박으면 터미널 테마(밝음/어두움)와 어긋나므로, 사용자의 테마를 따르는 키만 쓴다.
const COLORS = {
  text: 'text',
  muted: 'inactive',
  border: 'subtle',
  clay: 'claude',
  accent: 'claude',
  link: 'suggestion',
  code: 'error',
  success: 'success',
  danger: 'error',
  warning: 'warning',
} as const

const PANE = 'desk-diff'
const SESSIONS_PANE = 'desk-sessions'
const CONTEXT_PANE = 'desk-context'
const PR_PANE = 'desk-pr'
const AGENTS_PANE = 'desk-tasks'
// /desk-tasks 끝남 묶음을 접었는지(open 상태의 한 키).
const DONE_FOLDED = 'tasks:doneFolded'
const PER_GROUP = 8

const open = atom({ plugin: 'desk-look', key: 'open' } as const, {} as Record<string, boolean>)
const diff = atom({ plugin: 'desk-look', key: 'diff' } as const, [] as FileDiff[])
const repo = atom({ plugin: 'desk-look', key: 'repo' } as const, null as RepoInfo | null)
const surface = atom({ plugin: 'desk-look', key: 'surface' } as const, null as Surface | null)
const runs = atom({ plugin: 'desk-look', key: 'runs' } as const, { firstOf: {}, calls: {} } as Runs)
const images = atom({ plugin: 'desk-look', key: 'images' } as const, {} as Record<string, ImageInfo>)
const graphics = atom({ plugin: 'desk-look', key: 'graphics' } as const, false)
const pendingEdits = atom({ plugin: 'desk-look', key: 'pendingEdits' } as const, [] as TurnEdit[])
const turnCards = atom({ plugin: 'desk-look', key: 'turnCards' } as const, [] as TurnCard[])
// /desk-diff 패널 창 위치: ui.scroll 이 알려 준 첫 행과 보이는 행 수. 보이는 곳만 그리는 데 쓴다.
const diffWindow = atom({ plugin: 'desk-look', key: 'diffWindow' } as const, { offset: 0, bodyRows: 0 })
// 미리보기 패널에 열린 문서, 그리고 이번 턴에 Write 로 쓴 문서(마지막 것이 턴 끝에 열린다).
const previewFile = atom({ plugin: 'desk-look', key: 'preview' } as const, null as PreviewFile | null)
const previewWritten = atom({ plugin: 'desk-look', key: 'previewWritten' } as const, null as string | null)
const sessions = atom({ plugin: 'desk-look', key: 'sessions' } as const, [] as SessionEntry[])
const sessionQuery = atom({ plugin: 'desk-look', key: 'sessionQuery' } as const, '')
const turnStartedAt = atom({ plugin: 'desk-look', key: 'turnStartedAt' } as const, null as number | null)
// 질문 카드 상태. ask.tsx 의 것과 같은 키다(상태 원본은 파일마다 선언해야 한다).
const asking = atom({ plugin: 'desk-look', key: 'ask' } as const, null as AskState | null)
const promptOrigin = atom({ plugin: 'desk-look', key: 'promptOrigin' } as const, null as 'composer' | 'bridge' | null)
const tasks = atom({ plugin: 'desk-look', key: 'tasks' } as const, [] as TaskItem[])
const tick = atom({ plugin: 'desk-look', key: 'tick' } as const, 0)
const usage = atom({ plugin: 'desk-look', key: 'usage' } as const, null as UsageInfo | null)
const usageBreakdown = atom({ plugin: 'desk-look', key: 'usageBreakdown' } as const, null as UsageBreakdown | null)
const pr = atom({ plugin: 'desk-look', key: 'pr' } as const, null as PrState | null)
// diff 줄 댓글: 쓰는 중인 것(고른 줄 범위)과 다음 프롬프트에 붙일 것. 쓰던 글은 draftText 에 둔다:
// atom 에 두면 글자마다 diff 패널 전체를 다시 그린다. 패널이 다시 그려질 때 입력칸 값으로 돌려준다.
const commentDraft = atom({ plugin: 'desk-look', key: 'commentDraft' } as const, null as CommentDraft | null)
const lineComments = atom({ plugin: 'desk-look', key: 'lineComments' } as const, [] as LineComment[])
let draftText = ''
let commentSeq = 0
const diffView = atom({ plugin: 'desk-look', key: 'diffView' } as const, {
  scope: 'uncommitted',
  base: null,
  files: [],
  commits: [],
  commitFiles: {},
} as DiffView)

const agents = atom({ plugin: 'desk-look', key: 'agents' } as const, {} as Record<string, AgentRecord>)
const agentView = atom({ plugin: 'desk-look', key: 'agentView' } as const, null as string | null)
const agentDetail = atom({ plugin: 'desk-look', key: 'agentDetail' } as const, null as AgentDetail | null)
const agentClock = atom({ plugin: 'desk-look', key: 'agentClock' } as const, 0)
const taskOutput = atom({ plugin: 'desk-look', key: 'taskOutput' } as const, null as { id: string; text: string | null } | null)

// 스피너 시계: 엔진은 모드가 바뀔 때만 Spinner 를 다시 그리므로 직접 tick 을 올려 다시 그리게 한다.
// 스피너가 사라지면(마지막으로 그린 지 2초가 지나면) 스스로 멈춘다.
const SPINNER_TICK = 500
let ticker: Timer | null = null
const THEME_POLL = 3000
let themeWatch: Timer | null = null
let spinnerSeen = 0
let spinnerFallbackStart = 0

const FILE_EDITING = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const CARD_ROWS = 3
// 턴 기록은 최근 60턴, 복사할 답변은 턴마다 5만 자까지만 둔다.
const TURN_CARDS = 60
const MAX_COPY = 50_000

// 같은 파일을 여러 번 고치면 한 줄로 합친다.
export function mergeEdit(list: TurnEdit[], edit: TurnEdit): TurnEdit[] {
  const index = list.findIndex(item => item.path === edit.path)
  if (index === -1) return [...list, edit]
  return list.map((item, at) =>
    at === index ? { ...item, added: item.added + edit.added, removed: item.removed + edit.removed } : item,
  )
}


const lastLine = (text: string) => text.trim().split('\n').pop() ?? ''

// `claude plugin update --json` 의 결과 한 줄을 사람에게 보일 문장으로.
export function updateMessage(exitCode: number, stdout: string, stderr: string): string {
  let result: { outcome?: string; updateOutcome?: string; oldVersion?: string; newVersion?: string; message?: string } | null = null
  try {
    result = JSON.parse(lastLine(stdout))
  } catch {
    result = null
  }
  if (exitCode !== 0 || result?.outcome !== 'ok') return T.updateFailed(result?.message ?? lastLine(stderr || stdout))
  if (result.updateOutcome === 'up_to_date') return T.updateLatest(result.newVersion ?? '')
  return T.updateDone(result.oldVersion ?? '', result.newVersion ?? '')
}

// 세션 편집: 파일별로 합치고 헌크는 편집 순서대로 붙인다. 최근 파일 SESSION_FILES 개, 파일마다 헌크 SESSION_PATCHES 개까지.
const SESSION_FILES = 50
const SESSION_PATCHES = 20

export function mergeSessionEdit(list: SessionEdit[], edit: SessionEdit): SessionEdit[] {
  const old = list.find(item => item.path === edit.path)
  const merged = old
    ? { path: edit.path, added: old.added + edit.added, removed: old.removed + edit.removed, patches: [...old.patches, ...edit.patches].slice(-SESSION_PATCHES) }
    : edit
  return [...list.filter(item => item.path !== edit.path), merged].slice(-SESSION_FILES)
}

// 대화 기록(runs)의 성공한 편집 도구 호출을 파일별로 모은다. 기록에서 다시 계산하므로 재시작·resume 뒤에도 남는다.
export function sessionEditsOf(state: Runs): SessionEdit[] {
  let list: SessionEdit[] = []
  for (const call of Object.values(state.calls).flat()) {
    if (!FILE_EDITING.has(call.tool) || call.isRunning) continue
    const fields = fieldsOf(call.input)
    const path = stringField(fields, 'file_path') ?? stringField(fields, 'notebook_path')
    const stat = diffStat(call)
    if (path && stat) list = mergeSessionEdit(list, { path, ...stat, patches: editPatches(call.tool, call.input, call.output) })
  }
  return list
}

// diff 패널에 git 대신 세션 기록으로 보일 편집: git diff 가 잡지 못하는 저장소 밖(또는 저장소가 아닌 곳) 파일과
// 저장소 안이지만 git 이 무시하는 파일(.gitignore). 그 밖의 저장소 안 파일은 git 이 정본이다(커밋했으면 패널에서 빠지는 게 맞다).
export function outsideEdits(edits: ReadonlyArray<SessionEdit>, info: RepoInfo | null): SessionEdit[] {
  if (info?.isRepo !== true) return [...edits]
  const root = info.root
  const ignored = new Set(info.ignored ?? [])
  return root ? edits.filter(edit => !edit.path.startsWith(`${root}/`) || ignored.has(edit.path)) : []
}

// 소요 시간 줄과 턴 기록을 durationMs 로 짝짓는다. 둘이 같은 값을 재지만 반올림 차이를 1초까지 봐준다.
export function cardFor(cards: ReadonlyArray<TurnCard>, durationMs: number): TurnCard | undefined {
  let best: TurnCard | undefined
  for (const card of cards) {
    const gap = Math.abs(card.durationMs - durationMs)
    if (gap <= 1000 && (best === undefined || gap < Math.abs(best.durationMs - durationMs))) best = card
  }
  return best
}

const EDITING_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'Bash'])

type Call = Pick<ToolGroupCall, 'tool' | 'input' | 'isRunning' | 'isErrored' | 'isInterrupted' | 'output'>

type Category = 'command' | 'read' | 'edit' | 'create' | 'search' | 'web' | 'agent' | 'todo' | 'ask' | 'other'

const CATEGORY_OF: Record<string, Category> = {
  Bash: 'command',
  BashOutput: 'command',
  KillShell: 'command',
  PowerShell: 'command',
  Read: 'read',
  NotebookRead: 'read',
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Write: 'create',
  Grep: 'search',
  Glob: 'search',
  LS: 'search',
  ToolSearch: 'search',
  WebFetch: 'web',
  WebSearch: 'web',
  Agent: 'agent',
  Task: 'agent',
  TodoWrite: 'todo',
  TaskCreate: 'todo',
  TaskUpdate: 'todo',
  TaskList: 'todo',
  AskUserQuestion: 'ask',
}

// 데스크톱의 "Ran 2 commands, created a file, edited 3 files, and 3 more actions" 문구.
const PHRASES: Record<Category, [string, (count: number) => string]> = {
  command: ['ran a command', count => `ran ${count} commands`],
  read: ['read a file', count => `read ${count} files`],
  edit: ['edited a file', count => `edited ${count} files`],
  create: ['created a file', count => `created ${count} files`],
  search: ['searched', count => `searched ${count} times`],
  web: ['fetched a page', count => `fetched ${count} pages`],
  agent: ['ran an agent', count => `ran ${count} agents`],
  todo: ['updated todos', () => 'updated todos'],
  ask: ['asked a question', count => `asked ${count} questions`],
  other: ['used a tool', count => `used ${count} tools`],
}

const VERB: Record<Category, string> = {
  command: 'Ran',
  read: 'Read',
  edit: 'Edited',
  create: 'Created',
  search: 'Searched',
  web: 'Fetched',
  agent: 'Agent',
  todo: 'Updated todos',
  ask: 'Asked',
  other: 'Used',
}

const categoryOf = (tool: string): Category => CATEGORY_OF[tool] ?? 'other'

export function describeCalls(calls: ReadonlyArray<Call>): string {
  const counts = new Map<Category, number>()
  for (const call of calls) {
    const category = categoryOf(call.tool)
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  const entries = [...counts]
  const phrase = ([category, count]: [Category, number]) =>
    count === 1 ? PHRASES[category][0] : PHRASES[category][1](count)
  const shown = entries.slice(0, 3).map(phrase)
  const rest = entries.slice(3).reduce((sum, [, count]) => sum + count, 0)
  const text = rest > 0 ? `${shown.join(', ')}, and ${rest} more action${rest === 1 ? '' : 's'}` : shown.join(', ')
  const failed = calls.filter(call => call.isErrored).length
  return text.charAt(0).toUpperCase() + text.slice(1) + (failed > 0 ? ` (${failed} failed)` : '')
}

const fieldsOf = (input: unknown): Record<string, unknown> =>
  typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}

const stringField = (fields: Record<string, unknown>, key: string) =>
  typeof fields[key] === 'string' ? (fields[key] as string) : undefined

// 동사 옆에 붙는 회색 대상: 파일명, 명령, 패턴, URL.
export function summarize(tool: string, input: unknown): string {
  const fields = fieldsOf(input)
  const path = stringField(fields, 'file_path') ?? stringField(fields, 'notebook_path') ?? stringField(fields, 'path')
  const questions = Array.isArray(fields.questions) ? fields.questions.map(fieldsOf) : []
  const summary =
    (tool === 'Bash' ? stringField(fields, 'command') : undefined) ??
    (tool === 'AskUserQuestion' ? stringField(questions[0] ?? {}, 'question') : undefined) ??
    (path ? path.split('/').pop() : undefined) ??
    stringField(fields, 'pattern') ??
    stringField(fields, 'url') ??
    stringField(fields, 'query') ??
    stringField(fields, 'description') ??
    stringField(fields, 'prompt') ??
    Object.values(fields).find((value): value is string => typeof value === 'string') ??
    ''
  return summary.split('\n')[0] ?? ''
}

// 질문 도구의 답: 결과의 answers 값들. 없으면 null.
export function askAnswer(output: unknown): string | null {
  let value = output
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  const answers = fieldsOf(fieldsOf(value).answers)
  const list = Object.values(answers).filter((answer): answer is string => typeof answer === 'string' && answer !== '')
  return list.length > 0 ? list.join(' · ') : null
}

function verbOf(tool: string): string {
  if (tool === PREVIEW_TOOL) return 'Previewed'
  const category = categoryOf(tool)
  if (category !== 'other') return VERB[category]
  // mcp__server__tool → tool
  return `Used ${tool.startsWith('mcp__') ? (tool.split('__').pop() ?? tool) : tool}`
}

// 끝 줄바꿈은 줄을 하나 더 만들지 않는다('a\nb\n' 은 2줄).
const lineCount = (text: unknown) => (typeof text === 'string' ? linesOf(text.replace(/\n$/, '')).length : 0)

// 앞뒤로 같은 줄 수. 편집은 old_string 에 문맥 줄을 함께 넣으니 그 줄은 바뀐 것으로 치지 않는다.
function commonEnds(before: string[], after: string[]): { head: number; tail: number } {
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head++
  let tail = 0
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++
  return { head, tail }
}

const linesOf = (text: string) => (text === '' ? [] : text.split('\n'))

// Edit 의 old/new 는 바꾼 줄 앞뒤 문맥 줄을 함께 담는다. 앞뒤 공통 줄을 걷어내고 남은 줄만 센다.
export function lineChange(oldText: string, newText: string): { added: number; removed: number } {
  const before = linesOf(oldText)
  const after = linesOf(newText)
  const { head, tail } = commonEnds(before, after)
  return { added: after.length - head - tail, removed: before.length - head - tail }
}

// 편집 도구의 +/− 줄 수: 데스크톱의 초록·빨강 칩.
export function diffStat(call: Call): { added: number; removed: number } | null {
  if (call.isErrored || call.isInterrupted) return null
  const fields = fieldsOf(call.input)
  switch (call.tool) {
    case 'Edit':
      return lineChange(stringField(fields, 'old_string') ?? '', stringField(fields, 'new_string') ?? '')
    case 'MultiEdit': {
      const edits = Array.isArray(fields.edits) ? fields.edits.map(fieldsOf) : []
      const changes = edits.map(edit => lineChange(stringField(edit, 'old_string') ?? '', stringField(edit, 'new_string') ?? ''))
      return {
        added: changes.reduce((sum, change) => sum + change.added, 0),
        removed: changes.reduce((sum, change) => sum + change.removed, 0),
      }
    }
    case 'Write': {
      // 있던 파일을 덮어쓰면 결과에 헌크가 온다. 새 파일은 헌크가 비어 내용 줄 수를 쓴다.
      const hunks = (call.output as { structuredPatch?: unknown } | null | undefined)?.structuredPatch
      if (Array.isArray(hunks) && hunks.length > 0) {
        const lines = hunks.flatMap(hunk => (hunk as { lines?: unknown }).lines).filter((line): line is string => typeof line === 'string')
        return { added: lines.filter(line => line.startsWith('+')).length, removed: lines.filter(line => line.startsWith('-')).length }
      }
      return { added: lineCount(fields.content), removed: 0 }
    }
    case 'NotebookEdit':
      return { added: lineCount(fields.new_source), removed: 0 }
    default:
      return null
  }
}

export function outputText(output: unknown): string {
  if (output === undefined || output === null) return ''
  if (typeof output === 'string') return output
  const fields = fieldsOf(output)
  const stdout = stringField(fields, 'stdout')
  if (stdout !== undefined) return [stdout, stringField(fields, 'stderr') ?? ''].filter(Boolean).join('\n')
  const file = fieldsOf(fields.file)
  const content = stringField(file, 'content') ?? stringField(fields, 'content')
  if (content !== undefined) return content
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

function cap(text: string, lines: number): string {
  const all = text.replace(/\s+$/, '').split('\n')
  return all.length <= lines ? all.join('\n') : `${all.slice(0, lines).join('\n')}\n${T.moreLines(all.length - lines)}`
}

// Edit·MultiEdit 결과의 structuredPatch: 파일 기준 줄 번호와 앞뒤 문맥이 붙은 헌크. 없으면 null.
export function patchOf(output: unknown): string | null {
  const hunks = (output as { structuredPatch?: unknown } | null | undefined)?.structuredPatch
  if (!Array.isArray(hunks) || hunks.length === 0) return null
  return hunks
    .map(hunk => {
      const part = hunk as { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }
      return [`@@ -${part.oldStart},${part.oldLines} +${part.newStart},${part.newLines} @@`, ...part.lines].join('\n')
    })
    .join('\n')
}

// 성공한 편집 도구 호출의 헌크들: 결과의 structuredPatch, 없으면 입력에서 만든다(새로 쓴 파일은 전부 +).
export function editPatches(tool: string, input: unknown, result: unknown): string[] {
  const fromResult = patchOf(result)
  if (fromResult) return [fromResult]
  const fields = fieldsOf(input)
  switch (tool) {
    case 'Edit':
      return [editHunk(stringField(fields, 'old_string') ?? '', stringField(fields, 'new_string') ?? '')]
    case 'MultiEdit':
      return (Array.isArray(fields.edits) ? fields.edits.map(fieldsOf) : []).map(edit =>
        editHunk(stringField(edit, 'old_string') ?? '', stringField(edit, 'new_string') ?? ''),
      )
    case 'Write': {
      const lines = linesOf((stringField(fields, 'content') ?? '').replace(/\n$/, ''))
      return lines.length === 0 ? [] : [[`@@ -0,0 +1,${lines.length} @@`, ...lines.map(line => `+${line}`)].join('\n')]
    }
    default:
      return []
  }
}

// 편집 하나를 diff 헌크로(결과에 헌크가 없을 때): 바뀐 줄만 −/+, 앞뒤 같은 줄은 문맥으로 두 줄까지.
export function editHunk(oldText: string, newText: string, context = 2): string {
  const before = linesOf(oldText)
  const after = linesOf(newText)
  const { head, tail } = commonEnds(before, after)
  const lead = before.slice(Math.max(0, head - context), head)
  const trail = before.slice(before.length - tail, before.length - tail + context)
  const removed = before.slice(head, before.length - tail)
  const added = after.slice(head, after.length - tail)
  const start = head - lead.length + 1
  return [
    `@@ -${start},${lead.length + removed.length + trail.length} +${start},${lead.length + added.length + trail.length} @@`,
    ...lead.map(line => ` ${line}`),
    ...removed.map(line => `-${line}`),
    ...added.map(line => `+${line}`),
    ...trail.map(line => ` ${line}`),
  ].join('\n')
}

// `git diff` 출력을 파일 단위로 나눈다. Code format: 'diff' 는 @@ 헌크부터 받는다.
export function parseDiff(text: string, isNew = false): FileDiff[] {
  const files: FileDiff[] = []
  for (const chunk of text.split(/^diff --git /m).slice(1)) {
    const lines = chunk.split('\n')
    const header = lines[0] ?? ''
    const path = header.replace(/^a\/.* b\/(.*)$/, '$1')
    const firstHunk = lines.findIndex(line => line.startsWith('@@'))
    const hunks = firstHunk === -1 ? [] : lines.slice(firstHunk)
    files.push({
      path,
      added: hunks.filter(line => line.startsWith('+')).length,
      removed: hunks.filter(line => line.startsWith('-')).length,
      patch: hunks.join('\n').trimEnd(),
      isNew,
    })
  }
  return files
}

// 사용자 git 설정(diff.mnemonicPrefix·noprefix)과 상관없이 머리말을 a/ b/ 로 고정해 경로를 읽는다.
// git 을 부르는 자리마다 명령 전체를 고정 글자로 쓴다(디렉터리 검사가 무엇을 실행하는지 끝까지 읽게). diff 는 늘
// --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ 로 같은 모양을 받는다. 길이가 변하는 목록(경로·커밋)은 stdin 으로.

// 컨텍스트 칩의 숫자: 인자 없는 usage() 는 상태 줄의 값이라 공짜다. 턴이 끝날 때마다 다시 읽는다.
async function refreshUsage($: EngineInterface) {
  const [raw, now] = await Promise.all([$.session.usage(), $.clock.now()])
  const next = toUsage(raw, now)
  await update($, usage, previous => (JSON.stringify({ ...previous, at: 0 }) === JSON.stringify({ ...next, at: 0 }) ? previous : next))
}

// 패널을 열 때만 항목별 내역을 계산한다. summary 는 로컬 추정이라 API 요청이 없다(full 은 도구마다 요청).
async function refreshBreakdown($: EngineInterface) {
  const [raw, now] = await Promise.all([$.session.usage({ breakdown: 'summary' }), $.clock.now()])
  await update($, usage, () => toUsage(raw, now))
  await update($, usageBreakdown, () => toBreakdown(raw, now))
}

async function openContext($: EngineInterface) {
  await refreshBreakdown($).catch(() => undefined)
  await $.ui.open({ id: CONTEXT_PANE, title: T.paneContext, focus: true })
}

// 줄 전체가 눌리는 버튼: 라벨 뒤에 칩·흐린 설명(Text)을 함께 넣는다.
type RowButtonProps = { key: string; dimColor?: boolean; hotkey?: string; hover?: TextHoverProps; onPress: (press: UiPressArgument) => void }

function rowButton(els: Els, props: RowButtonProps, label: string, ...rest: unknown[]) {
  const { Button } = els
  const parts = rest.filter(part => part !== null && part !== undefined && part !== false && part !== '')
  return (
    <Button plain {...props}>
      {label}
      {parts as never}
    </Button>
  )
}

// 아래턱 오른쪽의 "◔ 62%": 링은 단계 색, 칩 전체가 컨텍스트 패널을 여는 버튼.
function contextMeter(els: Els, $: EngineInterface, info: UsageInfo | null, mode: ContextChipMode) {
  const percent = info?.percent ?? null
  if (!showsChip(mode, percent)) return null
  const { Box, Text, Button } = els
  const level = meterLevel(percent)
  const label = `${percent}%`
  return {
    width: 2 + cellWidth(label),
    node: (
      <Button key="context-chip" plain dimColor={level === 'muted'} onPress={() => void openContext($)}>
        <Text color={COLORS[level]}>{ring(percent)}</Text>
        {` ${label}`}
      </Button>
    ),
  }
}

// 아래턱 오른쪽의 PR 칩 "#12 ✓ 5/5": 누르면 /desk-pr 패널.
function prChip(els: Els, $: EngineInterface, state: PrState | null) {
  const info = state?.pr
  if (!info) return null
  const { Box, Text, Button } = els
  const parts = prChipParts(info)
  const text = parts.map(part => part.text).join(' ')
  const colored = parts.slice(1).map((part, index) => (
    <Text key={`pr-part-${index}`} color={COLORS[part.color]}>{` ${part.text}`}</Text>
  ))
  return {
    width: cellWidth(text),
    node: (
      <Button key="pr-chip" plain dimColor onPress={() => void openPr($)}>
        {parts[0]!.text}
        {colored as never}
      </Button>
    ),
  }
}

async function refreshDiff($: EngineInterface) {
  const opts = { timeoutMs: 5000 }
  const inside = await $.process.run(['git', 'rev-parse', '--is-inside-work-tree'], opts)
  if (inside.exitCode !== 0) {
    const cwd = await $.session.cwd()
    await update($, repo, () => ({ name: cwd.split('/').pop() ?? cwd, branch: null, isRepo: false }))
    await update($, diff, () => [])
    return
  }
  const [top, branch, tracked, untracked] = await Promise.all([
    $.process.run(['git', 'rev-parse', '--show-toplevel'], opts),
    $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], opts),
    $.process.run(['git', 'diff', 'HEAD', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'], opts).then(ran => (ran.exitCode === 0 ? ran : $.process.run(['git', 'diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'], opts))),
    $.process.run(['git', 'ls-files', '--others', '--exclude-standard'], opts),
  ])
  // 새로 만든 파일은 `git diff HEAD` 에 안 잡힌다. 데스크톱처럼 보이도록 최대 20개까지 붙인다.
  const fresh = untracked.stdout.split('\n').filter(Boolean).slice(0, 20)
  const freshDiffs = await Promise.all(fresh.map(path => $.process.run(['git', 'diff', '--no-index', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--', '/dev/null', path], opts)))
  const files = [
    ...parseDiff(tracked.stdout),
    ...freshDiffs.flatMap(ran => parseDiff(ran.stdout, true)),
  ]
  // 이 세션이 고친 저장소 안 파일 중 git 이 무시하는 것은 git diff·ls-files 어디에도 안 잡힌다. 세션 기록으로 보이게 골라 둔다.
  const root = top.stdout.trim()
  const inRepo = root ? sessionEditsOf(await read($, runs)).map(edit => edit.path).filter(path => path.startsWith(`${root}/`)) : []
  const ignored = inRepo.length ? (await $.process.run(['git', 'check-ignore', '--stdin'], { ...opts, stdin: `${inRepo.join('\n')}\n` })).stdout.split('\n').filter(Boolean) : []
  await update($, repo, () => ({
    name: root.split('/').pop() ?? '',
    branch: branch.exitCode === 0 ? branch.stdout.trim() : null,
    isRepo: true,
    root: root || undefined,
    ignored,
  }))
  await update($, diff, () => files)
}

// diff 패널의 되돌리기: 처음 누르면 5초 동안 확인 상태, 그 안에 한 번 더 누르면 HEAD 로 되돌린다.
// 커밋하지 않은 변경을 버리는 일이라 두 번 눌러야 하고, git 이 아는 파일만 대상이다(새 파일은 지우게 되므로 없음).
const REVERT_ARM_MS = 5000

async function revertFile($: EngineInterface, path: string, isArmed: boolean) {
  const key = `revert:${path}`
  if (!isArmed) {
    await update($, open, state => ({ ...state, [key]: true }))
    $.clock.after(REVERT_ARM_MS, () => void update($, open, state => ({ ...state, [key]: false })))
    return
  }
  await update($, open, state => ({ ...state, [key]: false }))
  const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { timeoutMs: 5000 })
  const ran = await $.process.run(['git', 'restore', '--source=HEAD', '--staged', '--worktree', '--', path], {
    cwd: top.stdout.trim() || undefined,
    timeoutMs: 5000,
  })
  $.ui.toast(ran.exitCode === 0 ? T.reverted(path) : T.revertFailed(ran.stderr.trim().split('\n')[0] ?? ''))
  await refreshDiff($)
}

// 처음 상태가 펼침인 행(묶음 안의 편집)도 있어서, 지금 보이는 상태를 받아 뒤집는다.
const toggle = ($: EngineInterface, id: string, shown?: boolean) =>
  update($, open, state => ({ ...state, [id]: !(state[id] ?? shown ?? false) }))

// 턴 끝 카드의 파일(도구가 준 경로, 보통 절대 경로)이나 /desk-diff 에 준 이름(뒷부분)에 맞는
// diff 패널 파일(저장소 기준 경로). 절대 경로 쪽은 가장 길게 맞는 것, 이름 쪽은 첫 번째.
export function matchDiffFile(files: ReadonlyArray<{ path: string }>, path: string): string | null {
  const whole = files.filter(file => file.path === path || path.endsWith(`/${file.path}`))
  const best = whole.sort((a, b) => b.path.length - a.path.length)[0]
  return best?.path ?? files.find(file => file.path.endsWith(`/${path}`))?.path ?? null
}

// 앞을 줄인다: 경로는 파일 이름 쪽이 중요하다.
export function clipStart(text: string, width: number): string {
  if (cellWidth(text) <= width) return text
  let out = ''
  for (const ch of [...text].reverse()) {
    if (cellWidth(ch + out) > width - 1) break
    out = ch + out
  }
  return `…${out}`
}

// diff 패널에서 세션 기록으로 보이는 파일의 키 앞머리.
const OUTSIDE = 's:'
// git 밖 편집 묶음 전체의 접기 키. 파일 접기 키(fold:경로)와 겹치지 않게 따로 둔다.
const OUTSIDE_GROUP = 'group:outside'

// 데스크톱처럼 턴 끝 카드의 파일을 누르면 diff 패널을 그 파일에서 연다(접혀 있으면 펼쳐서).
// 문서를 읽어 미리보기 상태에 둔다. 경로는 실제 경로로 바꿔 둬서 나중에 다른 모양의 경로로 온 편집도 같은 문서로 안다.
// 못 읽으면 던지지 않고 사유를 담는다.
async function loadPreview($: EngineInterface, asked: string): Promise<PreviewFile> {
  const path = await $.fs.stat(asked, { resolve: true }).then(
    stat => stat.realPath ?? asked,
    () => asked,
  )
  const file: PreviewFile = await $.fs.read(path).then(
    text => ({ path, text }),
    (error: unknown) => ({ path, text: '', error: error instanceof Error ? error.message : String(error) }),
  )
  await update($, previewFile, () => file)
  return file
}

async function openPreview($: EngineInterface, path: string, focus = false) {
  const file = await loadPreview($, path)
  const opened = await $.ui.open({ id: PREVIEW_PANE, title: fileName(file.path), ...(focus ? { focus: true as const } : {}) })
  return { file, isPlaced: opened.isPlaced }
}

// 보고 있는 문서인지. 열 때 실제 경로로 바꿔 뒀으니 다른 모양의 경로도 실제 경로로 견준다.
async function isPreviewed($: EngineInterface, path: string) {
  const shown = await read($, previewFile)
  if (shown === null) return false
  if (shown.path === path) return true
  const real = await $.fs.stat(path, { resolve: true }).then(
    stat => stat.realPath,
    () => undefined,
  )
  return real === shown.path
}

// 행 끝의 ◫ 칩: 쉴 때는 흐리고 마우스 아래에서 진해진다.
function previewChip(els: Els, $: EngineInterface, key: string, path: string, label = T.previewChip) {
  return <els.Button key={`preview-${key}`} plain dimColor label={label} onPress={() => void openPreview($, path).catch(() => undefined)} />
}

async function openDiffAt($: EngineInterface, path: string) {
  await refreshDiffView($, 'uncommitted')
  const inGit = matchDiffFile(await read($, diff), path)
  // git 이 모르는 파일(저장소 밖)은 세션 편집 기록에서 찾는다. 경로는 도구가 준 절대 경로다.
  const outside = inGit === null ? matchDiffFile(outsideEdits(sessionEditsOf(await read($, runs)), await read($, repo)), path) : null
  const target = inGit ?? (outside === null ? null : `${OUTSIDE}${outside}`)
  await $.ui.open({ id: PANE, title: T.paneChanges, focus: true })
  if (target === null) {
    $.ui.toast(T.notInDiff)
    return
  }
  // git 밖 파일이면 묶음도 편다: 접힌 묶음 안의 파일 머리 띠는 그리지 않아 스크롤해 갈 곳이 없다.
  await update($, open, state => ({ ...state, [`fold:${target}`]: false, ...(inGit === null ? { [OUTSIDE_GROUP]: false } : {}) }))
  // 막 연 패널은 아직 그려지기 전이라 스크롤이 거부된다("not this plugin's site"). 그려질 때까지 잠깐 다시 한다.
  for (let tries = 0; tries < 8; tries++) {
    const moved = await $.ui.scroll({ to: { key: `file-${target}` }, in: PANE, block: 'start' }).catch(() => ({ deny: 'failed' }))
    if (!moved.deny) return
    await $.clock.sleep(100).catch(() => undefined)
  }
}

// PR 바: 턴이 끝날 때마다 다시 읽되 30초 안에는 건너뛴다(gh·glab 은 네트워크를 탄다). 도구가 없거나 어느
// 호스트의 저장소도 아니면(isSticky) 같은 브랜치에서는 다시 묻지 않는다. 패널을 열거나 ↻ 를 누르면 바로 읽는다.
// 체크(GitLab 은 파이프라인 job)가 도는 동안은 턴 밖에서도 다시 읽고, 다 끝나면 멈춘다. 결과가 오지 않는 체크
// (GitHub EXPECTED, runner 를 기다리는 job)는 끝나지 않으므로, 체크 상태가 그대로면 간격을 PR_POLL 에서 두 배씩
// PR_POLL_MAX 까지 늘린다(gh·glab 사용 한도). 무엇이든 바뀌거나 새로 푸시하면 PR_POLL 로 돌아간다.
const PR_TTL = 30_000
const PR_POLL = 15_000
const PR_POLL_MAX = 120_000
let prFetch: Promise<void> | null = null
let prPoll: Timer | null = null
let prDelay = PR_POLL
let prSeen: string | null = null

const isChecking = (state: PrState | null | undefined) =>
  state?.status === 'ok' && state.pr?.state === 'OPEN' && state.pr.checks.some(check => check.state === 'pending')

// 다음 주기: 지난번 읽은 것과 head·체크 상태가 같으면 늘리고, 다르면 처음으로.
function pacePr(state: PrState) {
  const seen = JSON.stringify([state.pr?.headSha, state.pr?.checks.map(check => [check.name, check.state])])
  prDelay = seen === prSeen ? Math.min(prDelay * 2, PR_POLL_MAX) : PR_POLL
  prSeen = seen
}

function watchPr($: EngineInterface) {
  if (prPoll !== null) return
  prPoll = $.clock.after(prDelay, () => {
    prPoll = null
    // 다시 읽어 체크가 아직 돌면 refreshPr 이 다음 주기를 건다.
    void refreshPr($, false).catch(() => undefined)
  })
}

async function refreshPr($: EngineInterface, force: boolean) {
  if (prFetch) return prFetch
  prFetch = (async () => {
    const [branchRan, now] = await Promise.all([
      $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 5000 }).catch(() => null),
      $.clock.now(),
    ])
    const branch = branchRan?.exitCode === 0 ? branchRan.stdout.trim() : null
    const last = await read($, pr)
    if (branch === null || branch === 'HEAD') {
      await update($, pr, (): PrState => ({ status: 'none', branch, pr: null, at: now }))
      return
    }
    const ttl = isChecking(last) ? PR_POLL / 2 : PR_TTL
    if (!force && last && last.branch === branch && ((last.status === 'off' && last.isSticky) || now - last.at < ttl)) {
      // 다시 불러온 모듈은 타이머가 없다: 저장된 상태에 도는 체크가 있으면 다시 건다.
      if (isChecking(last)) watchPr($)
      return
    }
    if (force || last?.branch !== branch) await update($, pr, (previous): PrState => ({ status: 'loading', branch, pr: previous?.branch === branch ? previous.pr : null, at: now }))
    const next = await fetchReview($, branch, now)
    await update($, pr, () => next)
    // 다음 주기는 방금 읽은 때부터 센다(↻·턴 끝에서 바뀐 것을 보면 길게 걸어 둔 타이머 대신 PR_POLL 로).
    prPoll?.cancel()
    prPoll = null
    if (isChecking(next)) {
      pacePr(next)
      watchPr($)
    } else {
      prDelay = PR_POLL
      prSeen = null
    }
  })().finally(() => {
    prFetch = null
  })
  return prFetch
}

async function openDiff($: EngineInterface, scope?: DiffScope) {
  await refreshDiffView($, scope)
  await $.ui.open({ id: PANE, title: T.paneChanges, focus: true })
  // 맨 위에서 보여 준다. 다시 연 패널의 창과 적어 둔 위치(diffWindow)도 이 스크롤로 맞춰진다.
  await $.ui.scroll({ to: 'start', in: PANE }).catch(() => undefined)
}

async function openPr($: EngineInterface) {
  const shown = refreshPr($, true).catch(() => undefined)
  await $.ui.open({ id: PR_PANE, title: 'PR', focus: true })
  await shown
}

// PR 패널의 머지: Revert 처럼 5초 안에 두 번 눌러야 한다. 누른 순간 패널이 보여 준 PR(head 커밋)로 머지하고
// 결과를 알린 뒤 다시 읽는다. 도는 체크가 있으면 통과하면 머지되게 건다.
const MERGE_ARM_MS = 5000
let merging = false

async function mergeFromPane($: EngineInterface, info: PrInfo, action: MergeAction, isArmed: boolean) {
  const key = `merge:${info.url}`
  if (!isArmed) {
    await update($, open, state => ({ ...state, [key]: true }))
    $.clock.after(MERGE_ARM_MS, () => void update($, open, state => ({ ...state, [key]: false })))
    return
  }
  await update($, open, state => ({ ...state, [key]: false }))
  if (merging) return
  merging = true
  try {
    $.ui.toast(T.merging(prRef(info)))
    const result = await mergePr($, info, action)
    if (!result.ok) $.ui.toast(T.mergeFailed(result.error))
    else $.ui.toast([result.merged ? T.merged(prRef(info)) : T.autoMergeSet(prRef(info)), result.note].filter(Boolean).join(' · '))
  } finally {
    merging = false
  }
  await refreshPr($, true).catch(() => undefined)
}

// 줄 댓글의 diff 범위: 모델이 줄 번호가 어느 판의 것인지 알게.
function commentScope(prefix: string, base: string | undefined): string {
  if (prefix === OUTSIDE) return 'an edit made this session, outside git'
  if (prefix === 'b:') return base ? `branch changes since ${base}` : 'branch changes'
  const commit = /^c:([^:]+):$/.exec(prefix)
  return commit ? `commit ${commit[1]}` : 'uncommitted changes'
}

// 줄 번호 누름: 범위를 정하고 입력칸으로 포커스를 옮긴다(다음 그림에 생기는 입력칸을 엔진이 기다려 준다).
// 패널 버튼을 클릭해도 패널이 키를 갖지 않아 focus 가 거절되므로, 패널을 focus 로 다시 열어 키를 가져온다.
async function pickLine($: EngineInterface, at: LinePress) {
  const before = await read($, commentDraft)
  const next = pressLine(before, at)
  if (!next || before?.patch !== next.patch) draftText = ''
  await update($, commentDraft, () => next)
  if (!next) return
  await $.ui.open({ id: PANE, title: T.paneChanges, focus: true })
  await $.ui.focus({ requestId: PANE, key: draftKey(next) }).catch(() => undefined)
}

async function cancelComment($: EngineInterface) {
  draftText = ''
  await update($, commentDraft, () => null)
}

// Enter: 글이 있으면 그 범위 줄들과 함께 쌓고, 비었으면 닫는다.
async function saveComment($: EngineInterface, draft: CommentDraft, lines: DiffLine[], value: string) {
  const body = value.trim()
  await cancelComment($)
  if (body === '' || lines.length === 0) return
  const end = lines[lines.length - 1] as DiffLine
  const id = String(++commentSeq)
  await update($, lineComments, list => [...list, { id, patch: draft.patch, path: draft.path, scope: draft.scope, end: lineRef(end), lines, body }])
}

// "Claude에게 맡기기": 입력창이 비어 있으면 채우고, 쓰던 글이 있으면 뒤에 붙인다.
async function fillPrompt($: EngineInterface, text: string) {
  const box = await $.prompt.read().catch(() => ({ text: '', cursor: 0 }))
  const isEmpty = box.text.trim() === ''
  const filled = await $.prompt.fill({ text: isEmpty ? text : `\n\n${text}`, mode: isEmpty ? 'replace' : 'append' }).catch(() => null)
  $.ui.toast(filled?.isFilled ? T.filled : T.fillFailed)
}

// diff 패널의 브랜치·커밋 범위. 커밋 안 한 변경은 refreshDiff 의 diff 를 그대로 쓴다.
async function findBase($: EngineInterface) {
  const opts = { timeoutMs: 8000 }
  const [originHead, state] = await Promise.all([$.process.run(['git', 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], opts), read($, pr)])
  const candidates = baseCandidates(state?.pr?.base ?? null, originHead.exitCode === 0 ? originHead.stdout.trim() : null)
  for (const ref of candidates) {
    const found = await $.process.run(['git', 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], opts)
    if (found.exitCode !== 0) continue
    const base = await $.process.run(['git', 'merge-base', 'HEAD', ref], opts)
    if (base.exitCode === 0 && base.stdout.trim() !== '') return { ref, sha: base.stdout.trim() }
  }
  return null
}

async function refreshDiffView($: EngineInterface, scope?: DiffScope) {
  const view = await read($, diffView)
  const next = scope ?? view.scope
  if (next === 'uncommitted') {
    await refreshDiff($)
    await update($, diffView, previous => ({ ...previous, scope: next }))
    return
  }
  const opts = { timeoutMs: 8000 }
  const base = await findBase($)
  if (next === 'branch') {
    await refreshDiff($)
    const ran = base ? await $.process.run(['git', 'diff', base.sha, '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'], opts) : null
    // 브랜치 전체에도 아직 git 에 없는 새 파일을 넣는다(커밋 안 한 변경 쪽에서 이미 읽었다)
    const fresh = (await read($, diff)).filter(file => file.isNew)
    const files = ran && ran.exitCode === 0 ? [...parseDiff(ran.stdout), ...fresh] : []
    await update($, diffView, previous => ({ ...previous, scope: next, base, files }))
    return
  }
  const log = base
    ? await $.process.run(['git', 'log', LOG_FORMAT, `-n${MAX_COMMITS}`, `${base.sha}..HEAD`], opts)
    : await $.process.run(['git', 'log', LOG_FORMAT, `-n${MAX_COMMITS}`], opts)
  const commits = log.exitCode === 0 ? parseCommits(log.stdout) : []
  // 목록에 남은 커밋만 펼친 채로 둔다
  const keep = new Set(commits.map(commit => commit.sha))
  await update($, diffView, previous => ({
    ...previous,
    scope: next,
    base,
    commits,
    commitFiles: Object.fromEntries(Object.entries(previous.commitFiles).filter(([sha]) => keep.has(sha))),
  }))
}

// 커밋들의 diff 를 git show 한 번으로 읽는다(커밋은 stdin 으로). 커밋마다 \x1e<sha> 줄로 시작한다.
async function commitDiffs($: EngineInterface, shas: string[]): Promise<Record<string, FileDiff[]>> {
  // 시간을 넘기거나 git 을 못 띄우면 빈 커밋으로 둔다: 커밋 줄·z 는 결과를 기다리지 않아 던지면 아무도 못 받는다.
  const stdin = `${shas.join('\n')}\n`
  const ran = await $.process.run(['git', 'show', '--stdin', '--format=%x1e%H', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'], { timeoutMs: 8000, stdin }).catch(() => ({ exitCode: 1, stdout: '' }))
  const found = ran.exitCode === 0 ? splitCommitDiffs(ran.stdout) : {}
  return Object.fromEntries(shas.map(sha => [sha, found[sha] ?? []]))
}

export function splitCommitDiffs(text: string): Record<string, FileDiff[]> {
  return Object.fromEntries(
    text
      .split('\x1e')
      .slice(1)
      .map(chunk => {
        const end = chunk.indexOf('\n')
        return end < 0 ? [chunk, []] : [chunk.slice(0, end), parseDiff(chunk.slice(end + 1))]
      }),
  )
}

// 커밋 줄을 누르면 그 커밋의 diff 를 펼치고, 다시 누르면 접는다. 여러 커밋을 함께 펼쳐 둘 수 있다.
async function pickCommit($: EngineInterface, sha: string) {
  const view = await read($, diffView)
  if (view.commitFiles[sha]) {
    await update($, diffView, previous => ({ ...previous, commitFiles: Object.fromEntries(Object.entries(previous.commitFiles).filter(([open]) => open !== sha)) }))
    return
  }
  const files = await commitDiffs($, [sha])
  await update($, diffView, previous => ({ ...previous, commitFiles: { ...previous.commitFiles, ...files } }))
}

// 커밋별 탭의 모두 접기·펴기: 하나라도 펼쳐져 있으면 모두 접고, 아니면 목록의 커밋을 모두 편다.
async function foldCommits($: EngineInterface) {
  const view = await read($, diffView)
  if (Object.keys(view.commitFiles).length > 0) {
    await update($, diffView, previous => ({ ...previous, commitFiles: {} }))
    return
  }
  const files = await commitDiffs($, view.commits.map(commit => commit.sha))
  await update($, diffView, previous => ({ ...previous, commitFiles: files }))
}

async function refreshSurface($: EngineInterface) {
  const home = await $.env.get('HOME')
  const toml = home ? await $.fs.read(`${home}/${OMARCHY_COLORS}`).catch(() => null) : null
  const next = toml === null ? null : parseSurface(toml)
  const [colorterm, tmux] = await Promise.all([$.env.get('COLORTERM').catch(() => undefined), $.env.get('TMUX').catch(() => undefined)])
  diffColors = next ? diffPalette(next.mode, next.background, COLORS.muted, isTruecolor({ COLORTERM: colorterm, TMUX: tmux })) : null
  await update($, surface, previous => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next))
}

// diff 색: 터미널 바탕(Omarchy 테마)을 알 때만. 모르면 엔진 diff 그대로(말풍선 등과 같은 규칙).
// 대화 속 편집 행(callDetail)은 비동기 읽기 없이 그려서 테마를 읽을 때 같이 맞춰 둔다.
let diffColors: DiffPalette | null = null

async function readHerdrConfig($: EngineInterface): Promise<string> {
  const [xdg, home] = await Promise.all([$.env.get('XDG_CONFIG_HOME'), $.env.get('HOME')])
  const base = xdg || (home ? `${home}/.config` : '')
  return base ? $.fs.read(`${base}/herdr/config.toml`).catch(() => '') : ''
}

async function refreshImages($: EngineInterface) {
  const next = await listImages($).catch(() => ({}))
  await update($, images, previous => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next))
}

// 이 세션의 images 폴더(/tmp/claude-<uid>/<프로젝트>/<세션>/images). 찾으면 기억한다: 프롬프트마다 다시 훑지 않게.
let userId: string | null = null
let imagesDir: string | null = null
// 같은 그림(경로·수정 시각)은 PNG 머리를 다시 읽지 않는다.
const imageSizes = new Map<string, { width: number; height: number } | null>()

async function findImagesDir($: EngineInterface): Promise<string | null> {
  if (imagesDir !== null) return imagesDir
  if (userId === null) {
    const ran = await $.process.run(['id', '-u'], { timeoutMs: 3000 })
    userId = ran.exitCode === 0 ? ran.stdout.trim() : ''
  }
  if (userId === '') return null
  const root = `/tmp/claude-${userId}`
  const sessionId = await $.session.id()
  for (const project of await $.fs.list(root).catch(() => [])) {
    if (project.kind !== 'dir') continue
    const dir = `${root}/${project.name}/${sessionId}/images`
    if (await $.fs.exists(dir).catch(() => false)) return (imagesDir = dir)
  }
  return null
}

async function listImages($: EngineInterface): Promise<Record<string, ImageInfo>> {
  const dir = await findImagesDir($)
  if (dir === null) return {}
  const found: Record<string, ImageInfo> = {}
  for (const file of await $.fs.list(dir)) {
    const number = imageNumber(file.name)
    if (number === null || file.kind !== 'file') continue
    const path = `${dir}/${file.name}`
    const key = `${path}@${file.mtimeMs}`
    if (!imageSizes.has(key)) {
      // 앞 24바이트만 십진수로($.fs.read 는 그림 전체를 옮기고 4 MiB 가 넘으면 거절한다)
      const ran = await $.process.run(['od', '-An', '-tu1', '-N', '24', path], { timeoutMs: 3000 }).catch(() => null)
      imageSizes.set(key, ran?.exitCode === 0 ? pngSize(ran.stdout.trim().split(/\s+/).map(Number)) : null)
    }
    const size = imageSizes.get(key)
    if (size) found[number] = { path, ...size }
  }
  return found
}

async function refreshSessions($: EngineInterface) {
  // 빈 세션을 걸러 낸 뒤에도 40개가 차도록 넉넉히 읽는다
  const next = (await listSessions($, 80).catch(() => [])).slice(0, 40)
  await update($, sessions, () => next)
}

// 기록 파일이 작으면 통째로 읽고, 크면 앞(작업 폴더)과 끝(제목)만 head·tail 로 읽는다($.fs.read 는 4 MiB 까지).
const SESSION_WHOLE = 320 * 1024

async function listSessions($: EngineInterface, count: number) {
  const home = await $.env.get('HOME')
  if (!home) return []
  const root = `${home}/.claude/projects`
  const folders = (await $.fs.list(root)).filter(entry => entry.kind === 'dir')
  const files = (
    await Promise.all(
      folders.map(async folder =>
        (await $.fs.list(`${root}/${folder.name}`).catch(() => []))
          .filter(entry => entry.kind === 'file' && entry.name.endsWith('.jsonl'))
          .map(entry => ({ path: `${root}/${folder.name}/${entry.name}`, id: entry.name.slice(0, -'.jsonl'.length), size: entry.size, mtimeMs: entry.mtimeMs })),
      ),
    )
  )
    .flat()
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, count)
  const entries = await Promise.all(
    files.map(async file => {
      if (file.size <= SESSION_WHOLE) {
        const text = await $.fs.read(file.path).catch(() => '')
        return sessionOf(file.id, file.mtimeMs, text, text)
      }
      const [head, tail] = await Promise.all([
        $.process.run(['head', '-c', '262144', file.path], { timeoutMs: 5000 }).catch(() => ({ stdout: '' })),
        $.process.run(['tail', '-c', '262144', file.path], { timeoutMs: 5000 }).catch(() => ({ stdout: '' })),
      ])
      return sessionOf(file.id, file.mtimeMs, head.stdout, tail.stdout)
    }),
  )
  return entries.filter(entry => entry !== null)
}

// 세션 줄을 눌렀을 때. 같은 폴더의 세션은 /resume <id> 를 실행해 지금 창에서 바로 넘어간다.
// $.command.run 은 턴이 기다리는 훅(/desk-sessions 의 command.run) 안에서는 거부되므로, 훅이 끝난 뒤
// 타이머로 실행한다. 그래도 실패하면 입력창에 채워 Enter 한 번으로 넘어가게 한다.
// 다른 폴더의 세션은 그 폴더에서 열어야 하므로 실행할 명령을 클립보드에 복사한다.
async function openSession($: EngineInterface, entry: SessionEntry) {
  const cwd = await $.session.cwd()
  if (entry.id === (await $.session.id())) return
  if (entry.cwd === cwd) {
    $.clock.after(50, () => {
      void $.command.run({ command: 'resume', args: entry.id }).catch(async () => {
        await $.prompt.fill({ text: `/resume ${entry.id}` })
        $.ui.toast(T.resumeHint(entry.title))
      })
    })
    return
  }
  const shell = `cd '${entry.cwd.replace(/'/g, "'\\''")}' && claude --resume ${entry.id}`
  const copied = await $.process.run(['wl-copy', '--', shell], { timeoutMs: 2000 }).catch(() => null)
  $.ui.toast(copied?.exitCode === 0 ? T.otherFolderCopied(shell) : T.otherFolder(shell))
}

// 엔진의 /copy 와 같은 길(클립보드 도구, 없으면 OSC 52)로 복사한다. 멀티플렉서·SSH 안에서도 된다.
async function copyText($: EngineInterface, text: string, press: UiPressArgument, what: 'code' | 'answer') {
  const copied = await $.ui.copy({ text, surface: press.surface })
  const lines = text.split('\n').length
  $.ui.toast(copied.isCopied ? T.copied(what, lines) : T.copyFailed(copied.reason))
}

async function refreshRuns($: EngineInterface) {
  const messages = await $.session.messages()
  const next = computeRuns(messages)
  await update($, runs, previous => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next))
  const list = computeTasks(messages)
  await update($, tasks, previous => (JSON.stringify(previous) === JSON.stringify(list) ? previous : list))
}

type Els = Elements['terminal']

// 에이전트 패널: 엔진 목록을 기록에 합친다. 끝난 에이전트는 목록에서 곧 빠지므로 기록이 남긴다.
async function refreshAgents($: EngineInterface) {
  const [list, now] = await Promise.all([$.agent.list(), $.clock.now()])
  await update($, agents, records => {
    const next = mergeAgents(records, list, now)
    return JSON.stringify(next) === JSON.stringify(records) ? records : next
  })
  if (Object.values(await read($, agents)).some(agent => isLive(agent.status))) startAgentClock($)
}

// 도는 에이전트가 있는 동안 1초마다 경과 시간을 다시 그리고, 2초마다 엔진 목록으로 상태를 맞춘다.
const AGENT_TICK = 1000
let agentTimer: Timer | null = null

function startAgentClock($: EngineInterface) {
  if (agentTimer !== null) return
  let count = 0
  agentTimer = $.clock.every(AGENT_TICK, () => {
    void (async () => {
      count++
      await update($, agentClock, () => count * AGENT_TICK)
      if (count % 2 === 0) await refreshAgents($)
      if (!Object.values(await read($, agents)).some(agent => isLive(agent.status))) {
        agentTimer?.cancel()
        agentTimer = null
      }
    })().catch(() => undefined)
  })
}

// 에이전트(포크된 스킬 /code-review 등 포함)는 활동이 처음 보일 때 엔진 목록을 다시 읽어 올린다.
// 목록에 없는 루프(압축·워크플로 포크)로 거듭 묻지 않도록 id 마다 한 번만. 도구 실행을 붙잡지 않게 뒤에서 한다.
const askedAgents = new Set<string>()

async function patchAgent($: EngineInterface, id: string, patch: (agent: AgentRecord) => Partial<AgentRecord>) {
  let isKnown = true
  const apply = (records: Record<string, AgentRecord>) => {
    const agent = records[id]
    isKnown = agent !== undefined
    return agent ? { ...records, [id]: { ...agent, ...patch(agent) } } : records
  }
  await update($, agents, apply)
  if (isKnown || askedAgents.has(id)) return
  askedAgents.add(id)
  void refreshAgents($)
    .then(() => update($, agents, apply))
    .catch(() => undefined)
}

// 셸·모니터 상세에 보일 출력 끝부분. 출력 파일은 끝남 알림이 알려 줘서 그 전에는 없다.
const OUTPUT_LINES = 40

async function refreshAgentDetail($: EngineInterface) {
  const id = await read($, agentView)
  if (id === null) return
  const task = (await read($, agents))[id]
  if (task?.kind === 'shell' || task?.kind === 'monitor') {
    const raw = task.outputFile ? await $.fs.read(task.outputFile).catch(() => null) : null
    const text = typeof raw === 'string' ? tailOf(raw, OUTPUT_LINES) : null
    await update($, taskOutput, () => ({ id, text }))
    return
  }
  const found = await $.session.messages({ agentId: id })
  const next = Array.isArray(found) ? agentDetailOf(id, found) : null
  await update($, agentDetail, previous => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next))
}

async function openAgents($: EngineInterface, id: string | null = null) {
  await update($, agentView, () => id)
  await refreshAgents($).catch(() => undefined)
  await refreshAgentDetail($).catch(() => undefined)
  await $.ui.open({ id: AGENTS_PANE, title: T.paneAgents, focus: true })
}

// 에이전트 대화를 메인 화면에 띄운다(엔진의 작업 목록에서 고른 것처럼). 그 뒤 Enter 는 그 에이전트에게 간다. id 가 없으면 메인 대화로.
async function viewInMain($: EngineInterface, id: string | undefined) {
  const shown = await $.ui.view(id === undefined ? {} : { agentId: id }).catch((error: unknown) => ({ deny: String(error) }))
  if (shown.deny) $.ui.toast(shown.deny)
}

// 작업 멈추기: Revert 처럼 5초 안에 두 번 눌러야 한다. 엔진의 TaskStop 도구를 부른다(셸·모니터·백그라운드 에이전트).
const STOP_ARM_MS = 5000
const GONE = /No task found/

async function stopTask($: EngineInterface, task: AgentRecord, isArmed: boolean) {
  const key = `stop:${task.id}`
  if (!isArmed) {
    await update($, open, state => ({ ...state, [key]: true }))
    $.clock.after(STOP_ARM_MS, () => void update($, open, state => ({ ...state, [key]: false })))
    return
  }
  await update($, open, state => ({ ...state, [key]: false }))
  const ran = await $.tool.call({ tool: 'TaskStop', task_id: task.id } as never).catch((error: unknown) => ({ deny: String(error) }))
  if ('deny' in ran && ran.deny !== undefined) {
    $.ui.toast(T.stopFailed(ran.deny))
    return
  }
  const now = await $.clock.now()
  // 엔진이 그런 작업이 없다고 하면 끝을 놓친 것이다. 끝남으로 두어 도는 목록에서 뺀다.
  if (ran.isError && GONE.test(ran.text ?? '')) {
    await patchAgent($, task.id, agent => ({ status: isLive(agent.status) ? 'completed' : agent.status, endedAt: agent.endedAt ?? now, activity: undefined }))
    $.ui.toast(T.alreadyEnded(task.description))
    return
  }
  if (ran.isError) {
    $.ui.toast(T.stopFailed(ran.text ?? ''))
    return
  }
  await patchAgent($, task.id, agent => ({ status: 'killed', endedAt: agent.endedAt ?? now, activity: undefined }))
  $.ui.toast(T.stopped(task.description))
}

// 아래턱 오른쪽의 "⋯ 2": 도는 백그라운드 작업(에이전트·셸·모니터) 수, 누르면 /desk-tasks 패널.
// PR 칩이 안 풀린 리뷰를 ◆ 로 쓰므로 겹치지 않는 기호를 쓴다.
function agentsChip(els: Els, $: EngineInterface, records: Record<string, AgentRecord>) {
  const live = Object.values(records).filter(agent => isLive(agent.status)).length
  if (live === 0) return null
  const { Box, Text, Button } = els
  const label = String(live)
  return {
    width: 2 + cellWidth(label),
    node: (
      <Button key="agents-chip" plain dimColor onPress={() => void openAgents($)}>
        <Text color={COLORS.clay}>⋯</Text>
        {` ${label}`}
      </Button>
    ),
  }
}

// 아래턱의 "✎ 2": 다음 프롬프트에 같이 갈 줄 댓글 수(데스크톱 입력창의 Comment 카드). 누르면 diff 패널.
function commentsChip(els: Els, $: EngineInterface, list: LineComment[]) {
  if (list.length === 0) return null
  const { Text, Button } = els
  const label = String(list.length)
  return {
    width: 2 + cellWidth(label),
    node: (
      <Button key="comments-chip" plain dimColor onPress={() => void openDiff($).catch(() => undefined)}>
        <Text color={COLORS.link}>✎</Text>
        {` ${label}`}
      </Button>
    ),
  }
}

const AGENT_STATUS_COLOR: Record<string, string> = { completed: COLORS.success, failed: COLORS.danger }

function agentFacts(agent: AgentRecord): string[] {
  return [
    modelLabel(agent.model),
    agent.tokens !== undefined ? T.agentTokens(formatTokens(agent.tokens)) : undefined,
    T.agentToolUses(agent.toolUses),
  ].filter((fact): fact is string => fact !== undefined)
}

const agentElapsed = (agent: AgentRecord, now: number) =>
  agent.startedAt === undefined ? undefined : formatElapsed((agent.endedAt ?? now) - agent.startedAt)

// 목록의 카드 한 장: 데스크톱 Background tasks 처럼 제목, 종류·시간, 모델·토큰·도구 수·하는 일·대화 보기.
const KIND_LABEL = (agent: AgentRecord) => (agent.kind === 'shell' ? T.kindShell : agent.kind === 'monitor' ? T.kindMonitor : agent.type)

// 도는 작업의 멈춤 버튼: 한 번 누르면 "멈출까요?", 5초 안에 한 번 더 누르면 멈춘다.
function stopButton(els: Els, $: EngineInterface, agent: AgentRecord, armed: Record<string, boolean>) {
  const isArmed = armed[`stop:${agent.id}`] ?? false
  return (
    <els.Button
      key={`stop-${agent.id}`}
      plain
      dimColor={!isArmed}
      label={isArmed ? T.stopConfirm : T.stop}
      onPress={() => void stopTask($, agent, isArmed).catch(() => undefined)}
    />
  )
}

// 목록의 카드 한 장: 데스크톱 Background tasks 처럼 제목, 종류·시간·상태, 그 아래 수치(에이전트) 또는 명령(셸·모니터).
function agentRow(els: Els, $: EngineInterface, agent: AgentRecord, number: number, now: number, columns: number, armed: Record<string, boolean>, inView: string | undefined) {
  const { Box, Text } = els
  const live = isLive(agent.status)
  const elapsed = agentElapsed(agent, now)
  const isAgent = agent.kind === undefined || agent.kind === 'agent'
  const open = () => void openAgents($, agent.id)
  return (
    <Box key={`agent-card-${agent.id}`} flexDirection="column" borderStyle="round" borderColor={live ? COLORS.clay : COLORS.border} paddingX={1}>
      {rowButton(els, { key: `agent-title-${agent.id}`, onPress: open }, clip(agent.description, Math.max(10, columns - 6)))}
      <Box columnGap={1}>
        <Text color={COLORS.muted}>{`${number}`}</Text>
        <Text color={COLORS.muted}>{KIND_LABEL(agent)}</Text>
        {elapsed && <Text color={COLORS.muted}>{elapsed}</Text>}
        {!live && <Text color={AGENT_STATUS_COLOR[agent.status] ?? COLORS.muted}>{T.agentStatus[agent.status] ?? agent.status}</Text>}
        {agent.id === inView && <Text color={COLORS.clay}>{`◉ ${T.agentInView}`}</Text>}
      </Box>
      <Box columnGap={2} flexWrap="wrap">
        {isAgent ? (
          <Text color={COLORS.muted}>{agentFacts(agent).join('  ')}</Text>
        ) : (
          agent.command && agent.command !== agent.description && <Text color={COLORS.muted}>{clip(agent.command.split('\n')[0] ?? '', Math.max(10, columns - 30))}</Text>
        )}
        {live && agent.activity && <Text color={COLORS.clay}>{agent.activity}</Text>}
        {rowButton(els, { key: `agent-view-${agent.id}`, onPress: open }, isAgent ? T.viewTranscript : T.viewDetails)}
        {live && stopButton(els, $, agent, armed)}
        {!live && (
          <els.Button key={`dismiss-${agent.id}`} plain dimColor label={T.taskDismiss} onPress={() => void update($, agents, records => dismissAgents(records, [agent.id]))} />
        )}
      </Box>
    </Box>
  )
}

// diff 행 묶음(가상 스크롤 없이): 대화 속 편집 행처럼 짧은 곳에 쓴다. more 가 양수면 잘린 행 수를 흐리게.
function diffLines(els: Pick<Els, 'Box' | 'Text' | 'Code'>, palette: DiffPalette, rows: DiffRow[], key: string, path: string | undefined, columns: number, more = 0) {
  const options = { path, gutter: gutterWidth(rows), columns, unmodified: T.unmodifiedLines }
  return (
    <els.Box flexDirection="column">
      {diffBlocks(rows).map((block, index) => diffBlock(els, palette, block, `${key}.${index}`, options))}
      {more > 0 && <els.Text color={COLORS.muted}>{T.moreLines(more)}</els.Text>}
    </els.Box>
  )
}

// /desk-diff 패널 몸통(테마를 알 때): 모든 것을 높이가 정해진 항목으로 편 뒤 창(ui.scroll 이 알려 준 위치) 앞뒤 한 화면만
// 실제로 그리고, 나머지 연달은 항목은 높이만 있는 빈 Box 하나로 둔다. 다 그리면 3000줄에 초 단위가 걸린다.
type DiffSection =
  | { kind: 'note'; key: string; text: string; indent?: number }
  | { kind: 'element'; key: string; node: unknown }
  | { kind: 'file'; file: FileDiff; prefix: string; canRevert: boolean; indent: number }
  | { kind: 'session'; edit: SessionEdit }

type VirtualDiff = {
  els: Els
  palette: DiffPalette
  window: { offset: number; bodyRows: number }
  columns: number
  head: unknown[]
  sections: DiffSection[]
  isFolded: (id: string) => boolean
  fileHeader: (file: FileDiff, prefix: string, canRevert: boolean, indent: number) => unknown
  sessionHeader: (edit: SessionEdit) => unknown
  notes: DiffNotes
}

// 줄 댓글을 패널에 잇는 것들: 고른 범위·단 댓글, diff 범위 이름, 번호 누름, 끼울 행 두 가지(높이 1).
type DiffNotes = {
  draft: CommentDraft | null
  comments: LineComment[]
  scopeOf: (prefix: string) => string
  onLine: (at: LinePress) => void
  draftRow: (key: string, draft: CommentDraft, lines: DiffLine[], pad: number) => unknown
  commentRow: (key: string, comment: LineComment, pad: number) => unknown
}

// 창이 아직 없을 때(막 열림) 한 화면으로 치는 행 수.
const DIFF_BODY_GUESS = 60

function virtualDiff(v: VirtualDiff) {
  const { Box, Text } = v.els
  type Item = { key: string; height: number; always?: boolean; node: () => unknown }
  const items: Item[] = []
  const tops = new Map<string, number>()
  const isOnScreen = (key: string, height: number) => {
    const at = tops.get(key) ?? 0
    return at + height > v.window.offset && at < v.window.offset + (v.window.bodyRows || DIFF_BODY_GUESS)
  }
  const spacer = (key: string) => items.push({ key, height: 1, node: () => <Box key={key} height={1} /> })
  const rowItems = ({ rows, blocks }: { rows: DiffRow[]; blocks: DiffBlock[] }, key: string, path: string, indent: number, scope: string) => {
    const options = { path, gutter: gutterWidth(rows), columns: v.columns - indent, unmodified: T.unmodifiedLines }
    // 이 패치에 단 댓글과 쓰는 중인 댓글은 범위 끝 줄 뒤에 한 행씩 끼운다: 덩어리를 그 줄에서 나눈다.
    const pad = indent + 1 + options.gutter
    const draft = v.notes.draft?.patch === key ? v.notes.draft : null
    const picked = draft ? rangeOf(rows, draft.anchor, draft.end) : null
    const after = new Map<number, Item[]>()
    const insert = (row: number, item: Item) => after.set(row, [...(after.get(row) ?? []), item])
    v.notes.comments.forEach(comment => {
      const row = comment.patch === key ? rowOf(rows, comment.end) : -1
      if (row !== -1) insert(row, { key: `cm-${comment.id}`, height: 1, node: () => v.notes.commentRow(`cm-${comment.id}`, comment, pad) })
    })
    if (draft && picked) insert(picked[1], { key: 'cm-draft', height: 1, node: () => v.notes.draftRow('cm-draft', draft, linesIn(rows, picked), pad) })
    const cuts = [...after.keys()].sort((a, b) => a - b)
    const cutBlocks =
      cuts.length === 0
        ? blocks
        : [...cuts, rows.length - 1].flatMap((cut, index) => diffBlocks(rows.slice(index === 0 ? 0 : (cuts[index - 1] ?? 0) + 1, cut + 1)))
    const pick = {
      Button: v.els.Button,
      mark: COLORS.link,
      isPicked: (row: number) => picked !== null && row >= picked[0] && row <= picked[1],
      onPress: (row: number) => {
        const at = rows[row]
        if (at?.kind === 'line') v.notes.onLine({ patch: key, path, scope, line: at.line })
      },
    }
    let row = 0
    cutBlocks.forEach((block, index) => {
      const rowKey = `${key}.${index}`
      const first = row
      row += block.kind === 'gap' ? 1 : block.lines.length
      items.push({
        key: rowKey,
        height: blockHeight(block),
        node: () => {
          const blockOptions = block.kind === 'lines' && isOnScreen(rowKey, blockHeight(block)) ? { ...options, pick: { ...pick, first } } : options
          if (indent === 0) return diffBlock(v.els, v.palette, block, rowKey, blockOptions)
          return (
            <Box key={rowKey} paddingLeft={indent}>
              {diffBlock(v.els, v.palette, block, `${rowKey}.r`, blockOptions)}
            </Box>
          )
        },
      })
      items.push(...(after.get(row - 1) ?? []))
    })
  }
  // 안내 글은 좁은 패널에서 잘리지 않게 줄바꿈한다. 높이는 폭으로 셈해 정해 둔다(세 줄까지).
  const note = (key: string, text: string, indent = 0) => {
    const height = Math.min(3, Math.max(1, Math.ceil(cellWidth(text) / Math.max(10, v.columns - indent))))
    items.push({
      key,
      height,
      node: () => (
        <Box key={key} height={height} overflow="hidden" paddingLeft={indent}>
          <Text color={COLORS.muted}>{text}</Text>
        </Box>
      ),
    })
  }

  v.head.forEach((node, index) => {
    if (index > 0) spacer(`h-gap-${index}`)
    items.push({ key: `h-${index}`, height: 1, always: true, node: () => node })
  })
  for (const section of v.sections) {
    spacer(`gap-${items.length}`)
    if (section.kind === 'note') note(`note-${section.key}`, section.text, section.indent)
    else if (section.kind === 'element') {
      items.push({
        key: `el-${section.key}`,
        height: 1,
        always: true,
        node: () => (
          <Box key={`el-${section.key}`} height={1} overflow="hidden">
            {section.node as never}
          </Box>
        ),
      })
    }
    else if (section.kind === 'file') {
      const { file, prefix, indent } = section
      const id = `${prefix}${file.path}`
      items.push({ key: `fh-${id}`, height: 1, always: true, node: () => v.fileHeader(file, prefix, section.canRevert, indent) })
      if (v.isFolded(id)) continue
      if (!file.patch) note(`bin-${id}`, T.binary, indent + 2)
      else rowItems(patchBlocks(file.patch), `d-${id}`, file.path, indent, v.notes.scopeOf(prefix))
    } else {
      const { edit } = section
      const id = `${OUTSIDE}${edit.path}`
      items.push({ key: `fh-${id}`, height: 1, always: true, node: () => v.sessionHeader(edit) })
      if (v.isFolded(id)) continue
      if (edit.patches.length === 0) note(`bin-${id}`, T.binary, 2)
      // 편집마다 따로: 서로 다른 시점의 줄 번호를 한 diff 로 잇지 않는다.
      edit.patches.forEach((patch, index) => {
        if (index > 0) note(`next-${id}-${index}`, T.nextEdit, 2)
        rowItems(patchBlocks(patch), `s-${id}-${index}`, edit.path, 0, v.notes.scopeOf(OUTSIDE))
      })
    }
  }

  // 누를 수 있는 번호 칸(줄마다 버튼)은 지금 보이는 덩어리에만: 앞뒤로 미리 그리는 두 화면까지 달면 스크롤이 35~45% 무거워진다.
  let top = 0
  for (const item of items) {
    tops.set(item.key, top)
    top += item.height
  }
  const steps = windowPlan(items, v.window.offset, v.window.bodyRows || DIFF_BODY_GUESS)
  const drawn = steps.map((step, index) => ('skip' in step ? <Box key={`skip-${index}`} height={step.skip} /> : items[step.draw]?.node()))
  return <Box flexDirection="column">{drawn as never}</Box>
}

// 호출 하나를 펼쳤을 때: 명령과 출력, 편집 diff, 새 파일 내용.
function callDetail({ Box, Text, Code }: Els, call: RunCall, columns: number) {
  const fields = fieldsOf(call.input)
  const filePath = stringField(fields, 'file_path') ?? stringField(fields, 'notebook_path')
  const output = outputText(call.output)
  switch (call.tool) {
    case 'Bash':
      return (
        <Box flexDirection="column">
          <Code source={stringField(fields, 'command') ?? ''} language="bash" wrap="wrap" />
          {output && <Text color={COLORS.muted}>{cap(output, 30)}</Text>}
        </Box>
      )
    case 'Edit':
    case 'MultiEdit': {
      const edits = call.tool === 'Edit' ? [fields] : Array.isArray(fields.edits) ? fields.edits.map(fieldsOf) : []
      const guessed = edits.map(edit => editHunk(stringField(edit, 'old_string') ?? '', stringField(edit, 'new_string') ?? ''))
      const patch = patchOf(call.output) ?? guessed.join('\n')
      if (!diffColors) return <Code source={cap(patch, 40)} path={filePath} format="diff" />
      // 데스크톱 모양 diff. 대화 안이라 안 바뀐 구간 표시는 빼고 40행까지.
      const rows = diffRows(parseHunks(patch), false)
      return diffLines({ Box, Text, Code }, diffColors, rows.slice(0, 40), `edit-${call.tool_use_id}`, filePath, columns, rows.length - 40)
    }
    case 'Write':
      return <Code source={cap(stringField(fields, 'content') ?? '', 40)} path={filePath} />
    default:
      return <Text color={COLORS.muted}>{cap(output || JSON.stringify(call.input, null, 2), 20)}</Text>
  }
}

// 백그라운드 작업이 끝났다는 알림 한 줄: "✓ Find chin in README  completed · 5s".
// 제목은 그 작업을 띄운 호출의 설명(에이전트) 또는 요약(명령), 모르면 알림 글의 첫 줄.
const TASK_MARK: Record<string, { mark: string; color: string }> = {
  completed: { mark: '✓', color: COLORS.success },
  failed: { mark: '✕', color: COLORS.danger },
  killed: { mark: '■', color: COLORS.muted },
}

function taskRow(els: Els, task: { status?: string; toolUseId?: string; durationMs?: number }, text: string, state: Runs) {
  const { Box, Text } = els
  const call = Object.values(state.calls)
    .flat()
    .find(item => item.tool_use_id === task.toolUseId)
  const fields = fieldsOf(call?.input)
  const title =
    stringField(fields, 'description') ?? (call ? summarize(call.tool, call.input) : undefined) ?? text.split('\n')[0] ?? ''
  const style = TASK_MARK[task.status ?? ''] ?? { mark: '◆', color: COLORS.clay }
  const facts = [task.status, task.durationMs !== undefined ? formatElapsed(task.durationMs) : null].filter(Boolean).join(' · ')
  return (
    <Box columnGap={1}>
      <Text color={style.color}>{style.mark}</Text>
      <Text color={COLORS.text} wrap="truncate-end">
        {title}
      </Text>
      {facts !== '' && <Text color={COLORS.muted}>{facts}</Text>}
    </Box>
  )
}

// 글을 짧은 키로(같은 메시지는 같은 키): 펼침 상태를 메시지마다 기억한다.
export function textKey(text: string): string {
  let hash = 5381
  for (let index = 0; index < text.length; index++) hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0
  return (hash >>> 0).toString(36)
}

// 에이전트가 보낸 메시지: "◆ Explore  첫 줄 미리보기 ›", 누르면 본문을 마크다운으로.
function peerRow(els: Els, $: EngineInterface, name: string, text: string, openState: Record<string, boolean>, columns: number) {
  const { Box, Text, Button } = els
  const key = `peer-${textKey(name + text)}`
  const isOpen = openState[key] ?? false
  const preview = text.split('\n').find(line => line.trim() !== '')?.trim() ?? ''
  const who = name.replace(/^@/, '')
  return (
    <Box flexDirection="column">
      <Box columnGap={1}>
        <Text color={COLORS.clay}>◆</Text>
        {rowButton(
          els,
          { key, onPress: () => toggle($, key, isOpen) },
          who,
          !isOpen && preview !== '' && <Text color={COLORS.muted}>{` ${clip(preview, Math.max(10, columns - cellWidth(who) - 6))}`}</Text>,
          <Text color={COLORS.muted}>{isOpen ? ' ⌄' : ' ›'}</Text>,
        )}
      </Box>
      {isOpen && (
        <Box marginLeft={2} paddingX={1} borderStyle="round" borderColor={COLORS.border} flexDirection="column">
          {renderMarkdown(text, els, COLORS, Math.max(20, columns - 8))}
        </Box>
      )}
    </Box>
  )
}

// 서브에이전트 카드: 데스크톱처럼 에이전트마다 한 장. 종류·설명, 끝나면 도구 수·토큰·시간·바꾼 줄.
// 설명을 누르면 결과 글을 마크다운으로 펼친다.
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${Number((count / 1_000_000).toFixed(1))}M`
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count)
}

function agentCard(els: Els, $: EngineInterface, call: RunCall, openState: Record<string, boolean>) {
  const { Box, Text, Button } = els
  const fields = fieldsOf(call.input)
  const id = call.tool_use_id
  const isOpen = openState[id] ?? false
  const summary = agentOf(call.output)
  const kind = stringField(fields, 'subagent_type') ?? summary?.type ?? 'agent'
  const title = stringField(fields, 'description') ?? stringField(fields, 'name') ?? 'Agent'
  const isBackground = summary?.status === 'async_launched'
  const facts = [
    summary?.toolUses !== undefined ? `${summary.toolUses} tool use${summary.toolUses === 1 ? '' : 's'}` : null,
    summary?.tokens !== undefined ? `${formatTokens(summary.tokens)} tokens` : null,
    summary?.durationMs !== undefined ? formatElapsed(summary.durationMs) : null,
  ].filter((fact): fact is string => fact !== null)
  const changed = (summary?.added ?? 0) + (summary?.removed ?? 0) > 0
  const body = summary?.text ?? (isOpen ? cap(stringField(fields, 'prompt') ?? '', 12) : '')

  return (
    <Box flexDirection="column" alignSelf="flex-start" borderStyle="round" borderColor={call.isRunning ? COLORS.clay : COLORS.border} paddingX={1}>
      <Box columnGap={1}>
        <Text color={COLORS.clay}>{call.isRunning ? '···' : '◆'}</Text>
        <Text color={COLORS.muted}>{kind}</Text>
        {rowButton(
          els,
          { key: `agent-${id}`, onPress: () => toggle($, id, isOpen) },
          title,
          call.isRunning && <Text color={COLORS.muted}> running</Text>,
          isBackground && <Text color={COLORS.muted}> in background</Text>,
          call.isErrored && !call.isInterrupted && <Text color={COLORS.danger}> failed</Text>,
          call.isInterrupted && <Text color={COLORS.muted}> interrupted</Text>,
          body !== '' && <Text color={COLORS.muted}>{isOpen ? ' ⌄' : ' ›'}</Text>,
        )}
      </Box>
      {(facts.length > 0 || changed) && (
        <Box columnGap={1}>
          <Text color={COLORS.muted}>{facts.join(' · ')}</Text>
          {changed && diffChips(Text, summary?.added ?? 0, summary?.removed ?? 0)}
        </Box>
      )}
      {isOpen && body !== '' && (
        <Box marginTop={1} flexDirection="column">
          {summary?.text ? renderMarkdown(cap(summary.text, 40), els, COLORS, 76) : <Text color={COLORS.muted}>{body}</Text>}
        </Box>
      )}
    </Box>
  )
}

// 계획 카드에서 접힌 채 보일 만큼: 줄 수가 넘으면 그다음 빈 줄(코드 울타리 밖)에서 자른다.
const PLAN_ROWS = 14

export function splitPlan(plan: string, rows: number): { head: string; hidden: number } {
  const lines = plan.split('\n')
  let fenced = false
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? ''
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    if (index >= rows && !fenced && line.trim() === '') {
      const hidden = lines.slice(index).filter(rest => rest.trim() !== '').length
      return hidden > 0 ? { head: lines.slice(0, index).join('\n'), hidden } : { head: plan, hidden: 0 }
    }
  }
  return { head: plan, hidden: 0 }
}

// 계획(ExitPlanMode): 데스크톱처럼 묶음에 섞지 않고 카드로. 승인 창은 엔진 것이고 이건 기록에 남는 모습.
function planCard(els: Els, $: EngineInterface, call: RunCall, openState: Record<string, boolean>, columns: number) {
  const { Box, Text } = els
  const plan = planOf(call.output)?.plan ?? ''
  const key = `plan-${call.tool_use_id}`
  const isOpen = openState[key] ?? false
  // 승인 창이 떠 있는 동안 엔진은 이 호출을 아직 시작 전으로 넘긴다(isRunning false, 결과·오류 없음).
  const isWaiting = call.isRunning || (call.output === undefined && !call.isErrored)
  const status = isWaiting
    ? { label: T.planWaiting, color: COLORS.muted }
    : call.isInterrupted
      ? { label: T.planInterrupted, color: COLORS.muted }
      : call.isErrored
        ? { label: T.planRejected, color: COLORS.danger }
        : { label: T.planApproved, color: COLORS.success }
  const width = Math.max(30, Math.min(columns - 2, 100))
  const { head, hidden } = splitPlan(plan, PLAN_ROWS)
  const empty = isWaiting ? T.planInDialog : T.planMissing
  return (
    <Box flexDirection="column" width={width} borderStyle="round" borderColor={COLORS.clay} paddingX={1}>
      <Box columnGap={1}>
        <Text color={COLORS.clay}>◇</Text>
        <Text color={COLORS.text} weight="semibold">
          Plan
        </Text>
        <Text color={status.color}>{status.label}</Text>
      </Box>
      {plan === '' ? <Text color={COLORS.muted}>{empty}</Text> : renderMarkdown(isOpen ? plan : head, els, COLORS, width - 4)}
      {hidden > 0 &&
        rowButton(els, { key, dimColor: true, onPress: () => toggle($, key) }, isOpen ? 'Show less' : `Show all · ${hidden} more lines`)}
    </Box>
  )
}

// 호출 한 줄: "Edited register.tsx +12 −3 ›", 누르면 아래로 펼친다.
function callLine(els: Els, $: EngineInterface, call: RunCall, openState: Record<string, boolean>, columns: number, indent = 0, openFirst = false) {
  if (isAgentTool(call.tool)) return agentCard(els, $, call, openState)
  if (isPlanTool(call.tool)) return planCard(els, $, call, openState, columns)
  const { Box, Text, Button } = els
  const id = call.tool_use_id
  const isOpen = openState[id] ?? openFirst
  const stat = diffStat(call)
  const answer = call.tool === 'AskUserQuestion' ? askAnswer(call.output) : null
  // 마크다운 문서를 쓰거나 고친 행, preview 도구 행: 줄 끝에 미리보기 칩.
  const doc = previewOf(call)
  // 버튼 안의 글은 칸에 맞춰 잘리지 않으니 직접 자른다(동사·칩·꺾쇠 몫을 빼고).
  const room = Math.max(12, columns - indent - cellWidth(verbOf(call.tool)) - (stat ? 16 : 0) - (doc ? cellWidth(T.previewChip) + 1 : 0) - 8)
  return (
    <Box flexDirection="column" paddingLeft={indent}>
      <Box columnGap={1}>
        {call.isRunning && <Text color={COLORS.clay}>···</Text>}
        {rowButton(
          els,
          { key: `row-${id}`, dimColor: true, onPress: () => toggle($, id, isOpen) },
          verbOf(call.tool),
          <Text color={COLORS.muted}>{` ${clip(summarize(call.tool, call.input), answer ? Math.ceil(room / 2) : room)}`}</Text>,
          stat && ' ',
          stat && diffChips(els.Text, stat.added, stat.removed),
          answer && <Text color={COLORS.text}>{` → ${clip(answer, Math.floor(room / 2))}`}</Text>,
          call.isErrored && !call.isInterrupted && <Text color={COLORS.danger}> failed</Text>,
          call.isInterrupted && <Text color={COLORS.muted}> interrupted</Text>,
          <Text color={COLORS.muted}>{isOpen ? ' ⌄' : ' ›'}</Text>,
        )}
        {doc !== null && previewChip(els, $, id, doc)}
      </Box>
      {isOpen && (
        <Box marginLeft={2} borderStyle="round" borderColor={COLORS.border} paddingX={1} flexDirection="column">
          {callDetail(els, call, columns - indent - 6)}
        </Box>
      )}
    </Box>
  )
}

// 묶음 한 줄: "Ran 2 commands, edited 3 files +54 −12 ›", 펼치면 호출마다 한 줄.
// 데스크톱처럼 성공한 편집은 펼치자마자 diff 까지 보인다.
function runLine(els: Els, $: EngineInterface, runId: string, calls: RunCall[], openState: Record<string, boolean>, columns: number) {
  // 에이전트만 모인 묶음은 접지 않고 카드를 쌓는다.
  if (calls.length > 0 && calls.every(call => isAgentTool(call.tool))) {
    return <els.Box flexDirection="column">{calls.map(call => agentCard(els, $, call, openState))}</els.Box>
  }
  const { Box, Text, Button } = els
  const key = `run-${runId}`
  const isOpen = openState[key] ?? false
  const stats = calls.map(diffStat).filter((stat): stat is { added: number; removed: number } => stat !== null)
  const added = stats.reduce((sum, stat) => sum + stat.added, 0)
  const removed = stats.reduce((sum, stat) => sum + stat.removed, 0)
  // 접힌 묶음 줄은 파일 이름을 말하지 않으니 칩에 문서 이름을 단다(둘까지). 펼치면 호출 줄마다 칩이 있다.
  const docs = isOpen ? [] : [...new Set(calls.map(previewOf).filter((path): path is string => path !== null))].slice(0, 2)
  return (
    <Box flexDirection="column">
      <Box columnGap={1}>
        {calls.some(call => call.isRunning) && <Text color={COLORS.clay}>···</Text>}
        {rowButton(
          els,
          { key, dimColor: true, onPress: () => toggle($, key) },
          describeCalls(calls),
          stats.length > 0 && ' ',
          stats.length > 0 && diffChips(els.Text, added, removed),
          <Text color={COLORS.muted}>{isOpen ? ' ⌄' : ' ›'}</Text>,
        )}
        {docs.map(path => previewChip(els, $, `${runId}-${path}`, path, `◫ ${clipStart(fileName(path), 24)}`))}
      </Box>
      {isOpen && calls.map(call => callLine(els, $, call, openState, columns, 2, isEditShown(call)))}
    </Box>
  )
}

const isEditShown = (call: RunCall) => FILE_EDITING.has(call.tool) && call.tool !== 'Write' && diffStat(call) !== null

export type RowPlan = { kind: 'hide' } | { kind: 'run'; first: string; calls: RunCall[] } | { kind: 'own' }

// 행(ToolUse 하나, 또는 엔진이 접은 ToolGroup 하나)이 맡은 호출 id 들로 무엇을 그릴지 정한다.
// 묶음 첫 호출을 가진 행이 묶음 전체를 그리고, 그 묶음의 다른 행은 비운다.
export function planRow(ids: ReadonlyArray<string>, runs: Runs): RowPlan {
  const first = ids[0] !== undefined ? runs.firstOf[ids[0]] : undefined
  if (first === undefined) return { kind: 'own' }
  if (!ids.includes(first)) return { kind: 'hide' }
  const calls = runs.calls[first] ?? []
  return calls.length > ids.length ? { kind: 'run', first, calls } : { kind: 'own' }
}

const asRunCall = (call: ToolGroupCall | (Call & { tool_use_id: string })): RunCall => ({
  tool_use_id: call.tool_use_id ?? '',
  tool: call.tool,
  input: call.input,
  isRunning: call.isRunning,
  isErrored: call.isErrored,
  isInterrupted: call.isInterrupted,
  output: call.output,
})

// 내 말풍선 위치(설정 메뉴의 bubbleSide). 왼쪽이 기본: 엔진이 말풍선 아래에 그리는 첨부 줄(└ …)이 왼쪽이라 나란해진다.
export function bubbleSide(options: Record<string, unknown>): 'left' | 'right' {
  return options.bubbleSide === 'right' ? 'right' : 'left'
}

export const register: Register = (on, options) => {
  const side = bubbleSide(options)
  const edge = side === 'right' ? 'flex-end' : 'flex-start'
  const chipMode = contextChipMode(options)
  const showPr = options.prBar !== 'off'
  // 화면 언어: 설정이 en·ko 면 그것, auto 면 세션이 시작될 때 Claude Code /config 의 language 를 따른다.
  const language = langSetting(options)
  setLang(language === 'auto' ? 'en' : language)
  registerAsk(on, options.askNotify !== 'off')
  const isPreviewAuto = options.previewAutoOpen !== 'off'

  on('session.start', async ($, e, next) => {
    if (language === 'auto') {
      const row = (await $.config.list().catch(() => [])).find(item => item.key === 'language')
      if (setLang(langFromConfig(row?.value))) $.ui.invalidate('ui.render')
    }
    // 도구를 못 걸어도(엔진이 거절) 아래 명령·언어 설정은 그대로 한다.
    await $.tool.register(previewTool(isPreviewAuto)).catch(() => undefined)
    await $.command.register({ name: 'desk-preview', description: T.cmdPreview, argumentHint: T.cmdPreviewHint })
    await $.command.register({
      name: 'desk-sessions',
      description: T.cmdSessions,
      argumentHint: T.cmdSessionsHint,
    })
    await $.command.register({
      name: 'desk-diff',
      description: T.cmdDiff,
      argumentHint: T.cmdDiffHint,
    })
    await $.command.register({
      name: 'desk-pr',
      description: T.cmdPr,
    })
    await $.command.register({
      name: 'desk-context',
      description: T.cmdContext,
    })
    await $.command.register({
      name: 'desk-tasks',
      description: T.cmdAgents,
      argumentHint: T.cmdAgentsHint,
    })
    await $.command.register({
      name: 'desk-update',
      description: T.cmdUpdate,
    })
    void refreshDiff($).catch(() => undefined)
    void refreshUsage($).catch(() => undefined)
    if (showPr) void refreshPr($, false).catch(() => undefined)
    void refreshSurface($).catch(() => undefined)
    // 테마를 바꾸면 3초 안에 말풍선·아래턱 색이 따라간다. 바뀌지 않았으면 다시 그리지 않는다.
    themeWatch?.cancel()
    themeWatch = $.clock.every(THEME_POLL, () => void refreshSurface($).catch(() => undefined))
    void refreshRuns($).catch(() => undefined)
    void refreshImages($).catch(() => undefined)
    void refreshAgents($).catch(() => undefined)
    void (async () => {
      const [TMUX, ZELLIJ, HERDR_ENV, TERM, TERM_PROGRAM, CLAUDE_CODE_FORCE_TERMINAL_IMAGES] = await Promise.all([
        $.env.get('TMUX'),
        $.env.get('ZELLIJ'),
        $.env.get('HERDR_ENV'),
        $.env.get('TERM'),
        $.env.get('TERM_PROGRAM'),
        $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES'),
      ])
      const herdr = HERDR_ENV === '1' && herdrGraphicsOn(await readHerdrConfig($))
      const env = { TMUX, ZELLIJ, HERDR_ENV, TERM, TERM_PROGRAM, CLAUDE_CODE_FORCE_TERMINAL_IMAGES }
      await update($, graphics, () => supportsGraphics(env, herdr))
    })().catch(() => undefined)
    return next(e)
  })

  // 테마를 바꿨을 수 있으니 프롬프트마다 다시 읽는다(타이머를 기다리지 않게).
  on('prompt.submit', async ($, e, next) => {
    void refreshSurface($).catch(() => undefined)
    // 사람이 어디서 입력했는지: 질문 카드가 Remote Control 세션에서 카드를 띄울지 고른다(ask.tsx)
    const origin = e.origin.kind
    if (origin === 'composer' || origin === 'bridge') await update($, promptOrigin, () => origin).catch(() => undefined)
    // 백그라운드 작업이 끝났다는 알림: 셸·모니터는 이것으로만 끝을 안다.
    if (e.origin.kind === 'task-notification') {
      const notices = parseNotices(e.text)
      if (notices.length > 0) {
        const now = await $.clock.now()
        await update($, agents, records => applyNotices(records, notices, now)).catch(() => undefined)
        const view = await read($, agentView)
        if (notices.some(notice => notice.id === view)) void refreshAgentDetail($).catch(() => undefined)
      }
    }
    // 줄 댓글은 사람이 친 프롬프트에 보이지 않는 context 로 붙여 보내고 비운다(슬래시 명령에는 붙이지 않는다).
    const notes = !e.command && (origin === 'composer' || origin === 'bridge') ? await read($, lineComments) : []
    const submitted = await next(notes.length > 0 ? { ...e, context: [...(e.context ?? []), commentContext(notes)] } : e)
    if (notes.length > 0 && !('drop' in submitted)) {
      await update($, lineComments, list => list.filter(item => !notes.some(sent => sent.id === item.id)))
      $.ui.toast(T.commentsSent(notes.length))
    }
    // 붙여 넣은 이미지가 저장된 뒤 다시 훑는다. 말풍선이 이 값을 읽어 썸네일로 다시 그려진다.
    void refreshImages($).catch(() => undefined)
    return submitted
  })

  // 대화에 메시지가 붙을 때마다 도구 묶음을 다시 계산한다. 첫 행이 이 값을 읽어 다시 그려진다.
  on('session.append', async ($, e, next) => {
    const appended = await next(e)
    if (e.agentId === undefined && (e.message.type === 'assistant' || e.message.type === 'user')) {
      void refreshRuns($).catch(() => undefined)
    }
    if (e.agentId === undefined && e.message.type !== 'assistant') {
      void refreshImages($).catch(() => undefined)
    }
    if (e.agentId !== undefined && e.agentId === (await read($, agentView))) {
      void refreshAgentDetail($).catch(() => undefined)
    }
    return appended
  })

  on('turn.start', async ($, e, next) => {
    // 서브에이전트·팀원의 턴도 온다. 메인 턴의 상태는 두고, 끝났던 에이전트가 다시 돌면(SendMessage·재개) 바로 실행 중으로.
    if (e.agentId !== undefined) {
      const id = e.agentId
      await patchAgent($, id, agent => (isLive(agent.status) ? {} : { status: 'running', endedAt: undefined, dismissed: undefined, activity: undefined })).catch(() => undefined)
      if ((await read($, agents))[id] !== undefined) startAgentClock($)
      return next(e)
    }
    await update($, pendingEdits, () => [])
    await update($, previewWritten, () => null)
    const now = await $.clock.now()
    await update($, turnStartedAt, () => now)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      const files = await read($, pendingEdits)
      const text = done.text.trim().slice(0, MAX_COPY)
      if (files.length > 0 || text !== '') {
        await update($, turnCards, cards => [...cards, { durationMs: e.durationMs, files, text }].slice(-TURN_CARDS))
      }
      await update($, pendingEdits, () => [])
      await update($, turnStartedAt, () => null)
      void refreshUsage($).catch(() => undefined)
      if (showPr) void refreshPr($, false).catch(() => undefined)
      // 이번 턴에 쓴 문서가 아직 패널에 없으면 연다.
      const doc = await read($, previewWritten)
      await update($, previewWritten, () => null)
      if (doc !== null && !(await isPreviewed($, doc).catch(() => false))) await openPreview($, doc).catch(() => undefined)
    } else {
      // 서브에이전트 한 번의 실행이 끝났다. 상태는 곧 엔진 목록으로 다시 맞춘다(다시 깨어날 수 있다).
      const now = await $.clock.now()
      const status = e.reason === 'answer' ? 'completed' : e.reason === 'aborted' ? 'killed' : 'failed'
      await patchAgent($, e.agentId, () => ({ status, endedAt: now, activity: undefined }))
      void refreshAgents($).catch(() => undefined)
    }
    return done
  })

  on('command.run', { command: 'desk-sessions' }, async ($, e) => {
    const index = Number.parseInt(e.args.trim(), 10)
    if (Number.isInteger(index) && index > 0) {
      const list = numbered(await read($, sessions), await $.session.cwd(), PER_GROUP, await $.session.id())
      const entry = list[index - 1]
      if (!entry) return { text: T.noSession(index) }
      await openSession($, entry)
      return { text: T.sessionPicked(index, entry.title) }
    }
    await refreshSessions($)
    await $.ui.open({ id: SESSIONS_PANE, title: T.paneSessions, focus: true })
    return { text: T.sessionsOpened }
  })

  // 마켓 목록을 새로 받고 desk-look 을 올린다. 플러그인이 스스로 다시 불러올 길은 없어 /reload-plugins 는 사람이 한다.
  on('command.run', { command: 'desk-update' }, async $ => {
    // 이 플러그인(desk-look@cc-desktop-mod, 마켓플레이스 저장소 이름 그대로). 명령은 고정 글자로.
    const market = await $.process.run(['claude', 'plugin', 'marketplace', 'update', 'cc-desktop-mod'], { timeoutMs: 150_000 })
    if (market.exitCode !== 0) return { text: T.updateFailed(lastLine(market.stderr || market.stdout)) }
    const ran = await $.process.run(['claude', 'plugin', 'update', 'desk-look@cc-desktop-mod', '--json'], { timeoutMs: 150_000 })
    return { text: updateMessage(ran.exitCode, ran.stdout, ran.stderr) }
  })

  on('command.run', { command: 'desk-preview' }, async ($, e) => {
    const asked = e.args.trim() || (await read($, previewFile))?.path
    if (!asked) return { text: T.previewNothing }
    const { file } = await openPreview($, asked, true)
    return { text: file.error === undefined ? T.previewOpened(fileName(file.path)) : T.previewUnreadable(file.error) }
  })

  on('tool.call', { tool: PREVIEW_TOOL }, async ($, e) => {
    const path = stringField(fieldsOf(e), 'path')
    if (!path) return { deny: 'Give path: the .md file to preview.' }
    const { file, isPlaced } = await openPreview($, path)
    if (file.error !== undefined) return { deny: `Couldn't open ${path} for preview (${file.error}).` }
    return {
      result: isPlaced
        ? `Showing ${file.path} in the preview pane.`
        : `The terminal is too narrow for the preview pane; the person can press ◫ on this row to open ${file.path}.`,
    }
  })

  on('command.run', { command: 'desk-context' }, async $ => {
    await openContext($)
    return { text: T.contextOpened }
  })

  on('command.run', { command: 'desk-diff' }, async ($, e) => {
    const name = e.args.trim()
    const scope = scopeOf(name)
    if (name !== '' && scope === null) {
      await openDiffAt($, name)
      return { text: T.diffOpenedAt(name) }
    }
    await openDiff($, scope ?? undefined)
    return { text: T.diffOpened }
  })

  on('command.run', { command: 'desk-tasks' }, async ($, e) => {
    const index = Number.parseInt(e.args.trim(), 10)
    if (Number.isInteger(index) && index > 0) {
      await refreshAgents($).catch(() => undefined)
      const { live, done } = orderAgents(await read($, agents))
      const agent = [...live, ...done][index - 1]
      if (!agent) return { text: T.noAgent(index) }
      await openAgents($, agent.id)
      return { text: T.agentPicked(index, agent.description) }
    }
    await openAgents($)
    return { text: T.agentsOpened }
  })

  // 에이전트 패널의 수치: 모델·컨텍스트 토큰(turn.step), 도구 수·하는 일(tool.call). 에이전트는 첫 턴(turn.start)에 엔진 목록으로 올린다.
  // agent.spawn 은 걸지 않는다: 디렉터리 검사가 그 훅을 권한 결정을 가져갈 수 있는 훅으로 보고 리뷰어에게 넘긴다.
  on('turn.step', async function* ($, e, next) {
    const id = e.agentId
    // 단계의 모델은 시작할 때 이미 정해져 있다. 단계를 붙잡지 않게 기다리지 않는다.
    if (id !== undefined) void patchAgent($, id, () => ({ model: e.model })).catch(() => undefined)
    const response = yield* next(e)
    const used = response.usage
    if (id !== undefined && used) {
      // 첫 단계의 모델 기록이 목록 다시 읽기와 엇갈려 빠졌으면 여기서 채운다
      await patchAgent($, id, agent => ({ tokens: stepTokens(used), model: agent.model ?? used.model }))
    }
    return response
  })

  on('command.run', { command: 'desk-pr' }, async $ => {
    await openPr($)
    const state = await read($, pr)
    return { text: T.prOpened(state?.pr ? prRef(state.pr) : null) }
  })

  on('tool.call', async ($, e, next) => {
    // 서브에이전트 안의 호출: 에이전트 패널의 도구 수와 지금 하는 일.
    const agentId = e.agentId
    const activity = activityOf(String(e.tool))
    if (agentId !== undefined) await patchAgent($, agentId, agent => ({ toolUses: agent.toolUses + 1, activity })).catch(() => undefined)
    const startedAt = await $.clock.now()
    const ran = await next(e)
    if (agentId !== undefined) await patchAgent($, agentId, agent => (agent.activity === activity ? { activity: undefined } : {})).catch(() => undefined)
    // 백그라운드로 넘어간 셸·모니터는 백그라운드 작업 패널에 올린다. 모델이 멈춘 작업은 멈춤으로.
    if (!ran.isError && ran.result !== undefined) {
      const task = backgroundTaskOf(String(e.tool), fieldsOf(e), ran.result, startedAt)
      if (task) {
        await update($, agents, records => ({ ...records, [task.id]: task })).catch(() => undefined)
        startAgentClock($)
      }
      const stopped = String(e.tool) === 'TaskStop' || String(e.tool) === 'KillShell' ? stringField(fieldsOf(ran.result), 'task_id') ?? stringField(fieldsOf(ran.result), 'shell_id') : undefined
      if (stopped) await patchAgent($, stopped, agent => ({ status: 'killed', endedAt: agent.endedAt ?? startedAt, activity: undefined })).catch(() => undefined)
    }
    // 턴 끝 카드용: 성공한 편집만 파일별 +/− 로 모은다
    const tool = String(e.tool)
    if (FILE_EDITING.has(tool) && !ran.isError) {
      const fields = fieldsOf(e)
      const path = stringField(fields, 'file_path') ?? stringField(fields, 'notebook_path')
      const stat = diffStat({ tool, input: e, isRunning: false, isErrored: false, isInterrupted: false, output: ran.result })
      if (path && stat) {
        await update($, pendingEdits, list => mergeEdit(list, { path, ...stat }))
      }
      // 마크다운 문서: 보고 있는 것이면 바로 다시 읽고, 메인 대화가 새로 쓴 것은 턴 끝에 열 후보로 둔다.
      if (isMarkdown(path)) {
        if (await isPreviewed($, path).catch(() => false)) await loadPreview($, path).catch(() => undefined)
        else if (tool === 'Write' && isPreviewAuto && !isPrivate(path) && e.agentId === undefined) await update($, previewWritten, () => path)
      }
    }
    // 도구 결과를 git 실행 시간만큼 붙잡지 않도록 기다리지 않는다. 실패는 패널이 비어 보일 뿐이다.
    if (EDITING_TOOLS.has(String(e.tool))) {
      void refreshDiff($).catch(() => undefined)
    }
    return ran
  })

  // 사용자 프롬프트: 오른쪽 정렬 말풍선. omarchy 테마를 읽었으면 데스크톱처럼 회색 면, 아니면 둥근 테두리.
  // [Image #N] 은 데스크톱처럼 말풍선 위 썸네일로 바꾼다(kitty 그래픽 프로토콜, 안 되는 터미널은 alt 글자).
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    // 백그라운드 작업 알림과 에이전트가 보낸 메시지: 데스크톱처럼 그 자리에서 펼치는 줄. ctrl+o 화면은 엔진 그대로.
    if (e.surface === 'terminal' && !e.props.isExpanded && (e.props.from || e.props.task)) {
      const els = $.ui.resolve(e)
      const [openState, state] = await Promise.all([read($, open), read($, runs)])
      if (e.props.task) return taskRow(els, e.props.task, e.props.text, state)
      return peerRow(els, $, e.props.from?.name ?? 'agent', e.props.text, openState, e.viewport?.columns ?? 80)
    }
    if (e.surface !== 'terminal' || e.props.origin.kind !== 'composer') {
      return next(e)
    }
    const { Box, Text, Image } = $.ui.resolve(e)
    const [face, known, canDraw] = await Promise.all([read($, surface), read($, images), read($, graphics)])
    const columns = e.viewport?.columns ?? 80
    const attached = [...e.props.text.matchAll(IMAGE_TOKEN)]
      .map(match => ({ number: match[1] ?? '', info: known[match[1] ?? ''] }))
      .filter((image): image is { number: string; info: ImageInfo } => canDraw && image.info !== undefined)
    const shown = new Set(attached.map(image => image.number))
    // 그림을 못 그리는 터미널에서는 [Image #N] 을 지운다. 엔진이 말풍선 아래 └ [Image #N] 줄로 이미 알려 준다.
    const text = e.props.text
      .replace(IMAGE_TOKEN, (token, number: string) => (shown.has(number) || !canDraw ? '' : token))
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/^\s*\n|\n\s*$/g, '')
      .trim()
    const longest = Math.max(0, ...text.split('\n').map(cellWidth))
    const width = Math.max(8, Math.min(longest + 4, Math.floor(columns * 0.85)))
    const thumbColumns = Math.min(36, Math.floor(columns * 0.4))

    return (
      <Box flexDirection="column" alignItems={edge} marginTop={1} rowGap={attached.length > 0 && text ? 1 : 0}>
        {attached.length > 0 && (
          <Box flexDirection="row" columnGap={1} flexWrap="wrap" justifyContent={edge}>
            {attached.map(image => (
              <Image
                key={`image-${image.number}`}
                source={{ file: image.info.path, format: 'png' }}
                alt={`[Image #${image.number}]`}
                {...thumbnailSize(image.info, thumbColumns)}
              />
            ))}
          </Box>
        )}
        {text !== '' &&
          (face ? (
            bubbleLines(Box, Text, canDraw ? Image : null, wrapText(text, Math.floor(columns * 0.85) - 6), face.bubble)
          ) : (
            <Box width={width} borderStyle="round" borderColor={COLORS.border} paddingX={1}>
              <Text color={COLORS.text}>{text}</Text>
            </Box>
          ))}
      </Box>
    )
  })

  // 어시스턴트 답변: 서명·불릿 없이 데스크톱 산문 스타일 마크다운.
  // 도구 호출 사이 글의 요약(isSummary)도 데스크톱처럼 불릿 없이 같은 모양으로 그린다.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') {
      return next(e)
    }
    const els = $.ui.resolve(e)
    const face = await read($, surface)
    const columns = (e.viewport?.columns ?? 80) - 2

    return (
      <els.Box flexDirection="column" marginTop={e.props.isFirstOfReply ? 1 : 0}>
        {renderMarkdown(e.props.text, els, { ...COLORS, ...(face ? { codeBg: face.bubble } : {}) }, columns, { onCopy: (source, press) => void copyText($, source, press, 'code') })}
      </els.Box>
    )
  })

  // 도구 호출 행. 묶음의 첫 행이 묶음 전체 한 줄을 그리고, 나머지 행은 비운다.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal') {
      return next(e)
    }
    const els = $.ui.resolve(e)
    const [state, openState] = await Promise.all([read($, runs), read($, open)])
    const plan = planRow([e.props.tool_use_id], state)
    if (plan.kind === 'hide') return <els.Box display="none" />
    if (plan.kind === 'run') return runLine(els, $, plan.first, plan.calls, openState, e.viewport?.columns ?? 80)
    const own = asRunCall(e.props)
    // 계획은 엔진이 준 결과에 계획 글이 없을 수 있어(결과 글만 남은 기록) 저장해 둔 요약을 먼저 쓴다.
    // 승인 직후엔 저장한 결과가 먼저 오고 이 행의 props 는 아직 실행 중일 수 있어, 상태도 저장한 쪽을 따른다.
    const saved = isPlanTool(own.tool) ? state.calls[state.firstOf[own.tool_use_id] ?? '']?.find(item => item.tool_use_id === own.tool_use_id) : undefined
    const call =
      saved && planOf(saved.output)
        ? { ...own, output: saved.output, isRunning: false, isErrored: own.isErrored || saved.isErrored, isInterrupted: own.isInterrupted || saved.isInterrupted }
        : own
    return callLine(els, $, call, openState, e.viewport?.columns ?? 80)
  })

  // 데스크톱은 결과를 따로 그리지 않는다. 펼친 행 안에서 보여 준다.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'terminal') {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })

  // 엔진이 접은 읽기·검색 묶음. 더 큰 묶음의 일부면 그 묶음 규칙을 따른다.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.surface !== 'terminal') {
      return next(e)
    }
    const els = $.ui.resolve(e)
    const [state, openState] = await Promise.all([read($, runs), read($, open)])
    const ids = e.props.calls.map(call => call.tool_use_id).filter((id): id is string => id !== undefined)
    const plan = planRow(ids, state)
    if (plan.kind === 'hide') return <els.Box display="none" />
    if (plan.kind === 'run') return runLine(els, $, plan.first, plan.calls, openState, e.viewport?.columns ?? 80)
    return runLine(els, $, e.requestId, e.props.calls.map(asRunCall), openState, e.viewport?.columns ?? 80)
  })

  // 진행 표시: 데스크톱의 "··· Running… 2m 29s". 클레이색 점 셋이 돌고, 경과 시간은 흐리게.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Text } = $.ui.resolve(e)
    const [now, startedAt] = await Promise.all([$.clock.now(), read($, turnStartedAt), read($, tick)])
    if (now - spinnerSeen > 2 * SPINNER_TICK + 1000) spinnerFallbackStart = now
    spinnerSeen = now
    if (ticker === null) {
      ticker = $.clock.every(SPINNER_TICK, () => {
        void (async () => {
          const at = await $.clock.now()
          if (at - spinnerSeen > 2000) {
            ticker?.cancel()
            ticker = null
            return
          }
          await update($, tick, () => at)
        })()
      })
    }
    const elapsed = now - (startedAt ?? spinnerFallbackStart)
    return (
      <Text>
        <Text color={COLORS.clay}>{spinnerDots(now)}</Text>
        <Text color={COLORS.text}>{` ${spinnerWord(e.props.mode, e.props.message)}${e.props.suffix}`}</Text>
        <Text color={COLORS.muted}>{`  ${formatElapsed(elapsed)}`}</Text>
      </Text>
    )
  })

  // 모드 라벨(focus, memory paused …): 흐린 글자 대신 데스크톱 입력창의 알약 칩으로.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.modes.length === 0) return next(e)
    const face = await read($, surface)
    if (!face) return next(e)
    const { Text } = $.ui.resolve(e)
    return (
      <Text>
        {e.props.modes.map((mode, index) => (
          <Text>
            {index > 0 ? ' ' : ''}
            <Text color={face.bubble}>{EDGES.single[0]}</Text>
            <Text color={COLORS.muted} backgroundColor={face.bubble}>
              {mode}
            </Text>
            <Text color={face.bubble}>{EDGES.single[1]}</Text>
          </Text>
        ))}
      </Text>
    )
  })

  // 명령 출력: 표·제목·코드·인용이 든 출력만 답변처럼 마크다운으로. 나머지(엔진 명령의 평문)는 그대로.
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isErrored || !looksLikeMarkdown(e.props.text)) return next(e)
    const els = $.ui.resolve(e)
    const face = await read($, surface)
    return renderMarkdown(e.props.text, els, { ...COLORS, ...(face ? { codeBg: face.bubble } : {}) }, (e.viewport?.columns ?? 80) - 4)
  })

  // 힌트 줄: 질문 카드가 떠 있으면 답하는 키를 엔진 줄 끝에 덧붙인다.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isDraft) return next(e)
    const state = await read($, asking)
    const question = state?.questions[state.step]
    if (!question) return next(e)
    return next({ ...e, props: { ...e.props, tail: askHint(question) } })
  })

  // 입력창 위: 할 일 카드, 질문 카드, "저장소  브랜치  +63 −29" 아래턱. 다른 플러그인의 밴드는 위에 그대로 둔다.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) {
      return next(e)
    }
    const below = await next(e)
    const [info, list] = await Promise.all([read($, repo), read($, tasks)])
    const els = $.ui.resolve(e)
    const plan = taskCard(els, list, e.props.bodyColumns, Math.min(TASK_ROWS, e.props.maxRows - 6))
    const asked = await askCard($, els, e.props.bodyColumns, e.props.maxRows)
    const meter = contextMeter(els, $, await read($, usage), chipMode)
    const prState = showPr ? prChip(els, $, await read($, pr)) : null
    const agentState = agentsChip(els, $, await read($, agents))
    const notesState = commentsChip(els, $, await read($, lineComments))
    const extras = [notesState, agentState, prState, meter].filter((chip): chip is NonNullable<typeof chip> => chip !== null)
    const reserve = extras.reduce((sum, chip) => sum + chip.width + 1, 0)
    const repoChin = info === null ? null : await chinBand($, els, info, e.props.bodyColumns - reserve)
    // PR·컨텍스트 칩은 아래턱 알약 오른쪽 바깥에(버튼에는 색을 줄 수 없어 알약 안에 넣지 않는다).
    const chin =
      extras.length === 0 ? repoChin : (
        <els.Box columnGap={1} paddingX={repoChin === null ? 1 : 0}>
          {repoChin}
          {extras.map(chip => chip.node) as never}
        </els.Box>
      )
    // 질문 중에는 질문이 띠를 차지한다(엔진 설문처럼): 다른 밴드·할 일 카드는 숨기고, 남는 줄이 있을 때만 아래턱.
    if (asked) {
      return (
        <els.Box flexDirection="column">
          {asked.card}
          {asked.rows < e.props.maxRows ? chin : null}
        </els.Box>
      )
    }
    if (plan === null && chin === null) return below
    return (
      <els.Box flexDirection="column">
        {below}
        {plan}
        {chin}
      </els.Box>
    )
  })

  // 턴 끝 카드: 데스크톱의 "Edited N files +51 −37" 상자. 편집이 없던 턴은 원래 줄만 둔다.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const line = await next(e)
    if (e.surface !== 'terminal') return line
    const card = cardFor(await read($, turnCards), e.props.durationMs)
    if (!card) return line
    const { Box, Text, Button } = $.ui.resolve(e)
    const answer = card.text ?? ''
    // 데스크톱 답변 아래의 복사 버튼: 턴 끝 줄과 나란히, 오른쪽 끝에 흐리게. 그 줄이 위에 빈 줄을
    // 두면(paneline 등) 버튼은 그 빈 줄, 곧 답변 바로 아래에 놓인다. 줄은 늘지 않는다.
    const head = (
      <Box columnGap={2}>
        {line}
        {answer !== '' && (
          <Button
            key={`copy-turn-${card.durationMs}`}
            plain
            dimColor
            label="⧉ copy"
            onPress={press => void copyText($, answer, press, 'answer')}
          />
        )}
      </Box>
    )
    if (card.files.length === 0) return head
    const key = `card-${card.durationMs}`
    const isOpen = (await read($, open))[key] ?? false
    const added = card.files.reduce((sum, file) => sum + file.added, 0)
    const removed = card.files.reduce((sum, file) => sum + file.removed, 0)
    const shown = isOpen ? card.files : card.files.slice(0, CARD_ROWS)
    const hidden = card.files.length - shown.length
    const width = Math.max(30, Math.min((e.viewport?.columns ?? 80) - 4, 72))
    const name = (path: string) => path.split('/').pop() ?? path
    const els = $.ui.resolve(e)
    // 파일 줄은 누르면 diff 패널의 그 파일로. 이름을 채워 칩을 오른쪽 끝에 맞춘다(테두리·여백 4칸).
    // 마크다운 문서 줄은 끝에 ◫(미리보기)를 더 둔다. 그 두 칸은 모든 줄이 비워 둬서 칩 열이 맞는다.
    const docSlot = card.files.some(file => isMarkdown(file.path)) ? 2 : 0
    const fileRow = (file: TurnEdit) => {
      const chips = ` +${file.added}  −${file.removed} `
      const room = Math.max(8, width - 4 - cellWidth(chips) - docSlot)
      const label = clipStart(name(file.path), room)
      const row = rowButton(
        els,
        { key: `diffat-${card.durationMs}-${file.path}`, onPress: () => void openDiffAt($, file.path).catch(() => undefined) },
        label + ' '.repeat(Math.max(0, room - cellWidth(label))),
        diffChips(Text, file.added, file.removed),
      )
      if (docSlot === 0) return row
      return (
        <Box columnGap={1}>
          {row}
          {isMarkdown(file.path) ? previewChip(els, $, `card-${card.durationMs}-${file.path}`, file.path, '◫') : <Text> </Text>}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {head}
        <Box flexDirection="column" width={width} borderStyle="round" borderColor={COLORS.border} paddingX={1}>
          <Box justifyContent="space-between">
            <Text color={COLORS.text} weight="semibold">
              {`Edited ${card.files.length} file${card.files.length === 1 ? '' : 's'}`}
            </Text>
            {diffChips(Text, added, removed)}
          </Box>
          {shown.map(fileRow)}
          {(hidden > 0 || isOpen) && card.files.length > CARD_ROWS && (
            <Button
              key={key}
              plain
              dimColor
              label={isOpen ? 'Show less' : `Show ${hidden} more`}
              onPress={() => toggle($, key)}
            />
          )}
        </Box>
      </Box>
    )
  })

  // 세션 패널: 프로젝트별로 묶은 최근 세션. 현재 세션은 클레이색 ●.
  on('ui.render', { component: 'Pane', requestId: SESSIONS_PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Input } = els
    const [list, query, cwd, current, now, home] = await Promise.all([
      read($, sessions),
      read($, sessionQuery),
      $.session.cwd(),
      $.session.id(),
      $.clock.now(),
      $.env.get('HOME'),
    ])
    const room = Math.max(16, e.props.bodyColumns - 12)
    const label = (path: string) => (home && path.startsWith(home) ? `~${path.slice(home.length)}` : path)
    // 번호는 거르기 전 목록 기준이라 /desk-sessions <번호> 와 늘 맞는다.
    const order = numbered(list, cwd, PER_GROUP, current).map(entry => entry.id)
    const shown = filterSessions(list, query)

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box columnGap={1}>
          <Text color={COLORS.text} weight="semibold">
            {T.recentSessions(list.length)}
          </Text>
          <Button key="sessions-refresh" plain dimColor label="↻" onPress={() => refreshSessions($)} />
        </Box>
        <Input
          key="sessions-search"
          label={T.search}
          placeholder={T.searchPlaceholder}
          value={query}
          submitLabel={T.openFirst}
          autoFocus
          onInput={value => void update($, sessionQuery, () => value)}
          onSubmit={value => {
            const first = filterSessions(list, value).find(entry => entry.id !== current)
            if (first) void openSession($, first)
          }}
        />
        {query.trim() !== '' && shown.length === 0 && <Text color={COLORS.muted}>{T.noMatch}</Text>}
        {groupSessions(shown, cwd).map(group => (
          <Box key={`group-${group.cwd}`} flexDirection="column">
            <Text color={group.cwd === cwd ? COLORS.clay : COLORS.muted} weight="semibold" wrap="truncate-start">
              {label(group.cwd)}
            </Text>
            {group.sessions.slice(0, PER_GROUP).map(entry => (
              <Box key={`session-${entry.id}`} columnGap={1}>
                <Text color={entry.id === current ? COLORS.clay : COLORS.muted}>
                  {entry.id === current ? ' ●' : String(order.indexOf(entry.id) + 1).padStart(2)}
                </Text>
                {rowButton(
                  els,
                  { key: `open-${entry.id}`, dimColor: entry.id !== current, onPress: () => openSession($, entry) },
                  clip(entry.title, room),
                  <Text color={COLORS.muted}>{` ${ago(entry.updatedAt, now)}`}</Text>,
                )}
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    )
  })

  // 에이전트 패널: 목록(실행 중·끝남)과, 한 에이전트를 누르면 그 대화(지시·답변·도구 묶음).
  on('ui.render', { component: 'Pane', requestId: AGENTS_PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const [records, view, detail, openState, now, output] = await Promise.all([
      read($, agents),
      read($, agentView),
      read($, agentDetail),
      read($, open),
      $.clock.now(),
      read($, taskOutput),
      read($, agentClock),
    ])
    const columns = Math.max(24, e.props.bodyColumns)
    // 메인 화면에 떠 있는 에이전트(엔진 작업 목록이나 '메인 화면에서 보기'로 연 것). 바뀌면 이 훅이 다시 돈다.
    const inView = e.props.view?.agentId

    const agent = view === null ? undefined : records[view]
    const back = rowButton(els, { key: 'agent-back', dimColor: true, onPress: () => void openAgents($) }, `‹ ${T.agentBack}`)
    // 셸·모니터 상세: 데스크톱·엔진의 Shell details 처럼 상태, 실행 시간, 명령, 요약, 출력 끝부분.
    if (agent && (agent.kind === 'shell' || agent.kind === 'monitor')) {
      const live = isLive(agent.status)
      const shownOutput = output?.id === agent.id ? output.text : null
      const field = (label: string, value: unknown) => (
        <Box columnGap={1}>
          <Text color={COLORS.muted}>{label}</Text>
          {value as never}
        </Box>
      )
      return (
        <Box flexDirection="column" rowGap={1}>
          <Box columnGap={1}>
            {back}
            <Text color={COLORS.text} weight="semibold" wrap="truncate-end">
              {agent.description}
            </Text>
          </Box>
          <Box flexDirection="column">
            {field(T.taskStatus, <Text color={live ? COLORS.clay : AGENT_STATUS_COLOR[agent.status] ?? COLORS.muted}>{T.agentStatus[agent.status] ?? agent.status}</Text>)}
            {field(T.taskRuntime, <Text color={COLORS.text}>{agentElapsed(agent, now) ?? '—'}</Text>)}
            {field(T.taskKind, <Text color={COLORS.text}>{KIND_LABEL(agent)}</Text>)}
            {agent.summary && field(T.taskSummary, <Text color={COLORS.text}>{agent.summary}</Text>)}
          </Box>
          {agent.command && <els.Code source={agent.command} language="bash" wrap="wrap" />}
          <Box flexDirection="column">
            <Text color={COLORS.muted}>{T.taskOutput}</Text>
            <Text color={shownOutput ? COLORS.text : COLORS.muted}>{shownOutput ?? (live ? T.outputWhenDone : T.noOutput)}</Text>
          </Box>
          {live && stopButton(els, $, agent, openState)}
        </Box>
      )
    }
    if (view !== null) {
      const shown = detail?.id === view ? detail : null
      const live = agent ? isLive(agent.status) : false
      const facts = agent
        ? [agent.tokens !== undefined ? T.agentTokens(formatTokens(agent.tokens)) : undefined, T.agentToolUses(agent.toolUses), agentElapsed(agent, now)].filter(Boolean).join(' · ')
        : ''
      return (
        <Box flexDirection="column" rowGap={1}>
          <Box columnGap={1}>
            {back}
            <Text color={COLORS.text} weight="semibold" wrap="truncate-end">
              {agent?.description ?? view}
            </Text>
            {view === inView
              ? rowButton(els, { key: 'agent-main-back', onPress: () => void viewInMain($, undefined) }, `‹ ${T.backToMain}`)
              : rowButton(els, { key: `agent-main-${view}`, onPress: () => void viewInMain($, view) }, T.viewInMain)}
            {agent && live && stopButton(els, $, agent, openState)}
          </Box>
          {agent && (
            <Box columnGap={1} flexWrap="wrap">
              <Text color={COLORS.muted}>{T.agentModel}</Text>
              <Text color={COLORS.text}>{modelLabel(agent.model) ?? agent.type}</Text>
              <Text color={live ? COLORS.clay : AGENT_STATUS_COLOR[agent.status] ?? COLORS.muted}>{T.agentStatus[agent.status] ?? agent.status}</Text>
              {facts !== '' && <Text color={COLORS.muted}>{facts}</Text>}
            </Box>
          )}
          {view === inView ? (
            <Text color={COLORS.muted}>{T.agentShownInMain}</Text>
          ) : shown === null ? (
            <Text color={COLORS.muted}>{T.agentGone}</Text>
          ) : (
            <Box flexDirection="column" rowGap={1}>
              {shown.prompt !== '' && (
                <Box flexDirection="column" borderStyle="round" borderColor={COLORS.border} paddingX={1}>
                  {renderMarkdown(shown.prompt, els, COLORS, columns - 4)}
                </Box>
              )}
              {shown.items.length === 0 && <Text color={COLORS.muted}>{T.agentNoItems}</Text>}
              {shown.items.map((item, index) => (
                <Box key={`agent-item-${index}`} flexDirection="column">
                  {item.kind === 'run'
                    ? runLine(els, $, item.id, item.calls, openState, columns)
                    : item.kind === 'user'
                      ? (
                          <Box flexDirection="column" borderStyle="round" borderColor={COLORS.border} paddingX={1}>
                            {renderMarkdown(item.text, els, COLORS, columns - 4)}
                          </Box>
                        )
                      : renderMarkdown(item.text, els, COLORS, columns)}
                </Box>
              ))}
              {live && agent?.activity && <Text color={COLORS.clay}>{`${spinnerDots(now)} ${agent.activity}`}</Text>}
            </Box>
          )}
        </Box>
      )
    }

    const { live, done } = orderAgents(records)
    const doneFolded = openState[DONE_FOLDED] ?? false
    return (
      <Box flexDirection="column" rowGap={1}>
        {live.length === 0 && done.length === 0 && <Text color={COLORS.muted}>{Object.keys(records).length > 0 ? T.tasksAllCleared : T.noAgents}</Text>}
        {live.length > 0 && (
          <Box flexDirection="column">
            <Text color={COLORS.muted}>{T.agentsRunning}</Text>
            {live.map((item, index) => agentRow(els, $, item, index + 1, now, columns, openState, inView))}
          </Box>
        )}
        {done.length > 0 && (
          <Box flexDirection="column">
            {/* 끝남 머리글: z 로 접고 펴고, c 로 끝난 작업을 목록에서 모두 뺀다(패널에 포커스가 있을 때). */}
            <Box columnGap={2}>
              {rowButton(
                els,
                { key: 'tasks-done-fold', dimColor: true, hotkey: 'z', onPress: () => toggle($, DONE_FOLDED, doneFolded) },
                `${T.agentsDone} ${done.length}`,
                <Text color={COLORS.muted}>{doneFolded ? ' ›' : ' ⌄'}</Text>,
              )}
              <els.Button key="tasks-clear-done" plain dimColor hotkey="c" label={T.tasksClearDone} onPress={() => void update($, agents, records => dismissAgents(records))} />
            </Box>
            {!doneFolded && done.map((item, index) => agentRow(els, $, item, live.length + index + 1, now, columns, openState, inView))}
          </Box>
        )}
      </Box>
    )
  })

  // 컨텍스트 패널: /context 의 항목별 내역을 막대로, 그 아래 사용 한도와 비용.
  // 미리보기 패널: 머리에 문서 이름·폴더와 r(다시 읽기)·d(변경 보기), 본문은 대화 답변과 같은 렌더러의 문서 모드.
  // 데스크톱 앱은 제 마크다운이 이미 데스크톱 모양이라 엔진 Markdown 으로 둔다.
  on('ui.render', { component: 'Pane', requestId: PREVIEW_PANE }, async ($, e) => {
    const file = await read($, previewFile)
    if (e.surface !== 'terminal') {
      const { Box, Text, Markdown } = $.ui.resolve(e)
      if (file === null) return <Text dimColor>{T.previewNothing}</Text>
      return (
        <Box flexDirection="column">
          <Text dimColor>{file.path}</Text>
          {file.error !== undefined ? <Text>{T.previewUnreadable(file.error)}</Text> : <Markdown text={file.text.slice(0, PREVIEW_ROOM)} />}
        </Box>
      )
    }
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    if (file === null) return <Text color={COLORS.muted}>{T.previewNothing}</Text>
    const face = await read($, surface)
    const columns = (e.props as { bodyColumns?: number }).bodyColumns ?? e.viewport?.columns ?? 80
    const isCut = file.text.length > PREVIEW_ROOM
    const folder = file.path.slice(0, Math.max(0, file.path.length - fileName(file.path).length - 1))
    return (
      <Box flexDirection="column">
        <Box columnGap={2}>
          <Box flexShrink={0}>
            <Text color={COLORS.text} weight="semibold">
              {fileName(file.path)}
            </Text>
          </Box>
          {/* 좁으면 폴더만 앞쪽부터 줄인다. 이름과 단축키는 늘 보인다. */}
          <Box flexGrow={1} flexShrink={1}>
            <Text color={COLORS.muted} wrap="truncate-start">
              {folder}
            </Text>
          </Box>
          <Box columnGap={2} flexShrink={0}>
            <Button key="preview-reload" plain dimColor hotkey="r" label={T.previewReload} onPress={() => void loadPreview($, file.path).catch(() => undefined)} />
            <Button key="preview-changes" plain dimColor hotkey="d" label={T.previewChanges} onPress={() => void openDiffAt($, file.path).catch(() => undefined)} />
          </Box>
        </Box>
        <Text color={COLORS.border}>{'─'.repeat(Math.max(4, columns - 1))}</Text>
        <Box marginTop={1} flexDirection="column">
          {file.error !== undefined ? (
            <Text color={COLORS.danger}>{T.previewUnreadable(file.error)}</Text>
          ) : (
            renderMarkdown(isCut ? file.text.slice(0, PREVIEW_ROOM) : file.text, els, { ...COLORS, ...(face ? { codeBg: face.bubble } : {}) }, columns - 1, {
              document: true,
              onCopy: (source, press) => void copyText($, source, press, 'code'),
            })
          )}
        </Box>
        {isCut && (
          <Box marginTop={1}>
            <Text color={COLORS.muted}>{T.previewCut(PREVIEW_ROOM.toLocaleString('en-US'))}</Text>
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: CONTEXT_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const [live, detail] = await Promise.all([read($, usage), read($, usageBreakdown)])
    const percent = live?.percent ?? null
    const width = Math.max(10, Math.min((e.viewport?.columns ?? 60) - 6, 40))
    const nameWidth = Math.max(0, ...(detail?.categories ?? []).map(category => cellWidth(category.name)))
    const used = detail?.categories.filter(category => category.kind !== 'free') ?? []
    const free = detail?.categories.find(category => category.kind === 'free')

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box columnGap={1}>
          <Text color={COLORS.text} weight="semibold">
            {T.contextTitle}
          </Text>
          {percent !== null && <Text color={COLORS[meterLevel(percent)]}>{`${ring(percent)} ${percent}%`}</Text>}
          <Button key="context-refresh" plain dimColor label="↻" onPress={() => void refreshBreakdown($).catch(() => undefined)} />
        </Box>
        {percent === null ? (
          <Text color={COLORS.muted}>{T.noUsage}</Text>
        ) : (
          <Box flexDirection="column">
            <Text color={COLORS[meterLevel(percent)]}>{meterBar(percent, width)}</Text>
            <Text color={COLORS.muted}>
              {[
                live?.tokens != null ? T.tokensOf(formatTokens(live.tokens), formatTokens(live.window)) : T.windowTokens(formatTokens(live?.window ?? 0)),
                detail?.compactAt != null ? T.autoCompact(formatTokens(detail.compactAt)) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </Box>
        )}
        {detail && (
          <Box flexDirection="column">
            <Text color={COLORS.muted}>{T.breakdown(detail.model)}</Text>
            {[...used, ...(free ? [free] : [])].map(category => (
              <Box key={`cat-${category.name}`} columnGap={1}>
                <Text color={(category.kind === 'free' ? COLORS.muted : category.color) as never}>{category.kind === 'free' ? '□' : '■'}</Text>
                <Text color={category.kind === 'free' ? COLORS.muted : COLORS.text}>{category.name + ' '.repeat(Math.max(0, nameWidth - cellWidth(category.name)))}</Text>
                <Text color={COLORS.muted}>{formatTokens(category.tokens).padStart(6)}</Text>
                <Text color={COLORS.muted}>{`${detail.max > 0 ? Math.round((category.tokens / detail.max) * 100) : 0}%`.padStart(4)}</Text>
              </Box>
            ))}
          </Box>
        )}
        {live && live.limits.length > 0 && (
          <Box flexDirection="column">
            <Text color={COLORS.muted}>{T.limits}</Text>
            {live.limits.map(limit => {
              const left = resetIn(limit.resetsAt, live.at)
              const name = limitName(limit.kind)
              const limitWidth = Math.max(...live.limits.map(item => cellWidth(limitName(item.kind))))
              return (
                <Box key={`limit-${limit.kind}`} columnGap={1}>
                  <Text color={COLORS.text}>{name + ' '.repeat(Math.max(0, limitWidth - cellWidth(name)))}</Text>
                  <Text color={COLORS[meterLevel(limit.percentUsed)]}>{meterBar(limit.percentUsed, 10)}</Text>
                  <Text color={COLORS.text}>{`${limit.percentUsed}%`.padStart(4)}</Text>
                  {left && <Text color={COLORS.muted}>{T.resetsIn(left)}</Text>}
                </Box>
              )
            })}
          </Box>
        )}
        {live?.costUsd != null && <Text color={COLORS.muted}>{T.sessionCost(live.costUsd.toFixed(2))}</Text>}
      </Box>
    )
  })

  // diff 패널 창이 움직이면(휠·스크롤 키·openDiffAt 의 스크롤) 위치를 적어 그 앞뒤만 다시 그린다.
  // 그려 둔 범위는 창 앞뒤로 한 화면씩 남으므로, 적어 둔 위치에서 반 화면 안쪽으로 움직이는 동안은 다시 그리지 않는다
  // (휠 대부분은 엔진이 창만 옮긴다). 다시 그리기는 기다리지 않는다: 옮긴 창은 이미 그려 둔 줄 위에 있다.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)
    if (moved.deny === undefined) {
      void update($, diffWindow, w =>
        w.bodyRows === e.bodyRows && Math.abs(w.offset - e.offset) * 2 <= e.bodyRows ? w : { offset: e.offset, bodyRows: e.bodyRows },
      ).catch(() => undefined)
    }
    return moved
  })

  // 우측 diff 패널: 파일별 +/− 요약과 헌크.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // 이 패널은 /desk-diff 로만 열리고 터미널에서 그린다.
    const els = $.ui.resolve(e) as Els
    const { Box, Text, Button, Code, Input } = els
    const [uncommitted, view, armed, info, edits, home, face, window, draft, comments] = await Promise.all([
      read($, diff),
      read($, diffView),
      read($, open),
      read($, repo),
      read($, runs),
      $.env.get('HOME').catch(() => undefined),
      read($, surface),
      read($, diffWindow),
      read($, commentDraft),
      read($, lineComments),
    ])
    // 패널 몸통 폭: viewport.columns 는 패널 폭이 아니다(구분선을 끌면 어긋나 단어 강조 조각이 일찍 잘렸다).
    const columns = (e.props as { bodyColumns?: number }).bodyColumns ?? e.viewport?.columns ?? 80
    const files = view.scope === 'branch' ? view.files : uncommitted
    // 커밋 안 한 변경에는 git 이 못 보는 저장소 밖 편집을 세션 기록으로 덧붙인다.
    const outside = view.scope === 'uncommitted' ? outsideEdits(sessionEditsOf(edits), info) : []
    // git 밖 편집 묶음을 접으면 머리 줄만 남는다. 개수·+/− 합계에는 그대로 센다.
    const outsideFolded = armed[OUTSIDE_GROUP] ?? false
    const outsideShown = outsideFolded ? [] : outside
    const added = [...files, ...outside].reduce((sum, file) => sum + file.added, 0)
    const removed = [...files, ...outside].reduce((sum, file) => sum + file.removed, 0)
    const shortPath = (path: string) => (home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path)
    const empty =
      info?.isRepo === false
        ? T.notRepoDiff
        : view.scope === 'branch'
          ? view.base
            ? T.noChangesSince(view.base.ref)
            : T.noBase
          : T.noUncommitted

    // 파일 하나: 머리 줄(누르면 접고 폄)과 diff. 되돌리기는 커밋 안 한 변경에서만.
    const fileBlock = (file: FileDiff, prefix: string, canRevert: boolean) => (
      <Box key={`file-${prefix}${file.path}`} flexDirection="column">
        <Box columnGap={1}>
          {rowButton(
            els,
            { key: `fold-${prefix}${file.path}`, onPress: () => toggle($, `fold:${prefix}${file.path}`) },
            clipStart(file.path, Math.max(12, columns - 34)),
            file.isNew && <Text color={COLORS.muted}> new</Text>,
            ' ',
            diffChips(Text, file.added, file.removed),
            <Text color={COLORS.muted}>{armed[`fold:${prefix}${file.path}`] ? ' ›' : ' ⌄'}</Text>,
          )}
          {canRevert && !file.isNew && (
            <Button
              key={`revert-${file.path}`}
              plain
              dimColor={!armed[`revert:${file.path}`]}
              label={armed[`revert:${file.path}`] ? T.revertConfirm : T.revert}
              onPress={() => void revertFile($, file.path, armed[`revert:${file.path}`] ?? false)}
            />
          )}
        </Box>
        {armed[`fold:${prefix}${file.path}`] ? null : file.patch ? (
          <Code source={file.patch} path={file.path} format="diff" />
        ) : (
          <Text color={COLORS.muted}>{T.binary}</Text>
        )}
      </Box>
    )

    // 세션 기록의 파일 하나: 편집마다의 헌크를 차례로. 되돌리기는 없다(git 이 모르는 파일).
    const outsideBlock = (edit: SessionEdit) => {
      const id = `${OUTSIDE}${edit.path}`
      return (
        <Box key={`file-${id}`} flexDirection="column">
          {rowButton(
            els,
            { key: `fold-${id}`, onPress: () => toggle($, `fold:${id}`) },
            clipStart(shortPath(edit.path), Math.max(12, columns - 34)),
            ' ',
            diffChips(Text, edit.added, edit.removed),
            <Text color={COLORS.muted}>{armed[`fold:${id}`] ? ' ›' : ' ⌄'}</Text>,
          )}
          {!armed[`fold:${id}`] &&
            (edit.patches.length > 0 ? (
              edit.patches.map((patch, index) => <Code key={`patch-${id}-${index}`} source={patch} path={edit.path} format="diff" />)
            ) : (
              <Text color={COLORS.muted}>{T.binary}</Text>
            ))}
        </Box>
      )
    }

    const shownCount = files.length + outside.length
    // 모두 접기·펴기: 하나라도 펴져 있으면 모두 접고, 아니면 모두 편다.
    // 파일 탭은 지금 보이는 파일 블록의 접기 키(fileBlock·outsideBlock 과 같은 모양), 커밋별 탭은 커밋 줄이 대상이다.
    const foldIds = [...files.map(file => `${view.scope === 'branch' ? 'b:' : ''}${file.path}`), ...outsideShown.map(edit => `${OUTSIDE}${edit.path}`)]
    const foldCount = view.scope === 'commits' ? view.commits.length : foldIds.length
    const anyOpen = view.scope === 'commits' ? Object.keys(view.commitFiles).length > 0 : foldIds.some(id => !armed[`fold:${id}`])
    const foldAll = () =>
      view.scope === 'commits' ? foldCommits($) : update($, open, state => ({ ...state, ...Object.fromEntries(foldIds.map(id => [`fold:${id}`, anyOpen])) }))
    const title =
      view.scope === 'commits'
        ? view.commits.length > 0
          ? `${view.commits.length} commit${view.commits.length === 1 ? '' : 's'}`
          : T.commitsTitle
        : shownCount > 0
          ? `Edited ${shownCount} file${shownCount === 1 ? '' : 's'}`
          : T.changesTitle

    // 커밋별 탭의 커밋 한 줄: 누르면 그 커밋의 파일을 펼친다.
    const commitRow = (commit: CommitInfo) =>
      rowButton(
        els,
        { key: `commit-${commit.sha}`, onPress: () => void pickCommit($, commit.sha) },
        commit.short,
        ' ',
        <Text color={COLORS.text}>{clip(commit.subject, Math.max(10, columns - cellWidth(commit.ago) - 16))}</Text>,
        <Text color={COLORS.muted}>{` · ${commit.ago}`}</Text>,
        <Text color={COLORS.muted}>{view.commitFiles[commit.sha] ? ' ⌄' : ' ›'}</Text>,
      )

    // 데스크톱 diff 패널의 파일 머리 띠: 바탕색 한 줄에 ⌄ 이름(굵게) 흐린 폴더 +N −M, 되돌리기.
    // 띠 Box 의 key(file-…)는 openDiffAt 이 스크롤해 갈 곳이라 패널이 보이는 곳만 그려도 늘 그린다.
    const diffFileHeader = (path: string, prefix: string, plus: number, minus: number, isNew: boolean, canRevert: boolean, indent: number, shown = path) => {
      const id = `${prefix}${path}`
      const isFolded = armed[`fold:${id}`] ?? false
      const name = shown.split('/').pop() ?? shown
      const folder = shown.slice(0, Math.max(0, shown.length - name.length - 1))
      const room = Math.max(0, columns - indent - cellWidth(name) - cellWidth(` +${plus}  −${minus} `) - (canRevert ? cellWidth(T.revertConfirm) + 2 : 0) - (isNew ? 5 : 0) - 8)
      return (
        <Box key={`file-${id}`} height={1} overflow="hidden" columnGap={1} paddingLeft={indent} {...(face ? { backgroundColor: face.bubble } : {})}>
          <Box flexShrink={0}>
          {rowButton(
            els,
            { key: `fold-${id}`, onPress: () => toggle($, `fold:${id}`) },
            isFolded ? ' › ' : ' ⌄ ',
            <Text color={COLORS.text} weight="semibold">
              {name}
            </Text>,
            folder && room > 4 && <Text color={COLORS.muted}>{` ${clipStart(folder, room)}`}</Text>,
            isNew && <Text color={COLORS.muted}> new</Text>,
            ' ',
            diffChips(Text, plus, minus),
          )}
          </Box>
          {canRevert && !isNew && (
            <Button
              key={`revert-${path}`}
              plain
              dimColor={!armed[`revert:${path}`]}
              label={armed[`revert:${path}`] ? T.revertConfirm : T.revert}
              onPress={() => void revertFile($, path, armed[`revert:${path}`] ?? false)}
            />
          )}
        </Box>
      )
    }

    // git 밖 편집 묶음의 머리 줄: 누르면 묶음 전체를 접고 편다.
    const outsideHeader = rowButton(
      els,
      { key: 'fold-outside', onPress: () => toggle($, OUTSIDE_GROUP) },
      outsideFolded ? '› ' : '⌄ ',
      <Text color={COLORS.muted}>{T.outsideEdits}</Text>,
      <Text color={COLORS.muted}>{` · ${outside.length}`}</Text>,
    )

    const tabs = (
      <Box key="diff-tabs" columnGap={2} height={1} overflow="hidden">
        {SCOPES.map(scope => (
          <Box key={`scope-box-${scope}`} flexShrink={0}>
            <Button
              key={`scope-${scope}`}
              plain
              dimColor={scope !== view.scope}
              label={`${scope === view.scope ? '●' : '○'} ${scopeLabel(scope)}`}
              onPress={() => void refreshDiffView($, scope)}
            />
          </Box>
        ))}
      </Box>
    )
    const titleRow = (
      <Box key="diff-title" columnGap={1} height={1} overflow="hidden">
        <Box flexShrink={0}>
          <Text color={COLORS.text} weight="semibold">
            {title}
          </Text>
        </Box>
        {view.scope !== 'commits' && shownCount > 0 && <Box flexShrink={0}>{diffChips(Text, added, removed)}</Box>}
        {view.scope !== 'uncommitted' && view.base && (
          <Box flexShrink={0}>
            <Text color={COLORS.muted}>{`vs ${view.base.ref}`}</Text>
          </Box>
        )}
        <Box flexShrink={0}>
          <Button key="refresh" plain dimColor label="↻" onPress={() => void refreshDiffView($)} />
        </Box>
        {foldCount > 1 && (
          <Box flexShrink={0}>
            <Button key="fold-all" plain dimColor hotkey="z" label={anyOpen ? T.foldAll : T.unfoldAll} onPress={() => void foldAll()} />
          </Box>
        )}
      </Box>
    )

    if (face && diffColors) {
      return virtualDiff({
        els,
        palette: diffColors,
        window,
        columns,
        head: [tabs, titleRow],
        sections: [
          ...(view.scope !== 'commits' && shownCount === 0 ? [{ kind: 'note' as const, key: 'empty', text: empty }] : []),
          ...(view.scope !== 'commits'
            ? files.map(file => ({ kind: 'file' as const, file, prefix: view.scope === 'branch' ? 'b:' : '', canRevert: view.scope === 'uncommitted', indent: 0 }))
            : []),
          ...(outside.length > 0 ? [{ kind: 'element' as const, key: 'outside', node: outsideHeader }] : []),
          ...outsideShown.map(edit => ({ kind: 'session' as const, edit })),
          ...(view.scope === 'commits' && view.commits.length === 0
            ? [{ kind: 'note' as const, key: 'no-commits', text: info?.isRepo === false ? T.notRepo : view.base ? T.noCommitsSince(view.base.ref) : T.noCommits }]
            : []),
          ...(view.scope === 'commits'
            ? view.commits.flatMap(commit => [
                { kind: 'element' as const, key: `commit-${commit.sha}`, node: commitRow(commit) },
                ...(view.commitFiles[commit.sha]?.length === 0 ? [{ kind: 'note' as const, key: `empty-${commit.sha}`, text: T.emptyCommit, indent: 2 }] : []),
                ...(view.commitFiles[commit.sha] ?? []).map(file => ({ kind: 'file' as const, file, prefix: `c:${commit.short}:`, canRevert: false, indent: 2 })),
              ])
            : []),
        ],
        isFolded: id => armed[`fold:${id}`] ?? false,
        fileHeader: (file, prefix, canRevert, indent) => diffFileHeader(file.path, prefix, file.added, file.removed, file.isNew, canRevert, indent),
        sessionHeader: edit => diffFileHeader(edit.path, OUTSIDE, edit.added, edit.removed, false, false, 0, shortPath(edit.path)),
        notes: {
          draft,
          comments,
          scopeOf: prefix => commentScope(prefix, view.base?.ref),
          onLine: at => void pickLine($, at).catch(() => undefined),
          draftRow: (key, picked, lines, pad) => (
            <Box key={key} height={1} paddingLeft={pad} columnGap={1}>
              <Box flexGrow={1} flexShrink={1} overflow="hidden">
                <Input
                  key={draftKey(picked)}
                  label={T.commentLabel(rangeLabel(lines))}
                  placeholder={T.commentPlaceholder}
                  value={draftText}
                  submitLabel={T.commentSave}
                  onInput={value => (draftText = value)}
                  onSubmit={value => void saveComment($, picked, lines, value).catch(() => undefined)}
                />
              </Box>
              <Button key="comment-cancel" plain dimColor label={T.cancel} onPress={() => void cancelComment($)} />
            </Box>
          ),
          commentRow: (key, comment, pad) => (
            <Box key={key} height={1} paddingLeft={pad} columnGap={1}>
              <Box flexGrow={1} flexShrink={1} overflow="hidden">
                <Text wrap="truncate-end">
                  <Text color={COLORS.link}>{`✎ ${rangeLabel(comment.lines)}`}</Text>
                  {`  ${comment.body}`}
                </Text>
              </Box>
              <Button key={`comment-del-${comment.id}`} plain dimColor label="✕" onPress={() => void update($, lineComments, list => list.filter(item => item.id !== comment.id))} />
            </Box>
          ),
        },
      })
    }

    return (
      <Box flexDirection="column" rowGap={1}>
        {tabs}
        {titleRow}
        {view.scope !== 'commits' && shownCount === 0 && <Text color={COLORS.muted}>{empty}</Text>}
        {view.scope !== 'commits' && files.map(file => fileBlock(file, view.scope === 'branch' ? 'b:' : '', view.scope === 'uncommitted'))}
        {outside.length > 0 && outsideHeader}
        {outsideShown.map(outsideBlock)}
        {view.scope === 'commits' && view.commits.length === 0 && (
          <Text color={COLORS.muted}>{info?.isRepo === false ? T.notRepo : view.base ? T.noCommitsSince(view.base.ref) : T.noCommits}</Text>
        )}
        {view.scope === 'commits' &&
          view.commits.map(commit => {
            const changed = view.commitFiles[commit.sha]
            return (
              <Box key={`commit-${commit.sha}`} flexDirection="column">
                {commitRow(commit)}
                {changed && (
                  <Box flexDirection="column" rowGap={1} paddingLeft={2}>
                    {changed.length === 0 && <Text color={COLORS.muted}>{T.emptyCommit}</Text>}
                    {changed.map(file => fileBlock(file, `c:${commit.short}:`, false))}
                  </Box>
                )}
              </Box>
            )
          })}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PR_PANE }, async ($, e) => {
    const els = $.ui.resolve(e) as Els
    const { Box, Text, Button, Link } = els
    const [state, armed] = await Promise.all([read($, pr), read($, open)])
    const columns = e.viewport?.columns ?? 80
    // ↻ 로 다시 읽는 동안은 … : 다 읽은 PR 이 그대로여도 다시 읽었는지 보이게(15초 자동 갱신은 바꾸지 않는다)
    const isLoading = state?.status === 'loading'
    const refresh = <Button key="pr-refresh" plain dimColor label={isLoading ? '…' : '↻'} onPress={() => void refreshPr($, true).catch(() => undefined)} />
    const info = state?.pr ?? null

    if (!info) {
      const message =
        state === null || state.status === 'loading'
          ? T.prLoading
          : state.status === 'none'
            ? state.branch
              ? T.prNone(state.branch)
              : T.prDetached
            : T.prFailed(state.error)
      return (
        <Box flexDirection="column" rowGap={1}>
          <Box columnGap={1}>
            <Text color={COLORS.text} weight="semibold">
              PR
            </Text>
            {refresh}
          </Box>
          <Text color={COLORS.muted}>{message}</Text>
        </Box>
      )
    }

    const summary = checkSummary(info.checks)
    const stateWord = info.state === 'MERGED' ? 'Merged' : info.state === 'CLOSED' ? 'Closed' : info.isDraft ? 'Draft' : 'Open'
    const stateColor = info.state === 'OPEN' ? (info.isDraft ? COLORS.muted : COLORS.success) : COLORS.muted
    const passes = info.checks.filter(check => check.state === 'pass' || check.state === 'skip')
    const showPasses = armed['pr:passes'] ?? false
    const nameWidth = Math.max(12, columns - 30)
    const action = mergeAction(info)
    const mergeKey = `merge:${info.url}`

    const checkRow = (check: PrCheck) => {
      const mark = check.state === 'fail' ? '✗' : check.state === 'pending' ? '●' : check.state === 'skip' ? '–' : '✓'
      const color = check.state === 'fail' ? COLORS.danger : check.state === 'pending' ? COLORS.warning : check.state === 'skip' ? COLORS.muted : COLORS.success
      return (
        <Box key={`check-${check.name}`} columnGap={1}>
          <Text color={color}>{mark}</Text>
          {check.url ? (
            <Link href={check.url}>{clip(check.name, nameWidth)}</Link>
          ) : (
            <Text color={check.state === 'pass' || check.state === 'skip' ? COLORS.muted : COLORS.text}>{clip(check.name, nameWidth)}</Text>
          )}
          {check.state === 'fail' && (
            <Button key={`fix-check-${check.name}`} plain label={T.handToClaude} onPress={() => void fillPrompt($, checkPrompt(info, check))} />
          )}
        </Box>
      )
    }

    const threadRow = (thread: PrThread, index: number) => (
      <Box key={`thread-${index}`} flexDirection="column">
        <Box columnGap={1}>
          <Text color={COLORS.warning}>◆</Text>
          <Text color={COLORS.text}>{clip(thread.line === null ? thread.path : `${thread.path}:${thread.line}`, Math.max(12, columns - 40))}</Text>
          <Text color={COLORS.muted}>{thread.author}</Text>
          {thread.isOutdated && <Text color={COLORS.muted}>outdated</Text>}
          <Button key={`fix-thread-${index}`} plain label={T.handToClaude} onPress={() => void fillPrompt($, threadPrompt(info, thread))} />
        </Box>
        <Box paddingLeft={2}>
          <Text color={COLORS.muted}>{clip(thread.body.split('\n').find(line => line.trim() !== '') ?? '', Math.max(10, columns - 4))}</Text>
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="column">
          <Box columnGap={1}>
            <Text color={COLORS.muted}>{`\uf407 ${prNumber(info)}`}</Text>
            <Text color={COLORS.text} weight="semibold">
              {clip(info.title, Math.max(10, columns - 14))}
            </Text>
            {refresh}
          </Box>
          <Box columnGap={1}>
            <Text color={stateColor}>{stateWord}</Text>
            <Text color={COLORS.muted}>{`· ${clip(`${info.base} ← ${info.head}`, Math.max(10, columns - 30))} ·`}</Text>
            {info.added !== null && info.removed !== null && diffChips(els.Text, info.added, info.removed)}
          </Box>
          {(info.reviewDecision || (info.state === 'OPEN' && info.mergeState)) && (
            <Box columnGap={1}>
              {info.reviewDecision && (
                <Text color={info.reviewDecision === 'APPROVED' ? COLORS.success : info.reviewDecision === 'CHANGES_REQUESTED' ? COLORS.danger : COLORS.muted}>
                  {T.review(reviewName(info.reviewDecision))}
                </Text>
              )}
              {info.reviewDecision && info.state === 'OPEN' && info.mergeState && <Text color={COLORS.muted}>·</Text>}
              {info.state === 'OPEN' && info.mergeState && <Text color={COLORS[mergeLevel(info.mergeState)]}>{mergeName(info.mergeState)}</Text>}
            </Box>
          )}
          {info.state === 'OPEN' && info.autoMerge && <Text color={COLORS.warning}>{T.autoMergeOn}</Text>}
          {action !== null && (
            <Button
              key="pr-merge"
              plain
              label={armed[mergeKey] ? (action === 'auto' ? T.mergeAutoConfirm : T.mergeConfirm) : action === 'auto' ? T.mergeAuto(info.provider) : T.merge}
              onPress={() => void mergeFromPane($, info, action, armed[mergeKey] ?? false)}
            />
          )}
          <Link href={info.url}>{T.openOn(info.provider)}</Link>
        </Box>
        <Box flexDirection="column">
          <Box columnGap={1}>
            <Text color={COLORS.text} weight="semibold">
              {info.provider === 'gitlab' ? 'Pipeline' : 'Checks'}
            </Text>
            <Text color={COLORS.muted}>
              {summary.total === 0
                ? T.checksNone
                : [T.passedOf(summary.passed, summary.total), summary.failed > 0 ? T.failedCount(summary.failed) : null, summary.pending > 0 ? T.runningCount(summary.pending) : null].filter(Boolean).join(' · ')}
            </Text>
          </Box>
          {info.checks.filter(check => check.state === 'fail' || check.state === 'pending').map(checkRow)}
          {passes.length > 0 &&
            rowButton(
              els,
              { key: 'pr-passes', dimColor: true, onPress: () => toggle($, 'pr:passes') },
              showPasses ? T.passesShown(passes.length) : T.passesFolded(passes.length),
              showPasses ? ' ⌄' : ' ›',
            )}
          {showPasses && passes.map(checkRow)}
        </Box>
        <Box flexDirection="column">
          <Box columnGap={1}>
            <Text color={COLORS.text} weight="semibold">
              {T.unresolved}
            </Text>
            <Text color={COLORS.muted}>{info.threads === null ? T.unreadable : T.count(info.threads.length)}</Text>
          </Box>
          {(info.threads ?? []).map(threadRow)}
        </Box>
      </Box>
    )
  })
}

// 명령 출력이 마크다운인지: 표·제목·코드 블록·인용이 하나라도 있으면.
export function looksLikeMarkdown(text: string): boolean {
  return parseBlocks(text).some(block => block.kind === 'table' || block.kind === 'heading' || block.kind === 'code' || block.kind === 'quote')
}

export function askHint(question: { kind: string; multiSelect: boolean }): string {
  const how = question.kind !== 'choice' ? T.askHowText : question.multiSelect ? T.askHowMulti : T.askHowPick
  return `  ${how} · ${T.askHintTail}`
}

// 질문 카드(입력창 위 띠). 묻는 상태와 도구 호출 훅은 ask.tsx, 그리기와 버튼은 여기($ 는 파일을 넘지 못한다).
// 답은 기다리는 cat 의 파이프(answer)에 tee 로 넘긴다(ask.tsx).
async function replyAsk($: EngineInterface, dir: string, payload: AskReply) {
  await $.process.run(['tee', `${dir}/answer`], { stdin: JSON.stringify(payload), timeoutMs: 3000 })
}

// 카드를 건드렸다고 알린다: Remote Control 세션에서 엔진 창으로 넘기는 시계를 다시 센다(ask.tsx).
// 매번 다른 글을 써서 기다리는 훅이 바뀐 것을 안다(답과 같은 tee 로).
let askTouches = 0
function touchAsk($: EngineInterface, dir: string) {
  void $.process.run(['tee', `${dir}/touched`], { stdin: String(++askTouches), timeoutMs: 3000 }).catch(() => undefined)
}

// 지금 질문에 답을 정하고 다음 질문으로, 마지막이면 답을 보낸다.
// 선택지 하나를 눌렀을 때. 질문이 바뀐 직후(ASK_SETTLE)의 키는 앞 질문에서 넘어온 것이라 버린다:
// 키를 누르고 떼는 사이에 질문이 바뀌면 다음 질문의 같은 번호가 함께 눌리기 때문이다.
const ASK_SETTLE = 350

async function pickAsk($: EngineInterface, state: AskState, label: string, isPicked: boolean) {
  if ((await $.clock.now()) - state.shownAt < ASK_SETTLE) return
  const question = state.questions[state.step]
  if (!question) return
  if (!question.multiSelect) return advanceAsk($, state, [label], '')
  const picks = state.picks[state.step] ?? []
  const value = isPicked ? picks.filter(item => item !== label) : [...picks, label]
  touchAsk($, state.dir)
  await update($, asking, current =>
    current && current.id === state.id ? { ...current, picks: current.picks.map((item, index) => (index === current.step ? value : item)) } : current,
  )
}

async function advanceAsk($: EngineInterface, state: AskState, picks: string[], text: string) {
  const question = state.questions[state.step]
  if (!question) return
  const problem = numberProblem(question, text)
  if (problem) {
    $.ui.toast(problem)
    return
  }
  const nextPicks = state.picks.map((value, index) => (index === state.step ? picks : value))
  const nextTexts = state.texts.map((value, index) => (index === state.step ? text : value))
  if (state.step + 1 < state.questions.length) {
    touchAsk($, state.dir)
    const shownAt = await $.clock.now()
    await update($, asking, current =>
      current && current.id === state.id ? { ...current, step: current.step + 1, picks: nextPicks, texts: nextTexts, shownAt } : current,
    )
    return
  }
  const answers = Object.fromEntries(
    state.questions.map((item, index) => [item.question, answerOf(item, nextPicks[index] ?? [], nextTexts[index] ?? '')]),
  )
  await replyAsk($, state.dir, { kind: 'answer', answers })
}

// 입력창 위 띠의 질문 카드. 묻는 중이 아니면 null.
// 질문 카드가 차지할 줄 수. 띠가 모자라면(낮은 터미널) 선택지 밖으로 밀린 버튼은 숫자 키가 먹지 않으므로
// 간단한 모양(제목·질문 한 줄 + 선택지, 여러 개 고르기면 제출 줄)으로, 그래도 모자라면 테두리 없는 두 줄로 줄인다.
export function askRows(question: { kind: string; description?: string; multiSelect: boolean; options: { preview?: string }[] }, compact: boolean): number {
  if (compact) return 2 + 1 + (question.kind === 'choice' ? question.options.length : 1) + (question.multiSelect ? 1 : 0)
  const choice = question.kind === 'choice'
  const hint = question.options.some(option => option.preview) ? 1 : 0
  return 2 + 2 + (question.description ? 1 : 0) + (choice ? 1 + question.options.length + hint : 0) + 1 + 1 + 1
}

// 띠 줄 수에 맞는 모양: 다 들어가면 full, 아니면 테두리 카드(compact), 그것도 안 되면 두 줄(inline).
export type AskMode = 'full' | 'compact' | 'inline'
export function askMode(question: Parameters<typeof askRows>[0], room: number): { mode: AskMode; rows: number } {
  if (askRows(question, false) <= room) return { mode: 'full', rows: askRows(question, false) }
  if (askRows(question, true) <= room) return { mode: 'compact', rows: askRows(question, true) }
  return { mode: 'inline', rows: 2 }
}

async function askCard($: EngineInterface, els: Elements['terminal'], columns: number, room: number) {
  const { Box, Text, Button, Input } = els
  const state = await read($, asking)
  const question = state?.questions[state.step]
  if (!state || !question) return null
  const done = (card: JSX.Element) => ({ card, rows })
  const picks = state.picks[state.step] ?? []
  const text = state.texts[state.step] ?? ''
  const total = state.questions.length
  const isLast = state.step + 1 === total
  const k = `${state.id}-${state.step}`
  const setText = (value: string) => {
    touchAsk($, state.dir)
    return update($, asking, current =>
      current && current.id === state.id ? { ...current, texts: current.texts.map((item, index) => (index === current.step ? value : item)) } : current,
    )
  }
  const unit = question.unit ? ` (${question.unit})` : ''
  const width = Math.max(30, Math.min(columns, 100))
  const { mode, rows } = askMode(question, room)
  const compact = mode !== 'full'
  const inline = mode === 'inline'

  // 가장 낮은 띠: 테두리 없이 두 줄(제목·질문 / 선택지를 한 줄에 나란히).
  if (inline) {
    return done(
      <Box flexDirection="column" width={width} paddingX={1}>
        <Text wrap="truncate-end">
          {question.header !== '' && <Text color={COLORS.clay} weight="semibold">{`${question.header} `}</Text>}
          {total > 1 && <Text color={COLORS.muted}>{`${state.step + 1}/${total} `}</Text>}
          <Text color={COLORS.text} weight="semibold">
            {question.question}
          </Text>
        </Text>
        <Box columnGap={2} flexWrap="wrap">
          {question.kind === 'choice' ? (
            question.options.map((option, index) => {
              const isPicked = picks.includes(option.label)
              const mark = question.multiSelect ? (isPicked ? '☑ ' : '☐ ') : ''
              return (
                <Box key={`opt-${k}-${index}`}>
                  <Button
                    key={`ask-${k}-${index}`}
                    plain
                    hover={{ color: COLORS.clay }}
                    hotkey={index < 8 ? String(index + 1) : undefined}
                    label={`${mark}${option.label}`}
                    onPress={() => void pickAsk($, state, option.label, isPicked)}
                  />
                </Box>
              )
            })
          ) : (
            <Button key={`ask-engine-${k}`} plain hotkey="9" label={T.answerInDefault} onPress={() => void replyAsk($, state.dir, { kind: 'engine' })} />
          )}
          {question.multiSelect && (
            <Button key={`ask-next-${k}`} plain hotkey="0" label={isLast ? T.submit : T.nextArrow} onPress={() => void advanceAsk($, state, picks, text)} />
          )}
        </Box>
      </Box>
    )
  }

  if (compact) {
    return done(
      <Box flexDirection="column" width={width} borderStyle="round" borderColor={COLORS.clay} paddingX={1}>
        <Text wrap="truncate-end">
          {question.header !== '' && <Text color={COLORS.clay} weight="semibold">{`${question.header} `}</Text>}
          {total > 1 && <Text color={COLORS.muted}>{`${state.step + 1}/${total} `}</Text>}
          <Text color={COLORS.text} weight="semibold">
            {question.question}
          </Text>
        </Text>
        {question.kind === 'choice' ? (
          question.options.map((option, index) => {
            const isPicked = picks.includes(option.label)
            const mark = question.multiSelect ? (isPicked ? '☑ ' : '☐ ') : ''
            return (
              <Box key={`opt-${k}-${index}`}>
                <Button
                  key={`ask-${k}-${index}`}
                  plain
                  hover={{ color: COLORS.clay }}
                  hotkey={index < 8 ? String(index + 1) : undefined}
                  label={`${mark}${option.label}`}
                  onPress={() => void pickAsk($, state, option.label, isPicked)}
                />
              </Box>
            )
          })
        ) : (
          <Button key={`ask-engine-${k}`} plain hotkey="9" label={T.answerInDefault} onPress={() => void replyAsk($, state.dir, { kind: 'engine' })} />
        )}
        {question.multiSelect && (
          <Button key={`ask-next-${k}`} hotkey="0" label={isLast ? T.submit : T.nextArrow} onPress={() => void advanceAsk($, state, picks, text)} />
        )}
      </Box>
    )
  }

  return done(
    <Box flexDirection="column" width={width} borderStyle="round" borderColor={COLORS.clay} paddingX={1}>
      <Box columnGap={1}>
        {question.header !== '' && (
          <Text color={COLORS.clay} weight="semibold">
            {question.header}
          </Text>
        )}
        {total > 1 && <Text color={COLORS.muted}>{`${state.step + 1}/${total}`}</Text>}
      </Box>
      <Text color={COLORS.text} weight="semibold">
        {question.question}
      </Text>
      {question.description && <Text color={COLORS.muted}>{question.description}</Text>}
      {question.kind === 'choice' && (
        <Box flexDirection="column" marginTop={1}>
          {question.options.map((option, index) => {
            const isPicked = picks.includes(option.label)
            const mark = question.multiSelect ? (isPicked ? '☑ ' : '☐ ') : ''
            return (
              <Box key={`opt-${k}-${index}`} columnGap={2} hover={option.preview ? { scope: `askp-${k}-${index}` } : undefined}>
                {rowButton(
                  els,
                  {
                    key: `ask-${k}-${index}`,
                    hover: { color: COLORS.clay },
                    hotkey: index < 8 ? String(index + 1) : undefined,
                    onPress: () => void pickAsk($, state, option.label, isPicked),
                  },
                  `${mark}${option.label}`,
                  option.description && option.description !== option.label && (
                    <Text color={COLORS.muted}>{`  ${clip(option.description, Math.max(10, columns - cellWidth(mark + option.label) - 10))}`}</Text>
                  ),
                )}
              </Box>
            )
          })}
          {question.options.some(option => option.preview) && <Text color={COLORS.muted}>{T.hoverPreview}</Text>}
          {question.options.map((option, index) => {
            if (!option.preview) return null
            // 카드 오른쪽, 제목 줄 높이부터 겹쳐 그린다(카드가 커지면 띠가 위로 자라 선택지가 커서 밑에서 밀려나므로).
            // 상자 배경은 칠해지지 않아 줄마다 같은 폭의 공백으로 채워 아래 글자를 덮는다.
            const lines = cap(option.preview, 10).split('\n')
            const inner = Math.max(...lines.map(cellWidth))
            return (
              <Box
                key={`askp-box-${k}-${index}`}
                position="absolute"
                top={-(question.description ? 4 : 3)}
                right={0}
                display="none"
                hover={{ scope: `askp-${k}-${index}`, display: 'flex' }}
                flexDirection="column"
                borderStyle="round"
                borderColor={COLORS.clay}
              >
                {lines.map(line => (
                  <Text color={COLORS.text}>{` ${line}${' '.repeat(inner - cellWidth(line))} `}</Text>
                ))}
              </Box>
            )
          })}
        </Box>
      )}
      <Box marginTop={1}>
        <Input
          key={`ask-text-${k}`}
          label={question.kind === 'choice' ? 'Other' : T.answerLabel(unit)}
          placeholder={question.placeholder ?? (question.kind === 'number' ? T.numberPlaceholder : T.otherPlaceholder)}
          value={text}
          submitLabel={isLast ? T.submit : T.next}
          onInput={value => void setText(value)}
          onSubmit={value => void advanceAsk($, state, question.multiSelect ? picks : [], value)}
        />
      </Box>
      <Box columnGap={2}>
        {question.multiSelect && (
          <Button key={`ask-next-${k}`} hotkey="0" label={isLast ? T.submit : T.nextArrow} onPress={() => void advanceAsk($, state, picks, text)} />
        )}
        <Button key={`ask-engine-${k}`} plain dimColor hotkey="9" label={T.toDefault} onPress={() => void replyAsk($, state.dir, { kind: 'engine' })} />
        <Button key={`ask-close-${k}`} plain dimColor label={T.close} onPress={() => void replyAsk($, state.dir, { kind: 'dismiss' })} />
      </Box>
    </Box>
  )
}

// 데스크톱 입력창의 회색 아래턱: 폭을 채운 알약 띠, 왼쪽에 저장소·브랜치, 오른쪽에 diff 칩.
// omarchy 테마를 못 읽으면 띠 없이 칩만.
async function chinBand($: EngineInterface, els: Elements['terminal'], info: RepoInfo, columns: number) {
  const { Box, Text, Button } = els
  const face = await read($, surface)
  const files = await read($, diff)
  const added = files.reduce((sum, file) => sum + file.added, 0)
  const removed = files.reduce((sum, file) => sum + file.removed, 0)
  // +/− 칩은 누르면 diff 패널(데스크톱처럼).
  const chips =
    files.length === 0 ? null : (
      <Button key="chin-diff" plain onPress={() => void openDiff($).catch(() => undefined)}>
        {diffChips(Text, added, removed)}
      </Button>
    )
  if (!face) {
    return (
      <Box columnGap={2} paddingX={1}>
        <Text color={COLORS.muted}>{info.name}</Text>
        {info.branch && <Text color={COLORS.muted}>{info.branch}</Text>}
        {chips}
      </Box>
    )
  }
  const left = chinLabel(info.name, info.branch)
  const chipText = files.length > 0 ? ` +${added}  −${removed} ` : ''
  const gap = Math.max(1, columns - 2 - cellWidth(left) - cellWidth(chipText) - 1)
  // 버튼은 Text 안에 넣을 수 없어 한 줄을 Box 로 잇는다.
  return (
    <Box>
      <Text>
        <Text color={face.bubble}>{EDGES.single[0]}</Text>
        <Text color={COLORS.muted} backgroundColor={face.bubble}>
          {left}
        </Text>
        <Text backgroundColor={face.bubble}>{' '.repeat(gap)}</Text>
      </Text>
      {chips}
      <Text>
        <Text backgroundColor={face.bubble}> </Text>
        <Text color={face.bubble}>{EDGES.single[1]}</Text>
      </Text>
    </Box>
  )
}

// 데스크톱의 계획 카드: 끝난 일 ✓(흐리게), 하는 중 ◉(클레이, 진행형 문구), 남은 일 ○.
const TASK_ROWS = 6
const TASK_MARKS = {
  completed: { mark: '✓', color: COLORS.success, text: COLORS.muted },
  in_progress: { mark: '◉', color: COLORS.clay, text: COLORS.text },
  pending: { mark: '○', color: COLORS.muted, text: COLORS.text },
} as const

export function taskCard(els: Elements['terminal'], list: ReadonlyArray<TaskItem>, columns: number, rows: number) {
  const { Box, Text } = els
  const { shown, hidden } = visibleTasks(list, Math.max(2, rows))
  if (shown.length === 0) return null
  const done = list.filter(item => item.status === 'completed').length
  const width = Math.max(24, Math.min(columns, 72))
  return (
    <Box flexDirection="column" width={width} borderStyle="round" borderColor={COLORS.border} paddingX={1}>
      <Box columnGap={1}>
        <Text color={COLORS.text} weight="semibold">
          Tasks
        </Text>
        <Text color={COLORS.muted}>{`${done}/${list.length}`}</Text>
      </Box>
      {shown.map(item => {
        const style = TASK_MARKS[item.status]
        const label = item.status === 'in_progress' ? (item.activeForm ?? item.subject) : item.subject
        return (
          <Text wrap="truncate-end">
            <Text color={style.color}>{`${style.mark} `}</Text>
            <Text color={style.text} weight={item.status === 'in_progress' ? 'semibold' : undefined}>
              {label}
            </Text>
          </Text>
        )
      })}
      {hidden > 0 && <Text color={COLORS.muted}>{`+${hidden} more`}</Text>}
    </Box>
  )
}

// 터미널은 Box 배경을 칠하지 않으므로 말풍선의 모든 칸을 글자 바탕으로 칠한다.
// 양 끝 칸은 줄 위치로 고른다: 한 줄이면 Nerd Font 반원(  )으로 알약 모양, 여러 줄이면
// 첫 줄은 위 모서리만, 마지막 줄은 아래 모서리만 사선으로 깎은 칸(Symbols for Legacy Computing),
// 가운데 줄은 꽉 찬 칸. 그러면 여러 줄도 한 덩어리의 둥근 상자가 된다.
// 반원은 Nerd Font 글리프라 omarchy 테마를 읽었을 때(= Nerd Font 기본 설치)만 이 모양을 쓴다.
const EDGES = {
  single: ['\ue0b6', '\ue0b4'],
  top: ['\u{1FB41}', '\u{1FB4C}'],
  bottom: ['\u{1FB52}', '\u{1FB5D}'],
} as const

// 각 줄의 왼쪽·오른쪽 끝 칸. null 이면 말풍선 색으로 꽉 채운 칸.
export function bubbleEdges(count: number): Array<readonly [string | null, string | null]> {
  return Array.from({ length: count }, (_, index) => {
    if (count === 1) return EDGES.single
    if (index === 0) return EDGES.top
    if (index === count - 1) return EDGES.bottom
    return [null, null] as const
  })
}

export function bubbleRows(lines: string[]): string[] {
  const inner = Math.max(1, ...lines.map(cellWidth))
  return lines.map(line => `  ${line}${' '.repeat(inner - cellWidth(line))}  `)
}

// 여러 줄 말풍선의 위·아래 줄 끝 칸을 그림으로 그릴 수 있으면(kitty 그래픽) 글리프 대신 둥근 모서리 그림을 쓴다.
// 사선 글리프는 모서리를 깎을 뿐이고, 한 칸 높이를 다 쓰는 반원은 줄 사이에 홈을 낸다.
// 그림은 말풍선 색으로 칠하므로 테마 색마다 한 번 만들어 둔다.
const cornerCache = new Map<string, string>()

function cornerSource(corner: Corner, fill: string) {
  const key = `${corner} ${fill}`
  let rgba = cornerCache.get(key)
  if (rgba === undefined) {
    rgba = cornerPixels(corner, fill).toBase64()
    cornerCache.set(key, rgba)
  }
  return { rgba, ...CORNER_SIZE }
}

function bubbleLines(
  Box: Elements['terminal']['Box'],
  Text: Elements['terminal']['Text'],
  Image: Elements['terminal']['Image'] | null,
  lines: string[],
  fill: string,
) {
  const edges = bubbleEdges(lines.length)
  const edge = (glyph: string | null) =>
    glyph === null ? <Text backgroundColor={fill}> </Text> : <Text color={fill}>{glyph}</Text>
  const corner = (key: string, at: Corner) =>
    Image && <Image key={key} source={cornerSource(at, fill)} columns={1} rows={1} alt=" " />
  return (
    <>
      {bubbleRows(lines).map((row, index) => {
        const body = (
          <Text color={COLORS.text} backgroundColor={fill}>
            {row}
          </Text>
        )
        const side = lines.length > 1 && index === 0 ? 'top' : lines.length > 1 && index === lines.length - 1 ? 'bottom' : null
        if (Image && side) {
          return (
            <Box flexDirection="row">
              {corner(`bubble-${index}-left`, `${side}-left`)}
              {body}
              {corner(`bubble-${index}-right`, `${side}-right`)}
            </Box>
          )
        }
        return (
          <Text>
            {edge(edges[index]?.[0] ?? null)}
            {body}
            {edge(edges[index]?.[1] ?? null)}
          </Text>
        )
      })}
    </>
  )
}

// 칸 수 기준 줄바꿈: 공백에서 끊고, 한 단어가 너무 길면 글자 단위로 끊는다.
export function wrapText(text: string, width: number): string[] {
  const max = Math.max(4, width)
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/(?<= )/)) {
      if (cellWidth(line + word.trimEnd()) <= max) {
        line += word
        continue
      }
      if (line.trim() !== '') out.push(line.trimEnd())
      line = ''
      for (const ch of word) {
        if (cellWidth(line + ch) > max) {
          out.push(line)
          line = ''
        }
        line += ch
      }
    }
    out.push(line.trimEnd())
  }
  return out
}

// 스피너 글자: 엔진이 덮어쓴 문구가 있으면 그것, 없으면 하는 일에 맞춘 데스크톱 낱말.
const SPINNER_WORDS = {
  requesting: 'Working',
  thinking: 'Thinking',
  responding: 'Responding',
  'tool-input': 'Preparing',
  'tool-use': 'Running',
} as const

export function spinnerWord(mode: keyof typeof SPINNER_WORDS, message: string | null): string {
  return message ?? SPINNER_WORDS[mode] ?? 'Working'
}

// 밝은 점 하나가 왼쪽에서 오른쪽으로 도는 세 칸.
export function spinnerDots(now: number): string {
  const frame = Math.floor(now / SPINNER_TICK) % 3
  return ['●', '·', '·'].map((_, index) => (index === frame ? '●' : '·')).join('')
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

// 아래턱 왼쪽 글자. 아이콘은 Nerd Font(폴더 U+F07B, 브랜치 U+E0A0). 폴더 아이콘은 두 칸으로 그려지니 뒤에 빈칸 두 개를 둔다.
export function chinLabel(name: string, branch: string | null | undefined): string {
  return branch ? ` \uf07b  ${name}   \ue0a0 ${branch}` : ` \uf07b  ${name}`
}

// 데스크톱의 초록·빨강 diff 칩.
function diffChips(Text: Elements['terminal']['Text'], added: number, removed: number) {
  return (
    <Text>
      <Text color={COLORS.success} backgroundColor="diffAddedDimmed">{` +${added} `}</Text>
      <Text color={COLORS.danger} backgroundColor="diffRemovedDimmed">{` −${removed} `}</Text>
    </Text>
  )
}

// ── PR·MR 읽기와 머지(gh·glab) ─────────────────────────────────────────────────
// 읽은 JSON 을 고치는 일은 pr.ts. 프로그램을 부르는 일은 여기서: 부르는 자리마다 명령을 고정 글자로 쓰고
// ($.process.run([...])), $ 는 같은 파일 함수에만 넘긴다. 디렉터리 검사가 둘 다 끝까지 따라가게.
// 테스트는 $ 대신 { process: { run } } 을 넘긴다.
const READ_MS = 15_000
const MERGE_MS = 30_000

// gh 가 없거나(실행 실패), GitHub 저장소가 아니면 off. PR 이 없는 브랜치는 none.
async function fetchPr($: EngineInterface, branch: string | null, at: number): Promise<PrState> {
  const view = await $.process.run(['gh', 'pr', 'view', '--json', PR_FIELDS], { timeoutMs: READ_MS }).catch(error => ({ exitCode: 127, stdout: '', stderr: String(error) }))
  if (view.exitCode !== 0) {
    const reason = view.stderr.trim().split('\n')[0] ?? ''
    return /no (open )?pull requests? found/i.test(view.stderr)
      ? { status: 'none', branch, pr: null, at }
      : { status: 'off', branch, pr: null, at, error: reason, isSticky: isLocalFailure(view) }
  }
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(view.stdout) as Record<string, unknown>
  } catch {
    return { status: 'off', branch, pr: null, at, error: T.outputUnreadable('gh') }
  }
  const where = prRepo(String(raw.url ?? ''))
  let threads: PrThread[] | null = null
  if (where) {
    const ran = await $.process.run(
      [
      'gh',
      'api',
      'graphql',
      '--hostname',
      where.host,
      '-f',
      `query=${THREADS_QUERY}`,
      '-F',
      `owner=${where.owner}`,
      '-F',
      `name=${where.name}`,
      '-F',
      `number=${Number(raw.number)}`,
      ],
      { timeoutMs: READ_MS },
    ).catch(() => null)
    if (ran?.exitCode === 0) {
      try {
        threads = toThreads(JSON.parse(ran.stdout))
      } catch {
        threads = null
      }
    }
  }
  return { status: 'ok', branch, pr: toPr(raw, threads), at }
}

// glab mr view 를 인자 없이 쓰면 같은 브랜치에 병합된 MR 이 여럿일 때 고르라며 실패한다. 그래서 열린 MR 을
// 브랜치로 먼저 찾고 번호로 읽는다.
async function fetchMr($: EngineInterface, branch: string | null, at: number): Promise<PrState> {
  const failed = (error: unknown) => ({ exitCode: 127, stdout: '', stderr: String(error) })
  const reasonOf = (stderr: string) => stderr.split('\n').map(line => line.trim()).find(line => line !== '' && line !== 'ERROR') ?? ''
  if (branch === null) return { status: 'none', branch, pr: null, at }
  const list = await $.process.run(['glab', 'mr', 'list', '--source-branch', branch, '--output', 'json'], { timeoutMs: READ_MS }).catch(failed)
  if (list.exitCode !== 0) return { status: 'off', branch, pr: null, at, error: reasonOf(list.stderr), isSticky: isLocalFailure(list) }
  let iid: number | undefined
  try {
    iid = (JSON.parse(list.stdout) as Array<{ iid?: number }>)[0]?.iid
  } catch {
    return { status: 'off', branch, pr: null, at, error: T.outputUnreadable('glab') }
  }
  if (iid === undefined) return { status: 'none', branch, pr: null, at }
  const view = await $.process.run(['glab', 'mr', 'view', String(iid), '--output', 'json'], { timeoutMs: READ_MS }).catch(failed)
  if (view.exitCode !== 0) return { status: 'off', branch, pr: null, at, error: reasonOf(view.stderr) }
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(view.stdout) as Record<string, unknown>
  } catch {
    return { status: 'off', branch, pr: null, at, error: T.outputUnreadable('glab') }
  }
  const webUrl = String(raw.web_url ?? '')
  const host = /^https?:\/\/([^/]+)\//.exec(webUrl)?.[1]
  const api = (path: string) =>
    (host ? $.process.run(['glab', 'api', '--hostname', host, path], { timeoutMs: READ_MS }) : $.process.run(['glab', 'api', path], { timeoutMs: READ_MS }))
      .then(ran => (ran.exitCode === 0 ? (JSON.parse(ran.stdout) as unknown) : null))
      .catch(() => null)
  const pipeline = (raw.head_pipeline ?? raw.pipeline) as { id?: number; status?: string; web_url?: string } | null
  const refs = raw.diff_refs as { base_sha?: string; head_sha?: string } | null
  const [jobs, discussions, stat] = await Promise.all([
    pipeline?.id ? api(`projects/${raw.project_id}/pipelines/${pipeline.id}/jobs?per_page=100`) : Promise.resolve(null),
    api(`projects/${raw.project_id}/merge_requests/${raw.iid}/discussions?per_page=100`),
    refs?.base_sha && refs.head_sha
      ? $.process.run(['git', 'diff', '--shortstat', refs.base_sha, refs.head_sha], { timeoutMs: READ_MS })
          .then(ran => (ran.exitCode === 0 ? shortStat(ran.stdout) : null))
          .catch(() => null)
      : Promise.resolve(null),
  ])
  // job 목록을 못 읽으면 파이프라인 전체 상태 하나를 체크로
  const checks = jobs !== null ? toJobs(jobs) : pipeline?.status ? [{ name: 'pipeline', state: jobState(pipeline), url: pipeline.web_url ?? null }] : []
  return { status: 'ok', branch, pr: toMr(raw, checks, toDiscussions(discussions, webUrl), stat), at }
}

const firstLine = (text: string) => text.split('\n').map(line => line.trim()).find(line => line !== '' && line !== 'ERROR') ?? ''

// GitHub: 저장소가 허용하는 방식(merge → squash → rebase 순)으로, 본 head 커밋일 때만. 원격 브랜치는 머지된 뒤
// 지운다. gh 의 --delete-branch 는 로컬 브랜치까지 지우고 기본 브랜치로 체크아웃하므로 쓰지 않는다.
// 자동 머지는 나중에 일어나서 지울 수 없다(저장소의 "Automatically delete head branches" 를 따른다).
// GitLab: REST 로 머지한다. squash 는 MR 설정(프로젝트 기본값)을 따르고 원격 브랜치는 지운다.
// 자동 머지 파라미터는 옛 이름(merge_when_pipeline_succeeds)과 새 이름(auto_merge)을 함께 보낸다.
export async function mergePr($: EngineInterface, pr: PrInfo, action: MergeAction): Promise<MergeResult> {
  const failed = (error: unknown): Ran => ({ exitCode: 127, stdout: '', stderr: String(error) })
  if (pr.headSha === null) return { ok: false, error: T.mergeNoHead }
  if (pr.provider === 'gitlab') {
    if (pr.projectId === undefined) return { ok: false, error: T.mergeNoHead }
    const host = /^https?:\/\/([^/]+)\//.exec(pr.url)?.[1]
    const isAuto = action === 'auto'
    const path = `projects/${pr.projectId}/merge_requests/${pr.number}/merge`
    const sha = `sha=${pr.headSha}`
    const whenPipeline = `merge_when_pipeline_succeeds=${isAuto}`
    const autoMerge = `auto_merge=${isAuto}`
    const ran = await (
      host
        ? $.process.run(['glab', 'api', '--hostname', host, '-X', 'PUT', path, '-f', sha, '-F', 'should_remove_source_branch=true', '-F', whenPipeline, '-F', autoMerge], { timeoutMs: MERGE_MS })
        : $.process.run(['glab', 'api', '-X', 'PUT', path, '-f', sha, '-F', 'should_remove_source_branch=true', '-F', whenPipeline, '-F', autoMerge], { timeoutMs: MERGE_MS })
    ).catch(failed)
    let body: Record<string, unknown> = {}
    try {
      body = JSON.parse(ran.stdout) as Record<string, unknown>
    } catch {
      body = {}
    }
    if (ran.exitCode !== 0) return { ok: false, error: typeof body.message === 'string' ? body.message : firstLine(ran.stderr) }
    return { ok: true, merged: body.state === 'merged' }
  }
  const where = prRepo(pr.url)
  if (!where) return { ok: false, error: T.mergeNoHead }
  const repo = `${where.host}/${where.owner}/${where.name}`
  const settings = await $.process.run(['gh', 'repo', 'view', repo, '--json', 'mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed,deleteBranchOnMerge'], { timeoutMs: MERGE_MS }).catch(failed)
  let allowed: Record<string, unknown> = {}
  try {
    allowed = settings.exitCode === 0 ? (JSON.parse(settings.stdout) as Record<string, unknown>) : {}
  } catch {
    allowed = {}
  }
  const method = allowed.mergeCommitAllowed !== false ? 'merge' : allowed.squashMergeAllowed !== false ? 'squash' : 'rebase'
  const how = `--${method}`
  const ran = await (
    action === 'auto'
      ? $.process.run(['gh', 'pr', 'merge', String(pr.number), '-R', repo, how, '--match-head-commit', pr.headSha, '--auto'], { timeoutMs: MERGE_MS })
      : $.process.run(['gh', 'pr', 'merge', String(pr.number), '-R', repo, how, '--match-head-commit', pr.headSha], { timeoutMs: MERGE_MS })
  ).catch(failed)
  if (ran.exitCode !== 0) return { ok: false, error: firstLine(ran.stderr) }
  if (action === 'auto') return { ok: true, merged: false }
  if (allowed.deleteBranchOnMerge === true) return { ok: true, merged: true }
  const removed = await $.process.run(['gh', 'api', '--hostname', where.host, '-X', 'DELETE', `repos/${where.owner}/${where.name}/git/refs/heads/${pr.head}`], { timeoutMs: MERGE_MS }).catch(failed)
  return removed.exitCode === 0 ? { ok: true, merged: true } : { ok: true, merged: true, note: T.branchKept(pr.head) }
}

// GitHub 저장소가 아니면 gh 는 네트워크 없이 곧바로 실패한다. 그때 glab 으로 다시 본다.
export async function fetchReview($: EngineInterface, branch: string | null, at: number): Promise<PrState> {
  const github = await fetchPr($, branch, at)
  if (github.status !== 'off') return github
  const gitlab = await fetchMr($, branch, at)
  if (gitlab.status !== 'off') return gitlab
  return { ...github, error: [github.error, gitlab.error].filter(Boolean).join(' / ') || undefined, isSticky: github.isSticky === true && gitlab.isSticky === true }
}
