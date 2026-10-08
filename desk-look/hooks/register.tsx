import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, TextHoverProps, Timer, ToolGroupCall, UiPressArgument } from 'claude-code'

import type { FileDiff, ImageInfo, RepoInfo, RunCall, Runs, AskState, SessionEntry, Surface, TaskItem, TurnCard, TurnEdit, UsageBreakdown, UsageInfo } from '../types'
import { IMAGE_TOKEN, LIST_IMAGES, parseImages, supportsGraphics, thumbnailSize } from './images'
import { cellWidth, parseBlocks, renderMarkdown } from './markdown'
import { agentOf, computeRuns, isAgentTool } from './runs'
import { LIST_SESSIONS, ago, clip, filterSessions, groupSessions, numbered, parseSessions } from './sessions'
import { WRITE as ASK_WRITE, answerOf, numberProblem, registerAsk } from './ask'
import type { AskReply } from './ask'
import { computeTasks, visibleTasks } from './tasks'
import { OMARCHY_COLORS, parseSurface } from './theme'
import { LIMIT_NAMES, contextChipMode, meterBar, meterLevel, resetIn, ring, showsChip, toBreakdown, toUsage } from './usage'
import type { ContextChipMode } from './usage'

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
const sessions = atom({ plugin: 'desk-look', key: 'sessions' } as const, [] as SessionEntry[])
const sessionQuery = atom({ plugin: 'desk-look', key: 'sessionQuery' } as const, '')
const turnStartedAt = atom({ plugin: 'desk-look', key: 'turnStartedAt' } as const, null as number | null)
// 질문 카드 상태. ask.tsx 의 것과 같은 키다(상태 원본은 파일마다 선언해야 한다).
const asking = atom({ plugin: 'desk-look', key: 'ask' } as const, null as AskState | null)
const tasks = atom({ plugin: 'desk-look', key: 'tasks' } as const, [] as TaskItem[])
const tick = atom({ plugin: 'desk-look', key: 'tick' } as const, 0)
const usage = atom({ plugin: 'desk-look', key: 'usage' } as const, null as UsageInfo | null)
// Button 안에 글·Text 를 넣을 수 있는 엔진(2.1.295+)인지. 모르는 동안은 옛 모양.
const richButtons = atom({ plugin: 'desk-look', key: 'richButtons' } as const, false)
const usageBreakdown = atom({ plugin: 'desk-look', key: 'usageBreakdown' } as const, null as UsageBreakdown | null)

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
  const category = categoryOf(tool)
  if (category !== 'other') return VERB[category]
  // mcp__server__tool → tool
  return `Used ${tool.startsWith('mcp__') ? (tool.split('__').pop() ?? tool) : tool}`
}

const lineCount = (text: unknown) => (typeof text === 'string' && text.length > 0 ? text.split('\n').length : 0)

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
    case 'Write':
      return { added: lineCount(fields.content), removed: 0 }
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
  return all.length <= lines ? all.join('\n') : `${all.slice(0, lines).join('\n')}\n… ${all.length - lines}줄 더`
}

// Edit·MultiEdit 결과의 structuredPatch: 파일 기준 줄 번호와 앞뒤 문맥이 붙은 헌크. 없으면 null.
export function patchOf(output: unknown): string | null {
  const hunks = (output as { structuredPatch?: unknown } | null | undefined)?.structuredPatch
  if (!Array.isArray(hunks) || hunks.length === 0) return null
  return hunks
    .map(hunk => {
      const h = hunk as { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }
      return [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines].join('\n')
    })
    .join('\n')
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
const GIT_DIFF = ['--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/']

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
  await $.ui.open({ id: CONTEXT_PANE, title: '컨텍스트', focus: true })
}

// 줄 전체가 눌리는 버튼. 2.1.295 부터 Button 안에 글·Text 를 넣을 수 있다. 그 전 엔진은 그런 그림을
// 통째로 거부하고 자기 그림을 그리므로, 그때는 첫 조각만 버튼 라벨로 하고 나머지는 옆에 둔다.
type RowButtonProps = { key: string; dimColor?: boolean; hotkey?: string; hover?: TextHoverProps; onPress: (press: UiPressArgument) => void }

function rowButton(els: Els, rich: boolean, props: RowButtonProps, label: string, ...rest: unknown[]) {
  const { Box, Text, Button } = els
  const parts = rest.filter(part => part !== null && part !== undefined && part !== false && part !== '')
  if (rich) {
    return (
      <Button plain {...props}>
        {label}
        {parts as never}
      </Button>
    )
  }
  return (
    <Box>
      <Button plain {...props} label={label} />
      {parts.map(part => (typeof part === 'string' ? <Text>{part}</Text> : part)) as never}
    </Box>
  )
}

export function supportsRichButtons(base: string | undefined): boolean {
  const [major = 0, minor = 0, patch = 0] = (base ?? '').split('-')[0]!.split('.').map(Number)
  return major > 2 || (major === 2 && (minor > 1 || (minor === 1 && patch >= 295)))
}

// 아래턱 오른쪽의 "◔ 62%": 링은 단계 색, 칩 전체가 컨텍스트 패널을 여는 버튼.
function contextMeter(els: Els, $: EngineInterface, info: UsageInfo | null, mode: ContextChipMode, rich: boolean) {
  const percent = info?.percent ?? null
  if (!showsChip(mode, percent)) return null
  const { Box, Text, Button } = els
  const level = meterLevel(percent)
  const label = `${percent}%`
  return {
    width: 2 + cellWidth(label),
    node: rich ? (
      <Button key="context-chip" plain dimColor={level === 'muted'} onPress={() => void openContext($)}>
        <Text color={COLORS[level]}>{ring(percent)}</Text>
        {` ${label}`}
      </Button>
    ) : (
      <Box columnGap={1}>
        <Text color={COLORS[level]}>{ring(percent)}</Text>
        <Button key="context-chip" plain dimColor={level === 'muted'} label={label} onPress={() => void openContext($)} />
      </Box>
    ),
  }
}

async function refreshDiff($: EngineInterface) {
  const git = (args: string[]) => $.process.run(['git', ...args], { timeoutMs: 5000 })
  const inside = await git(['rev-parse', '--is-inside-work-tree'])
  if (inside.exitCode !== 0) {
    const cwd = await $.session.cwd()
    await update($, repo, () => ({ name: cwd.split('/').pop() ?? cwd, branch: null, isRepo: false }))
    await update($, diff, () => [])
    return
  }
  const [top, branch, tracked, untracked] = await Promise.all([
    git(['rev-parse', '--show-toplevel']),
    git(['rev-parse', '--abbrev-ref', 'HEAD']),
    git(['diff', 'HEAD', ...GIT_DIFF]).then(ran => (ran.exitCode === 0 ? ran : git(['diff', ...GIT_DIFF]))),
    git(['ls-files', '--others', '--exclude-standard']),
  ])
  // 새로 만든 파일은 `git diff HEAD` 에 안 잡힌다. 데스크톱처럼 보이도록 최대 20개까지 붙인다.
  const fresh = untracked.stdout.split('\n').filter(Boolean).slice(0, 20)
  const freshDiffs = await Promise.all(fresh.map(path => git(['diff', '--no-index', ...GIT_DIFF, '--', '/dev/null', path])))
  const files = [
    ...parseDiff(tracked.stdout),
    ...freshDiffs.flatMap(ran => parseDiff(ran.stdout, true)),
  ]
  await update($, repo, () => ({
    name: top.stdout.trim().split('/').pop() ?? '',
    branch: branch.exitCode === 0 ? branch.stdout.trim() : null,
    isRepo: true,
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
  $.ui.toast(ran.exitCode === 0 ? `${path} 을(를) 되돌렸어요` : `되돌리지 못했어요: ${ran.stderr.trim().split('\n')[0] ?? ''}`)
  await refreshDiff($)
}

// 처음 상태가 펼침인 행(묶음 안의 편집)도 있어서, 지금 보이는 상태를 받아 뒤집는다.
const toggle = ($: EngineInterface, id: string, shown?: boolean) =>
  update($, open, state => ({ ...state, [id]: !(state[id] ?? shown ?? false) }))

async function refreshSurface($: EngineInterface) {
  const home = await $.env.get('HOME')
  const toml = home ? await $.fs.read(`${home}/${OMARCHY_COLORS}`).catch(() => null) : null
  const next = toml === null ? null : parseSurface(toml)
  await update($, surface, previous => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next))
}

async function refreshImages($: EngineInterface) {
  const ran = await $.process.run(['sh', '-c', LIST_IMAGES, 'sh', await $.session.id()], { timeoutMs: 3000 })
  const next = ran.exitCode === 0 ? parseImages(ran.stdout) : {}
  await update($, images, previous => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next))
}

async function refreshSessions($: EngineInterface) {
  // 빈 세션을 걸러 낸 뒤에도 40개가 차도록 넉넉히 읽는다
  const ran = await $.process.run(['sh', '-c', LIST_SESSIONS, 'sh', '80'], { timeoutMs: 5000 })
  const next = ran.exitCode === 0 ? parseSessions(ran.stdout).slice(0, 40) : []
  await update($, sessions, () => next)
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
        $.ui.toast(`Enter 를 누르면 "${entry.title}" 세션으로 넘어가요.`)
      })
    })
    return
  }
  const shell = `cd '${entry.cwd.replace(/'/g, "'\\''")}' && claude --resume ${entry.id}`
  const copied = await $.process.run(['wl-copy', '--', shell], { timeoutMs: 2000 }).catch(() => null)
  $.ui.toast(copied?.exitCode === 0 ? `다른 폴더의 세션이에요. 명령을 복사했어요: ${shell}` : `다른 폴더의 세션이에요: ${shell}`)
}

// 엔진의 /copy 와 같은 길(클립보드 도구, 없으면 OSC 52)로 복사한다. 멀티플렉서·SSH 안에서도 된다.
async function copyText($: EngineInterface, text: string, press: UiPressArgument, what: string) {
  const copied = await $.ui.copy({ text, surface: press.surface })
  const lines = text.split('\n').length
  $.ui.toast(copied.isCopied ? `${what} ${lines}줄을 복사했어요` : `복사하지 못했어요: ${copied.reason}`)
}

async function refreshRuns($: EngineInterface) {
  const messages = await $.session.messages()
  const next = computeRuns(messages)
  await update($, runs, previous => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next))
  const list = computeTasks(messages)
  await update($, tasks, previous => (JSON.stringify(previous) === JSON.stringify(list) ? previous : list))
}

type Els = Elements['terminal']

// 호출 하나를 펼쳤을 때: 명령과 출력, 편집 diff, 새 파일 내용.
function callDetail({ Box, Text, Code }: Els, call: RunCall) {
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
      return <Code source={cap(patchOf(call.output) ?? guessed.join('\n'), 40)} path={filePath} format="diff" />
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
function peerRow(els: Els, $: EngineInterface, name: string, text: string, openState: Record<string, boolean>, columns: number, rich: boolean) {
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
          rich,
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

function agentCard(els: Els, $: EngineInterface, call: RunCall, openState: Record<string, boolean>, rich: boolean) {
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
          rich,
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

// 호출 한 줄: "Edited register.tsx +12 −3 ›", 누르면 아래로 펼친다.
function callLine(els: Els, $: EngineInterface, call: RunCall, openState: Record<string, boolean>, columns: number, rich: boolean, indent = 0, openFirst = false) {
  if (isAgentTool(call.tool)) return agentCard(els, $, call, openState, rich)
  const { Box, Text, Button } = els
  const id = call.tool_use_id
  const isOpen = openState[id] ?? openFirst
  const stat = diffStat(call)
  const answer = call.tool === 'AskUserQuestion' ? askAnswer(call.output) : null
  // 버튼 안의 글은 칸에 맞춰 잘리지 않으니 직접 자른다(동사·칩·꺾쇠 몫을 빼고).
  const room = Math.max(12, columns - indent - cellWidth(verbOf(call.tool)) - (stat ? 16 : 0) - 8)
  return (
    <Box flexDirection="column" paddingLeft={indent}>
      <Box columnGap={1}>
        {call.isRunning && <Text color={COLORS.clay}>···</Text>}
        {rowButton(
          els,
          rich,
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
      </Box>
      {isOpen && (
        <Box marginLeft={2} borderStyle="round" borderColor={COLORS.border} paddingX={1} flexDirection="column">
          {callDetail(els, call)}
        </Box>
      )}
    </Box>
  )
}

// 묶음 한 줄: "Ran 2 commands, edited 3 files +54 −12 ›", 펼치면 호출마다 한 줄.
// 데스크톱처럼 성공한 편집은 펼치자마자 diff 까지 보인다.
function runLine(els: Els, $: EngineInterface, runId: string, calls: RunCall[], openState: Record<string, boolean>, columns: number, rich: boolean) {
  // 에이전트만 모인 묶음은 접지 않고 카드를 쌓는다.
  if (calls.length > 0 && calls.every(call => isAgentTool(call.tool))) {
    return <els.Box flexDirection="column">{calls.map(call => agentCard(els, $, call, openState, rich))}</els.Box>
  }
  const { Box, Text, Button } = els
  const key = `run-${runId}`
  const isOpen = openState[key] ?? false
  const stats = calls.map(diffStat).filter((stat): stat is { added: number; removed: number } => stat !== null)
  const added = stats.reduce((sum, stat) => sum + stat.added, 0)
  const removed = stats.reduce((sum, stat) => sum + stat.removed, 0)
  return (
    <Box flexDirection="column">
      <Box columnGap={1}>
        {calls.some(call => call.isRunning) && <Text color={COLORS.clay}>···</Text>}
        {rowButton(
          els,
          rich,
          { key, dimColor: true, onPress: () => toggle($, key) },
          describeCalls(calls),
          stats.length > 0 && ' ',
          stats.length > 0 && diffChips(els.Text, added, removed),
          <Text color={COLORS.muted}>{isOpen ? ' ⌄' : ' ›'}</Text>,
        )}
      </Box>
      {isOpen && calls.map(call => callLine(els, $, call, openState, columns, rich, 2, isEditShown(call)))}
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
  registerAsk(on, options.askNotify !== 'off')

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'desk-sessions',
      description: '데스크톱 사이드바처럼 최근 세션 목록 패널을 연다 (번호를 주면 그 세션으로 이동)',
      argumentHint: '[번호]',
    })
    await $.command.register({
      name: 'desk-diff',
      description: '데스크톱 앱처럼 우측에 변경 파일 diff 패널을 연다',
    })
    await $.command.register({
      name: 'desk-context',
      description: '컨텍스트 사용량을 항목별로, 사용 한도·비용과 함께 패널로 연다',
    })
    void refreshDiff($).catch(() => undefined)
    void refreshUsage($).catch(() => undefined)
    void $.session
      .version()
      .then(engine => update($, richButtons, () => supportsRichButtons(engine.base ?? engine.version)))
      .catch(() => undefined)
    void refreshSurface($).catch(() => undefined)
    // 테마를 바꾸면 3초 안에 말풍선·아래턱 색이 따라간다. 바뀌지 않았으면 다시 그리지 않는다.
    themeWatch?.cancel()
    themeWatch = $.clock.every(THEME_POLL, () => void refreshSurface($).catch(() => undefined))
    void refreshRuns($).catch(() => undefined)
    void refreshImages($).catch(() => undefined)
    void (async () => {
      const [TMUX, ZELLIJ, HERDR_ENV, TERM, TERM_PROGRAM] = await Promise.all([
        $.env.get('TMUX'),
        $.env.get('ZELLIJ'),
        $.env.get('HERDR_ENV'),
        $.env.get('TERM'),
        $.env.get('TERM_PROGRAM'),
      ])
      await update($, graphics, () => supportsGraphics({ TMUX, ZELLIJ, HERDR_ENV, TERM, TERM_PROGRAM }))
    })().catch(() => undefined)
    return next(e)
  })

  // 테마를 바꿨을 수 있으니 프롬프트마다 다시 읽는다(타이머를 기다리지 않게).
  on('prompt.submit', async ($, e, next) => {
    void refreshSurface($).catch(() => undefined)
    const submitted = await next(e)
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
    return appended
  })

  on('turn.start', async ($, e, next) => {
    await update($, pendingEdits, () => [])
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
    }
    return done
  })

  on('command.run', { command: 'desk-sessions' }, async ($, e) => {
    const index = Number.parseInt(e.args.trim(), 10)
    if (Number.isInteger(index) && index > 0) {
      const list = numbered(await read($, sessions), await $.session.cwd(), PER_GROUP, await $.session.id())
      const entry = list[index - 1]
      if (!entry) return { text: `${index}번 세션이 없어요. /desk-sessions 로 목록을 다시 열어 주세요.` }
      await openSession($, entry)
      return { text: `${index}번 세션: ${entry.title}` }
    }
    await refreshSessions($)
    await $.ui.open({ id: SESSIONS_PANE, title: '세션', focus: true })
    return { text: '세션 패널을 열었습니다.' }
  })

  on('command.run', { command: 'desk-context' }, async $ => {
    await openContext($)
    return { text: '컨텍스트 패널을 열었습니다.' }
  })

  on('command.run', { command: 'desk-diff' }, async $ => {
    await refreshDiff($)
    await $.ui.open({ id: PANE, title: '변경 사항', focus: true })
    return { text: '변경 사항 패널을 열었습니다.' }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    // 턴 끝 카드용: 성공한 편집만 파일별 +/− 로 모은다
    const tool = String(e.tool)
    if (FILE_EDITING.has(tool) && !ran.isError) {
      const fields = fieldsOf(e)
      const path = stringField(fields, 'file_path') ?? stringField(fields, 'notebook_path')
      const stat = diffStat({ tool, input: e, isRunning: false, isErrored: false, isInterrupted: false })
      if (path && stat) {
        await update($, pendingEdits, list => mergeEdit(list, { path, ...stat }))
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
      return peerRow(els, $, e.props.from?.name ?? 'agent', e.props.text, openState, e.viewport?.columns ?? 80, await read($, richButtons))
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
            bubbleLines(Text, wrapText(text, Math.floor(columns * 0.85) - 6), face.bubble)
          ) : (
            <Box width={width} borderStyle="round" borderColor={COLORS.border} paddingX={1}>
              <Text color={COLORS.text}>{text}</Text>
            </Box>
          ))}
      </Box>
    )
  })

  // 어시스턴트 답변: 서명·불릿 없이 데스크톱 산문 스타일 마크다운.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isSummary) {
      return next(e)
    }
    const els = $.ui.resolve(e)
    const face = await read($, surface)
    const columns = (e.viewport?.columns ?? 80) - 2

    return (
      <els.Box flexDirection="column" marginTop={e.props.isFirstOfReply ? 1 : 0}>
        {renderMarkdown(e.props.text, els, { ...COLORS, ...(face ? { codeBg: face.bubble } : {}) }, columns, { onCopy: (source, press) => void copyText($, source, press, '코드') })}
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
    if (plan.kind === 'run') return runLine(els, $, plan.first, plan.calls, openState, e.viewport?.columns ?? 80, await read($, richButtons))
    return callLine(els, $, asRunCall(e.props), openState, e.viewport?.columns ?? 80, await read($, richButtons))
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
    if (plan.kind === 'run') return runLine(els, $, plan.first, plan.calls, openState, e.viewport?.columns ?? 80, await read($, richButtons))
    return runLine(els, $, e.requestId, e.props.calls.map(asRunCall), openState, e.viewport?.columns ?? 80, await read($, richButtons))
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
    const meter = contextMeter(els, $, await read($, usage), chipMode, await read($, richButtons))
    const reserve = meter === null ? 0 : meter.width + 1
    const repoChin = info === null ? null : await chinBand($, els, info, e.props.bodyColumns - reserve)
    // 컨텍스트 칩은 아래턱 알약 오른쪽 바깥에(버튼에는 색을 줄 수 없어 알약 안에 넣지 않는다).
    const chin =
      meter === null ? repoChin : (
        <els.Box columnGap={1} paddingX={repoChin === null ? 1 : 0}>
          {repoChin}
          {meter.node}
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
            onPress={press => void copyText($, answer, press, '답변')}
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

    return (
      <Box flexDirection="column">
        {head}
        <Box flexDirection="column" width={width} borderStyle="round" borderColor={COLORS.border} paddingX={1}>
          <Box justifyContent="space-between">
            <Text color={COLORS.text} bold>
              {`Edited ${card.files.length} file${card.files.length === 1 ? '' : 's'}`}
            </Text>
            {diffChips(Text, added, removed)}
          </Box>
          {shown.map(file => (
            <Box justifyContent="space-between">
              <Text color={COLORS.text} wrap="truncate-start">
                {name(file.path)}
              </Text>
              {diffChips(Text, file.added, file.removed)}
            </Box>
          ))}
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
    const rich = await read($, richButtons)
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
          <Text color={COLORS.text} bold>
            {`최근 세션 ${list.length}개`}
          </Text>
          <Button key="sessions-refresh" plain dimColor label="↻" onPress={() => refreshSessions($)} />
        </Box>
        <Input
          key="sessions-search"
          label="검색"
          placeholder="제목이나 폴더"
          value={query}
          submitLabel="첫 결과 열기"
          autoFocus
          onInput={value => void update($, sessionQuery, () => value)}
          onSubmit={value => {
            const first = filterSessions(list, value).find(entry => entry.id !== current)
            if (first) void openSession($, first)
          }}
        />
        {query.trim() !== '' && shown.length === 0 && <Text color={COLORS.muted}>맞는 세션이 없어요.</Text>}
        {groupSessions(shown, cwd).map(group => (
          <Box key={`group-${group.cwd}`} flexDirection="column">
            <Text color={group.cwd === cwd ? COLORS.clay : COLORS.muted} bold wrap="truncate-start">
              {label(group.cwd)}
            </Text>
            {group.sessions.slice(0, PER_GROUP).map(entry => (
              <Box key={`session-${entry.id}`} columnGap={1}>
                <Text color={entry.id === current ? COLORS.clay : COLORS.muted}>
                  {entry.id === current ? ' ●' : String(order.indexOf(entry.id) + 1).padStart(2)}
                </Text>
                {rowButton(
                  els,
                  rich,
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

  // 우측 diff 패널: 파일별 +/− 요약과 헌크.
  // 컨텍스트 패널: /context 의 항목별 내역을 막대로, 그 아래 사용 한도와 비용.
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
          <Text color={COLORS.text} bold>
            컨텍스트
          </Text>
          {percent !== null && <Text color={COLORS[meterLevel(percent)]}>{`${ring(percent)} ${percent}%`}</Text>}
          <Button key="context-refresh" plain dimColor label="↻" onPress={() => void refreshBreakdown($).catch(() => undefined)} />
        </Box>
        {percent === null ? (
          <Text color={COLORS.muted}>아직 모델 응답이 없어서 사용량을 몰라요.</Text>
        ) : (
          <Box flexDirection="column">
            <Text color={COLORS[meterLevel(percent)]}>{meterBar(percent, width)}</Text>
            <Text color={COLORS.muted}>
              {[
                live?.tokens != null ? `${formatTokens(live.tokens)} / ${formatTokens(live.window)} 토큰` : `창 ${formatTokens(live?.window ?? 0)} 토큰`,
                detail?.compactAt != null ? `자동 압축 ${formatTokens(detail.compactAt)}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </Box>
        )}
        {detail && (
          <Box flexDirection="column">
            <Text color={COLORS.muted}>{`항목별 · ${detail.model} · 추정`}</Text>
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
            <Text color={COLORS.muted}>사용 한도</Text>
            {live.limits.map(limit => {
              const left = resetIn(limit.resetsAt, live.at)
              const name = LIMIT_NAMES[limit.kind] ?? limit.kind
              const limitWidth = Math.max(...live.limits.map(item => cellWidth(LIMIT_NAMES[item.kind] ?? item.kind)))
              return (
                <Box key={`limit-${limit.kind}`} columnGap={1}>
                  <Text color={COLORS.text}>{name + ' '.repeat(Math.max(0, limitWidth - cellWidth(name)))}</Text>
                  <Text color={COLORS[meterLevel(limit.percentUsed)]}>{meterBar(limit.percentUsed, 10)}</Text>
                  <Text color={COLORS.text}>{`${limit.percentUsed}%`.padStart(4)}</Text>
                  {left && <Text color={COLORS.muted}>{`${left} 뒤 초기화`}</Text>}
                </Box>
              )
            })}
          </Box>
        )}
        {live?.costUsd != null && <Text color={COLORS.muted}>{`이 세션 비용 $${live.costUsd.toFixed(2)}`}</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const files = await read($, diff)
    const armed = await read($, open)
    const info = await read($, repo)
    const added = files.reduce((sum, file) => sum + file.added, 0)
    const removed = files.reduce((sum, file) => sum + file.removed, 0)
    const empty = info?.isRepo === false ? 'git 저장소가 아니라서 보여 줄 diff가 없어요.' : '커밋되지 않은 변경이 없어요.'

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box columnGap={1}>
          <Text color={COLORS.text} bold>
            {files.length > 0 ? `Edited ${files.length} file${files.length === 1 ? '' : 's'}` : '변경 사항'}
          </Text>
          {files.length > 0 && diffChips(Text, added, removed)}
          <Button key="refresh" plain dimColor label="↻" onPress={() => refreshDiff($)} />
        </Box>
        {files.length === 0 && <Text color={COLORS.muted}>{empty}</Text>}
        {files.map(file => (
          <Box key={`file-${file.path}`} flexDirection="column">
            <Box columnGap={1}>
              <Text color={COLORS.text} wrap="truncate-start">
                {file.path}
              </Text>
              {file.isNew && <Text color={COLORS.muted}>new</Text>}
              {diffChips(Text, file.added, file.removed)}
              {!file.isNew && (
                <Button
                  key={`revert-${file.path}`}
                  plain
                  dimColor={!armed[`revert:${file.path}`]}
                  label={armed[`revert:${file.path}`] ? '다시 누르면 되돌려요' : '되돌리기'}
                  onPress={() => void revertFile($, file.path, armed[`revert:${file.path}`] ?? false)}
                />
              )}
            </Box>
            {file.patch ? (
              <Code source={file.patch} path={file.path} format="diff" />
            ) : (
              <Text color={COLORS.muted}>바이너리 또는 모드 변경</Text>
            )}
          </Box>
        ))}
      </Box>
    )
  })
}

// 명령 출력이 마크다운인지: 표·제목·코드 블록·인용이 하나라도 있으면.
export function looksLikeMarkdown(text: string): boolean {
  return parseBlocks(text).some(block => block.kind === 'table' || block.kind === 'heading' || block.kind === 'code' || block.kind === 'quote')
}

export function askHint(question: { kind: string; multiSelect: boolean }): string {
  const how = question.kind !== 'choice' ? '입력칸을 클릭해 답하기' : question.multiSelect ? '숫자로 고르고 0 제출' : '숫자로 고르기'
  return `  ${how} · 9 기본 창 · Esc 취소`
}

// 질문 카드(입력창 위 띠). 묻는 상태와 도구 호출 훅은 ask.tsx, 그리기와 버튼은 여기($ 는 파일을 넘지 못한다).
async function replyAsk($: EngineInterface, dir: string, payload: AskReply) {
  await $.process.run(['sh', '-c', ASK_WRITE, 'sh', dir, JSON.stringify(payload)], { timeoutMs: 3000 })
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
  const rich = await read($, richButtons)
  const done = (card: ReturnType<typeof h>) => ({ card, rows })
  const picks = state.picks[state.step] ?? []
  const text = state.texts[state.step] ?? ''
  const total = state.questions.length
  const isLast = state.step + 1 === total
  const k = `${state.id}-${state.step}`
  const setText = (value: string) =>
    update($, asking, current =>
      current && current.id === state.id ? { ...current, texts: current.texts.map((item, index) => (index === current.step ? value : item)) } : current,
    )
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
          {question.header !== '' && <Text color={COLORS.clay} bold>{`${question.header} `}</Text>}
          {total > 1 && <Text color={COLORS.muted}>{`${state.step + 1}/${total} `}</Text>}
          <Text color={COLORS.text} bold>
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
            <Button key={`ask-engine-${k}`} plain hotkey="9" label="기본 창에서 답하기" onPress={() => void replyAsk($, state.dir, { kind: 'engine' })} />
          )}
          {question.multiSelect && (
            <Button key={`ask-next-${k}`} plain hotkey="0" label={isLast ? '제출' : '다음 →'} onPress={() => void advanceAsk($, state, picks, text)} />
          )}
        </Box>
      </Box>
    )
  }

  if (compact) {
    return done(
      <Box flexDirection="column" width={width} borderStyle="round" borderColor={COLORS.clay} paddingX={1}>
        <Text wrap="truncate-end">
          {question.header !== '' && <Text color={COLORS.clay} bold>{`${question.header} `}</Text>}
          {total > 1 && <Text color={COLORS.muted}>{`${state.step + 1}/${total} `}</Text>}
          <Text color={COLORS.text} bold>
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
          <Button key={`ask-engine-${k}`} plain hotkey="9" label="기본 창에서 답하기" onPress={() => void replyAsk($, state.dir, { kind: 'engine' })} />
        )}
        {question.multiSelect && (
          <Button key={`ask-next-${k}`} hotkey="0" label={isLast ? '제출' : '다음 →'} onPress={() => void advanceAsk($, state, picks, text)} />
        )}
      </Box>
    )
  }

  return done(
    <Box flexDirection="column" width={width} borderStyle="round" borderColor={COLORS.clay} paddingX={1}>
      <Box columnGap={1}>
        {question.header !== '' && (
          <Text color={COLORS.clay} bold>
            {question.header}
          </Text>
        )}
        {total > 1 && <Text color={COLORS.muted}>{`${state.step + 1}/${total}`}</Text>}
      </Box>
      <Text color={COLORS.text} bold>
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
                  rich,
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
          {question.options.some(option => option.preview) && <Text color={COLORS.muted}>선택지에 마우스를 올리면 미리보기</Text>}
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
          label={question.kind === 'choice' ? 'Other' : `답${unit}`}
          placeholder={question.placeholder ?? (question.kind === 'number' ? '숫자' : '두 번 클릭해서 입력')}
          value={text}
          submitLabel={isLast ? '제출' : '다음'}
          onInput={value => void setText(value)}
          onSubmit={value => void advanceAsk($, state, question.multiSelect ? picks : [], value)}
        />
      </Box>
      <Box columnGap={2}>
        {question.multiSelect && (
          <Button key={`ask-next-${k}`} hotkey="0" label={isLast ? '제출' : '다음 →'} onPress={() => void advanceAsk($, state, picks, text)} />
        )}
        <Button key={`ask-engine-${k}`} plain dimColor hotkey="9" label="기본 창으로" onPress={() => void replyAsk($, state.dir, { kind: 'engine' })} />
        <Button key={`ask-close-${k}`} plain dimColor label="닫기" onPress={() => void replyAsk($, state.dir, { kind: 'dismiss' })} />
      </Box>
    </Box>
  )
}

// 데스크톱 입력창의 회색 아래턱: 폭을 채운 알약 띠, 왼쪽에 저장소·브랜치, 오른쪽에 diff 칩.
// omarchy 테마를 못 읽으면 띠 없이 칩만.
async function chinBand($: EngineInterface, els: Elements['terminal'], info: RepoInfo, columns: number) {
  const { Box, Text } = els
  const face = await read($, surface)
  const files = await read($, diff)
  const added = files.reduce((sum, file) => sum + file.added, 0)
  const removed = files.reduce((sum, file) => sum + file.removed, 0)
  if (!face) {
    return (
      <Box columnGap={2} paddingX={1}>
        <Text color={COLORS.muted}>{info.name}</Text>
        {info.branch && <Text color={COLORS.muted}>{info.branch}</Text>}
        {files.length > 0 && diffChips(Text, added, removed)}
      </Box>
    )
  }
  const left = chinLabel(info.name, info.branch)
  const chips = files.length > 0 ? ` +${added}  −${removed} ` : ''
  const gap = Math.max(1, columns - 2 - cellWidth(left) - cellWidth(chips) - 1)
  return (
    <Text>
      <Text color={face.bubble}>{EDGES.single[0]}</Text>
      <Text color={COLORS.muted} backgroundColor={face.bubble}>
        {left}
      </Text>
      <Text backgroundColor={face.bubble}>{' '.repeat(gap)}</Text>
      {files.length > 0 && diffChips(Text, added, removed)}
      <Text backgroundColor={face.bubble}> </Text>
      <Text color={face.bubble}>{EDGES.single[1]}</Text>
    </Text>
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
        <Text color={COLORS.text} bold>
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
            <Text color={style.text} bold={item.status === 'in_progress'}>
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

function bubbleLines(Text: Elements['terminal']['Text'], lines: string[], fill: string) {
  const edges = bubbleEdges(lines.length)
  const edge = (glyph: string | null) =>
    glyph === null ? <Text backgroundColor={fill}> </Text> : <Text color={fill}>{glyph}</Text>
  return (
    <>
      {bubbleRows(lines).map((row, index) => (
        <Text>
          {edge(edges[index]?.[0] ?? null)}
          <Text color={COLORS.text} backgroundColor={fill}>
            {row}
          </Text>
          {edge(edges[index]?.[1] ?? null)}
        </Text>
      ))}
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
