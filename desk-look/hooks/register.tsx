import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, ToolGroupCall } from 'claude-code'

import type { FileDiff, ImageInfo, RepoInfo, RunCall, Runs, SessionEntry, Surface, TurnCard, TurnEdit } from '../types'
import { IMAGE_TOKEN, LIST_IMAGES, parseImages, supportsGraphics, thumbnailSize } from './images'
import { cellWidth, renderMarkdown } from './markdown'
import { computeRuns } from './runs'
import { LIST_SESSIONS, ago, clip, groupSessions, numbered, parseSessions } from './sessions'
import { OMARCHY_COLORS, parseSurface } from './theme'

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
} as const

const PANE = 'desk-diff'
const SESSIONS_PANE = 'desk-sessions'
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

const FILE_EDITING = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const CARD_ROWS = 3

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

type Category = 'command' | 'read' | 'edit' | 'create' | 'search' | 'web' | 'agent' | 'todo' | 'other'

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
  const summary =
    (tool === 'Bash' ? stringField(fields, 'command') : undefined) ??
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

function verbOf(tool: string): string {
  const category = categoryOf(tool)
  if (category !== 'other') return VERB[category]
  // mcp__server__tool → tool
  return `Used ${tool.startsWith('mcp__') ? (tool.split('__').pop() ?? tool) : tool}`
}

const lineCount = (text: unknown) => (typeof text === 'string' && text.length > 0 ? text.split('\n').length : 0)

// Edit 의 old/new 는 바꾼 줄 앞뒤 문맥 줄을 함께 담는다. 앞뒤 공통 줄을 걷어내고 남은 줄만 센다.
export function lineChange(oldText: string, newText: string): { added: number; removed: number } {
  const before = oldText === '' ? [] : oldText.split('\n')
  const after = newText === '' ? [] : newText.split('\n')
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head++
  let tail = 0
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++
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

export function editHunk(oldText: string, newText: string): string {
  const removed = oldText.split('\n')
  const added = newText.split('\n')
  return [
    `@@ -1,${removed.length} +1,${added.length} @@`,
    ...removed.map(line => `-${line}`),
    ...added.map(line => `+${line}`),
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

const toggle = ($: EngineInterface, id: string) => update($, open, state => ({ ...state, [id]: !state[id] }))

async function refreshSurface($: EngineInterface) {
  const ran = await $.process.run(['sh', '-c', `cat "${OMARCHY_COLORS}"`], { timeoutMs: 2000 })
  const next = ran.exitCode === 0 ? parseSurface(ran.stdout) : null
  await update($, surface, previous => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next))
}

async function refreshImages($: EngineInterface) {
  const ran = await $.process.run(['sh', '-c', LIST_IMAGES, 'sh', await $.session.id()], { timeoutMs: 3000 })
  const next = ran.exitCode === 0 ? parseImages(ran.stdout) : {}
  await update($, images, previous => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next))
}

async function refreshSessions($: EngineInterface) {
  const ran = await $.process.run(['sh', '-c', LIST_SESSIONS, 'sh', '40'], { timeoutMs: 5000 })
  const next = ran.exitCode === 0 ? parseSessions(ran.stdout) : []
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

async function refreshRuns($: EngineInterface) {
  const next = computeRuns(await $.session.messages())
  await update($, runs, previous => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next))
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
      return (
        <Code
          source={editHunk(stringField(fields, 'old_string') ?? '', stringField(fields, 'new_string') ?? '')}
          path={filePath}
          format="diff"
        />
      )
    case 'Write':
      return <Code source={cap(stringField(fields, 'content') ?? '', 40)} path={filePath} />
    default:
      return <Text color={COLORS.muted}>{cap(output || JSON.stringify(call.input, null, 2), 20)}</Text>
  }
}

// 호출 한 줄: "Edited register.tsx +12 −3 ›", 누르면 아래로 펼친다.
function callLine(els: Els, $: EngineInterface, call: RunCall, openState: Record<string, boolean>, indent = 0) {
  const { Box, Text, Button } = els
  const id = call.tool_use_id
  const isOpen = openState[id] ?? false
  const stat = diffStat(call)
  return (
    <Box flexDirection="column" paddingLeft={indent}>
      <Box columnGap={1}>
        {call.isRunning && <Text color={COLORS.clay}>···</Text>}
        <Button key={`row-${id}`} plain dimColor label={verbOf(call.tool)} onPress={() => toggle($, id)} />
        <Text color={COLORS.muted} wrap="truncate-end">
          {summarize(call.tool, call.input)}
        </Text>
        {stat && diffChips(els.Text, stat.added, stat.removed)}
        {call.isErrored && !call.isInterrupted && <Text color={COLORS.danger}>failed</Text>}
        {call.isInterrupted && <Text color={COLORS.muted}>interrupted</Text>}
        <Text color={COLORS.muted}>{isOpen ? '⌄' : '›'}</Text>
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
function runLine(els: Els, $: EngineInterface, runId: string, calls: RunCall[], openState: Record<string, boolean>) {
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
        <Button key={key} plain dimColor label={describeCalls(calls)} onPress={() => toggle($, key)} />
        {stats.length > 0 && diffChips(els.Text, added, removed)}
        <Text color={COLORS.muted}>{isOpen ? '⌄' : '›'}</Text>
      </Box>
      {isOpen && calls.map(call => callLine(els, $, call, openState, 2))}
    </Box>
  )
}

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

export const register: Register = on => {
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
    void refreshDiff($).catch(() => undefined)
    void refreshSurface($).catch(() => undefined)
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

  // 테마를 바꿨을 수 있으니 프롬프트마다 다시 읽는다 (cat 한 번).
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
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      const files = await read($, pendingEdits)
      if (files.length > 0) {
        await update($, turnCards, cards => [...cards, { durationMs: e.durationMs, files }].slice(-100))
      }
      await update($, pendingEdits, () => [])
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
    await $.ui.open({ id: SESSIONS_PANE, title: '세션' })
    return { text: '세션 패널을 열었습니다.' }
  })

  on('command.run', { command: 'desk-diff' }, async $ => {
    await refreshDiff($)
    await $.ui.open({ id: PANE, title: '변경 사항' })
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
      <Box flexDirection="column" alignItems="flex-end" marginTop={1} rowGap={attached.length > 0 && text ? 1 : 0}>
        {attached.length > 0 && (
          <Box flexDirection="row" columnGap={1} flexWrap="wrap" justifyContent="flex-end">
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
        {renderMarkdown(e.props.text, els, { ...COLORS, ...(face ? { codeBg: face.bubble } : {}) }, columns)}
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
    if (plan.kind === 'run') return runLine(els, $, plan.first, plan.calls, openState)
    return callLine(els, $, asRunCall(e.props), openState)
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
    if (plan.kind === 'run') return runLine(els, $, plan.first, plan.calls, openState)
    return runLine(els, $, e.requestId, e.props.calls.map(asRunCall), openState)
  })

  // 입력창 위 칩: "저장소  브랜치  +63 −29". 다른 플러그인의 밴드는 위에 그대로 둔다.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) {
      return next(e)
    }
    const below = await next(e)
    const info = await read($, repo)
    if (info === null) {
      return below
    }
    const { Box, Text } = $.ui.resolve(e)
    const face = await read($, surface)
    const files = await read($, diff)
    const added = files.reduce((sum, file) => sum + file.added, 0)
    const removed = files.reduce((sum, file) => sum + file.removed, 0)
    const fill = face ? { backgroundColor: face.bubble } : {}

    return (
      <Box flexDirection="column">
        {below}
        <Box columnGap={2} paddingX={1} {...fill}>
          <Text color={COLORS.muted} {...fill}>
            {info.name}
          </Text>
          {info.branch && (
            <Text color={COLORS.muted} {...fill}>
              {info.branch}
            </Text>
          )}
          {files.length > 0 && diffChips(Text, added, removed)}
        </Box>
      </Box>
    )
  })

  // 턴 끝 카드: 데스크톱의 "Edited N files +51 −37" 상자. 편집이 없던 턴은 원래 줄만 둔다.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const line = await next(e)
    if (e.surface !== 'terminal') return line
    const card = cardFor(await read($, turnCards), e.props.durationMs)
    if (!card) return line
    const { Box, Text, Button } = $.ui.resolve(e)
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
        {line}
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
  on('ui.render', { component: 'Pane', requestId: SESSIONS_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const [list, cwd, current, now, home] = await Promise.all([
      read($, sessions),
      $.session.cwd(),
      $.session.id(),
      $.clock.now(),
      $.env.get('HOME'),
    ])
    const room = Math.max(16, e.props.bodyColumns - 12)
    const label = (path: string) => (home && path.startsWith(home) ? `~${path.slice(home.length)}` : path)
    const order = numbered(list, cwd, PER_GROUP, current).map(entry => entry.id)

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box columnGap={1}>
          <Text color={COLORS.text} bold>
            {`최근 세션 ${list.length}개`}
          </Text>
          <Button key="sessions-refresh" plain dimColor label="↻" onPress={() => refreshSessions($)} />
        </Box>
        {groupSessions(list, cwd).map(group => (
          <Box key={`group-${group.cwd}`} flexDirection="column">
            <Text color={group.cwd === cwd ? COLORS.clay : COLORS.muted} bold wrap="truncate-start">
              {label(group.cwd)}
            </Text>
            {group.sessions.slice(0, PER_GROUP).map(entry => (
              <Box key={`session-${entry.id}`} columnGap={1}>
                <Text color={entry.id === current ? COLORS.clay : COLORS.muted}>
                  {entry.id === current ? ' ●' : String(order.indexOf(entry.id) + 1).padStart(2)}
                </Text>
                <Button
                  key={`open-${entry.id}`}
                  plain
                  dimColor={entry.id !== current}
                  label={clip(entry.title, room)}
                  onPress={() => openSession($, entry)}
                />
                <Text color={COLORS.muted}>{ago(entry.updatedAt, now)}</Text>
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    )
  })

  // 우측 diff 패널: 파일별 +/− 요약과 헌크.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const files = await read($, diff)
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

// 데스크톱의 초록·빨강 diff 칩.
function diffChips(Text: Elements['terminal']['Text'], added: number, removed: number) {
  return (
    <Text>
      <Text color={COLORS.success} backgroundColor="diffAddedDimmed">{` +${added} `}</Text>
      <Text color={COLORS.danger} backgroundColor="diffRemovedDimmed">{` −${removed} `}</Text>
    </Text>
  )
}
