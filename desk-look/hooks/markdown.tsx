import type { Elements } from 'claude-code'

import { renderDiagram } from './diagram'

// 데스크톱 앱 산문 스타일로 마크다운을 Box/Text 트리로 그린다.
// 엔진의 Markdown 요소는 표·인용·코드 블록 모양을 바꿀 수 없어서 직접 파싱한다.

export type Palette = {
  text: string
  muted: string
  border: string
  code: string
  link: string
  // 인라인 코드 바탕. 터미널 배경을 알 때만 칠한다.
  codeBg?: string
  // 다이어그램 화살표 강조색.
  accent: string
}

type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'bold' | 'italic' | 'strike'; children: Inline[] }
  | { kind: 'link'; href: string; children: Inline[] }

type Align = 'left' | 'center' | 'right'

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; language?: string; source: string }
  | { kind: 'table'; header: string[]; align: Align[]; rows: string[][] }
  | { kind: 'list'; items: { level: number; marker: string; text: string }[] }
  | { kind: 'quote'; blocks: Block[]; raw: string }
  | { kind: 'rule' }

// 한글·CJK·이모지는 터미널에서 두 칸이다.
export function cellWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff)
    width += isWide ? 2 : 1
  }
  return width
}

// 여는 펜스 뒤 info string 은 첫 단어만 언어로 쓰고 나머지(title="…" 등)는 버린다.
const FENCE = /^\s*(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const BULLETS = ['•', '◦', '▪']
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let current = ''
  let inCode = false
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (ch === '\\' && trimmed[i + 1] === '|') {
      current += '|'
      i++
    } else if (ch === '`') {
      inCode = !inCode
      current += ch
    } else if (ch === '|' && !inCode) {
      cells.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  cells.push(current.trim())
  return cells
}

function isBlockStart(line: string, next: string | undefined): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    LIST_ITEM.test(line) ||
    /^\s*>/.test(line) ||
    (line.includes('|') && next !== undefined && TABLE_SEPARATOR.test(next) && next.includes('-'))
  )
}

export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i] ?? ''
    const next = lines[i + 1]

    if (line.trim() === '') {
      i++
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const marker = fence[1] ?? '```'
      const body: string[] = []
      i++
      const closes = (candidate: string) => {
        const trimmed = candidate.trim()
        return trimmed.length >= marker.length && /^(`+|~+)$/.test(trimmed) && trimmed[0] === marker[0]
      }
      while (i < lines.length && !closes(lines[i] ?? '')) {
        body.push(lines[i] ?? '')
        i++
      }
      i++
      blocks.push({ kind: 'code', language: fence[2] || undefined, source: body.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: (heading[1] ?? '#').length, text: heading[2] ?? '' })
      i++
      continue
    }

    if (RULE.test(line) && !LIST_ITEM.test(line.replace(/\s+/g, ''))) {
      blocks.push({ kind: 'rule' })
      i++
      continue
    }

    if (line.includes('|') && next !== undefined && TABLE_SEPARATOR.test(next) && next.includes('-')) {
      const header = splitRow(line)
      const align = splitRow(next).map((cell): Align => {
        const left = cell.startsWith(':')
        const right = cell.endsWith(':')
        return left && right ? 'center' : right ? 'right' : 'left'
      })
      const rows: string[][] = []
      i += 2
      while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim() !== '') {
        rows.push(splitRow(lines[i] ?? ''))
        i++
      }
      blocks.push({ kind: 'table', header, align, rows })
      continue
    }

    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i] ?? '')) {
        body.push((lines[i] ?? '').replace(/^\s*>\s?/, ''))
        i++
      }
      blocks.push({ kind: 'quote', blocks: parseBlocks(body.join('\n')), raw: body.join('\n') })
      continue
    }

    if (LIST_ITEM.test(line)) {
      const items: { level: number; marker: string; text: string }[] = []
      while (i < lines.length) {
        const current = lines[i] ?? ''
        const item = LIST_ITEM.exec(current)
        if (item) {
          const indent = (item[1] ?? '').replace(/\t/g, '    ').length
          const marker = item[2] ?? '-'
          items.push({
            level: Math.min(4, Math.floor(indent / 2)),
            marker: /\d/.test(marker) ? marker : (BULLETS[Math.min(4, Math.floor(indent / 2)) % BULLETS.length] ?? '•'),
            text: item[3] ?? '',
          })
          i++
        } else if (current.trim() !== '' && /^\s+/.test(current) && items.length > 0) {
          // 들여쓴 이어지는 줄은 앞 항목에 붙인다.
          const last = items[items.length - 1]
          if (last) last.text += ' ' + current.trim()
          i++
        } else {
          break
        }
      }
      blocks.push({ kind: 'list', items })
      continue
    }

    const paragraph: string[] = []
    while (i < lines.length) {
      const current = lines[i] ?? ''
      if (current.trim() === '' || (paragraph.length > 0 && isBlockStart(current, lines[i + 1]))) break
      paragraph.push(current.trim())
      i++
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
  }

  return blocks
}

const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*([^*\s][^*]*?)\*|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let rest = text
  while (rest.length > 0) {
    const match = INLINE.exec(rest)
    if (!match) {
      out.push({ kind: 'text', text: rest })
      break
    }
    if (match.index > 0) {
      out.push({ kind: 'text', text: rest.slice(0, match.index) })
    }
    const [whole, code, bold1, bold2, strike, italic, linkText, linkHref, angleUrl, bareUrl] = match
    if (code !== undefined) out.push({ kind: 'code', text: code })
    else if (bold1 !== undefined || bold2 !== undefined) out.push({ kind: 'bold', children: parseInline(bold1 ?? bold2 ?? '') })
    else if (strike !== undefined) out.push({ kind: 'strike', children: parseInline(strike) })
    else if (italic !== undefined) out.push({ kind: 'italic', children: parseInline(italic) })
    else if (linkText !== undefined && linkHref !== undefined) out.push({ kind: 'link', href: linkHref, children: parseInline(linkText) })
    else {
      const url = angleUrl ?? bareUrl ?? whole
      out.push({ kind: 'link', href: url, children: [{ kind: 'text', text: url }] })
    }
    rest = rest.slice(match.index + whole.length)
  }
  return out
}

// 그려질 칸 수. 바탕을 칠한 인라인 코드는 앞뒤 공백 한 칸씩이 더 붙는다.
export function inlineWidth(nodes: Inline[], codePadding: number): number {
  return nodes.reduce(
    (sum, node) =>
      sum +
      (node.kind === 'text'
        ? cellWidth(node.text)
        : node.kind === 'code'
          ? cellWidth(node.text) + codePadding * 2
          : inlineWidth(node.children, codePadding)),
    0,
  )
}

export function plainText(nodes: Inline[]): string {
  return nodes
    .map(node => (node.kind === 'text' || node.kind === 'code' ? node.text : plainText(node.children)))
    .join('')
}

// 표 열 너비: 자연 너비가 들어가면 그대로, 넘치면 좁은 열은 지키고 넓은 열부터 줄인다.
export function columnWidths(natural: number[], room: number, fill = false): number[] {
  const padding = 2
  const total = natural.reduce((sum, width) => sum + width + padding, 0)
  if (total <= room) {
    if (!fill) return natural
    const content = natural.reduce((sum, width) => sum + width, 0)
    const extra = room - total
    const grown = natural.map(width => width + Math.floor((extra * width) / Math.max(1, content)))
    const last = grown.length - 1
    grown[last] = (grown[last] ?? 0) + room - grown.reduce((sum, width) => sum + width + padding, 0)
    return grown
  }
  let budget = Math.max(natural.length * (4 + padding), room) - natural.length * padding
  const widths = natural.map(() => 0)
  let open = natural.map((_, index) => index)
  while (open.length > 0) {
    const share = Math.floor(budget / open.length)
    const fits = open.filter(index => (natural[index] ?? 0) <= share)
    if (fits.length === 0) {
      open.forEach((index, n) => (widths[index] = Math.max(4, share + (n < budget - share * open.length ? 1 : 0))))
      break
    }
    for (const index of fits) {
      widths[index] = natural[index] ?? 0
      budget -= natural[index] ?? 0
    }
    open = open.filter(index => !fits.includes(index))
  }
  return widths
}

type Els = Elements['terminal']

const ALERT = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n?/i

const ALERTS: Record<string, { title: string; color: string }> = {
  NOTE: { title: 'ⓘ Note', color: 'suggestion' },
  TIP: { title: '✓ Tip', color: 'success' },
  IMPORTANT: { title: '! Important', color: 'claude' },
  WARNING: { title: '⚠ Warning', color: 'warning' },
  CAUTION: { title: '✕ Caution', color: 'error' },
}

export function renderMarkdown(markdown: string, els: Els, colors: Palette, columns: number) {
  const { Box, Text, Code, Link } = els
  const codePadding = colors.codeBg ? 1 : 0

  const inline = (nodes: Inline[], key: string): (string | ReturnType<typeof h>)[] =>
    nodes.map((node, index) => {
      const k = `${key}.${index}`
      switch (node.kind) {
        case 'text':
          return node.text
        case 'code':
          return colors.codeBg ? (
            <Text color={colors.code} backgroundColor={colors.codeBg}>{` ${node.text} `}</Text>
          ) : (
            <Text color={colors.code}>{node.text}</Text>
          )
        case 'bold':
          return <Text bold>{inline(node.children, k)}</Text>
        case 'italic':
          return <Text italic>{inline(node.children, k)}</Text>
        case 'strike':
          return <Text strikethrough>{inline(node.children, k)}</Text>
        case 'link':
          return (
            <Text color={colors.link} underline>
              <Link href={node.href}>{inline(node.children, k)}</Link>
            </Text>
          )
      }
    })

  const prose = (text: string, key: string, props: Record<string, unknown> = {}) => (
    <Text color={colors.text} {...props}>
      {inline(parseInline(text), key)}
    </Text>
  )

  const table = (block: Extract<Block, { kind: 'table' }>, key: string, room: number) => {
    const count = Math.max(block.header.length, ...block.rows.map(row => row.length))
    const cell = (row: string[], index: number) => row[index] ?? ''
    const natural = Array.from({ length: count }, (_, index) =>
      Math.max(
        1,
        inlineWidth(parseInline(cell(block.header, index)), codePadding),
        ...block.rows.map(row => inlineWidth(parseInline(cell(row, index)), codePadding)),
      ),
    )
    // 데스크톱 메시지 열처럼 폭을 채우되, 아주 넓은 터미널에서 늘어지지 않게 100칸에서 멈춘다.
    const widths = columnWidths(natural, Math.min(room, 100) - 2, true)
    const inner = widths.reduce((sum, width) => sum + width + 2, 0)
    const justify = (index: number) =>
      block.align[index] === 'right' ? 'flex-end' : block.align[index] === 'center' ? 'center' : 'flex-start'
    const headerFill = colors.codeBg ? { backgroundColor: colors.codeBg } : {}
    const row = (cells: string[], rowKey: string, isHeader: boolean) => (
      <Box flexDirection="row" {...(isHeader ? headerFill : {})}>
        {widths.map((width, index) => (
          <Box width={width + 2} paddingX={1} justifyContent={justify(index)} {...(isHeader ? headerFill : {})}>
            {prose(cell(cells, index), `${rowKey}.${index}`, isHeader ? (colors.codeBg ? headerFill : { bold: true }) : {})}
          </Box>
        ))}
      </Box>
    )
    const rule = <Text color={colors.border}>{'─'.repeat(inner)}</Text>

    return (
      <Box flexDirection="column" alignSelf="flex-start" borderStyle="round" borderColor={colors.border}>
        {row(block.header, `${key}.h`, true)}
        {block.rows.flatMap((cells, index) => [rule, row(cells, `${key}.${index}`, false)])}
      </Box>
    )
  }

  const blocks = (list: Block[], key: string, room: number, tone?: string): ReturnType<typeof h>[] =>
    list.map((block, index) => {
      const k = `${key}.${index}`
      const gap = index === 0 ? 0 : 1
      const toned = tone ? { color: tone } : {}
      switch (block.kind) {
        case 'heading':
          return <Box marginTop={gap}>{prose(block.text, k, { bold: true, ...toned })}</Box>
        case 'paragraph':
          return <Box marginTop={gap}>{prose(block.text, k, toned)}</Box>
        case 'rule':
          return (
            <Box marginTop={gap}>
              <Text color={colors.border}>{'─'.repeat(Math.max(4, Math.min(room, 80)))}</Text>
            </Box>
          )
        // mermaid 는 박스 문자 그림으로 그린다(lovely-mermaid). 폭이 모자라거나 못 그리는 문법이면 코드 블록으로.
        case 'code':
          if (block.language === 'mermaid') {
            const diagram = renderDiagram(block.source)
            if (diagram !== null && diagram.width + 6 <= room) {
              const tone = { border: colors.muted, line: colors.muted, arrow: colors.accent, label: colors.muted, text: colors.text }
              return (
                <Box marginTop={gap} flexDirection="column" alignSelf="flex-start" borderStyle="round" borderColor={colors.border} paddingX={2} paddingY={1}>
                  {diagram.rows.map(row => (
                    <Text wrap="truncate-end">
                      {row.length === 0
                        ? ' '
                        : row.map(seg =>
                            seg.href ? (
                              <Text color={colors.link} underline>
                                <Link href={seg.href}>{seg.text}</Link>
                              </Text>
                            ) : (
                              <Text color={tone[seg.kind]} italic={seg.kind === 'label'}>
                                {seg.text}
                              </Text>
                            ),
                          )}
                    </Text>
                  ))}
                </Box>
              )
            }
          }
          return (
            <Box marginTop={gap} flexDirection="column" borderStyle="round" borderColor={colors.border} paddingX={1}>
              <Code source={block.source} language={block.language} wrap="wrap" />
            </Box>
          )
        case 'table':
          return <Box marginTop={gap}>{table(block, k, room)}</Box>
        case 'quote':
          // GitHub 알림(> [!NOTE] 등): 종류 색 테두리 + 제목 줄.
          {
            const alert = ALERT.exec(block.raw)
            const style = alert ? ALERTS[(alert[1] ?? '').toUpperCase()] : undefined
            if (alert && style) {
              return (
                <Box marginTop={gap} flexDirection="column" borderStyle="round" borderColor={style.color} paddingX={1}>
                  <Text color={style.color} bold>
                    {style.title}
                  </Text>
                  {blocks(parseBlocks(block.raw.slice(alert[0].length)), k, room - 4)}
                </Box>
              )
            }
          }
          return (
            <Box marginTop={gap} borderStyle="quote" borderColor={colors.border} paddingLeft={1} flexDirection="column">
              {blocks(block.blocks, k, room - 2, colors.muted)}
            </Box>
          )
        case 'list':
          return (
            <Box marginTop={gap} flexDirection="column">
              {block.items.map((item, n) => (
                <Box flexDirection="row" paddingLeft={item.level * 2}>
                  <Box width={cellWidth(item.marker) + 1} flexShrink={0}>
                    <Text color={colors.muted}>{item.marker}</Text>
                  </Box>
                  {prose(item.text, `${k}.${n}`, toned)}
                </Box>
              ))}
            </Box>
          )
      }
    })

  return (
    <Box flexDirection="column">
      {blocks(parseBlocks(markdown), 'md', Math.max(20, columns))}
    </Box>
  )
}
