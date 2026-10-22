import type { AsanaComment, AsanaDetail, AsanaField, AsanaProject, AsanaServer, AsanaTask, AsanaUser } from '../types'
import { T } from './i18n'

// /desk-asana: 내게 할당된 Asana 태스크. 엔진에 이미 붙은 Asana MCP 서버를 그대로 쓴다($.mcp.call, 엔진의 연결·인증).
// 서버 이름은 사람마다 달라 도구 목록에서 찾는다: Asana 공식 v2 서버(get_my_tasks)를 먼저, 없으면 claude.ai 커넥터(asana_*).
// 검색(v2 search_tasks, v1 asana_search_tasks)은 Premium 워크스페이스에서만 된다. v1 은 내 태스크 목록도 이 검색이다.
// 프로젝트 탭: 워크스페이스의 프로젝트(get_projects)를 멤버에 내가 있는지로 나누고, 고른 프로젝트의 열린 태스크(get_tasks)를
// 섹션별로 묶는다. get_tasks 는 보드 차례(섹션 차례)로 주므로 섹션 목록을 따로 읽지 않는다(빈 섹션은 안 보인다).
// 사용자 지정 작업 유형의 상태(Open·In Progress…)는 두 서버 모두 바꾸는 도구가 없어(v2 update_tasks 는 키를 버린다) 보여 주기만 한다.

export const ASANA_TOOLS = {
  v2: {
    list: 'get_my_tasks',
    search: 'search_tasks',
    task: 'get_task',
    stories: 'get_task_stories',
    comment: 'add_comment',
    update: 'update_tasks',
    users: 'search_objects',
    me: 'get_me',
    projects: 'get_projects',
    tasks: 'get_tasks',
  },
  v1: {
    list: 'asana_search_tasks',
    search: 'asana_search_tasks',
    task: 'asana_get_task',
    stories: 'asana_get_stories_for_task',
    comment: 'asana_create_task_story',
    update: 'asana_update_task',
    users: 'asana_typeahead_search',
    me: 'asana_get_user',
    projects: 'asana_get_projects',
    tasks: 'asana_get_tasks',
  },
} as const

// 상세에 보이는 댓글 수. v2 get_task 는 최근 것부터 이만큼, v1 은 활동 100개에서 댓글만 골라 끝에서 이만큼.
export const COMMENT_LIMIT = 30
const LIST_FIELDS = 'name,due_on,completed,custom_type_status_option.name,memberships.project.name,memberships.section.name,permalink_url'
// 검색 결과는 남의 태스크도 섞이니 담당자 이름까지.
const SEARCH_FIELDS = `${LIST_FIELDS},assignee.name`
const PROJECT_TASK_FIELDS = 'name,due_on,completed,custom_type_status_option.name,assignee.name,permalink_url,memberships.project.gid,memberships.project.name,memberships.section.name'
// 태스크 키(taskKey)는 키 필드를 설정했을 때만 읽는다. 없으면 목록 응답을 예전 그대로.
const withKey = (fields: string, keyFields: readonly string[]) => (keyFields.length === 0 ? fields : `${fields},custom_fields.name,custom_fields.display_value`)
// 목록 한 쪽의 크기. custom_fields 는 프로젝트의 모든 필드를 태스크마다 실어 응답이 커지니(필드 셋에 약 230자) 반으로 시작한다.
// 그래도 MCP 결과 한도를 넘으면 패널이 더 줄여 다시 읽는다(register.tsx readPages).
const pageSize = (keyFields: readonly string[]) => (keyFields.length === 0 ? 100 : 50)

// 설정 asanaKeyField: 태스크 키로 보일 사용자 정의 필드 이름들(쉼표로, 앞의 것부터). 예: "JKD" 또는 "JKD, J5S".
export function keyFieldNames(value: unknown): string[] {
  return typeof value !== 'string' ? [] : value.split(',').map(name => name.trim()).filter(name => name !== '')
}
const TASK_FIELDS = [
  'name,notes,html_notes,completed,due_on,permalink_url,assignee.name',
  'memberships.project.name,memberships.section.name',
  'custom_type_status_option.name,custom_type.status_options.gid,custom_type.status_options.name,custom_type.status_options.enabled',
  'custom_fields.name,custom_fields.type,custom_fields.display_value,custom_fields.is_formula_field',
  'custom_fields.enum_options.name,custom_fields.enum_options.enabled',
].join(',')

// 도구 이름(mcp__<서버>__<도구>) 목록에서 Asana 서버를 찾는다. 패널이 쓰는 도구가 그 서버에 다 있어야 한다.
export function findAsanaServer(names: readonly string[]): AsanaServer | null {
  const all = new Set(names)
  for (const dialect of ['v2', 'v1'] as const) {
    const tools = Object.values(ASANA_TOOLS[dialect])
    const suffix = `__${ASANA_TOOLS[dialect].list}`
    for (const name of names) {
      if (!name.startsWith('mcp__') || !name.endsWith(suffix)) continue
      const server = name.slice('mcp__'.length, -suffix.length)
      if (server !== '' && tools.every(tool => all.has(`mcp__${server}__${tool}`))) return { name: server, dialect }
    }
  }
  return null
}

// 패널이 그 서버에서 부르는 도구의 전체 이름. 플러그인의 $.mcp.call 도 권한 검사를 받아(auto mode 분류기는 거절,
// 기본 모드는 누를 때마다 창) 사람이 settings 의 permissions.allow 에 이 이름들을 넣어야 패널이 막힘없이 돈다.
export function paneTools(server: AsanaServer): string[] {
  return [...new Set<string>(Object.values(ASANA_TOOLS[server.dialect]))].map(tool => `mcp__${server.name}__${tool}`)
}

export type AsanaCall = { tool: string; args: Record<string, unknown> }

// 작업 유형에 따라 보류·배포 대기 같은 상태도 Asana 에선 완료라, 열린 태스크와 함께 이 날수 안에 완료된 태스크도 읽어
// 목록 끝 "최근 완료" 묶음으로 보인다. since 는 그 시작 ISO 시각(doneSince).
export const DONE_DAYS = 14
export const doneSince = (now: number) => new Date(now - DONE_DAYS * 86_400_000).toISOString()

// 내 태스크: v2 는 completed_since 하나로 열린 것과 그 뒤 완료된 것을 함께 준다. v1 검색은 둘을 한 번에 못 받아 따로 부른다.
export function listCalls(server: AsanaServer, since: string, keyFields: readonly string[] = []): AsanaCall[] {
  const opt_fields = withKey(LIST_FIELDS, keyFields)
  const limit = pageSize(keyFields)
  if (server.dialect === 'v2') return [{ tool: ASANA_TOOLS.v2.list, args: { completed_since: since, limit, opt_fields } }]
  const args = { assignee_any: 'me', limit, opt_fields }
  return [
    { tool: ASANA_TOOLS.v1.list, args: { ...args, completed: false, sort_by: 'modified_at' } },
    { tool: ASANA_TOOLS.v1.list, args: { ...args, completed: true, completed_at_after: since, sort_by: 'completed_at' } },
  ]
}

// 워크스페이스 전체에서 글자로 찾는다(이름·설명·댓글). 열린 태스크만, 최근에 바뀐 것부터.
export function searchCall(server: AsanaServer, text: string, keyFields: readonly string[] = []): AsanaCall {
  return { tool: ASANA_TOOLS[server.dialect].search, args: { text, completed: false, limit: 50, sort_by: 'modified_at', opt_fields: withKey(SEARCH_FIELDS, keyFields) } }
}

// 키로 찾기: 검색어가 "JKD-1630" 모양이면 키 필드마다 값이 같은 열린 태스크를 찾는다. 글자 검색은 필드 값을 보지 않는다.
// gids 는 목록에서 본 키 필드의 gid(keyFieldGids). 아직 못 봤으면 키로는 찾지 않는다.
export function keySearchCalls(server: AsanaServer, text: string, keyFields: readonly string[], gids: readonly string[]): AsanaCall[] {
  if (!/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(text)) return []
  return gids.map(gid => ({
    tool: ASANA_TOOLS[server.dialect].search,
    args: { custom_fields: JSON.stringify({ [`${gid}.value`]: text.toUpperCase() }), completed: false, limit: 10, opt_fields: withKey(SEARCH_FIELDS, keyFields) },
  }))
}

export function taskCall(server: AsanaServer, gid: string): AsanaCall {
  return server.dialect === 'v2'
    ? { tool: ASANA_TOOLS.v2.task, args: { task_id: gid, comment_limit: COMMENT_LIMIT, include_subtasks: false, opt_fields: TASK_FIELDS } }
    : { tool: ASANA_TOOLS.v1.task, args: { task_id: gid, opt_fields: TASK_FIELDS } }
}

// 댓글은 활동(story)에서 따로 읽는다. v2 get_task 의 댓글은 html_text 를 주지 않아(opt_fields 도 안 먹는다) 서식·멘션 이름이 없다.
// v2 는 최근 것부터 COMMENT_LIMIT 개, v1 은 정렬을 고를 수 없어 오래된 것부터 100개다.
const STORY_FIELDS = 'text,html_text,created_at,created_by.name,created_by.gid,resource_subtype'
export function storiesCall(server: AsanaServer, gid: string): AsanaCall {
  return server.dialect === 'v2'
    ? { tool: ASANA_TOOLS.v2.stories, args: { task_id: gid, resource_subtype: 'comment_added', sort_ascending: false, limit: COMMENT_LIMIT, opt_fields: STORY_FIELDS } }
    : { tool: ASANA_TOOLS.v1.stories, args: { task_id: gid, limit: 100, opt_fields: STORY_FIELDS } }
}

// 고른 사람이 글에 "@이름" 으로 남아 있으면 html_text 로 보낸다(<a data-asana-gid/> 가 멘션이 된다). 지웠으면 그냥 글.
export function commentCall(server: AsanaServer, gid: string, text: string, mentions: readonly AsanaUser[] = []): AsanaCall {
  const html = mentionHtml(text, mentions)
  return { tool: ASANA_TOOLS[server.dialect].comment, args: html === null ? { task_id: gid, text } : { task_id: gid, html_text: html } }
}

// 고른 사람의 "@이름" 을 <a data-asana-gid/> 로 바꾼다(Asana 가 이름으로 펼친다). 하나도 안 남았으면 null(그냥 글).
// 긴 이름부터 맞춰 "Kim" 이 "Kim Lee" 의 앞을 먹지 않게 한다. 줄바꿈은 <body> 안에 그대로 둔다(Asana 도 html_text 에 \n 으로 둔다).
export function mentionHtml(text: string, mentions: readonly AsanaUser[]): string | null {
  const byName = new Map(mentions.filter(user => user.name !== '').map(user => [escapeHtml(`@${user.name}`), user.gid]))
  if (byName.size === 0) return null
  const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  let isUsed = false
  const body = escapeHtml(text).replace(new RegExp(names.join('|'), 'g'), name => {
    isUsed = true
    return `<a data-asana-gid="${byName.get(name)}"/>`
  })
  return isUsed ? `<body>${body}</body>` : null
}

const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }

// 글 조각을 글자마다 원래 모양(엔티티면 &quot; 그대로)과 함께 푼다. 고친 조각도 안 바꾼 글자는 원래 모양으로 다시 쓴다.
function decodeText(raw: string): { text: string; pieces: string[] } {
  const pieces: string[] = []
  let text = ''
  for (const match of raw.matchAll(/&(#\d+|#x[0-9a-f]+|[a-z]+);|[\s\S]/gi)) {
    const entity = match[1]
    const code = entity?.startsWith('#x') || entity?.startsWith('#X') ? parseInt(entity.slice(2), 16) : entity?.startsWith('#') ? Number(entity.slice(1)) : null
    const value = entity === undefined ? match[0] : code !== null ? String.fromCodePoint(code) : (ENTITIES[entity.toLowerCase()] ?? match[0])
    // 한 글자가 UTF-16 두 칸이면 원래 모양은 첫 칸에만 둔다.
    for (let unit = 0; unit < value.length; unit++) pieces.push(unit === 0 ? match[0] : '')
    text += value
  }
  return { text, pieces }
}
const unescapeHtml = (raw: string) => decodeText(raw).text

// 댓글 고치기: 두 Asana MCP 서버 모두 댓글(story)을 고치는 도구가 없어, 사람이 넣은 개인 토큰(PAT, userConfig asanaToken)이
// 있을 때만 REST API 로 한다. story 의 text 는 멘션을 프로필 URL 로 풀고 서식을 버리므로, 고칠 글은 html_text 에서 만들고
// 저장은 바뀐 글자만 원래 html_text 의 그 자리에 끼워 넣는다(storyPatch). 손대지 않은 태그·글은 바이트 그대로 남는다.
export const ASANA_API = 'https://app.asana.com/api/1.0'

export type AsanaStory = { gid: string; author: string | null; html: string; draft: string | null }

export function toStory(json: unknown): AsanaStory | null {
  const raw = dataOf(json) as { gid?: unknown; html_text?: unknown; created_by?: Named } | undefined
  if (typeof raw?.gid !== 'string' || typeof raw.html_text !== 'string') return null
  return { gid: raw.gid, author: str(raw.created_by?.gid), html: raw.html_text, draft: storyView(raw.html_text)?.text ?? null }
}

type Tok = { raw: string; kind: 'text' | 'open' | 'close' | 'self'; name: string; text: string; pieces: string[] }
// 고칠 글의 글자 한 칸: 글 조각(seg 번째 토큰의 off 번째 글자) 아니면 고칠 수 없는 표시(group). 표시는 멘션·링크·이미지(인라인)와
// 목록 기호·블록 앞뒤 줄바꿈(구조)이다. before·after 는 그 표시 앞뒤에 글을 끼울 수 있는 토큰 자리(끼울 수 없으면 null).
type Cell = { seg: number; off: number } | { group: number }
type Group = { start: number; end: number; before: number | null; after: number | null; isDeletable: boolean; first: number; last: number }

function tokenize(html: string): Tok[] {
  const body = html.replace(/^\s*<body>/, '').replace(/<\/body>\s*$/, '')
  return (body.match(/<[^>]+>|[^<]+/g) ?? []).map(raw => {
    if (!raw.startsWith('<')) return { raw, kind: 'text', name: '', ...decodeText(raw) }
    const name = (/^<\/?\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(raw)?.[1] ?? '').toLowerCase()
    const kind = raw.startsWith('</') ? 'close' : raw.endsWith('/>') || name === 'img' || name === 'hr' || name === 'br' ? 'self' : 'open'
    return { raw, kind, name, text: '', pieces: [] }
  })
}

const BLOCKS = new Set(['h1', 'h2', 'blockquote', 'pre', 'ul', 'ol'])

export function storyView(html: string): { text: string; cells: Cell[]; groups: Group[]; toks: Tok[] } | null {
  const toks = tokenize(html)
  const cells: Cell[] = []
  const groups: Group[] = []
  const lists: Array<{ ordered: boolean; n: number }> = []
  let text = ''
  let pendingBreak: number | null = null
  const atLineStart = () => text === '' || text.endsWith('\n')
  const fixed = (shown: string, at: Omit<Group, 'start' | 'end'>) => {
    if (shown === '') return
    const group = groups.length
    groups.push({ ...at, start: text.length, end: text.length + shown.length })
    for (const _ of shown) cells.push({ group })
    text += shown
  }
  const flushBreak = (next: string) => {
    if (pendingBreak !== null && !next.startsWith('\n') && !atLineStart()) fixed('\n', { before: null, after: pendingBreak, isDeletable: false, first: pendingBreak, last: pendingBreak })
    pendingBreak = null
  }
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i] as Tok
    if (tok.kind === 'text') {
      flushBreak(tok.text)
      for (let off = 0; off < tok.text.length; off++) cells.push({ seg: i, off })
      text += tok.text
    } else if (tok.kind === 'open' && tok.name === 'a') {
      // 링크·멘션은 통째로 하나의 표시: 안쪽 글자를 보이되 고칠 수 없고, 다 지우면 링크째 지운다.
      let close = i + 1
      while (close < toks.length && !(toks[close]?.kind === 'close' && toks[close]?.name === 'a')) close++
      if (close >= toks.length) return null
      flushBreak('')
      fixed(toks.slice(i + 1, close).map(inner => inner.text).join(''), { before: i, after: close, isDeletable: true, first: i, last: close })
      i = close
    } else if (tok.kind === 'self' && tok.name === 'img') {
      flushBreak('')
      fixed(T.asanaImage, { before: i, after: i, isDeletable: false, first: i, last: i })
    } else if (tok.kind === 'self' && tok.name === 'hr') {
      flushBreak('')
      fixed(`${atLineStart() ? '' : '\n'}———\n`, { before: i, after: i, isDeletable: false, first: i, last: i })
    } else if (tok.kind === 'open' && (tok.name === 'ul' || tok.name === 'ol')) {
      flushBreak('')
      lists.push({ ordered: tok.name === 'ol', n: 0 })
    } else if (tok.kind === 'open' && tok.name === 'li') {
      flushBreak('')
      const list = lists.at(-1)
      if (list) list.n++
      const mark = list?.ordered ? `${list.n}. ` : '• '
      fixed(`${atLineStart() ? '' : '\n'}${'  '.repeat(Math.max(0, lists.length - 1))}${mark}`, { before: null, after: i, isDeletable: false, first: i, last: i })
    } else if (tok.kind === 'open' && BLOCKS.has(tok.name)) {
      flushBreak('')
      if (!atLineStart()) fixed('\n', { before: i, after: i, isDeletable: false, first: i, last: i })
    } else if (tok.kind === 'close' && BLOCKS.has(tok.name)) {
      if (tok.name === 'ul' || tok.name === 'ol') lists.pop()
      pendingBreak = i
    }
  }
  return { text, cells, groups, toks }
}

// 태스크 본문(html_notes)을 패널 마크다운으로 옮겨 웹처럼 제목·굵게·목록·코드를 살린다. Asana 서식 태그는 몇 개뿐이다
// (h1·h2·strong·em·u·s·code·a·ul·ol·li·blockquote·pre·hr·img·table). 글은 마크다운 표시로 읽히지 않게 \ 로 막고(parseInline 이 푼다),
// 블록 밖 줄바꿈 하나가 문단 하나다. 밑줄은 마크다운에 없어 글만 남긴다.
type HtmlNode = string | { name: string; raw: string; children: HtmlNode[] }
type HtmlElement = Exclude<HtmlNode, string>

function htmlTree(html: string): HtmlNode[] {
  const root: HtmlElement = { name: '', raw: '', children: [] }
  const stack = [root]
  for (const tok of tokenize(html)) {
    const top = stack[stack.length - 1] as HtmlElement
    if (tok.kind === 'text') top.children.push(tok.text)
    else if (tok.kind === 'self') top.children.push({ name: tok.name, raw: tok.raw, children: [] })
    else if (tok.kind === 'open') {
      const node: HtmlElement = { name: tok.name, raw: tok.raw, children: [] }
      top.children.push(node)
      stack.push(node)
    } else {
      // 짝이 안 맞는 닫는 태그는 버린다.
      let at = stack.length - 1
      while (at > 0 && stack[at]?.name !== tok.name) at--
      if (at > 0) stack.length = at
    }
  }
  return root.children
}

const textOf = (node: HtmlNode): string => (typeof node === 'string' ? node : node.children.map(textOf).join(''))
const attrOf = (node: HtmlElement, name: string) => {
  const value = new RegExp(`\\s${name}="([^"]*)"`).exec(node.raw)?.[1]
  return value === undefined ? null : unescapeHtml(value)
}
// 주소는 그대로 둬야 맨 주소 링크가 깨지지 않는다.
const escapeText = (text: string) =>
  text
    .split(/(https?:\/\/[^\s<>()]+)/)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(/[\\`*_~[\]|]/g, '\\$&')))
    .join('')
// 줄 머리의 #·>·-·+·"1." 은 제목·인용·목록으로 읽힌다.
const escapeLineStart = (line: string) => line.replace(/^(\s*)([#>+-])/, '$1\\$2').replace(/^(\s*\d+)([.)])/, '$1\\$2')
// 감쌀 글을 첫 인자로 둔다: 표시 글자 '*' 가 첫 인자면 디렉터리 검사가 모든 도구에 거는 훅 등록으로 읽고 막는다.
const wrapInline = (inner: string, mark: string) => (inner.trim() === '' ? inner : `${mark}${inner}${mark}`)

function inlineMarkdown(nodes: readonly HtmlNode[]): string {
  return nodes
    .map(node => {
      if (typeof node === 'string') return escapeText(node)
      const inner = inlineMarkdown(node.children)
      switch (node.name) {
        case 'strong':
        case 'b':
          return wrapInline(inner, '**')
        case 'em':
        case 'i':
          return wrapInline(inner, '*')
        case 's':
        case 'strike':
        case 'del':
          return wrapInline(inner, '~~')
        case 'code': {
          const raw = textOf(node)
          return raw.trim() !== '' && !/[`\n]/.test(raw) ? `\`${raw}\`` : inner
        }
        case 'a': {
          const href = attrOf(node, 'href')?.replace(/[\s()]/g, ch => encodeURIComponent(ch))
          return href ? `[${inner.trim() === '' ? escapeText(href) : inner}](${href})` : inner
        }
        case 'img':
          return escapeText(T.asanaImage)
        default:
          return inner
      }
    })
    .join('')
}

const INLINE_TAGS = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'code', 'a', 'img', 'span'])

function listMarkdown(list: HtmlElement, level: number): string[] {
  const lines: string[] = []
  let n = 0
  for (const item of list.children) {
    if (typeof item === 'string' || item.name !== 'li') continue
    n++
    const text = inlineMarkdown(item.children.filter(child => typeof child === 'string' || (child.name !== 'ul' && child.name !== 'ol')))
    lines.push(`${'  '.repeat(Math.min(4, level))}${list.name === 'ol' ? `${n}.` : '-'} ${text.replace(/\s*\n\s*/g, ' ').trim()}`)
    for (const child of item.children) if (typeof child !== 'string' && (child.name === 'ul' || child.name === 'ol')) lines.push(...listMarkdown(child, level + 1))
  }
  return lines
}

function blockMarkdown(nodes: readonly HtmlNode[]): string[] {
  const out: string[] = []
  let run: HtmlNode[] = []
  const flush = () => {
    for (const line of inlineMarkdown(run).split('\n')) if (line.trim() !== '') out.push(escapeLineStart(line.trim()))
    run = []
  }
  for (const node of nodes) {
    if (typeof node === 'string' || INLINE_TAGS.has(node.name)) {
      run.push(node)
      continue
    }
    flush()
    switch (node.name) {
      case 'h1':
      case 'h2':
      case 'h3':
        out.push(`${'#'.repeat(Number(node.name[1]))} ${inlineMarkdown(node.children).replace(/\s*\n\s*/g, ' ').trim()}`)
        break
      case 'ul':
      case 'ol':
        out.push(listMarkdown(node, 0).join('\n'))
        break
      case 'blockquote':
        out.push(
          blockMarkdown(node.children)
            .join('\n\n')
            .split('\n')
            .map(line => (line === '' ? '>' : `> ${line}`))
            .join('\n'),
        )
        break
      case 'pre': {
        const source = textOf(node).replace(/\n+$/, '')
        const fence = '`'.repeat(Math.max(3, ...[...source.matchAll(/`+/g)].map(match => match[0].length + 1)))
        out.push(`${fence}\n${source}\n${fence}`)
        break
      }
      case 'hr':
        // --- 는 맨 앞이면 front matter 로 읽힌다.
        out.push('***')
        break
      case 'table': {
        const rows: string[][] = []
        const collect = (parent: HtmlElement) => {
          for (const child of parent.children) {
            if (typeof child === 'string') continue
            if (child.name === 'tr') rows.push(child.children.filter((cell): cell is HtmlElement => typeof cell !== 'string' && (cell.name === 'td' || cell.name === 'th')).map(cell => inlineMarkdown(cell.children).replace(/\s*\n\s*/g, ' ').trim()))
            else collect(child)
          }
        }
        collect(node)
        const [header, ...body] = rows
        if (header) out.push([header, header.map(() => '---'), ...body].map(row => `| ${row.join(' | ')} |`).join('\n'))
        break
      }
      default:
        out.push(...blockMarkdown(node.children))
    }
  }
  flush()
  return out.filter(block => block.trim() !== '')
}

export function notesMarkdown(html: string): string {
  return blockMarkdown(htmlTree(html)).join('\n\n')
}

// 글자 단위 diff(Myers). 앞뒤 같은 글은 먼저 걷어 낸다. 돌려주는 것은 옛 글의 [start, end) 를 text 로 바꾸는 덩어리들.
// 바뀐 곳이 DIFF_LIMIT 를 넘으면(거의 새로 쓴 글) 기억이 D² 로 불어나므로, 가운데를 통째로 바꾸는 한 덩어리로 돌려준다.
const DIFF_LIMIT = 500

export function textDiff(a: string, b: string): Array<{ start: number; end: number; text: string }> {
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const x0 = a.slice(head, a.length - tail)
  const y0 = b.slice(head, b.length - tail)
  const n = x0.length
  const m = y0.length
  const max = n + m
  const v = new Map<number, number>([[1, 0]])
  const trace: Array<Map<number, number>> = []
  let found = false
  for (let d = 0; d <= max && !found; d++) {
    if (d > DIFF_LIMIT) return [{ start: head, end: a.length - tail, text: y0 }]
    trace.push(new Map(v))
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1)) ? (v.get(k + 1) ?? 0) : (v.get(k - 1) ?? 0) + 1
      let y = x - k
      while (x < n && y < m && x0[x] === y0[y]) {
        x++
        y++
      }
      v.set(k, x)
      if (x >= n && y >= m) {
        found = true
        break
      }
    }
  }
  // 거꾸로 따라가며 한 칸씩 (지움 | 넣음 | 같음) 을 모은다.
  const ops: Array<{ kind: 'eq' | 'del' | 'ins'; a: number; b: number }> = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0; d--) {
    const prev = trace[d] as Map<number, number>
    const k = x - y
    const prevK = k === -d || (k !== d && (prev.get(k - 1) ?? -1) < (prev.get(k + 1) ?? -1)) ? k + 1 : k - 1
    const prevX = d === 0 ? 0 : (prev.get(prevK) ?? 0)
    const prevY = d === 0 ? 0 : prevX - prevK
    while (x > prevX && y > prevY) {
      x--
      y--
      ops.push({ kind: 'eq', a: x, b: y })
    }
    if (d > 0) {
      if (x === prevX) ops.push({ kind: 'ins', a: x, b: y - 1 })
      else ops.push({ kind: 'del', a: x - 1, b: y })
      x = prevX
      y = prevY
    }
  }
  ops.reverse()
  const hunks: Array<{ start: number; end: number; text: string }> = []
  for (const op of ops) {
    if (op.kind === 'eq') continue
    const last = hunks.at(-1)
    const start = op.a
    if (last && last.end === start) {
      if (op.kind === 'del') last.end = op.a + 1
      else last.text += y0[op.b]
    } else hunks.push({ start, end: op.kind === 'del' ? op.a + 1 : start, text: op.kind === 'ins' ? (y0[op.b] as string) : '' })
  }
  return hunks.map(hunk => ({ start: hunk.start + head, end: hunk.end + head, text: hunk.text }))
}

// 고친 글을 원래 html_text 에 끼워 넣는다. 바뀐 덩어리가 고칠 수 없는 표시(목록 기호, 이미지, 멘션 글자의 일부)를 건드리면 거절한다.
// 멘션·링크는 통째로 지우는 것만 된다. 끼워 넣는 글은 왼쪽 글 조각의 서식을 따르고, 없으면 오른쪽, 그것도 없으면 표시의 앞뒤 자리에 둔다.
export function storyPatch(html: string, edited: string): { html: string } | { error: 'format' } | null {
  const view = storyView(html)
  if (view === null) return { error: 'format' }
  const { cells, groups, toks } = view
  const hunks = textDiff(view.text, edited)
  if (hunks.length === 0) return null
  const del = new Map<number, Set<number>>()
  const ins = new Map<number, Map<number, string>>()
  const extra = new Map<number, string>()
  const removed = new Set<number>()
  const putText = (seg: number, off: number, value: string) => {
    const at = ins.get(seg) ?? new Map<number, string>()
    at.set(off, (at.get(off) ?? '') + value)
    ins.set(seg, at)
  }
  for (const hunk of hunks) {
    const covered = cells.slice(hunk.start, hunk.end)
    for (const cell of covered) {
      if ('seg' in cell) {
        const set = del.get(cell.seg) ?? new Set<number>()
        set.add(cell.off)
        del.set(cell.seg, set)
        continue
      }
      const group = groups[cell.group] as Group
      if (!group.isDeletable || group.start < hunk.start || group.end > hunk.end) return { error: 'format' }
      for (let tok = group.first; tok <= group.last; tok++) removed.add(tok)
    }
    if (hunk.text === '') continue
    const firstText = covered.find(cell => 'seg' in cell) as { seg: number; off: number } | undefined
    const left = cells[hunk.start - 1]
    const right = cells[hunk.end]
    const groupOf = (cell: Cell | undefined) => (cell && 'group' in cell ? (groups[cell.group] as Group) : null)
    // 줄 첫머리의 목록 기호 바로 앞에 쓴 글은 html 에서 앞 문단 끝으로 갈 수밖에 없어, 줄로 끝나지 않으면 거절한다.
    const mark = groupOf(right)
    if (mark && mark.before === null && mark.start === hunk.end && (hunk.start === 0 || view.text[hunk.start - 1] === '\n') && !hunk.text.endsWith('\n')) {
      return { error: 'format' }
    }
    if (firstText) putText(firstText.seg, firstText.off, hunk.text)
    else if (left && 'seg' in left) putText(left.seg, left.off + 1, hunk.text)
    else if (right && 'seg' in right) putText(right.seg, right.off, hunk.text)
    else {
      const before = groupOf(left)
      const after = groupOf(right)
      if (before && before.end === hunk.start && before.after !== null) extra.set(before.after, (extra.get(before.after) ?? '') + hunk.text)
      else if (after && after.start === hunk.end && after.before !== null) extra.set(after.before - 1, (extra.get(after.before - 1) ?? '') + hunk.text)
      else if (!left && !right) extra.set(-1, (extra.get(-1) ?? '') + hunk.text)
      else return { error: 'format' }
    }
  }
  const out: string[] = [escapeHtml(extra.get(-1) ?? '')]
  toks.forEach((tok, i) => {
    if (!removed.has(i)) {
      if (tok.kind === 'text' && (del.has(i) || ins.has(i))) {
        const gone = del.get(i)
        const added = ins.get(i)
        let value = ''
        for (let off = 0; off <= tok.text.length; off++) {
          value += escapeHtml(added?.get(off) ?? '')
          if (off < tok.text.length && !gone?.has(off)) value += tok.pieces[off]
        }
        out.push(value)
      } else out.push(tok.raw)
    }
    if (extra.has(i)) out.push(escapeHtml(extra.get(i) as string))
  })
  return { html: `<body>${out.join('')}</body>` }
}

// 담당자나 드롭다운 필드 하나를 바꾼다. v2 는 여러 태스크를 받는 배열, v1 의 custom_fields 는 JSON 글자.
export function updateCall(server: AsanaServer, gid: string, change: { assignee: string } | { field: string; option: string }): AsanaCall {
  const fields = 'field' in change ? { [change.field]: change.option } : null
  if (server.dialect === 'v2') {
    return { tool: ASANA_TOOLS.v2.update, args: { tasks: [{ task: gid, ...(fields ? { custom_fields: fields } : { assignee: (change as { assignee: string }).assignee }) }] } }
  }
  return { tool: ASANA_TOOLS.v1.update, args: { task_id: gid, ...(fields ? { custom_fields: JSON.stringify(fields) } : { assignee: (change as { assignee: string }).assignee }) } }
}

// 나(gid). 프로젝트 멤버에 내가 있는지 견준다. v1 asana_get_user 는 인자가 없으면 나다.
export function meCall(server: AsanaServer): AsanaCall {
  return { tool: ASANA_TOOLS[server.dialect].me, args: {} }
}

// 워크스페이스의 보관하지 않은 프로젝트. 다음 쪽은 앞 결과의 next_page.offset 으로.
export function projectsCall(server: AsanaServer, offset?: string): AsanaCall {
  return {
    tool: ASANA_TOOLS[server.dialect].projects,
    args: { archived: false, limit: 100, opt_fields: 'name,members.gid,modified_at,permalink_url', ...(offset ? { offset } : {}) },
  }
}

// 프로젝트의 열린 태스크와 since 뒤에 완료된 태스크. v2 completed_since 는 ISO 시각만 받는다('now' 를 거절).
export function projectTasksCall(server: AsanaServer, project: string, since: string, keyFields: readonly string[]): AsanaCall {
  return {
    tool: ASANA_TOOLS[server.dialect].tasks,
    args: { project, completed_since: since, limit: pageSize(keyFields), opt_fields: withKey(PROJECT_TASK_FIELDS, keyFields) },
  }
}

export function usersCall(server: AsanaServer, query: string): AsanaCall {
  return { tool: ASANA_TOOLS[server.dialect].users, args: { resource_type: 'user', query, count: 8, opt_fields: 'name,email' } }
}

type Block = { type: string; text?: string }

// MCP 결과: 첫 text 블록의 JSON. 실패(isError)나 JSON 이 아니면 그 글을 오류로.
export function resultData(result: { content: readonly Block[]; isError: boolean }): { ok: true; data: unknown } | { ok: false; error: string } {
  const text = result.content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
    .trim()
  if (result.isError) return { ok: false, error: firstLine(text) || 'error' }
  try {
    return { ok: true, data: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, error: firstLine(text) || 'empty result' }
  }
}

const firstLine = (text: string) => (text.split('\n').find(line => line.trim() !== '') ?? '').trim().slice(0, 200)

type Named = { gid?: string; name?: string | null } | null | undefined
type RawProject = { gid?: string; name?: string; members?: Named[]; modified_at?: string; permalink_url?: string; task_counts?: { num_incomplete_tasks?: number } | null }
type RawMembership = { project?: Named; section?: Named }
type RawTask = {
  gid?: string
  name?: string
  notes?: string
  html_notes?: string
  completed?: boolean
  due_on?: string | null
  permalink_url?: string
  assignee?: Named
  memberships?: RawMembership[]
  custom_type_status_option?: Named
  custom_type?: { status_options?: Array<{ gid?: string; name?: string; enabled?: boolean }> } | null
  custom_fields?: Array<{
    gid?: string
    name?: string
    type?: string
    display_value?: string | null
    is_formula_field?: boolean
    enum_options?: Array<{ gid?: string; name?: string; enabled?: boolean }>
  }>
  comments?: RawStory[]
}
type RawStory = { gid?: string; text?: string; html_text?: string; created_at?: string; created_by?: Named; resource_subtype?: string }

const str = (value: unknown) => (typeof value === 'string' ? value : null)
const dataOf = (json: unknown) => (json as { data?: unknown } | null)?.data

// 필드 이름은 대소문자를 가리지 않는다(설정에 "jkd" 라고 넣어도 JKD 필드).
const isKeyField = (name: unknown, keyFields: readonly string[]) => typeof name === 'string' && keyFields.some(key => key.toLowerCase() === name.toLowerCase())

// 태스크 키: 설정한 키 필드 중 앞의 것부터 값이 있는 것(Asana ID 필드면 "JKD-1630").
function taskKey(fields: RawTask['custom_fields'], keyFields: readonly string[]): string | null {
  for (const name of keyFields) {
    const value = str(fields?.find(field => isKeyField(field?.name, [name]))?.display_value)
    if (value !== null && value.trim() !== '') return value.trim()
  }
  return null
}

// 응답의 태스크들에 붙은 키 필드의 gid. 키로 찾기(keySearchCalls)는 이름이 아니라 gid 로 묻는다.
export function keyFieldGids(json: unknown, keyFields: readonly string[]): string[] {
  const data = dataOf(json)
  if (!Array.isArray(data)) return []
  const fields = (data as RawTask[]).flatMap(raw => raw?.custom_fields ?? [])
  return [...new Set(fields.filter(field => typeof field?.gid === 'string' && isKeyField(field.name, keyFields)).map(field => field.gid as string))]
}

// project 를 주면 그 프로젝트의 자리(섹션)를 쓴다. 아니면 이름이 있는 첫 프로젝트.
export function toTasks(json: unknown, keyFields: readonly string[] = [], project?: string): AsanaTask[] {
  const data = dataOf(json)
  if (!Array.isArray(data)) return []
  return (data as RawTask[])
    .filter(raw => typeof raw?.gid === 'string')
    .map(raw => {
      const place = raw.memberships?.find(item => (project === undefined ? str(item?.project?.name) !== null : item?.project?.gid === project))
      return {
        gid: raw.gid as string,
        name: str(raw.name) ?? '',
        key: taskKey(raw.custom_fields, keyFields),
        dueOn: str(raw.due_on),
        project: str(place?.project?.name),
        section: str(place?.section?.name),
        url: str(raw.permalink_url),
        assignee: str(raw.assignee?.name),
        isDone: raw.completed === true,
        status: str(raw.custom_type_status_option?.name),
      }
    })
}

// 다음 쪽 표시(next_page.offset). 없으면 마지막 쪽.
export function nextOffset(json: unknown): string | null {
  return str((json as { next_page?: { offset?: unknown } | null } | null)?.next_page?.offset)
}

export function myGid(json: unknown): string | null {
  return str((dataOf(json) as { gid?: unknown } | undefined)?.gid)
}

// 최근에 바뀐 것부터(Asana 홈의 "최근"처럼). 열린 태스크 수는 v2 만 준다.
export function toProjects(json: unknown, me: string | null): AsanaProject[] {
  const data = dataOf(json)
  if (!Array.isArray(data)) return []
  return (data as RawProject[])
    .filter(raw => typeof raw?.gid === 'string')
    .map(raw => {
      const members = (raw.members ?? []).filter(member => typeof member?.gid === 'string')
      const open = raw.task_counts?.num_incomplete_tasks
      return {
        gid: raw.gid as string,
        name: str(raw.name) ?? '',
        url: str(raw.permalink_url),
        members: members.length,
        open: typeof open === 'number' ? open : null,
        isMine: me !== null && members.some(member => member?.gid === me),
        modifiedAt: str(raw.modified_at) ?? '',
      }
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}

function toComment(raw: RawStory): AsanaComment | null {
  if (typeof raw?.gid !== 'string' || typeof raw.text !== 'string') return null
  if (raw.resource_subtype !== undefined && raw.resource_subtype !== 'comment_added') return null
  return {
    gid: raw.gid,
    author: str(raw.created_by?.name) ?? '?',
    authorGid: str(raw.created_by?.gid),
    at: str(raw.created_at) ?? '',
    text: raw.text,
    richText: typeof raw.html_text === 'string' ? notesMarkdown(raw.html_text) : null,
  }
}

// 상세: 댓글은 활동 목록(stories)에서 고른다. stories 를 못 읽으면 v2 get_task 에 든 평문 댓글을 쓴다.
export function toDetail(json: unknown, stories?: unknown, keyFields: readonly string[] = []): AsanaDetail | null {
  const raw = dataOf(json) as RawTask | undefined
  if (!raw || typeof raw.gid !== 'string') return null
  const storyList = Array.isArray(dataOf(stories)) ? dataOf(stories) : raw.comments
  // v2 stories 는 최근 것부터 온다. 오래된 것부터 읽히게.
  const comments = (Array.isArray(storyList) ? (storyList as RawStory[]) : [])
    .map(toComment)
    .filter((item): item is AsanaComment => item !== null)
    .sort((a, b) => a.at.localeCompare(b.at))
  const fields: AsanaField[] = (raw.custom_fields ?? [])
    .filter(field => typeof field?.gid === 'string' && typeof field.name === 'string')
    .map(field => {
      const options = (field.enum_options ?? []).filter(option => typeof option?.gid === 'string' && option.enabled !== false)
      const isPickable = field.type === 'enum' && field.is_formula_field !== true && options.length > 0
      return {
        gid: field.gid as string,
        name: field.name as string,
        value: str(field.display_value),
        options: isPickable ? options.map(option => ({ gid: option.gid as string, name: str(option.name) ?? '' })) : null,
      }
    })
  return {
    gid: raw.gid,
    name: str(raw.name) ?? '',
    key: taskKey(raw.custom_fields, keyFields),
    notes: str(raw.notes) ?? '',
    richNotes: typeof raw.html_notes === 'string' ? notesMarkdown(raw.html_notes) : null,
    assignee: typeof raw.assignee?.gid === 'string' ? { gid: raw.assignee.gid, name: str(raw.assignee.name) ?? '?' } : null,
    dueOn: str(raw.due_on),
    completed: raw.completed === true,
    status: str(raw.custom_type_status_option?.name),
    statuses: (raw.custom_type?.status_options ?? [])
      .filter(option => typeof option?.gid === 'string' && option.enabled !== false)
      .map(option => ({ gid: option.gid as string, name: str(option.name) ?? '' })),
    places: (raw.memberships ?? [])
      .map(item => [str(item?.project?.name), str(item?.section?.name)].filter(Boolean).join(' › '))
      .filter(place => place !== ''),
    url: str(raw.permalink_url),
    fields,
    comments: comments.slice(-COMMENT_LIMIT),
  }
}

export function toUsers(json: unknown): AsanaUser[] {
  const data = dataOf(json)
  if (!Array.isArray(data)) return []
  return (data as Array<{ gid?: string; name?: string; email?: string }>)
    .filter(user => typeof user?.gid === 'string' && typeof user.name === 'string')
    .map(user => ({ gid: user.gid as string, name: user.name as string, email: str(user.email) }))
}

// 바꾸기 결과의 실패: v2 update_tasks 는 성공(data)·실패(failed) 목록을 따로 돌려준다(모르는 키는 조용히 버리고 0건).
export function updateProblem(server: AsanaServer, json: unknown): string | null {
  if (server.dialect === 'v1') return null
  const result = json as { data?: unknown[]; failed?: Array<{ errors?: unknown[] }>; summary?: string } | null
  const failed = result?.failed ?? []
  if (failed.length > 0) return firstLine(JSON.stringify(failed[0]?.errors ?? failed[0]))
  if (!Array.isArray(result?.data) || result.data.length === 0) return result?.summary ?? 'not updated'
  return null
}

// 프로젝트(프로젝트 탭에서는 섹션)별로 묶는다(처음 나온 차례). 이름이 없는 것은 맨 끝 한 묶음.
export function groupTasks(tasks: readonly AsanaTask[], by: 'project' | 'section' = 'project'): Array<{ name: string | null; tasks: AsanaTask[] }> {
  const groups = new Map<string | null, AsanaTask[]>()
  for (const task of tasks) groups.set(task[by], [...(groups.get(task[by]) ?? []), task])
  const named = [...groups].filter(([name]) => name !== null)
  const loose = groups.get(null)
  return [...named, ...(loose ? [[null, loose] as const] : [])].map(([name, list]) => ({ name, tasks: list }))
}

// 마감일 칩: 지난 것은 빨강, 오늘은 노랑, 나머지는 흐리게 "10/20"(올해가 아니면 연도까지).
export function dueChip(dueOn: string | null, today: string): { text: string; level: 'danger' | 'warning' | 'muted' } | null {
  if (!dueOn || !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return null
  if (dueOn === today) return { text: T.asanaToday, level: 'warning' }
  const [year, month, day] = dueOn.split('-')
  const text = year === today.slice(0, 4) ? `${Number(month)}/${Number(day)}` : `${year}/${Number(month)}/${Number(day)}`
  return { text, level: dueOn < today ? 'danger' : 'muted' }
}

// 로컬 날짜(YYYY-MM-DD). Asana 의 due_on 은 날짜만이라 사람 시간대의 오늘과 견준다.
export function localDay(now: number): string {
  const at = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

// "Claude에게 맡기기": 태스크 제목·링크·상태·설명과 최근 댓글 몇 개를 입력창에 채운다.
export function asanaPrompt(task: AsanaDetail): string {
  const quote = (text: string, limit: number) =>
    text
      .trim()
      .slice(0, limit)
      .split('\n')
      .map(line => `> ${line}`)
      .join('\n')
  const head = [T.asanaPromptHead(task.name, task.key ?? null), task.url, [task.status, ...task.places].filter(Boolean).join(' · ')].filter(Boolean).join('\n')
  const notes = task.notes.trim() === '' ? '' : `\n\n${quote(task.notes, 3000)}`
  const recent = task.comments.slice(-5)
  const comments = recent.length === 0 ? '' : `\n\n${T.asanaPromptComments}\n${recent.map(c => `- ${c.author}: ${c.text.trim().slice(0, 600).replaceAll('\n', ' ')}`).join('\n')}`
  return `${head}${notes}${comments}`
}
