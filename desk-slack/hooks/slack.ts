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

// Slack mrkdwn 의 링크 <url|글> → 글, <url> → url. 나머지는 그대로.
export function slackText(text: string): string {
  return text.replace(/<((?:https?|mailto):[^|>]+)\|([^>]+)>/g, '$2').replace(/<((?:https?|mailto):[^>]+)>/g, '$1')
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
  return slackText(text).replace(/\s+/g, ' ').trim().slice(0, 200)
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
