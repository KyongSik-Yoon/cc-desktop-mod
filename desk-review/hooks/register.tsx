import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { DiffAt, ReviewItem, ReviewReport, Snippet, Stage, Status } from '../types'
import { counts, hunkAt, itemsOf, parseReport, reviewTool, sourceWindow } from './review'
import { T, langFromConfig, langSetting, setLang } from './i18n'

// 엔진 테마 키(desk-look 의 COLORS 와 같은 역할). hex 를 박으면 터미널 테마와 어긋난다.
const COLORS = {
  text: 'text',
  muted: 'inactive',
  clay: 'claude',
  success: 'success',
  danger: 'error',
} as const

const PANE = 'desk-review'

const report = atom({ plugin: 'desk-review', key: 'report' } as const, null as ReviewReport | null)
const open = atom({ plugin: 'desk-review', key: 'open' } as const, {} as Record<string, boolean>)
const snippets = atom({ plugin: 'desk-review', key: 'snippets' } as const, {} as Record<string, Snippet>)
const diffAt = atom({ plugin: 'desk-review', key: 'diffAt' } as const, null as DiffAt | null)

const STATUS_COLOR: Record<Status, string> = { fixed: COLORS.success, skipped: COLORS.muted, found: COLORS.danger, dismissed: COLORS.muted }
const STATUS_MARK: Record<Status, string> = { fixed: '✓', skipped: '–', found: '✕', dismissed: '○' }

async function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: T.paneTitle, focus: true })
}

// 모델이 넘긴 보고서를 받아 둔다. 새 보고서면 펼침·조각을 비운다.
async function takeReport($: EngineInterface, input: Record<string, unknown>) {
  const cwd = await $.session.cwd().catch(() => '')
  const before = await read($, report)
  const parsed = parseReport(input, cwd, (before?.id ?? 0) + 1)
  if ('error' in parsed) return parsed
  await update($, open, () => ({}))
  await update($, snippets, () => ({}))
  await update($, report, () => parsed.report)
  const opened = await openPane($).catch(() => null)
  return { report: parsed.report, isPlaced: opened?.isPlaced ?? false }
}

// 고친 항목의 diff: 커밋 안 한 변경에서 그 줄을 담은 헌크. HEAD 가 없는 저장소(첫 커밋 전)는 스테이지 기준.
// 바뀐 게 없거나(이미 커밋, git 이 모르는 새 파일) git 밖이면 null — 그때는 소스를 보인다.
async function diffSnippet($: EngineInterface, item: ReviewItem): Promise<Snippet | null> {
  const opts = { timeoutMs: 8000 }
  const head = await $.process.run(['git', 'diff', 'HEAD', '--no-color', '--no-ext-diff', '-U3', '--', item.path], opts).catch(() => null)
  const ran = head?.exitCode === 0 ? head : await $.process.run(['git', 'diff', '--no-color', '--no-ext-diff', '-U3', '--', item.path], opts).catch(() => null)
  const hunk = ran?.exitCode === 0 ? hunkAt(ran.stdout, item.line) : null
  return hunk === null ? null : { kind: 'diff', source: hunk }
}

// 지금 파일을 읽어 그 줄 둘레를 자른다(보고서를 만든 때가 아니라 지금 소스).
async function sourceSnippet($: EngineInterface, item: ReviewItem): Promise<Snippet> {
  return $.fs.read(item.path).then(
    text => sourceWindow(text, item.line),
    (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
  )
}

// 항목을 펴고 접는다. 처음 펼 때 조각을 만들어 둔다: 고친 항목은 그 자리 diff, 나머지는 지금 소스.
async function toggleItem($: EngineInterface, index: number, item: ReviewItem) {
  const key = String(index)
  const isOpening = !((await read($, open))[key] ?? false)
  await update($, open, state => ({ ...state, [key]: isOpening }))
  if (!isOpening) return
  const diffed = item.status === 'fixed' ? await diffSnippet($, item) : null
  const snippet = diffed ?? (await sourceSnippet($, item))
  await update($, snippets, state => ({ ...state, [key]: snippet }))
}

// desk-look 의 diff 패널을 이 파일에서 연다. 매번 n 을 올려 같은 파일을 다시 눌러도 state.set 이 불리게 한다.
async function showDiff($: EngineInterface, path: string) {
  await update($, diffAt, current => ({ path, n: (current?.n ?? 0) + 1 }))
}

function heading(els: Elements['terminal'], label: string) {
  const { Text } = els
  return (
    <Text color={COLORS.text} weight="semibold">
      {label}
    </Text>
  )
}

async function itemBlock($: EngineInterface, els: Elements['terminal'], item: ReviewItem, index: number, isOpen: boolean, snippet: Snippet | undefined) {
  const { Box, Text, Button, Code } = els
  const label = T[item.status]
  const row = (
    <Button key={`item-${index}`} plain dimColor={!isOpen} onPress={() => void toggleItem($, index, item)}>
      <Text color={STATUS_COLOR[item.status]}>{`${isOpen ? '▾' : '▸'} ${STATUS_MARK[item.status]} ${label} `}</Text>
      <Text color={COLORS.text}>{`${item.file}:${item.line}`}</Text>
    </Button>
  )
  const body = !isOpen ? null : snippet === undefined ? (
    <Text color={COLORS.muted}>{T.loading}</Text>
  ) : 'error' in snippet ? (
    <Text color={COLORS.danger}>{T.unreadable(snippet.error)}</Text>
  ) : (
    <Box flexDirection="column">
      {snippet.kind === 'source' && snippet.line !== item.line && <Text color={COLORS.muted}>{T.shifted(item.line, snippet.line)}</Text>}
      {snippet.kind === 'diff' ? <Code source={snippet.source} path={item.path} format="diff" /> : <Code source={snippet.source} path={item.path} startLine={snippet.startLine} />}
      <Button key={`diff-${index}`} plain dimColor label={T.openDiff} onPress={() => void showDiff($, item.path)} />
    </Box>
  )
  return (
    <Box key={`block-${index}`} flexDirection="column">
      {row}
      <Box flexDirection="column" paddingLeft={4}>
        <Text color={COLORS.muted}>{item.reason}</Text>
        {body}
      </Box>
    </Box>
  )
}

async function stageBlock($: EngineInterface, els: Elements['terminal'], state: ReviewReport, stage: Stage, opened: Record<string, boolean>, cut: Record<string, Snippet>) {
  const { Box, Text } = els
  const rows = itemsOf(state, stage)
  const blocks = await Promise.all(rows.map(({ item, index }) => itemBlock($, els, item, index, opened[String(index)] ?? false, cut[String(index)])))
  return (
    <Box flexDirection="column">
      {heading(els, stage === 'simplify' ? T.simplify : T.review)}
      {blocks.length > 0 ? blocks : <Text color={COLORS.muted}>{T.none}</Text>}
    </Box>
  )
}

function textBlock(els: Elements['terminal'], label: string, value: string) {
  const { Box, Text } = els
  return (
    <Box flexDirection="column">
      {heading(els, label)}
      <Text color={value === '' ? COLORS.muted : COLORS.text}>{value === '' ? T.none : value}</Text>
    </Box>
  )
}

// 설정 language 가 auto 일 때: desk-look 이 고른 언어, 아직 없으면 Claude Code /config 의 language.
async function pickLang($: EngineInterface) {
  const { value } = await $.state.get({ plugin: 'desk-look', key: 'lang' })
  if (value === 'en' || value === 'ko') return setLang(value)
  const row = (await $.config.list().catch(() => [])).find(item => item.key === 'language')
  return setLang(langFromConfig(row?.value))
}

export const register: Register = (on, options) => {
  const language = langSetting(options)
  setLang(language === 'auto' ? 'en' : language)

  on('session.start', async ($, e, next) => {
    if (language === 'auto' && (await pickLang($).catch(() => false))) $.ui.invalidate('ui.render')
    // 도구를 못 걸어도(엔진이 거절) 명령은 그대로 건다. 스킬은 도구가 없으면 Markdown 보고로 대신한다.
    await $.tool.register(reviewTool()).catch(() => undefined)
    await $.command.register({ name: 'desk-review', description: T.cmdReview, immediate: true })
    return next(e)
  })

  on('state.set', { plugin: 'desk-look', key: 'lang' }, async ($, e, next) => {
    const done = await next(e)
    if (language === 'auto' && (e.value === 'en' || e.value === 'ko') && setLang(e.value)) $.ui.invalidate('ui.render')
    return done
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'mcp__desk-review__review_report' }, async ($, e) => {
    const taken = await takeReport($, e as unknown as Record<string, unknown>)
    if ('error' in taken) return { deny: taken.error }
    const n = counts(taken.report)
    const tally = `${n.fixed} fixed, ${n.skipped} skipped, ${n.found} found, ${n.dismissed} dismissed`
    return {
      result: taken.isPlaced
        ? `Shown in the desk-review pane (${tally}). Reply with the one-line summary only; do not repeat the items.`
        : `Kept the report (${tally}), but the pane could not open here (a narrow terminal, or no terminal); the person can open it with /desk-review. Reply with the one-line summary only.`,
    }
  })

  on('command.run', { command: 'desk-review' }, async $ => {
    if ((await read($, report)) === null) return { text: T.noReport }
    await openPane($)
    return { text: T.opened }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const [state, opened, cut] = await Promise.all([read($, report), read($, open), read($, snippets)])
    if (state === null) return <Text color={COLORS.muted}>{T.noReport}</Text>
    const n = counts(state)
    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="column">
          {heading(els, T.summary)}
          <Text color={COLORS.text}>{state.summary}</Text>
          <Text color={COLORS.muted}>{T.counts(n.fixed, n.skipped, n.found, n.dismissed)}</Text>
        </Box>
        {await stageBlock($, els, state, 'simplify', opened, cut)}
        {await stageBlock($, els, state, 'review', opened, cut)}
        {textBlock(els, T.unverified, state.unverified)}
        {textBlock(els, T.next, state.next)}
      </Box>
    )
  })
}
