import type { Elements } from 'claude-code'

// 긴 패널의 맨 위에 "끝으로", 맨 아래에 "처음으로" 버튼을 둔다(사람의 End·Home 키와 같은 곳으로 간다).
// 원본은 desk-look/hooks/jumps.tsx 이고 scripts/sync-shared.sh 가 형제 플러그인의 hooks/shared/ 로 복사한다.
// 순수 함수만 둔다: 스크롤하는 클로저($.ui.scroll)는 각 플러그인의 register.tsx 가 만들어 넘긴다.

type Els = Elements['terminal']

export type Jump = { label: string; onPress: () => void }

// 버튼을 보일지는 트리가 창보다 긴지로 정한다. 엔진은 트리 높이를 사람이 스크롤할 때(ui.scroll)만 알려 주므로
// 그리기 전에 어림한다. 어림이 몇 줄 틀려도 창 높이 언저리에서 버튼이 보이고 말고가 바뀔 뿐이다.
export function withJumps(els: Els, tree: unknown, at: { bodyRows: number; columns: number; toEnd: Jump; toStart: Jump }) {
  const { Box, Button } = els
  const isLong = at.bodyRows > 0 && treeRows(tree, at.columns) > at.bodyRows
  // 버튼은 트리 뒤에 둔다: 입력칸 앞 요소가 생기거나 사라지면 입력칸이 포커스를 잃는다.
  // "끝으로"는 위 여백 한 줄에 절대 위치로 올린다.
  return (
    <Box flexDirection="column" paddingTop={isLong ? 1 : 0}>
      {tree as never}
      {isLong && (
        <Box key="pane-jump-start-row" justifyContent="flex-end">
          <Button key="pane-jump-start" plain dimColor label={at.toStart.label} onPress={at.toStart.onPress} />
        </Box>
      )}
      {isLong && (
        <Box key="pane-jump-end-row" position="absolute" top={0} right={0}>
          <Button key="pane-jump-end" plain dimColor label={at.toEnd.label} onPress={at.toEnd.onPress} />
        </Box>
      )}
    </Box>
  )
}

type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown }

const STEP: Record<string, number> = { xs: 1, sm: 1, md: 2, lg: 3, xl: 4 }

function space(value: unknown): number {
  return typeof value === 'number' ? Math.max(0, value) : typeof value === 'string' ? (STEP[value] ?? 0) : 0
}

// 한 축의 여백: 개별 값이 있으면 그것, 없으면 축 값, 없으면 전체 값.
function edge(props: Record<string, unknown>, kind: 'padding' | 'margin', side: 'Top' | 'Bottom' | 'Left' | 'Right'): number {
  const axis = side === 'Top' || side === 'Bottom' ? 'Y' : 'X'
  return space(props[`${kind}${side}`] ?? props[`${kind}${axis}`] ?? props[kind])
}

function childrenOf(node: Node): unknown[] {
  const raw = node.children ?? node.props?.children
  return (Array.isArray(raw) ? raw.flat(Infinity) : [raw]).filter(child => child !== null && child !== undefined && child !== false && child !== '')
}

// 터미널 칸 수 어림: 한글·한자·가나·전각·이모지는 두 칸.
function cells(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      code >= 0x1f300
    width += isWide ? 2 : 1
  }
  return width
}

function textOf(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!node || typeof node !== 'object') return ''
  if (Array.isArray(node)) return node.map(textOf).join('')
  return childrenOf(node as Node).map(textOf).join('')
}

function wrapped(text: string, columns: number, isWrapping: boolean): number {
  return text.split('\n').reduce((rows, line) => rows + (isWrapping ? Math.max(1, Math.ceil(cells(line) / Math.max(1, columns))) : 1), 0)
}

// 트리가 차지할 줄 수 어림(Yoga 를 흉내 낸 대강): 세로 Box 는 자식 합과 간격, 가로 Box 는 가장 높은 자식,
// 높이가 정해진 Box 는 그 높이, 절대 위치·숨긴 Box 는 0, 글은 폭으로 나눠 접는다.
export function treeRows(node: unknown, columns: number): number {
  if (typeof node === 'string' || typeof node === 'number') return wrapped(String(node), columns, true)
  if (!node || typeof node !== 'object') return 0
  if (Array.isArray(node)) return node.reduce((sum: number, child) => sum + treeRows(child, columns), 0)
  const element = node as Node
  const props = element.props ?? {}
  if (props.display === 'none' || props.position === 'absolute') return 0
  const outer = edge(props, 'margin', 'Top') + edge(props, 'margin', 'Bottom')
  if (typeof props.height === 'number') return props.height + outer
  switch (element.type) {
    case 'Text':
    case 'Link':
      return outer + wrapped(textOf(element), columns, !String(props.wrap ?? 'wrap').startsWith('truncate'))
    case 'Button':
      return outer + 1
    case 'Input':
      return outer + (typeof props.rows === 'number' ? props.rows : 1)
    case 'Code':
      return outer + String(props.source ?? '').split('\n').length
    case 'Markdown':
      return outer + wrapped(String(props.text ?? ''), columns, true)
    case 'Image':
      return outer + (typeof props.rows === 'number' ? props.rows : 1)
  }
  const border = props.borderStyle ? 2 : 0
  const inner = Math.max(1, columns - edge(props, 'padding', 'Left') - edge(props, 'padding', 'Right') - border)
  const kids = childrenOf(element).filter(child => {
    const childProps = (child as Node)?.props
    return !childProps || (childProps.display !== 'none' && childProps.position !== 'absolute')
  })
  const isRow = props.flexDirection === undefined || props.flexDirection === 'row' || props.flexDirection === 'row-reverse'
  const body = isRow
    ? kids.reduce((most: number, child) => Math.max(most, treeRows(child, inner)), 0)
    : kids.reduce((sum: number, child) => sum + treeRows(child, inner), 0) + space(props.rowGap ?? props.gap) * Math.max(0, kids.length - 1)
  return outer + border + edge(props, 'padding', 'Top') + edge(props, 'padding', 'Bottom') + body
}
