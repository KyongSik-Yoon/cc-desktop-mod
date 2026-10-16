import type { AsanaComment, AsanaDetail, AsanaField, AsanaServer, AsanaTask, AsanaUser } from '../types'
import { T } from './i18n'

// /desk-asana: 내게 할당된 Asana 태스크. 엔진에 이미 붙은 Asana MCP 서버를 그대로 쓴다($.mcp.call, 엔진의 연결·인증).
// 서버 이름은 사람마다 달라 도구 목록에서 찾는다: Asana 공식 v2 서버(get_my_tasks)를 먼저, 없으면 claude.ai 커넥터(asana_*).
// 검색(v2 search_tasks, v1 asana_search_tasks)은 Premium 워크스페이스에서만 된다. v1 은 내 태스크 목록도 이 검색이다.
// 사용자 지정 작업 유형의 상태(Open·In Progress…)는 두 서버 모두 바꾸는 도구가 없어(v2 update_tasks 는 키를 버린다) 보여 주기만 한다.

export const ASANA_TOOLS = {
  v2: { list: 'get_my_tasks', search: 'search_tasks', task: 'get_task', comment: 'add_comment', update: 'update_tasks', users: 'search_objects' },
  v1: {
    list: 'asana_search_tasks',
    search: 'asana_search_tasks',
    task: 'asana_get_task',
    stories: 'asana_get_stories_for_task',
    comment: 'asana_create_task_story',
    update: 'asana_update_task',
    users: 'asana_typeahead_search',
  },
} as const

// 상세에 보이는 댓글 수. v2 get_task 는 최근 것부터 이만큼, v1 은 활동 100개에서 댓글만 골라 끝에서 이만큼.
export const COMMENT_LIMIT = 30
const LIST_FIELDS = 'name,due_on,memberships.project.name,memberships.section.name,permalink_url'
// 검색 결과는 남의 태스크도 섞이니 담당자 이름까지.
const SEARCH_FIELDS = `${LIST_FIELDS},assignee.name`
const TASK_FIELDS = [
  'name,notes,completed,due_on,permalink_url,assignee.name',
  'memberships.project.name,memberships.section.name',
  'custom_type_status_option.name',
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

// tool.check 가 허용하는 것: 패널이 쓰는 이름의 MCP 도구만. 누가 불렀는지(desk-look 자신)는 훅이 origin 으로 가른다.
const PANE_TOOLS = new Set<string>([...Object.values(ASANA_TOOLS.v2), ...Object.values(ASANA_TOOLS.v1)])
export function isPaneTool(tool: string): boolean {
  const match = /^mcp__.+__([^_].*)$/.exec(tool)
  return match !== null && PANE_TOOLS.has(match[1] as string)
}

export type AsanaCall = { tool: string; args: Record<string, unknown> }

export function listCall(server: AsanaServer): AsanaCall {
  return server.dialect === 'v2'
    ? { tool: ASANA_TOOLS.v2.list, args: { completed_since: 'now', limit: 100, opt_fields: LIST_FIELDS } }
    : { tool: ASANA_TOOLS.v1.list, args: { assignee_any: 'me', completed: false, limit: 100, sort_by: 'modified_at', opt_fields: LIST_FIELDS } }
}

// 워크스페이스 전체에서 글자로 찾는다(이름·설명·댓글). 열린 태스크만, 최근에 바뀐 것부터.
export function searchCall(server: AsanaServer, text: string): AsanaCall {
  return { tool: ASANA_TOOLS[server.dialect].search, args: { text, completed: false, limit: 50, sort_by: 'modified_at', opt_fields: SEARCH_FIELDS } }
}

export function taskCall(server: AsanaServer, gid: string): AsanaCall {
  return server.dialect === 'v2'
    ? { tool: ASANA_TOOLS.v2.task, args: { task_id: gid, comment_limit: COMMENT_LIMIT, include_subtasks: false, opt_fields: TASK_FIELDS } }
    : { tool: ASANA_TOOLS.v1.task, args: { task_id: gid, opt_fields: TASK_FIELDS } }
}

// v1 만: 댓글은 활동(story)에서 따로 읽는다. 정렬을 고를 수 없어 오래된 것부터 100개다.
export function storiesCall(gid: string): AsanaCall {
  return { tool: ASANA_TOOLS.v1.stories, args: { task_id: gid, limit: 100, opt_fields: 'text,created_at,created_by.name,resource_subtype' } }
}

export function commentCall(server: AsanaServer, gid: string, text: string): AsanaCall {
  return { tool: ASANA_TOOLS[server.dialect].comment, args: { task_id: gid, text } }
}

// 담당자나 드롭다운 필드 하나를 바꾼다. v2 는 여러 태스크를 받는 배열, v1 의 custom_fields 는 JSON 글자.
export function updateCall(server: AsanaServer, gid: string, change: { assignee: string } | { field: string; option: string }): AsanaCall {
  const fields = 'field' in change ? { [change.field]: change.option } : null
  if (server.dialect === 'v2') {
    return { tool: ASANA_TOOLS.v2.update, args: { tasks: [{ task: gid, ...(fields ? { custom_fields: fields } : { assignee: (change as { assignee: string }).assignee }) }] } }
  }
  return { tool: ASANA_TOOLS.v1.update, args: { task_id: gid, ...(fields ? { custom_fields: JSON.stringify(fields) } : { assignee: (change as { assignee: string }).assignee }) } }
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
type RawMembership = { project?: Named; section?: Named }
type RawTask = {
  gid?: string
  name?: string
  notes?: string
  completed?: boolean
  due_on?: string | null
  permalink_url?: string
  assignee?: Named
  memberships?: RawMembership[]
  custom_type_status_option?: Named
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
type RawStory = { gid?: string; text?: string; created_at?: string; created_by?: Named; resource_subtype?: string }

const str = (value: unknown) => (typeof value === 'string' ? value : null)
const dataOf = (json: unknown) => (json as { data?: unknown } | null)?.data

export function toTasks(json: unknown): AsanaTask[] {
  const data = dataOf(json)
  if (!Array.isArray(data)) return []
  return (data as RawTask[])
    .filter(raw => typeof raw?.gid === 'string')
    .map(raw => {
      const place = raw.memberships?.find(item => str(item?.project?.name) !== null)
      return {
        gid: raw.gid as string,
        name: str(raw.name) ?? '',
        dueOn: str(raw.due_on),
        project: str(place?.project?.name),
        section: str(place?.section?.name),
        url: str(raw.permalink_url),
        assignee: str(raw.assignee?.name),
      }
    })
}

function toComment(raw: RawStory): AsanaComment | null {
  if (typeof raw?.gid !== 'string' || typeof raw.text !== 'string') return null
  if (raw.resource_subtype !== undefined && raw.resource_subtype !== 'comment_added') return null
  return { gid: raw.gid, author: str(raw.created_by?.name) ?? '?', at: str(raw.created_at) ?? '', text: raw.text }
}

// 상세: v2 는 get_task 에 댓글이 들어 있고, v1 은 활동 목록(stories)을 따로 받아 댓글만 고른다.
export function toDetail(json: unknown, stories?: unknown): AsanaDetail | null {
  const raw = dataOf(json) as RawTask | undefined
  if (!raw || typeof raw.gid !== 'string') return null
  const storyList = stories === undefined ? raw.comments : dataOf(stories)
  const comments = (Array.isArray(storyList) ? (storyList as RawStory[]) : []).map(toComment).filter((item): item is AsanaComment => item !== null)
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
    notes: str(raw.notes) ?? '',
    assignee: typeof raw.assignee?.gid === 'string' ? { gid: raw.assignee.gid, name: str(raw.assignee.name) ?? '?' } : null,
    dueOn: str(raw.due_on),
    completed: raw.completed === true,
    status: str(raw.custom_type_status_option?.name),
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

// 프로젝트별로 묶는다(처음 나온 차례). 프로젝트가 없는 태스크는 맨 끝 한 묶음.
export function groupTasks(tasks: readonly AsanaTask[]): Array<{ project: string | null; tasks: AsanaTask[] }> {
  const groups = new Map<string | null, AsanaTask[]>()
  for (const task of tasks) groups.set(task.project, [...(groups.get(task.project) ?? []), task])
  const named = [...groups].filter(([project]) => project !== null)
  const loose = groups.get(null)
  return [...named, ...(loose ? [[null, loose] as const] : [])].map(([project, list]) => ({ project, tasks: list }))
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
  const head = [T.asanaPromptHead(task.name), task.url, [task.status, ...task.places].filter(Boolean).join(' · ')].filter(Boolean).join('\n')
  const notes = task.notes.trim() === '' ? '' : `\n\n${quote(task.notes, 3000)}`
  const recent = task.comments.slice(-5)
  const comments = recent.length === 0 ? '' : `\n\n${T.asanaPromptComments}\n${recent.map(c => `- ${c.author}: ${c.text.trim().slice(0, 600).replaceAll('\n', ' ')}`).join('\n')}`
  return `${head}${notes}${comments}`
}
