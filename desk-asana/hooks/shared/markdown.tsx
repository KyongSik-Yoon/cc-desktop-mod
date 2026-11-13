import type { Elements, UiPressArgument } from 'claude-code'

import { renderDiagram } from './diagram'
import { Lexer, type Token } from './vendor/marked.js'

// 데스크톱 앱 산문 스타일로 마크다운을 Box/Text 트리로 그린다.
// 엔진의 Markdown 요소는 표·인용·코드 블록 모양을 바꿀 수 없어서 직접 그린다. 블록 나누기만 marked 에 맡긴다.

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

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'bold' | 'italic' | 'strike'; children: Inline[] }
  | { kind: 'link'; href: string; children: Inline[] }

type Align = 'left' | 'center' | 'right'

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  // indented: 펜스 없이 네 칸 들여 쓴 코드(명령 출력의 들여 쓴 줄도 이렇게 읽히니 마크다운 판정에는 넣지 않는다)
  | { kind: 'code'; language?: string; source: string; indented?: true }
  | { kind: 'table'; header: string[]; align: Align[]; rows: string[][] }
  // marker 는 번호 목록일 때 쓴 그대로의 번호(1. 2) 등). 글머리 목록은 그리는 쪽이 깊이마다 고른다.
  | { kind: 'list'; ordered: boolean; items: { marker: string; blocks: Block[] }[] }
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

const MARKDOWN_FENCE = /^(markdown|md)$/i

// 엔진 Code 는 빈 줄을 높이 0 으로 그려 빼먹는다. 빈 줄을 공백 한 칸으로 넘긴다.
// 끝 줄바꿈 뒤의 빈 줄은 줄이 아니므로 두고(명령 끝 \n 이 빈 행이 되지 않게), 통째로 빈 글은 한 칸으로.
export function codeSource(source: string): string {
  const text = source.replace(/\r\n?/g, '\n')
  return text === '' ? ' ' : text.replace(/^$(?=\n)/gm, ' ')
}
const BULLETS = ['•', '◦', '▪']
// 코드 블록 최소 폭(테두리 포함). copy 버튼(" ⧉ copy ", 오른쪽 2칸 띄움)과 둥근 모서리가 들어가고, 한 줄 명령이 너무 납작해 보이지 않게.
const CODE_MIN_WIDTH = 24
const COPY_LABEL = ' ⧉ copy '

// 블록 구조는 marked(엔진 바이너리에도 들어 있는 파서)의 Lexer 로 읽고, 인라인은 아래 parseInline 이 맡는다.
// breaks 는 채팅 글용: 문단 안의 줄바꿈을 그대로 둔다(GFM 의 breaks). 아니면 CommonMark 처럼 한 칸으로 잇는다.
// 목록이 많은 8 KB 글이 1.4ms 쯤 걸려 예전 손 파서(0.1ms)보다 느리다. 같은 글을 스크롤·다시 그리기마다 또 읽지 않게
// 최근에 쓴 결과를 둔다. 개수가 아니라 글 길이 합계로 자른다: 긴 대화 전체가 들어가고, 큰 미리보기 글 몇 개로 메모리가
// 커지지 않게. 꺼낼 때 맨 뒤로 옮겨 스트리밍 중 새로 들어오는 앞부분 글들이 화면에 보이는 글을 밀어내지 않게 한다.
// 블록은 그리는 쪽이 고치지 않으므로 나눠 써도 된다.
const parsed = new Map<string, { prose?: Block[]; chat?: Block[] }>()
const PARSED_CHARS = 4_000_000
const PARSED_KEEP = 1000
let parsedChars = 0

export function parseBlocks(markdown: string, breaks = false): Block[] {
  const entry = parsed.get(markdown) ?? {}
  if (parsed.delete(markdown)) parsedChars -= markdown.length
  // 인라인 토큰은 쓰지 않으니 블록 단계만 돈다(lex() 는 인라인까지 만들어 두 배쯤 느리다).
  const blocks = (entry[breaks ? 'chat' : 'prose'] ??= toBlocks(new Lexer({ gfm: true }).blockTokens(markdown.replace(/\r\n?/g, '\n')), breaks))
  parsed.set(markdown, entry)
  parsedChars += markdown.length
  for (const key of parsed.keys()) {
    if (parsed.size === 1 || (parsedChars <= PARSED_CHARS && parsed.size <= PARSED_KEEP)) break
    parsed.delete(key)
    parsedChars -= key.length
  }
  return blocks
}

// 채팅 글은 펜스 없이 붙여 넣은 코드가 많아 breaks 면 줄 앞 들여쓰기를 남긴다.
const joinLines = (text: string, breaks: boolean) =>
  breaks ? text.split('\n').map(line => line.trimEnd()).join('\n') : text.split('\n').map(line => line.trim()).join(' ')

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

// 번호는 marked 가 다시 매기지 않고 글쓴이가 쓴 그대로 둔다.
const numberOf = (raw: string) => /^\s*(\d+[.)])/.exec(raw)?.[1] ?? ''

function toBlocks(tokens: Token[], breaks: boolean): Block[] {
  const blocks: Block[] = []
  for (const token of tokens) {
    switch (token.type) {
      case 'space':
      case 'checkbox':
        break
      case 'heading':
        blocks.push({ kind: 'heading', level: token.depth, text: token.text ?? '' })
        break
      case 'paragraph':
      case 'text':
        blocks.push({ kind: 'paragraph', text: joinLines(token.text ?? '', breaks) })
        break
      case 'code':
        blocks.push({
          kind: 'code',
          language: (token.lang ?? '').split(/\s/)[0] || undefined,
          source: token.text ?? '',
          ...(token.codeBlockStyle === 'indented' ? { indented: true as const } : {}),
        })
        break
      case 'hr':
        blocks.push({ kind: 'rule' })
        break
      case 'table': {
        // 칸은 원문에서 다시 나눈다: marked 는 백틱 안 | 에서도 나눠(`a|b`) 코드가 갈리고 뒤 칸이 사라진다.
        const [head = '', , ...rows] = token.raw.split('\n').filter((line: string) => line.trim() !== '')
        blocks.push({ kind: 'table', header: splitRow(head), align: token.align.map((align: Align | null) => align ?? 'left'), rows: rows.map(splitRow) })
        break
      }
      case 'blockquote':
        blocks.push({ kind: 'quote', blocks: toBlocks(token.tokens ?? [], breaks), raw: token.text ?? '' })
        break
      case 'list':
        blocks.push({
          kind: 'list',
          ordered: token.ordered === true,
          items: token.items.map((item: Token) => {
            const inner = toBlocks(item.tokens ?? [], breaks)
            // 할 일 항목은 예전처럼 [ ]·[x] 를 글 앞에 둔다. 빈 줄이 낀 항목은 marked 가 이미 문단 글에 붙여 준다.
            const first = inner[0]
            if (item.tokens?.[0]?.type === 'checkbox' && first?.kind === 'paragraph') first.text = `${item.tokens[0].raw}${first.text}`
            return { marker: token.ordered ? numberOf(item.raw) : '', blocks: inner }
          }),
        })
        break
      default:
        // html 블록·참조 정의([1]: 주소) 등: 원문을 문단으로(예전과 같다). 인라인이 참조 링크를 모르니 정의라도 보이게.
        if (token.raw.trim() !== '') blocks.push({ kind: 'paragraph', text: joinLines(token.raw.trim(), breaks) })
    }
  }
  return blocks
}

// \ 뒤 문장부호는 글자 그대로(CommonMark). 링크 글자에도 \] 가 들어갈 수 있다.
const INLINE = /\\([!-/:-@[-`{-~])|`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*([^*\s][^*]*?)\*|\[((?:\\.|[^\]\\])+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/

// 따옴표·괄호 안의 외톨이 \ 는 이스케이프가 아니라 글자다: "\" (\) [\]. 엔진(2.1.311)과 같은 조건으로,
// 여는 쪽이 글자·숫자에 붙었거나, 닫는 쪽 뒤에 글자가 이어지거나, 여는 쪽이 다른 토큰 바로 뒤면 이스케이프로 읽는다.
const WRAP_OPEN: Record<string, string> = { '"': '"', "'": "'", ')': '(', ']': '[', '}': '{', '>': '<' }
type Piece = { kind: 'text' | 'kept' | 'other'; raw: string }

function keepsBackslash(close: string, after: string, pieces: Piece[]): boolean {
  const open = WRAP_OPEN[close]
  const last = pieces.at(-1)
  if (open === undefined || last?.kind !== 'text' || !last.raw.endsWith(open)) return false
  if (/[\p{L}\p{N}].$/u.test(last.raw) || /^[\p{L}\p{N}\\*_`~]/u.test(after)) return false
  const before = pieces.at(-2)
  return last.raw !== open || before === undefined || before.kind === 'kept'
}

export function parseInline(text: string, inLink = false): Inline[] {
  const out: Inline[] = []
  const pieces: Piece[] = []
  let rest = text
  while (rest.length > 0) {
    const match = INLINE.exec(rest)
    if (!match) {
      out.push({ kind: 'text', text: rest })
      break
    }
    if (match.index > 0) {
      out.push({ kind: 'text', text: rest.slice(0, match.index) })
      pieces.push({ kind: 'text', raw: rest.slice(0, match.index) })
    }
    const [whole, escaped, code, bold1, bold2, strike, italic, linkText, linkHref, angleUrl, bareUrl] = match
    const isKept = escaped !== undefined && !inLink && keepsBackslash(escaped, rest.slice(match.index + whole.length), pieces)
    pieces.push({ kind: isKept ? 'kept' : 'other', raw: whole })
    if (isKept) out.push({ kind: 'text', text: whole })
    else if (escaped !== undefined) out.push({ kind: 'text', text: escaped })
    else if (code !== undefined) out.push({ kind: 'code', text: code })
    else if (bold1 !== undefined || bold2 !== undefined) out.push({ kind: 'bold', children: parseInline(bold1 ?? bold2 ?? '', inLink) })
    else if (strike !== undefined) out.push({ kind: 'strike', children: parseInline(strike, inLink) })
    else if (italic !== undefined) out.push({ kind: 'italic', children: parseInline(italic, inLink) })
    else if (linkText !== undefined && linkHref !== undefined) out.push({ kind: 'link', href: linkHref, children: parseInline(linkText, true) })
    else {
      const url = angleUrl ?? bareUrl ?? whole
      out.push({ kind: 'link', href: url, children: [{ kind: 'text', text: url }] })
    }
    rest = rest.slice(match.index + whole.length)
  }
  return out
}

// 엔진 Link 는 줄이 넘어가면 첫 줄에만 걸린다(2.1.302). 주소가 곧 글자인 링크는 한 줄에 들어가게
// 가운데를 줄여 그린다: 줄바꿈은 단어 단위라 이 길이면 통째로 다음 줄로 넘어간다.
const URL_LABEL = 40
const isUrl = (text: string) => /^https?:\/\/\S+$/.test(text)

export function urlLabel(url: string): string {
  if (cellWidth(url) <= URL_LABEL) return url
  const bare = url.replace(/^https?:\/\//, '')
  return bare.length <= URL_LABEL ? bare : `${bare.slice(0, 24)}…${bare.slice(-15)}`
}

// 링크의 글자가 주소 그대로면 줄인 문구를 돌려준다.
function linkLabel(node: Extract<Inline, { kind: 'link' }>): string | null {
  const [only] = node.children
  return node.children.length === 1 && only?.kind === 'text' && only.text === node.href && isUrl(node.href) ? urlLabel(node.href) : null
}

// 그려질 칸 수. 바탕을 칠한 인라인 코드는 앞뒤 공백 한 칸씩이 더 붙는다.
export function inlineWidth(nodes: Inline[], codePadding: number): number {
  return nodes.reduce(
    (sum, node) =>
      sum +
      (node.kind === 'text'
        ? cellWidth(node.text)
        : node.kind === 'code'
          ? cellWidth(isUrl(node.text) ? urlLabel(node.text) : node.text) + codePadding * 2
          : node.kind === 'link' && linkLabel(node) !== null
            ? cellWidth(linkLabel(node) ?? '')
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

export const ALERT = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n?/i

export const ALERTS: Record<string, { title: string; color: string }> = {
  NOTE: { title: 'ⓘ Note', color: 'suggestion' },
  TIP: { title: '✓ Tip', color: 'success' },
  IMPORTANT: { title: '! Important', color: 'claude' },
  WARNING: { title: '⚠ Warning', color: 'warning' },
  CAUTION: { title: '✕ Caution', color: 'error' },
}

// 파일 맨 앞의 YAML front matter(--- … ---)를 떼어 낸다. 키: 값 줄만 모으고, 닫는 줄이 없으면 본문 그대로.
export function splitFrontMatter(markdown: string): { fields: [string, string][]; body: string } {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  if (lines[0]?.trim() !== '---') return { fields: [], body: markdown }
  const end = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line))
  if (end < 0) return { fields: [], body: markdown }
  const fields = lines
    .slice(1, end)
    .map(line => /^([^\s:#][^:]*):\s*(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(match => [match[1] ?? '', (match[2] ?? '').replace(/^(["'])(.*)\1$/, '$2')] as [string, string])
  return { fields, body: lines.slice(end + 1).join('\n') }
}

// onCopy 가 있으면 코드 블록 오른쪽 위 모서리 옆에 늘 흐린 "⧉ copy" 버튼을 단다(hover 는 포인터가 있어야 해서 키보드·폰에선 못 본다).
// document 는 파일 한 편을 읽는 패널용: 제목 단계를 색·밑줄로 나누고 front matter 를 흐린 머리로 접는다.
// breaks 는 채팅 글(Slack)용: 한 줄 바꿈도 줄을 바꾼다. cards 는 좁은 패널용: 낱말이 잘릴 만큼 칸이 좁아지는 표를 행마다 카드로.
export type MarkdownOptions = { onCopy?: (source: string, press: UiPressArgument) => void; document?: boolean; breaks?: boolean; cards?: boolean }

export function renderMarkdown(markdown: string, els: Els, colors: Palette, columns: number, options: MarkdownOptions = {}) {
  const { Box, Text, Code, Link, Button } = els
  const codePadding = colors.codeBg ? 1 : 0

  const inline = (nodes: Inline[], key: string): (string | JSX.Element)[] =>
    nodes.map((node, index) => {
      const k = `${key}.${index}`
      switch (node.kind) {
        case 'text':
          return node.text
        case 'code': {
          // 백틱 안 주소도 누를 수 있게(엔진 Markdown 처럼).
          // 글자는 바탕이 있든 없든 code 색(테마 강조색). 본문색이면 회색 칩만 남아 화면 전체가 단색으로 보였다.
          const text = isUrl(node.text) ? <Link href={node.text}>{urlLabel(node.text)}</Link> : node.text
          return colors.codeBg ? (
            <Text color={colors.code} backgroundColor={colors.codeBg}>
              {' '}
              {text}{' '}
            </Text>
          ) : (
            <Text color={colors.code}>{text}</Text>
          )
        }
        case 'bold':
          return <Text weight="semibold">{inline(node.children, k)}</Text>
        case 'italic':
          return <Text italic>{inline(node.children, k)}</Text>
        case 'strike':
          return <Text strikethrough>{inline(node.children, k)}</Text>
        case 'link':
          return (
            <Text color={colors.link} underline>
              <Link href={node.href}>{linkLabel(node) ?? inline(node.children, k)}</Link>
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
    // cards: 칸이 그 칸의 가장 긴 낱말보다 좁아지면 낱말이 쪼개져 못 읽으니 행마다 카드로 그린다.
    if (options.cards) {
      const longest = Array.from({ length: count }, (_, index) =>
        Math.max(0, ...[block.header, ...block.rows].flatMap(row => plainText(parseInline(cell(row, index))).split(/\s+/).map(cellWidth))),
      )
      if (widths.some((width, index) => width < (longest[index] ?? 0))) return cards(block, key, room)
    }
    const inner = widths.reduce((sum, width) => sum + width + 2, 0)
    const justify = (index: number) =>
      block.align[index] === 'right' ? 'flex-end' : block.align[index] === 'center' ? 'center' : 'flex-start'
    const headerFill = colors.codeBg ? { backgroundColor: colors.codeBg } : {}
    const row = (cells: string[], rowKey: string, isHeader: boolean) => (
      <Box flexDirection="row" {...(isHeader ? headerFill : {})}>
        {widths.map((width, index) => (
          <Box width={width + 2} paddingX={1} justifyContent={justify(index)} {...(isHeader ? headerFill : {})}>
            {prose(cell(cells, index), `${rowKey}.${index}`, isHeader ? (colors.codeBg ? headerFill : { weight: 'semibold' }) : {})}
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

  // 카드: 첫 칸을 제목으로, 나머지는 "머리  값" 줄로. 머리 폭은 가장 긴 머리에 맞추되 폭의 1/3 을 넘지 않는다.
  const cards = (block: Extract<Block, { kind: 'table' }>, key: string, room: number) => {
    const labels = block.header.slice(1)
    const labelWidth = Math.min(Math.floor(room / 3), Math.max(0, ...labels.map(label => inlineWidth(parseInline(label), codePadding))))
    return (
      <Box flexDirection="column">
        {block.rows.map((row, index) => (
          <Box marginTop={index === 0 ? 0 : 1} flexDirection="column">
            {prose(row[0] ?? '', `${key}.${index}.t`, { weight: 'semibold' })}
            {labels.map((label, n) =>
              (row[n + 1] ?? '') === '' ? null : (
                <Box flexDirection="row" paddingLeft={2} columnGap={2}>
                  <Box width={labelWidth} flexShrink={0}>
                    {prose(label, `${key}.${index}.${n}.l`, { color: colors.muted })}
                  </Box>
                  {prose(row[n + 1] ?? '', `${key}.${index}.${n}`)}
                </Box>
              ),
            )}
          </Box>
        ))}
      </Box>
    )
  }

  const blocks = (list: Block[], key: string, room: number, tone?: string, depth = 0): JSX.Element[] =>
    list.map((block, index) => {
      const k = `${key}.${index}`
      // 목록 항목 안에서 글 바로 뒤 코드 블록은 붙인다: 테두리가 이미 띄우고, 블록 뒤 다음 항목도 붙으니 위아래가 같아진다.
      const gap = index === 0 || (depth > 0 && block.kind === 'code' && list[index - 1]?.kind === 'paragraph') ? 0 : 1
      const toned = tone ? { color: tone } : {}
      switch (block.kind) {
        case 'heading':
          // 문서: H1 은 강조색, H1·H2 는 아래에 가로줄. 위는 한 줄 더 띄워 절이 갈리게 한다.
          if (options.document && !tone) {
            const underline = block.level <= 2
            return (
              <Box marginTop={index === 0 ? 0 : 2} flexDirection="column">
                {prose(block.text, k, { weight: 'semibold', ...(block.level === 1 ? { color: colors.accent } : {}) })}
                {underline && <Text color={colors.border}>{'─'.repeat(Math.max(4, Math.min(room, 100)))}</Text>}
              </Box>
            )
          }
          return <Box marginTop={gap}>{prose(block.text, k, { weight: 'semibold', ...toned })}</Box>
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
          {
            // markdown 펜스(이슈·MR 초안 등)는 올라갈 모습으로 그린다. 원문은 copy 로.
            // 데스크톱처럼 내용 폭에 맞춘다: 가장 긴 줄 + 테두리·여백 4칸, 최소 폭, 화면 폭(복사 버튼 자리를 뺀)이 상한.
            // 내용 폭을 Yoga 에 맡기면(alignSelf 만) 엔진 Code 가 80칸쯤에서 접어 재므로 직접 센다(엔진 Box 는 maxWidth 를 받지 않는다).
            // markdown 펜스는 그린 모양(표·안쪽 코드 블록 테두리)이 원문 줄 폭과 달라, 버튼과 나란할 때만 상한 폭으로 늘린다.
            const onCopy = options.onCopy
            const limit = room - (onCopy ? COPY_LABEL.length : 0)
            const width = MARKDOWN_FENCE.test(block.language ?? '')
              ? onCopy
                ? limit
                : undefined
              : Math.min(limit, Math.max(CODE_MIN_WIDTH, Math.max(0, ...block.source.split('\n').map(cellWidth)) + 4))
            const fit = width === undefined ? {} : ({ alignSelf: 'flex-start', width } as const)
            const code = (
              <Box flexDirection="column" borderStyle="round" borderColor={colors.border} paddingX={1} {...fit}>
                {MARKDOWN_FENCE.test(block.language ?? '') ? (
                  // 톤을 넘겨 인용 안이면 흐리게, 문서 모드여도 바깥 문서의 절 모양(강조색·밑줄)을 쓰지 않게 한다.
                  blocks(parseBlocks(block.source, options.breaks), k, (width ?? room) - 4, tone ?? colors.text)
                ) : (
                  <Code source={codeSource(block.source)} language={block.language} wrap="wrap" />
                )}
              </Box>
            )
            if (!onCopy) return <Box marginTop={gap}>{code}</Box>
            // 버튼은 흐름 안, 상자 오른쪽 위 모서리 옆(데스크톱도 오른쪽에 버튼 자리를 비워 둔다). 위 테두리에 절대 위치로 얹으면
            // 대화를 굴려 테두리가 화면 위로 나갈 때 엔진이 버튼을 첫 보이는 줄의 코드 위에 겹쳐 그린다(2.1.322 실측).
            return (
              <Box key={`code${k}`} marginTop={gap} flexDirection="row" alignItems="flex-start">
                {code}
                <Button key={`copy${k}`} plain dimColor label={COPY_LABEL} onPress={press => onCopy(block.source, press)} />
              </Box>
            )
          }
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
                  <Text color={style.color} weight="semibold">
                    {style.title}
                  </Text>
                  {blocks(parseBlocks(block.raw.slice(alert[0].length), options.breaks), k, room - 4)}
                </Box>
              )
            }
          }
          return (
            <Box marginTop={gap} borderStyle="quote" borderColor={colors.border} paddingLeft={1} flexDirection="column">
              {blocks(block.blocks, k, room - 2, colors.muted)}
            </Box>
          )
        case 'list': {
          // 하위 목록은 글 바로 밑에 붙인다(빈 줄 없이). 글머리는 깊이마다 •◦▪.
          const tight = depth > 0 && list[index - 1]?.kind === 'paragraph'
          return (
            <Box marginTop={tight ? 0 : gap} flexDirection="column">
              {block.items.map((item, n) => {
                const marker = block.ordered ? item.marker : (BULLETS[depth % BULLETS.length] ?? '•')
                const width = cellWidth(marker) + 1
                // 글머리는 띄워 두고 본문은 왼쪽 여백만 준다(room 어림값에 기대지 않고 부모 폭을 그대로 쓴다).
                // 빈 항목은 한 줄을 차지해야 글머리가 다음 항목 글머리와 겹치지 않는다.
                return (
                  <Box flexDirection="column" paddingLeft={width}>
                    <Box position="absolute" top={0} left={0}>
                      <Text color={colors.muted}>{marker}</Text>
                    </Box>
                    {item.blocks.length === 0 ? <Text> </Text> : blocks(item.blocks, `${k}.${n}`, room - width, tone, depth + 1)}
                  </Box>
                )
              })}
            </Box>
          )
        }
      }
    })

  const room = Math.max(20, columns)
  if (!options.document) {
    return <Box flexDirection="column">{blocks(parseBlocks(markdown, options.breaks), 'md', room)}</Box>
  }
  const { fields, body } = splitFrontMatter(markdown)
  const keyWidth = Math.max(0, ...fields.map(([name]) => cellWidth(name)))
  return (
    <Box flexDirection="column">
      {fields.length > 0 && (
        <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor={colors.border} paddingX={1} alignSelf="flex-start">
          {fields.map(([name, value]) => (
            <Text>
              <Text color={colors.muted}>{name + ' '.repeat(keyWidth - cellWidth(name) + 2)}</Text>
              <Text color={colors.text}>{value}</Text>
            </Text>
          ))}
        </Box>
      )}
      {blocks(parseBlocks(body), 'md', room)}
    </Box>
  )
}
