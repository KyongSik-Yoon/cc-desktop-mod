import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AsanaDetail, AsanaEdit, AsanaProject, AsanaProjects, AsanaProjectView, AsanaSearch, AsanaServer, AsanaState, AsanaTab, AsanaTask, AsanaUser, AsanaView, FoldedPane } from '../types'
import {
  ASANA_API,
  asanaPrompt,
  keyFieldGids,
  keyFieldNames,
  keySearchCalls,
  commentCall,
  dueChip,
  findAsanaServer,
  groupTasks,
  listCalls,
  DONE_DAYS,
  doneSince,
  localDay,
  meCall,
  myGid,
  nextOffset,
  paneTools,
  projectsCall,
  projectTasksCall,
  resultData,
  searchCall,
  storiesCall,
  storyPatch,
  taskCall,
  toDetail,
  toProjects,
  toStory,
  toTasks,
  toUsers,
  updateCall,
  updateProblem,
  usersCall,
} from './asana'
import type { AsanaCall } from './asana'
import { T, langFromConfig, langSetting, setLang } from './i18n'
import { renderMarkdown } from './shared/markdown'
import { COLORS, ago, clip, fillPrompt, rowButton } from './util'

const ASANA_PANE = 'desk-asana'
// 댓글 입력칸이 자랄 수 있는 줄 수(desk-look 의 diff 줄 댓글 칸과 같다).
const COMMENT_ROWS = 3

// 내 태스크 목록, 펼친 태스크 하나(null 이면 목록), 담당자 바꾸기에서 찾은 사람들.
// 쓰던 댓글·찾는 이름은 변수에 둔다(atom 이면 글자마다 패널 전체를 다시 그린다).
const asana = atom({ plugin: 'desk-asana', key: 'asana' } as const, null as AsanaState | null)
const asanaView = atom({ plugin: 'desk-asana', key: 'asanaView' } as const, null as AsanaView | null)
const asanaUsers = atom({ plugin: 'desk-asana', key: 'asanaUsers' } as const, null as { query: string; status: 'loading' | 'ok' | 'failed'; users: AsanaUser[] } | null)
// 목록 위 검색창: 찾은 결과(null 이면 내 태스크).
const asanaSearch = atom({ plugin: 'desk-asana', key: 'asanaSearch' } as const, null as AsanaSearch | null)
// 탭(내 태스크·프로젝트), 프로젝트 목록, 펼친 프로젝트(null 이면 프로젝트 목록). 태스크 상세는 두 탭이 함께 쓴다(asanaView).
const asanaTab = atom({ plugin: 'desk-asana', key: 'asanaTab' } as const, 'mine' as AsanaTab)
const asanaProjects = atom({ plugin: 'desk-asana', key: 'asanaProjects' } as const, null as AsanaProjects | null)
const asanaProject = atom({ plugin: 'desk-asana', key: 'asanaProject' } as const, null as AsanaProjectView | null)
// 댓글 고치기에서 고치는 중인 것.
const asanaEdit = atom({ plugin: 'desk-asana', key: 'asanaEdit' } as const, null as AsanaEdit | null)
// 펼친 묶음·담당자 확인처럼 켜고 끄는 것.
const open = atom({ plugin: 'desk-asana', key: 'open' } as const, {} as Record<string, boolean>)
// desk-look 이 읽는 값: 이 세션에 떠 있음(옮김 안내), /desk-fold 로 접어 둔 패널.
const ready = atom({ plugin: 'desk-asana', key: 'ready' } as const, false)
const folded = atom({ plugin: 'desk-asana', key: 'folded' } as const, null as FoldedPane[] | null)
// 이 플러그인의 패널이 지금 열려 있는지(ui.open·ui.close 훅이 맞춘다). desk-look 의 /desk-fold 가 접을지 펼지 고른다.
const shown = atom({ plugin: 'desk-asana', key: 'shown' } as const, false)
let asanaDraft = ''
let asanaQuery = ''
// 댓글 칸의 키 차례: 보낸 뒤나 멘션을 끼운 뒤 새 value 로 다시 그린다. 끼운 사람은 보낼 때 "@이름" 이 남은 것만 멘션.
let asanaWriteRound = 0
let asanaMentions: AsanaUser[] = []
// 댓글 고치기: 사람이 넣은 Asana 개인 토큰(userConfig asanaToken, 없으면 ''), 패널에서 고치는 중인 글,
// 내 gid(MCP 로 읽어 ✎ 를 내 댓글에만 붙인다)와 토큰 주인 gid(고치기 전에 원문 작성자와 견준다).
let asanaToken = ''
// 태스크 키: 설정 asanaKeyField 의 필드 이름들(없으면 []), 목록에서 본 그 필드들의 gid(키로 찾기에 쓴다).
let asanaKeyFields: string[] = []
const asanaKeyGids = new Set<string>()
let asanaEditDraft = ''
// 고치는 칸의 키 차례: 칸은 Enter 뒤에 비므로, 거절·실패하면 고치던 글을 새 키로 다시 그린다.
let asanaEditRound = 0
let asanaMe: string | null = null
let asanaTokenMe: string | null = null
let asanaFindText = ''
let asanaFindRound = 0

// 처음 상태가 펼침인 행도 있어서, 지금 보이는 상태를 받아 뒤집는다.
const toggle = ($: EngineInterface, id: string, shown?: boolean) =>
  update($, open, state => ({ ...state, [id]: !(state[id] ?? shown ?? false) }))

// /desk-asana 의 Asana 호출(asana.ts 참고). MCP 서버는 세션이 시작된 뒤에 붙으므로 열 때마다 도구 목록에서 찾는다.
// 엔진이 거절하면(서버가 끊김, 권한) 던지는 대신 오류 글로 돌려준다.
async function callAsana($: EngineInterface, server: AsanaServer, call: AsanaCall) {
  try {
    return resultData(await $.mcp.call(server.name, call.tool, call.args))
  } catch (error) {
    return { ok: false as const, error: (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '' }
  }
}

// MCP 결과 크기 한도(엔진 MAX_MCP_OUTPUT_TOKENS, 플러그인은 못 바꾼다)에 걸린 실패. 응답 크기는 태스크 수보다
// 프로젝트의 사용자 정의 필드 수를 따라 미리 알 수 없어, 걸리면 쪽을 반으로 줄여 다시 읽는다.
const isTooLarge = (error: string) => error.includes('exceeds maximum allowed tokens')
// 도구(프로젝트 태스크는 프로젝트)마다 줄여 둔 쪽 크기. 세션 동안 기억해 같은 실패와 엔진이 남기는 결과 파일을 되풀이하지 않는다.
const asanaPageLimits = new Map<string, number>()
const MIN_PAGE = 10
const MAX_PAGE_CALLS = 12

type AsanaPages = { ok: true; data: { data: unknown[] }; isPartial: boolean } | { ok: false; error: string }

// 쪽을 이어 읽는다: max 개가 차거나 다음 쪽이 없을 때까지(호출은 MAX_PAGE_CALLS 번까지). 한도에 걸리면 같은 쪽을 반 크기로
// 다시 읽는다. 검색은 다음 쪽이 없어 줄인 만큼 적게 보인다. onPage 는 쪽마다 지금까지 읽은 것으로.
async function readPages($: EngineInterface, server: AsanaServer, call: AsanaCall, max: number, onPage?: (data: { data: unknown[] }, isLast: boolean, isPartial: boolean) => Promise<unknown>): Promise<AsanaPages> {
  const key = `${call.tool}:${String(call.args.project ?? '')}`
  let limit = Math.min(Number(call.args.limit), asanaPageLimits.get(key) ?? Infinity)
  const items: unknown[] = []
  let offset: string | null = null
  for (let calls = 0; calls < MAX_PAGE_CALLS; calls++) {
    const got = await callAsana($, server, { tool: call.tool, args: { ...call.args, limit, ...(offset === null ? {} : { offset }) } })
    if (!got.ok && isTooLarge(got.error) && limit > MIN_PAGE) {
      limit = Math.max(MIN_PAGE, Math.floor(limit / 2))
      asanaPageLimits.set(key, limit)
      continue
    }
    if (!got.ok) return got
    items.push(...((got.data as { data?: unknown[] } | null)?.data ?? []))
    offset = nextOffset(got.data)
    const isLast = offset === null || items.length >= max || calls === MAX_PAGE_CALLS - 1
    const data = { data: [...items] }
    await onPage?.(data, isLast, offset !== null)
    if (isLast) return { ok: true, data, isPartial: offset !== null }
  }
  return { ok: false, error: 'too many pages' }
}

async function findAsana($: EngineInterface): Promise<AsanaServer | null> {
  const tools = await $.tool.list().catch(() => [])
  return findAsanaServer(tools.filter(tool => tool.mcp).map(tool => tool.name))
}

// 패널 도구 중 allow 규칙이 없는 것. $.tool.check 는 규칙만 묻는다(창도 분류기도 없다).
async function findUnruled($: EngineInterface, server: AsanaServer) {
  const tools = paneTools(server)
  const verdicts = await Promise.all(tools.map(tool => $.tool.check({ tool, input: {} }).catch(() => null)))
  return tools.filter((_, index) => verdicts[index]?.decision !== 'allow')
}

let asanaFetch: Promise<void> | null = null

// 목록을 다시 읽는다. 읽는 동안은 전에 읽은 목록을 그대로 보인다(↻ 가 … 로).
async function refreshAsana($: EngineInterface) {
  if (asanaFetch) return asanaFetch
  asanaFetch = (async () => {
    await update($, asana, (state): AsanaState => ({ status: 'loading', server: state?.server ?? null, tasks: state?.tasks ?? [], unruled: state?.unruled ?? [] }))
    const server = await findAsana($)
    if (server === null) {
      await update($, asana, (): AsanaState => ({ status: 'none', server: null, tasks: [], unruled: [] }))
      return
    }
    const since = doneSince(await $.clock.now())
    const [unruled, ...gots] = await Promise.all([findUnruled($, server), ...listCalls(server, since, asanaKeyFields).map(call => readPages($, server, call, LIST_MAX))])
    const failed = gots.find(got => !got.ok)
    for (const got of gots) if (got.ok) keyFieldGids(got.data, asanaKeyFields).forEach(gid => asanaKeyGids.add(gid))
    await update($, asana, (): AsanaState =>
      failed && !failed.ok
        ? { status: 'failed', server, tasks: [], unruled, error: failed.error }
        : { status: 'ok', server, tasks: gots.flatMap(got => (got.ok ? toTasks(got.data, asanaKeyFields) : [])), unruled },
    )
  })().finally(() => {
    asanaFetch = null
  })
  return asanaFetch
}

async function openAsana($: EngineInterface) {
  const shown = refreshAsana($).catch(() => undefined)
  await $.ui.open({ id: ASANA_PANE, title: 'Asana', focus: true })
  await shown
}

// 읽는 한도: 프로젝트는 500개(쪽마다 MCP 호출 한 번), 한 프로젝트의 태스크와 내 태스크는 개수로(readPages).
const PROJECT_PAGES = 5
const PROJECT_TASK_MAX = 300
const LIST_MAX = 100

async function switchAsanaTab($: EngineInterface, tab: AsanaTab) {
  await update($, asanaTab, () => tab)
  const projects = await read($, asanaProjects)
  if (tab === 'projects' && (projects === null || projects.status === 'failed')) await refreshAsanaProjects($)
}

let asanaProjectsFetch: Promise<void> | null = null

// 나와 프로젝트 목록을 함께 읽는다. 서버는 내 태스크를 읽을 때 찾아 둔 것.
async function refreshAsanaProjects($: EngineInterface) {
  if (asanaProjectsFetch) return asanaProjectsFetch
  asanaProjectsFetch = (async () => {
    const server = (await read($, asana))?.server ?? null
    if (server === null) return
    await update($, asanaProjects, (state): AsanaProjects => ({ status: 'loading', projects: state?.projects ?? [] }))
    const [me, first] = await Promise.all([callAsana($, server, meCall(server)), callAsana($, server, projectsCall(server))])
    const pages = [first]
    let offset = first.ok ? nextOffset(first.data) : null
    while (offset !== null && pages.length < PROJECT_PAGES) {
      const got = await callAsana($, server, projectsCall(server, offset))
      pages.push(got)
      offset = got.ok ? nextOffset(got.data) : null
    }
    const failed = [me, ...pages].find(got => !got.ok)
    const gid = me.ok ? myGid(me.data) : null
    await update($, asanaProjects, (): AsanaProjects =>
      failed && !failed.ok
        ? { status: 'failed', projects: [], error: failed.error }
        : { status: 'ok', projects: toProjects({ data: pages.flatMap(got => (got.ok ? ((got.data as { data?: unknown[] }).data ?? []) : [])) }, gid) },
    )
  })().finally(() => {
    asanaProjectsFetch = null
  })
  return asanaProjectsFetch
}

// 프로젝트 하나를 펼친다: 열린 태스크를 쪽마다 더해 그린다. 다른 프로젝트로 옮겼으면 늦게 온 쪽은 버린다.
async function openAsanaProject($: EngineInterface, project: AsanaProject) {
  const server = (await read($, asana))?.server ?? null
  if (server === null) return
  await update($, asanaProject, (view): AsanaProjectView => ({ project, status: 'loading', tasks: view?.project.gid === project.gid ? view.tasks : [], isPartial: false }))
  const since = doneSince(await $.clock.now())
  const got = await readPages($, server, projectTasksCall(server, project.gid, since, asanaKeyFields), PROJECT_TASK_MAX, (data, isLast, isPartial) => {
    keyFieldGids(data, asanaKeyFields).forEach(gid => asanaKeyGids.add(gid))
    const tasks = toTasks(data, asanaKeyFields, project.gid)
    return update($, asanaProject, (view): AsanaProjectView | null =>
      view?.project.gid !== project.gid ? view : { project, status: isLast ? 'ok' : 'loading', tasks, isPartial: isLast && isPartial },
    )
  })
  if (!got.ok) await update($, asanaProject, (view): AsanaProjectView | null => (view?.project.gid !== project.gid ? view : { ...view, status: 'failed', error: got.error }))
}

async function closeAsanaProject($: EngineInterface) {
  await update($, asanaProject, () => null)
}

// 태스크 하나를 펼친다(같은 태스크를 다시 읽는 동안은 전 내용을 그대로 보인다).
async function openAsanaTask($: EngineInterface, server: AsanaServer, gid: string) {
  await update($, asanaView, (view): AsanaView => ({ gid, status: 'loading', task: view?.gid === gid ? view.task : null }))
  // 댓글 서식은 stories 에만 있다. v2 는 allow 규칙이 없으면 부르지 않고(기본 모드는 열 때마다 창) get_task 의 평문 댓글을 쓴다.
  // v1 은 댓글이 stories 에만 있어 늘 부른다.
  const storyCall = storiesCall(server, gid)
  const canStory = server.dialect === 'v1' || !(await read($, asana))?.unruled.includes(`mcp__${server.name}__${storyCall.tool}`)
  const [got, stories, me] = await Promise.all([
    callAsana($, server, taskCall(server, gid)),
    canStory ? callAsana($, server, storyCall) : null,
    asanaMe === null ? callAsana($, server, meCall(server)) : null,
  ])
  if (me?.ok) asanaMe = myGid(me.data)
  const task = got.ok ? toDetail(got.data, stories?.ok ? stories.data : undefined, asanaKeyFields) : null
  const error = got.ok ? (task ? undefined : 'unexpected result') : got.error
  await update($, asanaView, (view): AsanaView | null => (view?.gid !== gid ? view : task ? { gid, status: 'ok', task } : { gid, status: 'failed', task: null, error }))
}

async function closeAsanaTask($: EngineInterface) {
  asanaDraft = ''
  asanaQuery = ''
  asanaMentions = []
  await update($, asanaUsers, () => null)
  await update($, asanaEdit, () => null)
  await update($, open, state => ({ ...state, 'asana:assign': false, 'asana:mention': false, 'asana:status': false }))
  await update($, asanaView, () => null)
}

// 빈 글자로 찾으면 검색을 끝내고 내 태스크로 돌아간다. 늦게 온 옛 검색 결과는 버린다.
async function searchAsana($: EngineInterface, server: AsanaServer, value: string) {
  const query = value.trim()
  if (query === '') return clearAsanaSearch($)
  asanaFindText = value
  await update($, asanaSearch, (): AsanaSearch => ({ query, status: 'loading', tasks: [] }))
  // 키로 찾은 것을 앞에. 키로 찾기가 실패해도 글자 검색 결과는 보인다.
  const [got, byKey] = await Promise.all([
    readPages($, server, searchCall(server, query, asanaKeyFields), 50),
    Promise.all(keySearchCalls(server, query, asanaKeyFields, [...asanaKeyGids]).map(call => readPages($, server, call, 10))),
  ])
  // 내 목록에 키 필드가 없던 사람도 검색에 걸린 태스크에서 gid 를 배워 다음 키 검색부터 찾는다.
  if (got.ok) keyFieldGids(got.data, asanaKeyFields).forEach(gid => asanaKeyGids.add(gid))
  const keyed = byKey.flatMap(found => (found.ok ? toTasks(found.data, asanaKeyFields) : []))
  const texted = got.ok ? toTasks(got.data, asanaKeyFields) : []
  const tasks = [...keyed, ...texted].filter((task, index, all) => all.findIndex(other => other.gid === task.gid) === index)
  await update($, asanaSearch, (search): AsanaSearch | null =>
    search?.query !== query ? search : got.ok || keyed.length > 0 ? { query, status: 'ok', tasks } : { query, status: 'failed', tasks: [], error: got.ok ? '' : got.error },
  )
}

async function clearAsanaSearch($: EngineInterface) {
  asanaFindText = ''
  asanaFindRound++
  await update($, asanaSearch, () => null)
}

async function postAsanaComment($: EngineInterface, server: AsanaServer, gid: string, value: string) {
  const text = value.trim()
  if (text === '') return
  const got = await callAsana($, server, commentCall(server, gid, text, asanaMentions))
  if (!got.ok) {
    // 칸은 Enter 뒤에 비므로 쓰던 글을 새 키로 다시 그린다.
    $.ui.toast(T.asanaCommentFailed(got.error))
    asanaDraft = value
    asanaWriteRound++
    await update($, asanaView, view => (view ? { ...view } : view))
    await $.ui.focus({ requestId: ASANA_PANE, key: `asana-write-${gid}-${asanaWriteRound}` }).catch(() => undefined)
    return
  }
  asanaDraft = ''
  asanaMentions = []
  asanaWriteRound++
  $.ui.toast(T.asanaCommented)
  await openAsanaTask($, server, gid)
}

// 지우기: 쓴 글과 끼운 멘션을 비운 칸을 새로 그려 그리로 돌아간다.
async function clearAsanaDraft($: EngineInterface, gid: string) {
  asanaDraft = ''
  asanaMentions = []
  asanaWriteRound++
  await update($, asanaView, view => (view ? { ...view } : view))
  await $.ui.open({ id: ASANA_PANE, title: 'Asana', focus: true })
  await $.ui.focus({ requestId: ASANA_PANE, key: `asana-write-${gid}-${asanaWriteRound}` }).catch(() => undefined)
}

// Asana REST(댓글 고치기·상태 바꾸기만). 토큰은 헤더로만 보내고 오류 글에도 싣지 않는다. 엔진이 거절해도 오류 글로.
async function asanaRest($: EngineInterface, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const headers = { Authorization: `Bearer ${asanaToken}`, Accept: 'application/json', ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }) }
  const request = { method: init.method ?? 'GET', headers, ...(init.body === undefined ? {} : { body: JSON.stringify({ data: init.body }) }) }
  try {
    const res = await $.http.fetch(`${ASANA_API}${path}`, request)
    if (res.status === 401) return { ok: false, error: T.asanaTokenRejected }
    const json = JSON.parse(res.text || 'null') as { errors?: Array<{ message?: string }> } | null
    if (!res.ok) return { ok: false, error: json?.errors?.[0]?.message ?? `HTTP ${res.status}` }
    return { ok: true, data: json }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// ✎ 를 누르면: 토큰이 없으면 넣는 법을 펼치고, 있으면 REST 로 원문(html_text)과 토큰 주인을 읽어 고치는 칸을 연다.
// 다시 누르거나 취소하면 닫는다. 토큰 주인이 쓴 댓글이 아니면 열지 않는다(Asana 는 남의 댓글도 is_editable 로 줄 때가 있다).
async function startAsanaEdit($: EngineInterface, comment: string) {
  const shown = await read($, asanaEdit)
  if (shown?.comment === comment) return update($, asanaEdit, () => null)
  if (asanaToken === '') return update($, asanaEdit, (): AsanaEdit => ({ comment, status: 'notoken', story: null }))
  await update($, asanaEdit, (): AsanaEdit => ({ comment, status: 'loading', story: null }))
  const [got, me] = await Promise.all([
    asanaRest($, `/stories/${comment}?opt_fields=html_text,created_by.gid`),
    asanaTokenMe === null ? asanaRest($, '/users/me?opt_fields=gid') : null,
  ])
  if (me?.ok) asanaTokenMe = myGid(me.data)
  const story = got.ok ? toStory(got.data) : null
  const problem =
    !got.ok ? got.error : me && !me.ok ? me.error : story === null ? 'empty result' : story.author !== asanaTokenMe ? T.asanaEditNotMine : story.draft === null ? T.asanaEditFormatted : null
  if (problem !== null || story === null || story.draft === null) {
    $.ui.toast(T.asanaEditFailed(problem ?? ''))
    return update($, asanaEdit, () => null)
  }
  asanaEditDraft = story.draft
  asanaEditRound = 0
  await update($, asanaEdit, (state): AsanaEdit | null => (state?.comment !== comment ? state : { comment, status: 'ready', story: { text: story.draft as string, html: story.html } }))
  await $.ui.open({ id: ASANA_PANE, title: 'Asana', focus: true })
  await $.ui.focus({ requestId: ASANA_PANE, key: `asana-editing-${comment}-${asanaEditRound}` }).catch(() => undefined)
}

async function saveAsanaEdit($: EngineInterface, server: AsanaServer, task: string, value: string) {
  const state = await read($, asanaEdit)
  if (state?.status !== 'ready' || state.story === null || value.trim() === '') return
  // 바뀐 글자만 원문 html_text 에 끼운다. 목록 기호·이미지·멘션 글자를 건드렸으면 고치던 글을 두고 알린다.
  const patch = storyPatch(state.story.html, value)
  if (patch === null) return update($, asanaEdit, () => null)
  if ('error' in patch) {
    $.ui.toast(T.asanaEditFailed(T.asanaEditFormatted))
    return keepAsanaEdit($, state.comment, value)
  }
  await update($, asanaEdit, (shown): AsanaEdit | null => (shown?.comment !== state.comment ? shown : { ...shown, status: 'saving' }))
  const got = await asanaRest($, `/stories/${state.comment}?opt_fields=text`, { method: 'PUT', body: { html_text: patch.html } })
  if (!got.ok) {
    $.ui.toast(T.asanaEditFailed(got.error))
    return keepAsanaEdit($, state.comment, value)
  }
  asanaEditDraft = ''
  $.ui.toast(T.asanaEdited)
  await update($, asanaEdit, () => null)
  await openAsanaTask($, server, task)
}

// 거절·실패한 글을 다시 그리거나(Enter 뒤라 칸이 키를 갖고 있다) 지우기로 비운 칸을 그린다(버튼을 눌렀으니 패널을 다시 연다).
async function keepAsanaEdit($: EngineInterface, comment: string, value: string, isPressed = false) {
  asanaEditDraft = value
  asanaEditRound++
  await update($, asanaEdit, (shown): AsanaEdit | null => (shown?.comment !== comment ? shown : { ...shown, status: 'ready' }))
  if (isPressed) await $.ui.open({ id: ASANA_PANE, title: 'Asana', focus: true })
  await $.ui.focus({ requestId: ASANA_PANE, key: `asana-editing-${comment}-${asanaEditRound}` }).catch(() => undefined)
}

// 작업 유형 상태 바꾸기: MCP update_tasks 는 custom_type_status_option 을 조용히 버려, 개인 토큰이 있을 때만 REST 로 바꾼다.
// 고른 상태의 완료 여부(completion_state)는 Asana 가 태스크 완료에 함께 반영한다.
async function changeAsanaStatus($: EngineInterface, server: AsanaServer, task: string, option: string) {
  const got = await asanaRest($, `/tasks/${task}?opt_fields=gid`, { method: 'PUT', body: { custom_type_status_option: option } })
  if (!got.ok) return $.ui.toast(T.asanaUpdateFailed(got.error))
  await update($, open, state => ({ ...state, 'asana:status': false }))
  void refreshAsana($).catch(() => undefined)
  const shown = await read($, asanaProject)
  if (shown) void openAsanaProject($, shown.project).catch(() => undefined)
  await openAsanaTask($, server, task)
}

// 사람 찾기 칸은 담당자 바꾸기와 멘션이 함께 쓴다. 한쪽 결과를 다른 쪽에서 누르지 않게 하나만 열고 결과를 비운다.
async function toggleAsanaFinder($: EngineInterface, mode: 'assign' | 'mention') {
  const other = mode === 'assign' ? 'asana:mention' : 'asana:assign'
  asanaQuery = ''
  await update($, asanaUsers, () => null)
  const isOpening = !((await read($, open))[`asana:${mode}`] ?? false)
  await update($, open, state => ({ ...state, [`asana:${mode}`]: isOpening, [other]: false }))
  // 댓글 칸에 고리가 있으면 autoFocus 가 듣지 않아(사람이 옮긴 고리는 그대로) 연 찾기 칸으로 직접 옮긴다.
  if (!isOpening) return
  await $.ui.open({ id: ASANA_PANE, title: 'Asana', focus: true })
  await $.ui.focus({ requestId: ASANA_PANE, key: mode === 'assign' ? 'asana-user-search' : 'asana-mention-search' }).catch(() => undefined)
}

// 댓글 칸에 "@이름 " 을 끼우고(비었으면 그것만, 쓰던 글이 있으면 뒤에) 다시 그 칸으로 커서를 돌린다.
async function pickMention($: EngineInterface, gid: string, user: AsanaUser) {
  if (!asanaMentions.some(item => item.gid === user.gid)) asanaMentions = [...asanaMentions, user]
  const gap = asanaDraft === '' || /\s$/.test(asanaDraft) ? '' : ' '
  asanaDraft = `${asanaDraft}${gap}@${user.name} `
  asanaWriteRound++
  asanaQuery = ''
  await update($, asanaUsers, () => null)
  await update($, open, state => ({ ...state, 'asana:mention': false }))
  await $.ui.open({ id: ASANA_PANE, title: 'Asana', focus: true })
  await $.ui.focus({ requestId: ASANA_PANE, key: `asana-write-${gid}-${asanaWriteRound}` }).catch(() => undefined)
}

async function findAsanaUsers($: EngineInterface, server: AsanaServer, value: string) {
  const query = value.trim()
  asanaQuery = value
  if (query === '') return
  await update($, asanaUsers, () => ({ query, status: 'loading' as const, users: [] }))
  const got = await callAsana($, server, usersCall(server, query))
  await update($, asanaUsers, () => (got.ok ? { query, status: 'ok' as const, users: toUsers(got.data) } : { query, status: 'failed' as const, users: [] }))
}

// 담당자·드롭다운 필드 바꾸기. 담당자는 다른 사람에게 넘기면 내 목록에서 빠지므로 머지처럼 두 번 눌러야 한다.
const ASSIGN_ARM_MS = 5000

async function changeAsana($: EngineInterface, server: AsanaServer, task: AsanaDetail, change: { assignee: string; name: string } | { field: string; option: string }) {
  const got = await callAsana($, server, updateCall(server, task.gid, 'field' in change ? change : { assignee: change.assignee }))
  const problem = got.ok ? updateProblem(server, got.data) : got.error
  if (problem !== null) {
    $.ui.toast(T.asanaUpdateFailed(problem))
    return
  }
  if ('assignee' in change) {
    $.ui.toast(T.asanaAssigned(change.name))
    asanaQuery = ''
    await update($, asanaUsers, () => null)
    await update($, open, state => ({ ...state, 'asana:assign': false }))
    void refreshAsana($).catch(() => undefined)
    const shown = await read($, asanaProject)
    if (shown) void openAsanaProject($, shown.project).catch(() => undefined)
  } else {
    await update($, open, state => ({ ...state, [`asana:field:${change.field}`]: false }))
  }
  await openAsanaTask($, server, task.gid)
}

async function armAssign($: EngineInterface, server: AsanaServer, task: AsanaDetail, user: { gid: string; name: string }, isArmed: boolean) {
  const key = `asana:arm:${user.gid}`
  if (!isArmed) {
    await update($, open, state => ({ ...state, [key]: true }))
    $.clock.after(ASSIGN_ARM_MS, () => void update($, open, state => ({ ...state, [key]: false })))
    return
  }
  await update($, open, state => ({ ...state, [key]: false }))
  await changeAsana($, server, task, { assignee: user.gid, name: user.name })
}

// 세션마다 비워지는 상태를 다시 채운다: 세션이 시작될 때와 창 안에서 다른 세션으로 넘어간 뒤(/resume·/clear).
function refreshSessionState($: EngineInterface) {
  void update($, ready, () => true).catch(() => undefined)
}

// desk-look 의 /desk-fold 를 따라 접고 편다: desk-look 이 folded 에 목록을 쓰면(접을 desk-look 패널이 없으면 빈 목록)
// 이 플러그인의 패널도 접고, null 을 쓰면 접어 둔 것을 다시 연다. 엔진은 다른 플러그인의 패널을 닫게 하지 않는다.
async function followFold($: EngineInterface, isFolding: boolean) {
  if (isFolding) {
    const panes = (await $.ui.panes()).filter(pane => pane.isPlaced)
    if (panes.length === 0) return
    // 이미 접어 둔 것이 있으면 새로 접는 것을 더한다(desk-look 의 toggleFold 와 같다).
    const saved = await read($, folded)
    const fresh = panes.map(pane => ({ id: pane.id, title: pane.title, isShown: pane.isShown, offset: 0 }))
    await update($, folded, () => [...(saved ?? []).filter(pane => !fresh.some(item => item.id === pane.id)), ...fresh])
    for (const pane of panes) await $.ui.close({ id: pane.id }).catch(() => undefined)
    return
  }
  const saved = await read($, folded)
  await update($, folded, () => null)
  for (const pane of saved ?? []) await $.ui.open({ id: pane.id, title: pane.title, ...(pane.isShown ? { focus: true as const } : {}) })
}

// 설정 language 가 auto 일 때: desk-look 이 있으면 desk-look 이 고른 언어, 없으면 Claude Code /config 의 language.
async function pickLang($: EngineInterface) {
  const { value } = await $.state.get({ plugin: 'desk-look', key: 'lang' })
  if (value === 'en' || value === 'ko') return setLang(value)
  const row = (await $.config.list().catch(() => [])).find(item => item.key === 'language')
  return setLang(langFromConfig(row?.value))
}

export const register: Register = (on, options) => {
  const language = langSetting(options)
  setLang(language === 'auto' ? 'en' : language)
  asanaToken = typeof options.asanaToken === 'string' ? options.asanaToken.trim() : ''
  asanaKeyFields = keyFieldNames(options.asanaKeyField)
  asanaKeyGids.clear()
  asanaMe = null
  asanaTokenMe = null

  on('session.start', async ($, e, next) => {
    if (language === 'auto' && (await pickLang($).catch(() => false))) $.ui.invalidate('ui.render')
    // 패널만 여는 명령은 턴 중에도 바로 연다(immediate).
    await $.command.register({ name: 'desk-asana', description: T.cmdAsana, immediate: true })
    refreshSessionState($)
    return next(e)
  })

  // 창 안의 /resume·/clear 는 상태(atom)를 비우고 session.start 없이 이어 간다. 넘어간 뒤 다시 채운다.
  on('session.end', async ($, e, next) => {
    const done = await next(e)
    if (e.reason === 'resume' || e.reason === 'clear') $.clock.after(300, () => refreshSessionState($))
    return done
  })

  on('state.set', { plugin: 'desk-look', key: 'lang' }, async ($, e, next) => {
    const done = await next(e)
    if (language === 'auto' && (e.value === 'en' || e.value === 'ko') && setLang(e.value)) $.ui.invalidate('ui.render')
    return done
  }).catch(($, e, next) => next(e))

  on('state.set', { plugin: 'desk-look', key: 'folded' }, async ($, e, next) => {
    const done = await next(e)
    await followFold($, e.value !== null).catch(() => undefined)
    return done
  }).catch(($, e, next) => next(e))

  // 패널이 열려 있는지 desk-look 에 알린다. 사람이 ✕ 로 닫아도, 플러그인을 내려도 ui.close 가 온다.
  on('ui.open', { id: ASANA_PANE }, async ($, e, next) => {
    const opened = await next(e)
    if (opened.value?.isPlaced) await update($, shown, () => true).catch(() => undefined)
    return opened
  })

  on('ui.close', { id: ASANA_PANE }, async ($, e, next) => {
    const done = await next(e)
    await update($, shown, () => false).catch(() => undefined)
    return done
  })

  on('command.run', { command: 'desk-asana' }, async $ => {
    await openAsana($)
    const state = await read($, asana)
    return { text: state?.status === 'none' ? T.asanaNoServer : T.asanaOpened }
  })

  // Asana 패널: 내 태스크를 프로젝트별로, 하나를 누르면 상세(상태·담당자·드롭다운 필드·설명·댓글)와 댓글 달기.
  on('ui.render', { component: 'Pane', requestId: ASANA_PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Input, Link } = els
    const [state, view, armed, found, search, tab, projects, project, editing, now] = await Promise.all([
      read($, asana),
      read($, asanaView),
      read($, open),
      read($, asanaUsers),
      read($, asanaSearch),
      read($, asanaTab),
      read($, asanaProjects),
      read($, asanaProject),
      read($, asanaEdit),
      $.clock.now(),
    ])
    const columns = Math.max(24, e.props.bodyColumns)
    const server = state?.server ?? null
    const today = localDay(now)
    const due = (dueOn: string | null) => {
      const chip = dueChip(dueOn, today)
      return chip && <Text color={COLORS[chip.level]}>{` ${chip.text}`}</Text>
    }

    if (view !== null && server !== null) {
      const task = view.task
      const head = (
        <Box columnGap={1}>
          <Button key="asana-back" plain dimColor label={T.asanaBack} onPress={() => void closeAsanaTask($)} />
          <Button key="asana-reload" plain dimColor hotkey="r" label={view.status === 'loading' ? '…' : '↻'} onPress={() => void openAsanaTask($, server, view.gid)} />
        </Box>
      )
      if (task === null) {
        return (
          <Box flexDirection="column" rowGap={1}>
            {head}
            <Text color={COLORS.muted}>{view.status === 'failed' ? T.asanaFailed(view.error ?? '') : T.asanaLoading}</Text>
          </Box>
        )
      }
      const isAssigning = armed['asana:assign'] ?? false
      const isMentioning = armed['asana:mention'] ?? false
      // 담당자 바꾸기와 멘션이 함께 쓰는 사람 찾기 칸. 행은 모드마다 키가 달라 누른 쪽 동작만 한다.
      const finder = (key: string, rows: Array<ReturnType<typeof rowButton>>) => (
        <Box flexDirection="column" paddingLeft={2}>
          <Input
            key={key}
            label={T.asanaFindLabel}
            placeholder={T.asanaFindPlaceholder}
            value={asanaQuery}
            submitLabel={T.asanaFind}
            autoFocus
            onInput={value => (asanaQuery = value)}
            onSubmit={value => void findAsanaUsers($, server, value)}
          />
          {rows}
          {found?.status === 'loading' && <Text color={COLORS.muted}>{T.asanaFinding}</Text>}
          {found?.status === 'failed' && <Text color={COLORS.danger}>{T.asanaFindFailed}</Text>}
          {found?.status === 'ok' && found.users.length === 0 && <Text color={COLORS.muted}>{T.asanaNoPeople}</Text>}
        </Box>
      )
      const mentionRow = (user: AsanaUser) =>
        rowButton(
          els,
          { key: `asana-mention-${user.gid}`, dimColor: true, onPress: () => void pickMention($, task.gid, user) },
          `@${user.name}`,
          user.email ? <Text color={COLORS.muted}>{` ${user.email}`}</Text> : null,
        )
      const userRow = (user: { gid: string; name: string; email?: string | null }) => {
        const isArmed = armed[`asana:arm:${user.gid}`] ?? false
        return rowButton(
          els,
          { key: `asana-user-${user.gid}`, dimColor: !isArmed, onPress: () => void armAssign($, server, task, user, isArmed) },
          isArmed ? T.asanaAssignConfirm(user.name) : user.name,
          !isArmed && user.email ? <Text color={COLORS.muted}>{` ${user.email}`}</Text> : null,
        )
      }
      const fields = task.fields.filter(field => field.value !== null || field.options !== null)
      const canPickStatus = task.status !== null && task.statuses.length > 0
      const isStatusPicking = armed['asana:status'] ?? false
      return (
        <Box flexDirection="column" rowGap={1}>
          {head}
          <Box flexDirection="column">
            <Text color={COLORS.text} weight="semibold">
              {task.name}
            </Text>
            <Box columnGap={1}>
              {task.status !== null ? (
                <Text color={task.completed ? COLORS.success : COLORS.accent}>{`● ${task.status}`}</Text>
              ) : (
                task.completed && <Text color={COLORS.success}>{T.asanaDone}</Text>
              )}
              {canPickStatus && <Button key="asana-status" plain dimColor label={isStatusPicking ? T.cancel : T.asanaChange} onPress={() => void toggle($, 'asana:status')} />}
              {!canPickStatus && task.places.length > 0 && (
                <Text color={COLORS.muted} wrap="truncate-end">
                  {task.places.join(' · ')}
                </Text>
              )}
            </Box>
            {isStatusPicking &&
              (asanaToken === '' ? (
                <Text color={COLORS.warning}>{T.asanaNeedToken(T.asanaStatusWhat)}</Text>
              ) : (
                <Box paddingLeft={2} columnGap={2} flexWrap="wrap">
                  {task.statuses.map(option => (
                    <Button
                      key={`asana-status-${option.gid}`}
                      plain
                      dimColor={option.name !== task.status}
                      label={option.name === task.status ? `✓ ${option.name}` : option.name}
                      onPress={() => void changeAsanaStatus($, server, task.gid, option.gid)}
                    />
                  ))}
                </Box>
              ))}
            {/* 상태 옆 바꾸기 버튼과 장소의 › 가 한 줄에 섞이지 않게 장소를 다음 줄로 내린다. */}
            {canPickStatus && task.places.length > 0 && (
              <Text color={COLORS.muted} wrap="truncate-end">
                {task.places.join(' · ')}
              </Text>
            )}
            <Box columnGap={2}>
              <Button key="asana-claude" plain label={T.handToClaude} onPress={() => void fillPrompt($, asanaPrompt(task))} />
              {task.url && <Link href={task.url}>{T.asanaOpenOn}</Link>}
            </Box>
          </Box>
          <Box flexDirection="column">
            <Box columnGap={1}>
              <Text color={COLORS.muted}>{T.asanaAssignee}</Text>
              <Text color={task.assignee ? COLORS.text : COLORS.muted}>{task.assignee?.name ?? T.asanaNobody}</Text>
              <Button key="asana-assign" plain dimColor label={isAssigning ? T.cancel : T.asanaChange} onPress={() => void toggleAsanaFinder($, 'assign')} />
            </Box>
            {isAssigning && finder('asana-user-search', [userRow({ gid: 'me', name: T.asanaMe }), ...(found?.status === 'ok' ? found.users.map(userRow) : [])])}
            {task.dueOn !== null && (
              <Box columnGap={1}>
                <Text color={COLORS.muted}>{T.asanaDueLabel}</Text>
                <Text color={COLORS.text}>{task.dueOn}</Text>
                {due(task.dueOn)}
              </Box>
            )}
            {fields.map(field => {
              const isPicking = armed[`asana:field:${field.gid}`] ?? false
              return (
                <Box key={`asana-fieldrow-${field.gid}`} flexDirection="column">
                  <Box columnGap={1}>
                    <Text color={COLORS.muted}>{clip(field.name, Math.max(8, Math.floor(columns / 3)))}</Text>
                    <Text color={field.value ? COLORS.text : COLORS.muted}>{field.value ?? '—'}</Text>
                    {field.options && (
                      <Button key={`asana-field-${field.gid}`} plain dimColor label={isPicking ? '⌄' : '›'} onPress={() => void toggle($, `asana:field:${field.gid}`)} />
                    )}
                  </Box>
                  {isPicking && field.options && (
                    <Box paddingLeft={2} columnGap={2} flexWrap="wrap">
                      {field.options.map(option => (
                        <Button
                          key={`asana-option-${field.gid}-${option.gid}`}
                          plain
                          dimColor={option.name !== field.value}
                          label={option.name === field.value ? `✓ ${option.name}` : option.name}
                          onPress={() => void changeAsana($, server, task, { field: field.gid, option: option.gid })}
                        />
                      ))}
                    </Box>
                  )}
                </Box>
              )
            })}
          </Box>
          {/* 0.48 이 열어 둔 상세(asanaView atom)는 /reload-plugins 뒤에도 남고 richNotes 가 없다. */}
          {typeof task.richNotes === 'string'
            ? task.richNotes !== '' && renderMarkdown(task.richNotes, els, COLORS, columns, { document: true })
            : task.notes.trim() !== '' && <Text color={COLORS.text}>{task.notes.trim()}</Text>}
          <Box flexDirection="column" rowGap={1}>
            <Text color={COLORS.text} weight="semibold">
              {T.asanaComments(task.comments.length)}
            </Text>
            {task.comments.map(comment => (
              <Box key={`asana-comment-${comment.gid}`} flexDirection="column">
                <Box columnGap={1}>
                  <Text color={COLORS.accent}>{comment.author}</Text>
                  <Text color={COLORS.muted}>{Number.isNaN(Date.parse(comment.at)) ? '' : ago(Date.parse(comment.at), now)}</Text>
                  {asanaMe !== null && comment.authorGid === asanaMe && (
                    <Button
                      key={`asana-edit-${comment.gid}`}
                      plain
                      dimColor
                      label={editing?.comment === comment.gid ? (editing.status === 'loading' || editing.status === 'saving' ? '…' : T.cancel) : T.asanaEdit}
                      onPress={() => void startAsanaEdit($, comment.gid)}
                    />
                  )}
                </Box>
                {editing?.comment === comment.gid && editing.story !== null ? (
                  <Box flexDirection="column">
                    <Input
                      key={`asana-editing-${comment.gid}-${asanaEditRound}`}
                      label={T.asanaEditLabel}
                      rows={Math.min(12, Math.max(COMMENT_ROWS, editing.story.text.split('\n').length + 1))}
                      value={asanaEditDraft}
                      submitLabel={editing.status === 'saving' ? '…' : T.asanaEditSave}
                      onInput={value => (asanaEditDraft = value)}
                      onSubmit={value => void saveAsanaEdit($, server, task.gid, value)}
                    />
                    <Box>
                      <Button key={`asana-edit-clear-${comment.gid}`} plain dimColor label={T.inputClear} onPress={() => void keepAsanaEdit($, comment.gid, '', true)} />
                    </Box>
                  </Box>
                ) : typeof comment.richText === 'string' ? (
                  // 0.49 가 열어 둔 상세(asanaView atom)의 댓글에는 richText 가 없다.
                  comment.richText !== '' && renderMarkdown(comment.richText, els, COLORS, columns, { document: true })
                ) : (
                  <Text color={COLORS.text}>{comment.text.trim()}</Text>
                )}
                {editing?.comment === comment.gid && editing.status === 'notoken' && <Text color={COLORS.warning}>{T.asanaNeedToken(T.asanaEditWhat)}</Text>}
              </Box>
            ))}
            <Input
              key={`asana-write-${task.gid}-${asanaWriteRound}`}
              label={T.asanaCommentLabel}
              placeholder={T.asanaCommentPlaceholder}
              rows={COMMENT_ROWS}
              value={asanaDraft}
              submitLabel={T.asanaSend}
              onInput={value => (asanaDraft = value)}
              onSubmit={value => void postAsanaComment($, server, task.gid, value)}
            />
            <Box columnGap={2}>
              <Button key="asana-mention" plain dimColor label={isMentioning ? T.cancel : T.asanaMention} onPress={() => void toggleAsanaFinder($, 'mention')} />
              <Button key="asana-write-clear" plain dimColor label={T.inputClear} onPress={() => void clearAsanaDraft($, task.gid)} />
            </Box>
            {isMentioning && finder('asana-mention-search', found?.status === 'ok' ? found.users.map(mentionRow) : [])}
          </Box>
          <Box>
            <Button key="asana-back-end" plain dimColor label={T.asanaBack} onPress={() => void closeAsanaTask($)} />
          </Box>
        </Box>
      )
    }

    const room = Math.max(16, columns - 10)
    const owner = (name: string | null) => name !== null && <Text color={COLORS.muted}>{` ${clip(name, 12)}`}</Text>
    // 완료된 태스크는 흐리게, 마감일 대신 상태(없으면 ✓)를 붙인다. 태스크 키는 제목 바로 뒤에 흐리게.
    const taskRow = (task: AsanaTask) => {
      const key = task.key ?? null
      return rowButton(
        els,
        { key: `asana-task-${task.gid}`, dimColor: task.isDone, onPress: () => void (server && openAsanaTask($, server, task.gid)) },
        clip(task.name, Math.max(12, room - (task.assignee === null ? 0 : 13) - (key === null ? 0 : key.length + 1))),
        key !== null && <Text color={COLORS.muted}>{` ${key}`}</Text>,
        owner(task.assignee),
        task.isDone ? <Text color={COLORS.success}>{` ${task.status === null ? '✓' : `● ${task.status}`}`}</Text> : due(task.dueOn),
      )
    }
    // 탭은 diff 패널의 범위 고르기와 같은 모양. allow 규칙 안내는 두 탭 모두에.
    const tabs = (
      <Box key="asana-tabs" columnGap={2}>
        {(['mine', 'projects'] as const).map(name => (
          <Button
            key={`asana-tab-${name}`}
            plain
            dimColor={name !== tab}
            label={`${name === tab ? '●' : '○'} ${name === 'mine' ? T.asanaTabMine : T.asanaTabProjects}`}
            onPress={() => void switchAsanaTab($, name)}
          />
        ))}
      </Box>
    )
    const unruled = (state?.unruled.length ?? 0) > 0 && (
      <Box flexDirection="column">
        <Text color={COLORS.warning}>{T.asanaUnruled}</Text>
        <Text color={COLORS.muted}>{state?.unruled.map(tool => `"${tool}",`).join('\n')}</Text>
      </Box>
    )
    const isUnready = state === null || state.status === 'none' || (state.status === 'loading' && state.server === null)

    // 프로젝트 탭: 펼친 프로젝트가 있으면 그 열린 태스크를 섹션별로(담당자 누구든), 아니면 내가 멤버인 프로젝트.
    if (tab === 'projects' && !isUnready) {
      if (project !== null) {
        const openTasks = project.tasks.filter(task => !task.isDone)
        const doneTasks = project.tasks.filter(task => task.isDone)
        const groups = groupTasks(openTasks, 'section')
        const foldOf = (name: string | null) => `asana:fold:${project.project.gid}:${name ?? ''}`
        const doneFold = `asana:done:${project.project.gid}`
        // 하나라도 펴져 있으면 모두 접고, 다 접혀 있으면 모두 편다(diff 패널의 모두 접기와 같다).
        const folds = [...groups.map(group => foldOf(group.name)), ...(doneTasks.length > 0 ? [doneFold] : [])]
        const anyOpen = folds.some(fold => !(armed[fold] ?? false))
        const foldAll = () => update($, open, state => ({ ...state, ...Object.fromEntries(folds.map(fold => [fold, anyOpen])) }))
        const message =
          project.status === 'failed'
            ? T.asanaFailed(project.error ?? '')
            : openTasks.length === 0
              ? project.status === 'loading'
                ? T.asanaLoading
                : T.asanaProjectEmpty
              : null
        return (
          <Box flexDirection="column" rowGap={1}>
            {tabs}
            {unruled}
            <Box flexDirection="column">
              <Box columnGap={1}>
                <Button key="asana-project-back" plain dimColor label={T.asanaProjectsBack} onPress={() => void closeAsanaProject($)} />
                <Button key="asana-project-refresh" plain dimColor hotkey="r" label={project.status === 'loading' ? '…' : '↻'} onPress={() => void openAsanaProject($, project.project)} />
                {folds.length > 1 && (
                  <Button key="asana-fold-all" plain dimColor hotkey="z" label={anyOpen ? T.foldAll : T.unfoldAll} onPress={() => void foldAll()} />
                )}
              </Box>
              <Box columnGap={1}>
                <Text color={COLORS.text} weight="semibold" wrap="truncate-end">
                  {clip(project.project.name, Math.max(8, columns - 16))}
                </Text>
                <Text color={COLORS.muted}>{T.asanaOpenCount(openTasks.length)}</Text>
              </Box>
              {project.project.url && <Link href={project.project.url}>{T.asanaOpenOn}</Link>}
            </Box>
            {message !== null && <Text color={COLORS.muted}>{message}</Text>}
            {groups.map((group, index) => {
              const fold = foldOf(group.name)
              const isFolded = armed[fold] ?? false
              return (
                <Box key={`asana-sectionbox-${index}`} flexDirection="column">
                  {rowButton(
                    els,
                    { key: `asana-section-${index}`, onPress: () => void toggle($, fold) },
                    isFolded ? '› ' : '⌄ ',
                    <Text color={COLORS.muted} weight="semibold">
                      {clip(group.name === null || group.name === 'Untitled section' ? T.asanaNoSection : group.name, Math.max(8, columns - 12))}
                    </Text>,
                    <Text color={COLORS.muted}>{` · ${group.tasks.length}`}</Text>,
                  )}
                  {!isFolded && group.tasks.map(taskRow)}
                </Box>
              )
            })}
            {doneTasks.length > 0 && (
              <Box key="asana-sectionbox-done" flexDirection="column">
                {rowButton(
                  els,
                  { key: 'asana-section-done', onPress: () => void toggle($, doneFold) },
                  (armed[doneFold] ?? false) ? '› ' : '⌄ ',
                  <Text color={COLORS.muted} weight="semibold">
                    {T.asanaRecentDone(DONE_DAYS, doneTasks.length)}
                  </Text>,
                )}
                {!(armed[doneFold] ?? false) && doneTasks.map(taskRow)}
              </Box>
            )}
            {project.isPartial && <Text color={COLORS.muted}>{T.asanaProjectPartial(project.tasks.length)}</Text>}
            {/* 목록이 길면 위로 되돌아가지 않도록 맨 아래에도 같은 버튼 */}
            <Box>
              <Button key="asana-project-back-end" plain dimColor label={T.asanaProjectsBack} onPress={() => void closeAsanaProject($)} />
            </Box>
          </Box>
        )
      }
      const mine = (projects?.projects ?? []).filter(item => item.isMine)
      const message =
        projects === null || (projects.status === 'loading' && mine.length === 0)
          ? T.asanaLoading
          : projects.status === 'failed'
            ? T.asanaFailed(projects.error ?? '')
            : mine.length === 0
              ? T.asanaNoProjects
              : null
      return (
        <Box flexDirection="column" rowGap={1}>
          {tabs}
          {unruled}
          <Box columnGap={1}>
            <Text color={COLORS.text} weight="semibold">
              {T.asanaMyProjects(mine.length)}
            </Text>
            <Button key="asana-projects-refresh" plain dimColor hotkey="r" label={projects?.status === 'loading' ? '…' : '↻'} onPress={() => void refreshAsanaProjects($)} />
          </Box>
          {message !== null && <Text color={COLORS.muted}>{message}</Text>}
          <Box flexDirection="column">
            {mine.map(item =>
              rowButton(
                els,
                { key: `asana-project-${item.gid}`, onPress: () => void openAsanaProject($, item) },
                clip(item.name, Math.max(12, room - 16)),
                <Text color={COLORS.muted}>{` ${T.asanaProjectMeta(item.members, item.open)}`}</Text>,
              ),
            )}
          </Box>
        </Box>
      )
    }

    // 검색 중이면 찾은 태스크를, 아니면 내 태스크를 같은 모양(프로젝트 묶음)으로 보인다.
    const listed = (search ?? state)?.tasks ?? []
    const tasks = listed.filter(task => !task.isDone)
    const doneTasks = listed.filter(task => task.isDone)
    const message =
      state === null || (state.status === 'loading' && listed.length === 0 && search === null)
        ? T.asanaLoading
        : state.status === 'none'
          ? T.asanaNoServer
          : search?.status === 'loading'
            ? T.asanaSearching
            : (search ?? state).status === 'failed'
              ? T.asanaFailed((search ?? state).error ?? '')
              : tasks.length === 0
                ? search
                  ? T.asanaNoMatch
                  : T.asanaEmpty
                : null
    return (
      <Box flexDirection="column" rowGap={1}>
        {!isUnready && tabs}
        {unruled}
        <Box columnGap={1}>
          <Text color={COLORS.text} weight="semibold" wrap="truncate-end">
            {search ? T.asanaFound(clip(search.query, Math.max(8, columns - 20)), tasks.length) : T.asanaMine(tasks.length)}
          </Text>
          <Button
            key="asana-refresh"
            plain
            dimColor
            hotkey="r"
            label={(search ?? state)?.status === 'loading' ? '…' : '↻'}
            onPress={() => void (search && server ? searchAsana($, server, search.query) : refreshAsana($))}
          />
          {search && <Button key="asana-search-clear" plain dimColor label={T.asanaSearchClear} onPress={() => void clearAsanaSearch($)} />}
        </Box>
        {state?.server && (
          <Input
            key={`asana-search-${asanaFindRound}`}
            label={T.asanaSearchLabel}
            placeholder={asanaKeyFields.length === 0 ? T.asanaSearchPlaceholder : T.asanaSearchPlaceholderKey(asanaKeyFields.join('·'))}
            value={asanaFindText}
            submitLabel={T.asanaFind}
            onInput={value => (asanaFindText = value)}
            onSubmit={value => void (server && searchAsana($, server, value))}
          />
        )}
        {message !== null && <Text color={COLORS.muted}>{message}</Text>}
        {groupTasks(tasks).map(group => (
          <Box key={`asana-group-${group.name ?? ''}`} flexDirection="column">
            <Text color={COLORS.muted} weight="semibold" wrap="truncate-end">
              {group.name ?? T.asanaNoProject}
            </Text>
            {group.tasks.map(taskRow)}
          </Box>
        ))}
        {doneTasks.length > 0 && (
          <Box key="asana-group-done" flexDirection="column">
            <Text color={COLORS.muted} weight="semibold">
              {T.asanaRecentDone(DONE_DAYS, doneTasks.length)}
            </Text>
            {doneTasks.map(taskRow)}
          </Box>
        )}
      </Box>
    )
  })
}
