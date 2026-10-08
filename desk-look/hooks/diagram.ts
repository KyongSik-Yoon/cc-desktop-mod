import { cellWidth } from './markdown'
import { render } from './vendor/lovely-mermaid.js'

// mermaid 를 박스 문자 그림으로 그린다(lovely-mermaid). 렌더러가 칸마다 역할(border·text·edge·edgeLabel)을
// 붙여 주므로, 테두리는 흐리게·글자는 본문색·화살표만 강조색으로 칠한다. 한글 폭도 렌더러가 맞춘다.

export type Segment = { text: string; kind: 'border' | 'text' | 'line' | 'arrow' | 'label'; href?: string }

export type Diagram = { rows: Segment[][]; width: number }

type Cell = { ch: string; kind: Segment['kind']; href?: string; isContinuation?: boolean }

// 일반 노드 상자는 둥근 모서리로. 분기 노드의 이중선(╔╗╚╝)은 구분되도록 그대로 둔다.
const ROUNDED: Record<string, string> = { '┌': '╭', '┐': '╮', '└': '╰', '┘': '╯' }

// 글꼴의 ▼ 는 칸 안에 여백을 두고 작게 그려져 선·상자와 떨어져 보인다. 화살표 칸은 선으로 잇고,
// 그 앞 상자 테두리 칸에 Ghostty 가 칸 가장자리까지 그리는 삼각형 블록을 꽂는다.
const HEADS: Record<string, { dy: number; dx: number; line: string; block: string }> = {
  '▼': { dy: 1, dx: 0, line: '│', block: '\u{1FB6D}' },
  '▲': { dy: -1, dx: 0, line: '│', block: '\u{1FB6F}' },
  '▶': { dy: 0, dx: 1, line: '─', block: '\u{1FB6C}' },
  '►': { dy: 0, dx: 1, line: '─', block: '\u{1FB6C}' },
  '◀': { dy: 0, dx: -1, line: '─', block: '\u{1FB6E}' },
  '◄': { dy: 0, dx: -1, line: '─', block: '\u{1FB6E}' },
}

const cache = new Map<string, Diagram | null>()

function toCells(row: ReadonlyArray<{ text: string; role: string; href?: string }>): Cell[] {
  const cells: Cell[] = []
  for (const span of row) {
    const kind: Cell['kind'] =
      span.role === 'border' ? 'border' : span.role === 'edge' ? 'line' : span.role === 'edgeLabel' ? 'label' : 'text'
    for (const ch of span.text) {
      const cell: Cell = { ch, kind, ...(span.href ? { href: span.href } : {}) }
      if (kind === 'border') cell.ch = ROUNDED[ch] ?? ch
      if (kind === 'line' && HEADS[ch]) cell.kind = 'arrow'
      cells.push(cell)
      // 두 칸 글자 뒤에 자리만 차지하는 칸을 둬서 칸 좌표로 위아래 이웃을 찾을 수 있게 한다
      if (cellWidth(ch) === 2) cells.push({ ch: '', kind, isContinuation: true })
    }
  }
  return cells
}

export function plugArrows(grid: Cell[][]): void {
  for (let y = 0; y < grid.length; y++) {
    for (const [x, cell] of (grid[y] ?? []).entries()) {
      const head = cell.kind === 'arrow' ? HEADS[cell.ch] : undefined
      if (!head) continue
      const next = grid[y + head.dy]?.[x + head.dx]
      if (next && next.kind === 'border' && !next.isContinuation) {
        next.ch = head.block
        next.kind = 'arrow'
        cell.ch = head.line
        cell.kind = 'line'
      } else {
        cell.ch = head.block
      }
    }
  }
}

function toSegments(cells: Cell[]): Segment[] {
  const out: Segment[] = []
  for (const cell of cells) {
    if (cell.isContinuation) continue
    const last = out[out.length - 1]
    if (last && last.kind === cell.kind && last.href === cell.href) last.text += cell.ch
    else out.push({ text: cell.ch, kind: cell.kind, ...(cell.href ? { href: cell.href } : {}) })
  }
  // 오른쪽 끝 공백은 칠할 필요가 없다
  const last = out[out.length - 1]
  if (last && last.kind === 'text' && last.text.trim() === '') out.pop()
  return out
}

export function renderDiagram(source: string): Diagram | null {
  const cached = cache.get(source)
  if (cached !== undefined) return cached
  let diagram: Diagram | null = null
  try {
    const art = render(source)
    if (art && art.warnings.length === 0) {
      const grid = art.styled.map(toCells)
      plugArrows(grid)
      const rows = grid.map(toSegments)
      while (rows.length > 0 && (rows[rows.length - 1] ?? []).length === 0) rows.pop()
      diagram = { rows, width: art.width }
    }
  } catch {
    diagram = null
  }
  if (cache.size > 50) cache.clear()
  cache.set(source, diagram)
  return diagram
}
