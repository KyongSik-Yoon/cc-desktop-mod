import { cellWidth } from './util'
import type { SlackInbox, SlackMessage, SlackPoller, SlackPost, SlackRoom, SlackServer } from '../types'

// /desk-slack: 나에게 온 DM·그룹 DM 을 대화방으로. 엔진에 붙은 Slack MCP 서버(claude.ai 커넥터)를 그대로 쓴다.
// 이 서버는 JSON 이 아니라 마크다운 글을 JSON 한 겹({"results": …}, {"messages": …})에 싸서 준다. 그래서 줄 정규식으로 읽는다.
// 받은 편지: 검색 to:<@나> 는 DM·그룹 DM 에서 남이 보낸 것만 준다(내 답장은 빠진다, 스레드 답글은 들어온다).
// 방 안은 채널 기록(read_channel)으로 양쪽 다. 채널 기록에는 최상위 글만 있어 스레드 답글은 스레드(read_thread)로 따로 읽는다.
// 읽음 표시를 Slack 에 되돌리는 도구가 없어 안 읽음은 desk-slack 안에서만 센다.

export const SLACK_TOOLS = {
  search: 'slack_search_public_and_private',
  history: 'slack_read_channel',
  thread: 'slack_read_thread',
  send: 'slack_send_message',
  me: 'slack_read_user_profile',
} as const

// 처음 열 때 채우는 기간. 그 뒤로는 마지막으로 본 메시지 다음부터.
export const FIRST_FILL_S = 3 * 24 * 60 * 60
// 방 안에서 보여 줄 메시지 수
export const HISTORY_LIMIT = 30
// 다른 세션이 이만큼 받은 편지를 읽지 않았으면 이 세션이 넘겨받는다
export const LEASE_MS = 3 * 60 * 1000

// 검색 도구가 있는 서버. 나머지 도구가 목록에 없으면(deny 규칙은 도구를 목록에서 뺀다) 서버 없음이 아니라 규칙 안내로 간다(slackTools).
export function findSlackServer(names: readonly string[]): SlackServer | null {
  const suffix = `__${SLACK_TOOLS.search}`
  const found = names.find(name => name.startsWith('mcp__') && name.endsWith(suffix) && name.length > 'mcp__'.length + suffix.length)
  return found ? { name: found.slice('mcp__'.length, -suffix.length) } : null
}

// 패널과 받은 편지 확인이 부르는 도구의 전체 이름. allow 규칙이 다 있어야 부른다(Asana paneTools 와 같은 까닭).
// 스레드 도구는 뒤에 더한 것이라 빼고 따로 본다(slackThreadTool): 규칙이 없어도 스레드만 못 열고 나머지는 돈다.
export function slackTools(server: SlackServer): string[] {
  return Object.values(SLACK_TOOLS)
    .filter(tool => tool !== SLACK_TOOLS.thread)
    .map(tool => `mcp__${server.name}__${tool}`)
}

export function slackThreadTool(server: SlackServer): string {
  return `mcp__${server.name}__${SLACK_TOOLS.thread}`
}

export type SlackCall = { tool: string; args: Record<string, unknown> }

export function profileCall(): SlackCall {
  return { tool: SLACK_TOOLS.me, args: {} }
}

// 나에게 온 DM·그룹 DM, 최근 것부터. after 는 Unix 초(포함). 필터의 after: 는 날짜 단위라 쓰지 않는다.
export function inboxCall(me: string, afterS: number): SlackCall {
  return {
    tool: SLACK_TOOLS.search,
    args: {
      filters: `to:<@${me}>`,
      natural_language_query: '',
      channel_types: 'im,mpim',
      after: String(afterS),
      sort: 'timestamp',
      sort_dir: 'desc',
      limit: 20,
      include_context: false,
    },
  }
}

// 방의 최근 메시지. concise 에는 ts 가 없어 detailed 로.
export function historyCall(channel: string): SlackCall {
  return { tool: SLACK_TOOLS.history, args: { channel_id: channel, limit: HISTORY_LIMIT, response_format: 'detailed' } }
}

// 스레드의 부모 글과 최근 답글(오래된 것부터). limit 은 최신 쪽에서 자른다.
export function threadCall(channel: string, thread: string): SlackCall {
  return { tool: SLACK_TOOLS.thread, args: { channel_id: channel, message_ts: thread, limit: HISTORY_LIMIT, response_format: 'detailed' } }
}

// thread 가 있으면 그 스레드에 답글로
export function sendCall(channel: string, text: string, thread: string | null = null): SlackCall {
  return { tool: SLACK_TOOLS.send, args: thread === null ? { channel_id: channel, message: text } : { channel_id: channel, message: text, thread_ts: thread } }
}

type Block = { type: string; text?: string }

// MCP 결과의 글(key 는 results·messages·result). 실패(isError)나 모양이 다르면 오류 글.
export function resultText(result: { content: readonly Block[]; isError: boolean }, key: string): { ok: true; text: string } | { ok: false; error: string } {
  const text = result.content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
    .trim()
  if (result.isError) return { ok: false, error: firstLine(text) || 'error' }
  try {
    const value = (JSON.parse(text) as Record<string, unknown> | null)?.[key]
    if (typeof value === 'string') return { ok: true, text: value }
  } catch {
    // 아래에서 오류로
  }
  return { ok: false, error: firstLine(text) || 'empty result' }
}

// 보내기 결과: 실패면 그 글의 첫 줄, 아니면 null(성공 글의 모양은 보지 않는다).
export function sendProblem(result: { content: readonly Block[]; isError: boolean }): string | null {
  if (!result.isError) return null
  const text = result.content.map(block => (block.type === 'text' ? (block.text ?? '') : '')).join('\n')
  return firstLine(text) || 'error'
}

const firstLine = (text: string) => (text.split('\n').find(line => line.trim() !== '') ?? '').trim().slice(0, 200)

// 프로필에서 내 UID
export function parseMe(text: string): string | null {
  return /^User ID: (\w+)$/m.exec(text)?.[1] ?? null
}

const people = (text: string) => [...text.matchAll(/([^,]+?) \(ID: (\w+)\)/g)].map(match => ({ name: match[1]!.trim(), id: match[2]! }))
// "kevin <kevin@example.com>" → "kevin"
const bare = (name: string) => name.replace(/\s*<[^>]*>\s*$/, '').trim()

// 검색 결과: "### Result N of M" 마다 Channel·Participants·From·Time·Message_ts·Permalink·Text 줄. DM·그룹 DM 만.
// 스레드 답글은 Permalink 에 ?thread_ts=부모 가 붙는다(부모 글 자신이면 같은 ts 라 스레드로 치지 않는다).
export function parseSearch(text: string): SlackMessage[] {
  const out: SlackMessage[] = []
  for (const block of text.split(/^### Result \d+ of \d+[^\n]*$/m).slice(1)) {
    const channel = /^Channel: (DM|Group DM) \(ID: (\w+)\)$/m.exec(block)
    const from = /^From: (.+?) \(ID: (\w+)\)/m.exec(block)
    const ts = /^Message_ts: (\d+\.\d+)/m.exec(block)?.[1]
    if (!channel || !from || !ts) continue
    const body = /^Text: ?\n([\s\S]*)$/m.exec(block)?.[1] ?? ''
    const permalink = /^Permalink: \[[^\]]*\]\((https?:[^)\s]+)\)/m.exec(block)?.[1] ?? null
    const thread = permalink ? (/[?&]thread_ts=(\d+\.\d+)/.exec(permalink)?.[1] ?? null) : null
    out.push({
      channel: channel[2]!,
      kind: channel[1] === 'DM' ? 'dm' : 'group',
      participants: people(/^Participants: (.*)$/m.exec(block)?.[1] ?? ''),
      from: { id: from[2]!, name: bare(from[1]!) },
      ts,
      text: body.replace(/\n+---\s*$/, '').trim(),
      permalink,
      thread: thread === ts ? null : thread,
    })
  }
  return out
}

// 채널 기록: "=== Message from 이름 <메일> (U…) at 시각 ===" 다음 줄 "Message TS: …", 그 뒤 본문. 최신 것부터 오니 뒤집는다.
// 답글이 달린 글은 본문 끝에 "Thread: N replies (latest: 시각)" 줄이 붙는다. 그 줄은 replies 로 옮긴다.
export function parseHistory(text: string): SlackPost[] {
  const parts = text.split(/^=== Message from (.+?) \((\w+)\) at (.+?) ===[ \t]*$/m)
  const out: SlackPost[] = []
  for (let index = 1; index + 3 < parts.length; index += 4) {
    const rest = parts[index + 3] ?? ''
    const ts = /^\s*Message TS: (\d+\.\d+)/.exec(rest)?.[1]
    if (!ts) continue
    const body = rest.replace(/^\s*Message TS: [^\n]*\n?/, '')
    const thread = /^Thread: (\d+) repl(?:y|ies)\b[^\n]*$/m.exec(body)
    out.push({
      ts,
      from: { id: parts[index + 1]!, name: bare(parts[index]!) },
      at: parts[index + 2]!,
      text: (thread ? body.replace(thread[0], '') : body).trim(),
      replies: thread ? Number(thread[1]) : 0,
    })
  }
  return out.reverse()
}

// 스레드: "=== THREAD PARENT MESSAGE ===" 와 "--- Reply i of n ---" 마다 From·Time·Message TS 줄, 그 뒤 본문. 오래된 것부터 온다.
export function parseThread(text: string): SlackPost[] {
  const out: SlackPost[] = []
  for (const block of text.split(/^(?:=== THREAD PARENT MESSAGE ===|--- Reply \d+ of \d+ ---)[ \t]*$/m).slice(1)) {
    const from = /^From: (.+?) \((\w+)\)[ \t]*$/m.exec(block)
    const ts = /^Message TS: (\d+\.\d+)[ \t]*$/m.exec(block)
    if (!from || !ts) continue
    const body = block.slice(ts.index + ts[0].length).replace(/^=== THREAD REPLIES[^\n]*$/m, '')
    out.push({ ts: ts[1]!, from: { id: from[2]!, name: bare(from[1]!) }, at: /^Time: (.*)$/m.exec(block)?.[1]?.trim() ?? '', text: body.trim(), replies: 0 })
  }
  return out
}

// Slack mrkdwn 의 링크 <url|글> → 글, <url> → url, 엔티티는 글자로. 나머지는 그대로(미리보기·알림·Claude 에게 줄 글).
export function slackText(text: string): string {
  return entities(text.replace(/<((?:https?|mailto):[^|>]+)\|([^>]+)>/g, '$2').replace(/<((?:https?|mailto):[^>]+)>/g, '$1'))
}

// 방 안 글을 그릴 마크다운(desk-look 렌더러로 그린다). Slack mrkdwn 은 마크다운과 다르다:
// *굵게* _기울임_ ~취소~, ``` 는 한 줄 안에서도 열고 닫고, <주소|글>·<@U…>·<#C…|이름>·<!here> 를 쓴다.
// 코드 밖의 나머지 글자는 마크다운으로 읽히지 않게 \ 로 막는다. names 는 멘션 <@U…> 을 이름으로 풀 사람들.
// Slack 은 글자 < > & 를 &lt; &gt; &amp; 로 준다(진짜 < 는 위 모양에만): <…> 를 읽은 뒤에 푼다.
const WORD = '\\p{L}\\p{N}_'
const mark = (m: string) => `(?<![${WORD}${m}])${m}([^\\s${m}](?:[^\\n${m}]*[^\\s${m}])?)${m}(?![${WORD}${m}])`
const SLACK_INLINE = new RegExp(`<([^<>\\n]+)>|(\`[^\`\\n]+\`)|${mark('\\*')}|${mark('_')}|${mark('~')}`, 'gu')

export function slackMarkdown(text: string, names: Readonly<Record<string, string>> = {}): string {
  const out: string[] = []
  let last = 0
  for (const fence of text.matchAll(/```([\s\S]*?)```/g)) {
    out.push(slackLines(text.slice(last, fence.index), names))
    const body = (fence[1] ?? '').replace(/^\n/, '').replace(/\n$/, '')
    // 상자 표가 든 펜스는 터미널 출력을 붙여 넣은 것: 코드 대신 글로 그려 표를 패널 폭에 맞춘다(서식 글자는 글자 그대로)
    out.push(body.split('\n').some(line => BOX_RULE.test(line)) ? `\n${slackLines(body, names, true)}\n` : `\n\`\`\`\n${entities(body)}\n\`\`\`\n`)
    last = fence.index + fence[0].length
  }
  out.push(slackLines(text.slice(last), names))
  return out.join('').replace(/^\n+|\n+$/g, '')
}

// 코드 블록 밖: 줄 앞 • ◦ ▪ 는 목록으로, ─ 만 있는 줄은 가로줄로, 줄 앞 │ 는 인용으로, 상자 표는 마크다운 표로,
// 나머지는 줄마다 인라인(literal 이면 서식 없이 글자만).
// 터미널 출력(• ─ 줄이 있는 글)을 복사하면 둘째 줄부터 같은 칸만큼 들여 있어 그만큼 걷는다(첫 줄은 빼고 센다,
// Python 의 cleandoc). 펜스 없이 붙여 넣은 코드는 첫 줄만 덜 들여 있는 게 보통이라 그대로 둔다.
function slackLines(text: string, names: Readonly<Record<string, string>>, literal = false): string {
  const inline = (line: string) => (literal ? escapeMarkdown(line) : slackInline(line, names))
  const raw = text.split('\n')
  const isTerminal = raw.some(line => /^\s*(?:[•◦▪]\s|[─━]{3,})/.test(line))
  const indents = raw.slice(1).filter(line => line.trim() !== '').map(line => /^ */.exec(line)![0].length)
  const strip = isTerminal && indents.length > 0 ? Math.min(...indents) : 0
  const lines = raw.map((line, index) => (index === 0 ? line.trimStart() : line.slice(strip)))
  const out: string[] = []
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? ''
    const table = boxTable(lines, index)
    if (table) {
      const row = (cells: string[]) => `| ${cells.map(cell => inline(cell).replace(/\|/g, '\\|')).join(' | ')} |`
      out.push('', row(table.header), `|${table.header.map(() => ' --- ').join('|')}|`, ...table.rows.map(row), '')
      index = table.end - 1
      continue
    }
    if (/^\s*[─━]{3,}\s*$/.test(line)) out.push('---')
    else if (/^\s*│\s/.test(line) && !line.slice(line.indexOf('│') + 1).includes('│')) out.push(`> ${inline(line.slice(line.indexOf('│') + 1).trim())}`)
    else {
      const bullet = /^(\s*)[•◦▪]\s+(.*)$/.exec(line)
      out.push(bullet ? `${bullet[1]}- ${inline(bullet[2] ?? '')}` : inline(line))
    }
  }
  return out.join('\n')
}

// 터미널이 그린 상자 표: 머리 줄 → ─┼─ 줄 → 행. 칸은 │ 로 나뉘고, 첫 칸이 빈 줄은 위 행이 칸 폭에서 접혀 내려온 것.
// 접힌 조각이 칸 폭을 꽉 채웠고 앞뒤가 영문·숫자면 낱말 가운데서 접힌 것이라 붙이고, 아니면 한 칸 띄워 잇는다.
const BOX_RULE = /^\s*─+(?:┼─+)+\s*$/

function boxTable(lines: readonly string[], start: number): { header: string[]; rows: string[][]; end: number } | null {
  const first = lines[start] ?? ''
  if (!first.includes('│') || /^\s*│/.test(first)) return null
  let rule = start + 1
  while (rule < lines.length && rule - start <= 3 && !BOX_RULE.test(lines[rule] ?? '') && (lines[rule] ?? '').includes('│')) rule++
  if (!BOX_RULE.test(lines[rule] ?? '')) return null
  const widths = (lines[rule] ?? '').trim().split('┼').map(segment => cellWidth(segment) - 2)
  const split = (line: string) => line.split('│')
  const count = widths.length
  const merge = (group: string[]) => {
    const cells = widths.map(() => '')
    // 칸마다 마지막으로 붙인 조각: 이것이 칸 폭을 채웠으면 다음 조각은 낱말 가운데서 이어진다
    const tails = widths.map(() => '')
    for (const line of group) {
      split(line)
        .slice(0, count)
        .forEach((piece, index) => {
          const part = piece.trim()
          const was = cells[index] ?? ''
          if (part === '') return
          const isCut = cellWidth(tails[index] ?? '') >= (widths[index] ?? 0) && /[A-Za-z0-9_]$/.test(was) && /^[A-Za-z0-9_]/.test(part)
          cells[index] = was === '' ? part : `${was}${isCut ? '' : ' '}${part}`
          tails[index] = part
        })
    }
    return cells
  }
  const header = merge(lines.slice(start, rule))
  const rows: string[][] = []
  let group: string[] = []
  let end = rule + 1
  for (; end < lines.length; end++) {
    const line = lines[end] ?? ''
    if (BOX_RULE.test(line)) continue
    if (!line.includes('│') || split(line).length !== count) break
    if (split(line)[0]!.trim() !== '' && group.length > 0) {
      rows.push(merge(group))
      group = []
    }
    group.push(line)
  }
  if (group.length > 0) rows.push(merge(group))
  return rows.length > 0 ? { header, rows, end } : null
}

// nested: 굵게·기울임 안. 멘션을 또 ** 로 싸면 렌더러가 ** 짝을 잘못 맞춘다.
function slackInline(text: string, names: Readonly<Record<string, string>>, nested = false): string {
  let out = ''
  let last = 0
  for (const match of text.matchAll(SLACK_INLINE)) {
    out += escapeMarkdown(text.slice(last, match.index))
    const [whole, angle, code, bold, italic, strike] = match
    if (angle !== undefined) out += slackAngle(angle, names, nested) ?? escapeMarkdown(whole)
    else if (code !== undefined) out += entities(code)
    else if (bold !== undefined) out += `**${slackInline(bold, names, true)}**`
    else if (italic !== undefined) out += `*${slackInline(italic, names, true)}*`
    else if (strike !== undefined) out += `~~${slackInline(strike, names, true)}~~`
    last = match.index + whole.length
  }
  return out + escapeMarkdown(text.slice(last))
}

// <…> 하나. Slack 이 만든 모양이 아니면(사람이 쓴 <host> 같은 글) null.
function slackAngle(inner: string, names: Readonly<Record<string, string>>, nested: boolean): string | null {
  const strong = (label: string) => (nested ? label : `**${label}**`)
  const bar = inner.indexOf('|')
  const [head, label] = bar < 0 ? [inner, null] : [inner.slice(0, bar), inner.slice(bar + 1)]
  if (/^(?:https?|mailto):/.test(head)) {
    const href = head.replace(/[()\s]/g, ch => encodeURIComponent(ch))
    const shown = label ?? head.replace(/^mailto:/, '')
    return shown === head ? `<${href}>` : `[${escapeMarkdown(shown)}](${href})`
  }
  const mention = /^@([UW]\w+)$/.exec(head)
  if (mention) return strong(`@${escapeMarkdown(label ?? names[mention[1]!] ?? mention[1]!)}`)
  if (/^#C\w+$/.test(head)) return strong(`#${escapeMarkdown(label ?? head.slice(1))}`)
  if (/^!(?:here|channel|everyone)$/.test(head)) return strong(`@${head.slice(1)}`)
  if (head.startsWith('!') && label !== null) return strong(escapeMarkdown(label))
  return null
}

const entities = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

// 마크다운이 서식으로 읽는 글자를 막는다(엔티티도 함께 푼다). 맨 주소는 그대로 둔다(렌더러가 링크로 읽는다).
function escapeMarkdown(text: string): string {
  return entities(text)
    .split(/(https?:\/\/\S+)/)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(/[\\`*_~[\]]/g, '\\$&')))
    .join('')
}

// 기록·스레드 본문 끝의 "Files: a.png (ID: F…, image/png, 51.1 KB)" 줄. 본문과 따로 그린다.
export function slackFiles(text: string): { text: string; files: string[] } {
  const files: string[] = []
  const rest = text.replace(/^Files: (.*)$/gm, (_, list: string) => {
    for (const file of list.matchAll(/(.+?) \(ID: \w+, [^,)]+, ([^)]+)\)(?:, |$)/g)) files.push(`${file[1]!.trim()} · ${file[2]!.trim()}`)
    return ''
  })
  return { text: rest.trim(), files }
}

// Slack ts("1792131860.241069") 비교. 소수까지 문자열로(배정밀도로 바꾸면 끝자리가 흐려진다).
export function tsCompare(a: string, b: string): number {
  const [ai = '0', af = ''] = a.split('.')
  const [bi = '0', bf = ''] = b.split('.')
  if (ai.length !== bi.length) return ai.length - bi.length
  if (ai !== bi) return ai < bi ? -1 : 1
  const [x, y] = [af.padEnd(6, '0'), bf.padEnd(6, '0')]
  return x === y ? 0 : x < y ? -1 : 1
}

export const emptyInbox = (): SlackInbox => ({ watermark: null, notified: null, rooms: {} })

// 미리보기 한 줄
export function snippet(text: string): string {
  return slackText(text).replace(/```/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
}

// 받은 메시지를 방에 넣는다. 워터마크보다 새 것만, 내가 보낸 것은 빼고. 닫은 방(지운 방)도 새 메시지면 다시 생긴다.
// 처음 채우기(워터마크 없음)는 알리지 않고 읽은 것으로 넣는다(Slack 의 읽음을 알 수 없어 지켜보기 전 것은 세지 않는다).
// 받은 게 없으면 워터마크를 지금(nowS)으로 둬 다음부터는 알린다.
// fresh: 알릴 메시지(오래된 것부터). 검색은 한 번에 20개라 그 사이 더 오면 오래된 것은 방에 안 들어간다.
export function mergeInbox(inbox: SlackInbox, messages: readonly SlackMessage[], me: string, nowS: number): { inbox: SlackInbox; fresh: SlackMessage[] } {
  const known = inbox.watermark
  const added = messages
    .filter(message => message.from.id !== me && (known === null || tsCompare(message.ts, known) > 0))
    .sort((a, b) => tsCompare(a.ts, b.ts))
  const rooms = { ...inbox.rooms }
  for (const message of added) {
    const was = rooms[message.channel]
    const others = message.participants.filter(person => person.id !== me).map(person => person.name)
    rooms[message.channel] = {
      id: message.channel,
      kind: message.kind,
      title: others.length > 0 ? others.join(', ') : (was?.title ?? message.from.name),
      lastTs: message.ts,
      lastFrom: message.from.name,
      lastThread: message.thread,
      preview: snippet(message.text),
      unread: (was?.unread ?? 0) + (known === null ? 0 : 1),
      link: message.permalink?.replace(/\/p\d+(?:\?.*)?$/, '') ?? was?.link ?? null,
    }
  }
  const watermark = added.length > 0 ? added[added.length - 1]!.ts : (known ?? `${nowS}.000000`)
  return { inbox: { ...inbox, watermark, rooms }, fresh: known === null ? [] : added }
}

// 방을 열어 읽은 기록으로 안 읽음을 지우고, 기록의 마지막 글(내 답장이면 lastFrom 이 null)을 미리보기로.
// thread 는 읽은 것이 스레드면 그 부모 ts(채널 기록이면 null).
export function readRoom(inbox: SlackInbox, channel: string, posts: readonly SlackPost[], me: string, thread: string | null = null): SlackInbox {
  const room = inbox.rooms[channel]
  if (!room) return inbox
  const last = posts[posts.length - 1]
  const isNewer = last !== undefined && tsCompare(last.ts, room.lastTs) >= 0
  const next: SlackRoom = isNewer ? { ...room, unread: 0, lastTs: last.ts, lastFrom: last.from.id === me ? null : last.from.name, lastThread: thread, preview: snippet(last.text) } : { ...room, unread: 0 }
  return { ...inbox, rooms: { ...inbox.rooms, [channel]: next } }
}

export function closeRoom(inbox: SlackInbox, channel: string): SlackInbox {
  const { [channel]: _, ...rooms } = inbox.rooms
  return { ...inbox, rooms }
}

// 최근 방부터
export function roomList(inbox: SlackInbox): SlackRoom[] {
  return Object.values(inbox.rooms).sort((a, b) => tsCompare(b.lastTs, a.lastTs))
}

export function unreadCount(inbox: SlackInbox): number {
  return Object.values(inbox.rooms).reduce((sum, room) => sum + room.unread, 0)
}

// 받은 편지를 읽을 세션: 아무도 없거나, 나거나, 맡은 세션이 LEASE_MS 동안 소식이 없을 때.
export function holdsLease(poller: SlackPoller | null, session: string, now: number): boolean {
  return poller === null || poller.session === session || now - poller.at > LEASE_MS
}

// 알림: 방마다 하나. 여러 개면 마지막 글에 "외 N개".
export function notices(fresh: readonly SlackMessage[], inbox: SlackInbox, more: (count: number) => string): Array<{ title: string; text: string }> {
  const byRoom = new Map<string, SlackMessage[]>()
  for (const message of fresh) byRoom.set(message.channel, [...(byRoom.get(message.channel) ?? []), message])
  return [...byRoom].map(([channel, list]) => {
    const last = list[list.length - 1]!
    const room = inbox.rooms[channel]
    const head = room?.kind === 'group' ? `${last.from.name}: ` : ''
    return { title: room?.title ?? last.from.name, text: `${head}${snippet(last.text)}${list.length > 1 ? more(list.length - 1) : ''}` }
  })
}

// "Claude에게 맡기기": 방 이름과 최근 대화를 입력창에.
export function slackPrompt(room: SlackRoom, posts: readonly SlackPost[], head: string): string {
  const recent = posts.slice(-10).map(post => `- ${post.from.name}: ${slackText(post.text).trim().slice(0, 600).replaceAll('\n', ' ')}`)
  return [head, room.link, '', ...recent].filter(line => line !== null).join('\n')
}
