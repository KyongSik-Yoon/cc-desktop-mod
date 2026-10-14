import type { Elements } from 'claude-code'

import { cellWidth } from './markdown'
import { mix } from './theme'

// 데스크톱 Code 탭 diff 모양: 줄 전체 폭 연초록·연분홍, 왼쪽 색 세로줄, 번호 한 칸, 추가·삭제 모두 문법 색,
// 바뀐 단어는 더 진하게, 안 바뀐 구간은 "N unmodified lines" 한 줄로.
// 엔진 Code 는 색을 바꿀 수 없어 줄마다 배경 Box 를 깔고 그 위에 문법 색만 Code 로 그린다(줄당 Code 하나라 비싸다:
// 패널은 보이는 행만 그린다). 모든 행 높이가 정해져 있어(줄은 한 행으로 자른다) 행 번호로 위치를 셀 수 있다.

type Els = Elements['terminal']

export type DiffLine = { kind: ' ' | '+' | '-'; text: string; oldNo: number; newNo: number }
export type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: DiffLine[] }

// 그릴 행: 줄 하나(1행), 또는 안 바뀐 구간 표시(위아래 빈 줄을 포함해 GAP_ROWS 행).
export type DiffRow = { kind: 'line'; line: DiffLine; span?: [number, number] } | { kind: 'gap'; count: number }
export const GAP_ROWS = 3
export const rowHeight = (row: DiffRow) => (row.kind === 'gap' ? GAP_ROWS : 1)

export type DiffPalette = { addBg: string; delBg: string; addStrong: string; delStrong: string; addBar: string; delBar: string; muted: string }

// 틴트는 터미널 바탕에 초록·빨강을 섞어 만든다: 고정 색은 바탕(흰색·회색·짙은 색)에 따라 묻히거나 튄다.
// 256색으로 그려질 때(엔진이 줄인다)는 섞은 색이 가까운 팔레트 칸으로 뭉개진다: 진한 강조가 바탕과 같은 칸이 되거나
// 초록이 청록 칸으로 간다. 그래서 xterm 256색 팔레트에 있는 색을 그대로 골라 둔다(줄여도 제자리).
const PALETTE_256 = {
  light: { addBg: '#d7ffd7', delBg: '#ffd7d7', addStrong: '#afd7af', delStrong: '#ffafaf', addBar: '#5faf5f', delBar: '#d75f5f' },
  dark: { addBg: '#005f00', delBg: '#5f0000', addStrong: '#008700', delStrong: '#870000', addBar: '#5fd75f', delBar: '#ff5f5f' },
} as const

// 엔진이 truecolor 로 그리는지: COLORTERM 이 truecolor·24bit 이고 tmux 밖일 때(tmux 안에서는 FORCE_COLOR=3 이어도 256색으로 줄였다).
export function isTruecolor(env: { COLORTERM?: string; TMUX?: string }): boolean {
  return /^(truecolor|24bit)$/i.test(env.COLORTERM ?? '') && !env.TMUX
}

export function diffPalette(mode: 'light' | 'dark', background: string, muted: string, truecolor = true): DiffPalette {
  if (!truecolor) return { ...PALETTE_256[mode], muted }
  const add = mode === 'light' ? '#2da44e' : '#3fb950'
  const del = mode === 'light' ? '#d1242f' : '#f85149'
  return {
    addBg: mix(background, add, 0.16),
    delBg: mix(background, del, 0.13),
    addStrong: mix(background, add, 0.38),
    delStrong: mix(background, del, 0.32),
    addBar: add,
    delBar: del,
    muted,
  }
}

const HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

// 탭은 네 칸으로 펴 둔다: 조각 폭을 칸 수로 재기 때문. Code 는 탭·줄바꿈 밖의 제어 문자(CRLF 파일의 \r 등)와
// 10000자 넘는 글을 거절해서 지우고 자른다(한 행으로 잘려 보이므로 뒤는 어차피 안 보인다).
const LINE_ROOM = 4000
const untab = (text: string) => text.replace(/\t/g, '    ').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, LINE_ROOM)

export function parseHunks(patch: string): Hunk[] {
  const hunks: Hunk[] = []
  let current: Hunk | null = null
  let oldNo = 0
  let newNo = 0
  for (const raw of patch.split('\n')) {
    const header = HEADER.exec(raw)
    if (header) {
      oldNo = Number(header[1])
      newNo = Number(header[3])
      current = { oldStart: oldNo, oldLines: Number(header[2] ?? 1), newStart: newNo, newLines: Number(header[4] ?? 1), lines: [] }
      hunks.push(current)
      continue
    }
    if (!current || raw.startsWith('\\')) continue
    const kind = raw[0] === '+' || raw[0] === '-' ? raw[0] : ' '
    const text = untab(raw.slice(1))
    if (kind === '+') current.lines.push({ kind, text, oldNo: 0, newNo: newNo++ })
    else if (kind === '-') current.lines.push({ kind, text, oldNo: oldNo++, newNo: 0 })
    else current.lines.push({ kind, text, oldNo: oldNo++, newNo: newNo++ })
  }
  return hunks
}

// 붙어 있는 −줄 묶음과 바로 뒤 +줄 묶음을 차례로 짝지어 바뀐 가운데 구간을 찾는다. 줄 대부분이 바뀌었으면 강조하지 않는다.
const TOKEN = /\w+|\s+|[^\w\s]/g

export function wordSpan(before: string, after: string): { before: [number, number]; after: [number, number] } | null {
  const a = before.match(TOKEN) ?? []
  const b = after.match(TOKEN) ?? []
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  if (head === 0 && tail === 0) return null
  const chars = (tokens: string[], from: number, to: number) => tokens.slice(from, to).join('').length
  const span = (tokens: string[], text: string): [number, number] => [chars(tokens, 0, head), text.length - chars(tokens, tokens.length - tail, tokens.length)]
  const x = span(a, before)
  const y = span(b, after)
  // 바뀐 부분이 없거나(공백만 다름) 줄의 대부분이면 강조가 오히려 시끄럽다.
  const share = Math.max((x[1] - x[0]) / Math.max(1, before.length), (y[1] - y[0]) / Math.max(1, after.length))
  if (share > 0.7) return null
  return { before: x, after: y }
}

// gaps: 첫 hunk 앞과 hunk 사이의 안 바뀐 줄 수를 행으로 넣을지(패널은 넣고, 대화 속 편집 행은 뺀다).
export function diffRows(hunks: Hunk[], gaps = true): DiffRow[] {
  const rows: DiffRow[] = []
  let oldEnd = 1
  for (const hunk of hunks) {
    const skipped = hunk.oldStart - oldEnd
    if (gaps && hunk.oldStart > 0 && skipped > 0) rows.push({ kind: 'gap', count: skipped })
    oldEnd = hunk.oldStart + hunk.oldLines
    const lines = hunk.lines
    for (let i = 0; i < lines.length; ) {
      const line = lines[i]
      if (!line || line.kind !== '-') {
        if (line) rows.push({ kind: 'line', line })
        i++
        continue
      }
      // −줄 묶음 뒤 +줄 묶음: 같은 순번끼리 단어 강조를 짝짓는다.
      let j = i
      while (lines[j]?.kind === '-') j++
      let k = j
      while (lines[k]?.kind === '+') k++
      const minus = lines.slice(i, j)
      const plus = lines.slice(j, k)
      const spans = minus.map((m, n) => (plus[n] ? wordSpan(m.text, plus[n].text) : null))
      minus.forEach((m, n) => rows.push({ kind: 'line', line: m, ...(spans[n] ? { span: spans[n].before } : {}) }))
      plus.forEach((p, n) => rows.push({ kind: 'line', line: p, ...(spans[n] ? { span: spans[n].after } : {}) }))
      i = k
    }
  }
  return rows
}

// 패치 하나의 행: 스크롤할 때마다 패널이 다시 그려지므로 패치 글 기준으로 기억해 둔다.
const rowCache = new Map<string, DiffRow[]>()
const ROW_CACHE = 400

export function patchRows(patch: string): DiffRow[] {
  const hit = rowCache.get(patch)
  if (hit) return hit
  const rows = diffRows(parseHunks(patch))
  if (rowCache.size >= ROW_CACHE) rowCache.clear()
  rowCache.set(patch, rows)
  return rows
}

// 보이는 곳만 그리기: 항목마다 높이가 있을 때, 창(첫 행·보이는 행 수) 앞뒤 한 화면과 always 인 항목만 그리고
// 나머지 연달은 항목은 높이를 합친 빈 칸 하나로.
export type WindowStep = { draw: number } | { skip: number }

export function windowPlan(items: ReadonlyArray<{ height: number; always?: boolean }>, offset: number, bodyRows: number): WindowStep[] {
  const from = offset - bodyRows
  const to = offset + 2 * bodyRows
  const steps: WindowStep[] = []
  let row = 0
  let skipped = 0
  items.forEach((item, index) => {
    const isShown = item.always || (row + item.height > from && row < to)
    if (isShown) {
      if (skipped > 0) steps.push({ skip: skipped })
      skipped = 0
      steps.push({ draw: index })
    } else skipped += item.height
    row += item.height
  })
  if (skipped > 0) steps.push({ skip: skipped })
  return steps
}

// 번호 칸 폭: 가장 큰 줄 번호 자릿수 + 표시(+/−) + 사이 칸.
export function gutterWidth(rows: DiffRow[]): number {
  const most = rows.reduce((max, row) => (row.kind === 'line' ? Math.max(max, row.line.oldNo, row.line.newNo) : max), 0)
  return String(most).length + 3
}

type RowOptions = { path?: string; gutter: number; columns: number; unmodified: (count: number) => string }

// 행 하나. key 는 패널 안에서 겹치지 않게 부르는 쪽이 준다.
export function diffRow(els: Pick<Els, 'Box' | 'Text' | 'Code'>, palette: DiffPalette, row: DiffRow, key: string, options: RowOptions) {
  const { Box, Text, Code } = els
  if (row.kind === 'gap') {
    return (
      <Box key={key} height={GAP_ROWS} flexDirection="column" justifyContent="center">
        <Text color={palette.muted} wrap="truncate-end">
          {options.unmodified(row.count)}
        </Text>
      </Box>
    )
  }
  const { line } = row
  const isAdd = line.kind === '+'
  const isDel = line.kind === '-'
  const bg = isAdd ? palette.addBg : isDel ? palette.delBg : undefined
  const number = String(isDel ? line.oldNo : line.newNo).padStart(options.gutter - 3)
  const source = line.text === '' ? ' ' : line.text
  const room = Math.max(4, options.columns - 1 - options.gutter)
  const code = (text: string, codeKey: string) => <Code key={codeKey} source={text === '' ? ' ' : text} path={options.path} wrap="truncate-end" />
  // 바뀐 단어: 앞·가운데·뒤 세 조각. 조각마다 폭을 정해야 앞 Code 가 남은 폭을 다 먹지 않는다. 앞부분이 칸을 넘기면 강조를 뺀다.
  const span = row.span
  const pre = span ? cellWidth(source.slice(0, span[0])) : 0
  const mid = span ? cellWidth(source.slice(span[0], span[1])) : 0
  const body: ReturnType<typeof code>[] = []
  if (span && mid > 0 && pre < room) {
    if (pre > 0) {
      body.push(
        <Box key={`${key}.a`} width={pre} flexShrink={0}>
          {code(source.slice(0, span[0]), `${key}.ac`)}
        </Box>,
      )
    }
    body.push(
      <Box key={`${key}.b`} width={Math.min(mid, room - pre)} flexShrink={0} backgroundColor={isAdd ? palette.addStrong : palette.delStrong}>
        {code(source.slice(span[0], span[1]), `${key}.bc`)}
      </Box>,
    )
    if (pre + mid < room && span[1] < source.length) body.push(code(source.slice(span[1]), `${key}.cc`))
  } else body.push(code(source, `${key}.c`))
  return (
    <Box key={key} flexDirection="row" height={1} overflow="hidden" {...(bg ? { backgroundColor: bg } : {})}>
      <Box width={1} flexShrink={0} {...(isAdd ? { backgroundColor: palette.addBar } : isDel ? { backgroundColor: palette.delBar } : {})} />
      <Box width={options.gutter} flexShrink={0}>
        <Text color={isAdd ? palette.addBar : isDel ? palette.delBar : palette.muted}>{`${number} ${isAdd ? '+' : isDel ? '-' : ' '} `}</Text>
      </Box>
      {body}
    </Box>
  )
}
