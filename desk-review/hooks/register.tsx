import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { DiffAt, ReviewItem, ReviewReport, Stage, Status } from '../types'
import { counts, itemsOf, parseReport, reviewTool } from './review'
import { T, langFromConfig, langSetting, setLang } from './i18n'
import { withJumps } from './shared/jumps'

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
const diffAt = atom({ plugin: 'desk-review', key: 'diffAt' } as const, null as DiffAt | null)

const STATUS_COLOR: Record<Status, string> = { fixed: COLORS.success, skipped: COLORS.muted, found: COLORS.danger, dismissed: COLORS.muted }
const STATUS_MARK: Record<Status, string> = { fixed: '✓', skipped: '–', found: '✕', dismissed: '○' }

async function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: T.paneTitle, focus: true })
}

// 모델이 넘긴 보고서를 받아 둔다.
async function takeReport($: EngineInterface, input: Record<string, unknown>) {
  const cwd = await $.session.cwd().catch(() => '')
  const before = await read($, report)
  const parsed = parseReport(input, cwd, (before?.id ?? 0) + 1)
  if ('error' in parsed) return parsed
  await update($, report, () => parsed.report)
  const opened = await openPane($).catch(() => null)
  return { report: parsed.report, isPlaced: opened?.isPlaced ?? false }
}

// desk-look 의 diff 패널을 이 파일의 그 줄에서 연다. 매번 n 을 올려 같은 파일을 다시 눌러도 state.set 이 불리게 한다.
// 사람이 이 패널을 잡고 있으면 엔진이 desk-look 패널의 focus 를 거절해 변경 사항 탭이 이 탭 뒤에 열린다.
// desk-look 은 남의 패널을 닫을 수 없으니 desk-look 의 openInFront 처럼 여기서 순서를 잡는다:
// 이 패널을 닫고 → desk-look 이 변경 사항 탭을 연 뒤 → 이 패널을 그 뒤에 다시 연다.
async function showDiff($: EngineInterface, path: string, line: number) {
  const panes = await $.ui.panes().catch(() => [])
  const isFront = panes.some(item => item.isShown && item.id === PANE)
  if (isFront) await $.ui.close({ id: PANE })
  await update($, diffAt, current => ({ path, line, n: (current?.n ?? 0) + 1 }))
  if (isFront) await $.ui.open({ id: PANE, title: T.paneTitle })
}

function heading(els: Elements['terminal'], label: string) {
  const { Text } = els
  return (
    <Text color={COLORS.text} weight="semibold">
      {label}
    </Text>
  )
}

// 항목: 상태·경로:줄 머리줄과 그 아래 이유. 좁은 패널이라 코드는 싣지 않고, 머리줄을 누르면 desk-look 변경 사항 탭에서 그 파일을 연다.
function itemBlock($: EngineInterface, els: Elements['terminal'], item: ReviewItem, index: number) {
  const { Box, Text, Button } = els
  const tone = STATUS_COLOR[item.status]
  // 경로는 폴더를 흐리게, 파일 이름을 굵게, 줄 번호를 강조색으로 해서 눈이 파일 이름에 먼저 가게 한다.
  const cut = item.file.lastIndexOf('/') + 1
  // 항목마다 상태 색 세로 막대로 묶어, 이유가 어느 항목 것인지 한눈에 갈리게 한다.
  return (
    <Box key={`block-${index}`} flexDirection="column" borderStyle="quote" borderColor={tone} paddingLeft={1}>
      <Button key={`item-${index}`} plain onPress={() => void showDiff($, item.path, item.line)}>
        <Text color={tone} weight="semibold">{`${STATUS_MARK[item.status]} ${T[item.status]}  `}</Text>
        <Text color={COLORS.muted}>{item.file.slice(0, cut)}</Text>
        <Text color={COLORS.text} weight="semibold">
          {item.file.slice(cut)}
        </Text>
        <Text color={COLORS.clay}>{`:${item.line}`}</Text>
        <Text color={COLORS.muted}>{' ◫'}</Text>
      </Button>
      <Box paddingLeft={2}>
        <Text color={COLORS.text}>{item.reason}</Text>
      </Box>
    </Box>
  )
}

function stageBlock($: EngineInterface, els: Elements['terminal'], state: ReviewReport, stage: Stage) {
  const { Box, Text } = els
  const rows = itemsOf(state, stage)
  const blocks = rows.map(({ item, index }) => itemBlock($, els, item, index))
  return (
    // quote 테두리가 위아래에 빈 행을 하나씩 두므로 항목 사이는 따로 띄우지 않는다.
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

// 패널이 그리는 범위(ui.render 의 e 에서 쓰는 것만). 테스트 하네스처럼 창을 모르는 곳에서는 버튼 없이 그린다.
type PaneSite = { requestId: string; props: { scroll?: { bodyRows: number }; bodyColumns?: number } }

// 긴 패널의 맨 위에 "끝으로", 맨 아래에 "처음으로"(shared/jumps.tsx). 사람의 End·Home 과 같은 곳으로 창을 옮긴다.
function paneJumps($: EngineInterface, els: Elements['terminal'], e: PaneSite, tree: unknown) {
  return withJumps(els, tree, {
    bodyRows: e.props.scroll?.bodyRows ?? 0,
    columns: e.props.bodyColumns ?? 80,
    toEnd: { label: T.jumpEnd, onPress: () => void $.ui.scroll({ in: e.requestId, to: 'end' }).catch(() => undefined) },
    toStart: { label: T.jumpStart, onPress: () => void $.ui.scroll({ in: e.requestId, to: 'start' }).catch(() => undefined) },
  })
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
    const state = await read($, report)
    if (state === null) return <Text color={COLORS.muted}>{T.noReport}</Text>
    const n = counts(state)
    return paneJumps($, els, e, (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="column">
          {heading(els, T.summary)}
          <Text color={COLORS.text}>{state.summary}</Text>
          <Text color={COLORS.muted}>{T.counts(n.fixed, n.skipped, n.found, n.dismissed)}</Text>
        </Box>
        {stageBlock($, els, state, 'simplify')}
        {stageBlock($, els, state, 'review')}
        {textBlock(els, T.unverified, state.unverified)}
        {textBlock(els, T.next, state.next)}
      </Box>
    ))
  })
}
