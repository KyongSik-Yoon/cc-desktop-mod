import { atom, read, update } from 'claude-code'
import type { Chunk, Elements, EngineInterface, ModelUsage, Register, RenderSurface, TextHoverProps, Timer, ToolGroupCall, TurnStepResult, UiPressArgument } from 'claude-code'

import type { ActivityKind, ActivityLog, ActivityState, TurnStats, AgentDetail, AgentRecord, CommentDraft, LineComment, DiffFilter, DiffScope, DiffView, FileDiff, OpenedGaps, ImageInfo, PrCheck, PrInfo, PrState, PrThread, RepoInfo, RunCall, Runs, AskState, PlanAskState, CommitInfo, FoldedPane, Graphics, SessionEdit, SessionEntry, LiveSession, PreviewFile, Surface, TaskItem, TurnCard, TurnEdit, UsageBreakdown, UsageInfo, ContextCompaction, ContextPoint } from '../types'
import { CORNER_SIZE, IMAGE_TOKEN, TMUX_GRAPHICS_FORMAT, cornerPixels, graphicsOf, herdrGraphicsOn, imageNumber, pngSize, thumbnailSize, type Corner } from './images'
import { cellWidth, parseBlocks, renderMarkdown } from './markdown'
import { blockHeight, diffBlock, diffBlocks, diffPalette, diffRows, gutterWidth, isTruecolor, openGaps, parseHunks, patchBlocks, untab, windowPlan } from './diffview'
import type { DiffBlock, DiffLine, DiffPalette, DiffRow, Gap } from './diffview'
import { commentContext, draftKey, lineRef, linesIn, pressLine, rangeLabel, rangeOf, rowOf } from './comments'
import type { LinePress } from './comments'
import { agentOf, computeRuns, isAgentTool, isPlanTool, placeCall, planOf, withPredicted } from './runs'
import type { PredictedCall, RunCursor } from './runs'
import { activityOf, agentDetailOf, applyNotices, backgroundTaskOf, dismissAgents, exitStatusOf, isLive, mergeAgents, modelLabel, orderAgents, outputFileOf, parseNotices, stepTokens, tailOf } from './agents'
import { ago, clip, filterSessions, groupSessions, herdrPaneOf, isGroupFolded, liveSessionsOf, numbered, sessionOf } from './sessions'
import { answerOf, awaitReply, cardSession, numberProblem, openReplyPipe, registerAsk } from './ask'
import type { AskReply } from './ask'
import { CANCEL_REASON, DISMISS_REASON, planInput, planTitle, reviseReason } from './plan'
import type { PlanReply } from './plan'
import { gather, gatheredLines } from './gather'
import { computeTasks } from './tasks'
import { GAP_GLYPH, KIND_GLYPH, LOG_EVENTS, NOW_AFTER_MS, PROC_DEPTH, PROC_POLL_MS, QUIET_AFTER_MS, callProcesses, childPids, clipWidth, clockOf, etimesOf, flowRows, ioBytes, isCallRoot, kindOf, laneCells, laneSegments, procView, sayStrip, statPid, statRow, stepStrip, turnNarration, uptimeTicks } from './activity'
import type { FlowRow, LaneSegment, ProcRow, StripPart } from './activity'
import type { ProcSample } from './activity'
import { OMARCHY_COLORS, gray256, parseSurface } from './theme'
import { limitName, contextChipMode, meterLevel, resetIn, ring, showsChip, toBreakdown, toUsage, barRuns, cacheShares, chartColumns, chartRows, chartTop, columnOf, compactionPoints, hhmm, sparkline, splitOf, sumSplits, turnCosts } from './usage'
import type { BarPart, BarRun, ContextChipMode } from './usage'
import { PR_FIELDS, THREADS_QUERY, checkPrompt, checkSummary, isLocalFailure, jobState, mergeAction, mergeLevel, mergeName, prChipParts, prNumber, prRef, prRepo, reviewName, shortStat, threadPrompt, toDiscussions, toJobs, toMr, toPr, toThreads } from './pr'
import type { MergeAction, MergeResult, Ran } from './pr'
import { LOG_FORMAT, MAX_COMMITS, SCOPES, baseCandidates, branchChoices, matchesPath, parseCommits, scopeLabel, scopeOf } from './gitview'
import { T, currentLang, langFromConfig, langSetting, setLang, type Lang } from './i18n'
import { previewHtml } from './preview-html'
import { PREVIEW_PANE, PREVIEW_ROOM, PREVIEW_TOOL, fileName, isMarkdown, isPrivate, previewOf, previewTool } from './preview'

export { cellWidth } from './markdown'

// 데스크톱 앱 CDS 토큰의 역할을 엔진 테마 키에 대응시킨다.
// hex 를 박으면 터미널 테마(밝음/어두움)와 어긋나므로, 사용자의 테마를 따르는 키만 쓴다.
const COLORS = {
  text: 'text',
  muted: 'inactive',
  border: 'subtle',
  clay: 'claude',
  accent: 'claude',
  link: 'suggestion',
  code: 'error',
  success: 'success',
  danger: 'error',
  warning: 'warning',
} as const

const PANE = 'desk-diff'
const SESSIONS_PANE = 'desk-sessions'
const CONTEXT_PANE = 'desk-context'
const PR_PANE = 'desk-pr'
const AGENTS_PANE = 'desk-tasks'
const ACTIVITY_PANE = 'desk-activity'
const DESK_PANES = new Set([PANE, SESSIONS_PANE, CONTEXT_PANE, PR_PANE, AGENTS_PANE, PREVIEW_PANE, ACTIVITY_PANE])
// /desk-tasks 끝남 묶음을 접었는지(open 상태의 한 키).
const DONE_FOLDED = 'tasks:doneFolded'
const PER_GROUP = 8
// diff 줄 댓글 칸 높이(쓰는 동안만 끼는 행), 질문 카드 직접 입력칸이 자랄 수 있는 줄 수.
const COMMENT_ROWS = 3
const ASK_TEXT_ROWS = 4

const open = atom({ plugin: 'desk-look', key: 'open' } as const, {} as Record<string, boolean>)
const diff = atom({ plugin: 'desk-look', key: 'diff' } as const, [] as FileDiff[])
const repo = atom({ plugin: 'desk-look', key: 'repo' } as const, null as RepoInfo | null)
const surface = atom({ plugin: 'desk-look', key: 'surface' } as const, null as Surface | null)
const runs = atom({ plugin: 'desk-look', key: 'runs' } as const, { firstOf: {}, calls: {} } as Runs)
const images = atom({ plugin: 'desk-look', key: 'images' } as const, {} as Record<string, ImageInfo>)
const graphics = atom({ plugin: 'desk-look', key: 'graphics' } as const, null as Graphics)
// herdr 에 `herdr --remote` 클라이언트가 붙어 있는지. 원격 터미널은 알 수 없고(foot 처럼 kitty 그림을 버리는 곳도 있다)
// 모든 클라이언트가 한 화면을 같이 보므로, 붙어 있는 동안은 그림 없이 그린다.
const herdrRemote = atom({ plugin: 'desk-look', key: 'herdrRemote' } as const, false)
const pendingEdits = atom({ plugin: 'desk-look', key: 'pendingEdits' } as const, [] as TurnEdit[])
const turnCards = atom({ plugin: 'desk-look', key: 'turnCards' } as const, [] as TurnCard[])
// /desk-diff 패널 창 위치: ui.scroll 이 알려 준 첫 행과 보이는 행 수. 보이는 곳만 그리는 데 쓴다.
const diffWindow = atom({ plugin: 'desk-look', key: 'diffWindow' } as const, { offset: 0, bodyRows: 0 })
// 미리보기 패널에 열린 문서, 그리고 이번 턴에 Write 로 쓴 문서(마지막 것이 턴 끝에 열린다).
const previewFile = atom({ plugin: 'desk-look', key: 'preview' } as const, null as PreviewFile | null)
const previewWritten = atom({ plugin: 'desk-look', key: 'previewWritten' } as const, null as string | null)
const sessions = atom({ plugin: 'desk-look', key: 'sessions' } as const, [] as SessionEntry[])
const sessionQuery = atom({ plugin: 'desk-look', key: 'sessionQuery' } as const, '')
const liveSessions = atom({ plugin: 'desk-look', key: 'liveSessions' } as const, {} as Record<string, LiveSession>)
const turnStartedAt = atom({ plugin: 'desk-look', key: 'turnStartedAt' } as const, null as number | null)
// 진행 띠를 턴이 끝난 뒤에도 남겨 둔 동안, 그 턴이 끝난 시각. 닫거나(✕) bandAfterTurn 시간이 지나거나 새 턴이 시작되면 비운다.
const bandDoneAt = atom({ plugin: 'desk-look', key: 'bandDoneAt' } as const, null as number | null)
// 질문 카드 상태. ask.tsx 의 것과 같은 키다(상태 원본은 파일마다 선언해야 한다).
const asking = atom({ plugin: 'desk-look', key: 'ask' } as const, null as AskState | null)
// 계획 카드 상태(plan.ts, ask.tsx 의 것과 같은 키).
const planAsking = atom({ plugin: 'desk-look', key: 'planAsk' } as const, null as PlanAskState | null)
const promptOrigin = atom({ plugin: 'desk-look', key: 'promptOrigin' } as const, null as 'composer' | 'bridge' | null)
const tasks = atom({ plugin: 'desk-look', key: 'tasks' } as const, [] as TaskItem[])
const tick = atom({ plugin: 'desk-look', key: 'tick' } as const, 0)
// 메인 대화에 지금 서 있는 effort(turn.step 에서 effortInForce 로). 스피너 줄 끝에 단다.
const stepEffort = atom({ plugin: 'desk-look', key: 'stepEffort' } as const, null as Effort | null)
const IDLE_ACTIVITY: ActivityState = { calls: [], say: null, idleSince: null, proc: null, taskSince: {}, commands: 0, failed: 0, agents: 0 }
const turnActivity = atom({ plugin: 'desk-look', key: 'activity' } as const, IDLE_ACTIVITY)
const activityLog = atom({ plugin: 'desk-look', key: 'activityLog' } as const, null as ActivityLog | null)
// /desk-activity 패널을 다시 그리게 하는 시계(ms). 패널이 그려지고 무언가 돌 때만 ACTIVITY_TICK 마다 간다.
const activityClock = atom({ plugin: 'desk-look', key: 'activityClock' } as const, 0)
// /desk-activity 패널 몸통(머리 아래 줄)의 첫 줄. 끝(ACTIVITY_END)이면 늘어나는 줄을 따라간다.
// 머리(제목·막대·범례)를 늘 보이게 하려고 패널이 스스로 스크롤한다: ui.scroll 을 next 없이 받아 이 값을 옮긴다.
const activityTop = atom({ plugin: 'desk-look', key: 'activityTop' } as const, 0)
// /desk-activity 패널에서 호출을 펼친 에이전트(에이전트 줄을 누르면 펴고, 다시 누르면 접는다).
const activityAgentOpen = atom({ plugin: 'desk-look', key: 'activityAgentOpen' } as const, null as string | null)
const ACTIVITY_END = Number.MAX_SAFE_INTEGER
// 마지막으로 그린 몸통 창: pinned 면 머리를 고정해 그렸고, room 은 몸통에 보이는 줄 수, max 는 첫 줄의 끝.
let activityWindow = { pinned: false, room: 0, max: 0 }
// 패널 시계가 도는 동안 마지막으로 새로 읽어 그린 입력과 그 시각·시계 값(activity 패널 훅이 시계 사이에 다시 쓴다).
let activityFrame: { input: PaneInput; at: number; clockAt: number } | null = null
const usage = atom({ plugin: 'desk-look', key: 'usage' } as const, null as UsageInfo | null)
const usageBreakdown = atom({ plugin: 'desk-look', key: 'usageBreakdown' } as const, null as UsageBreakdown | null)
const pr = atom({ plugin: 'desk-look', key: 'pr' } as const, null as PrState | null)
// diff 줄 댓글: 쓰는 중인 것(고른 줄 범위)과 다음 프롬프트에 붙일 것. 쓰던 글은 draftText 에 둔다:
// atom 에 두면 글자마다 diff 패널 전체를 다시 그린다. 패널이 다시 그려질 때 입력칸 값으로 돌려준다.
const commentDraft = atom({ plugin: 'desk-look', key: 'commentDraft' } as const, null as CommentDraft | null)
const lineComments = atom({ plugin: 'desk-look', key: 'lineComments' } as const, [] as LineComment[])
let draftText = ''
// 입력칸 키 차례: 지우기를 누르면 늘려 빈 칸을 새로 그린다.
let draftRound = 0
const draftInputKey = (draft: CommentDraft) => `${draftKey(draft)}-${draftRound}`
// 패널마다 마지막 스크롤 위치(접을 때 적어 둔다)와, 다시 편 뒤 첫 스크롤에 되살릴 위치.
const paneOffsets = new Map<string, number>()
const restoreOffsets = new Map<string, number>()
// diff 패널이 마지막으로 그릴 때 본 접기 상태. 펴기 직후 스크롤은 펴진 그림이 그려진 뒤에 한다.
let diffDrawnFolds: Record<string, boolean> = {}
let commentSeq = 0
const diffView = atom({ plugin: 'desk-look', key: 'diffView' } as const, {
  scope: 'uncommitted',
  base: null,
  baseRef: null,
  bases: null,
  files: [],
  commits: [],
  commitFiles: {},
} as DiffView)
const diffGaps = atom({ plugin: 'desk-look', key: 'diffGaps' } as const, {} as Record<string, OpenedGaps>)
const diffFilter = atom({ plugin: 'desk-look', key: 'diffFilter' } as const, { isOpen: false, query: '' } as DiffFilter)
// diff 패널이 마지막으로 그린 파일 머리 띠(위에서부터): 접기 id 와 첫 행. n·p 이동에 쓴다.
let diffHeads: { id: string; top: number }[] = []
// n·p·머리 띠 누름이 마지막으로 스크롤해 간 파일. 사람이 창을 옮기면 잊는다.
let diffCursor: string | null = null

const agents = atom({ plugin: 'desk-look', key: 'agents' } as const, {} as Record<string, AgentRecord>)
const agentView = atom({ plugin: 'desk-look', key: 'agentView' } as const, null as string | null)
const agentDetail = atom({ plugin: 'desk-look', key: 'agentDetail' } as const, null as AgentDetail | null)
const agentClock = atom({ plugin: 'desk-look', key: 'agentClock' } as const, 0)
const taskOutput = atom({ plugin: 'desk-look', key: 'taskOutput' } as const, null as { id: string; text: string | null } | null)
// /desk-fold 로 접어 둔 패널. 펴면 비운다. 접은 동안은 내 패널이 없었어도 빈 목록이다(toggleFold).
const folded = atom({ plugin: 'desk-look', key: 'folded' } as const, null as FoldedPane[] | null)
// 아래턱 ✉ 칩을 누른 횟수. desk-slack 이 이 값의 state.set 을 훅해 Slack 패널을 연다.
const slackOpenCount = atom({ plugin: 'desk-look', key: 'slackOpen' } as const, 0)
// 지금 화면 언어. desk-asana·desk-slack 이 이 값을 따른다.
const lang = atom({ plugin: 'desk-look', key: 'lang' } as const, 'en' as Lang)
// 같은 마켓의 desk-asana·desk-slack 이 쓰는 값(읽기만): 접어 둔 패널, 이 세션에 떠 있는지, 안 읽은 Slack 메시지 수.
const asanaFolded = atom({ plugin: 'desk-asana', key: 'folded' } as const, null as FoldedPane[] | null)
const slackFolded = atom({ plugin: 'desk-slack', key: 'folded' } as const, null as FoldedPane[] | null)
const asanaReady = atom({ plugin: 'desk-asana', key: 'ready' } as const, false)
const slackReady = atom({ plugin: 'desk-slack', key: 'ready' } as const, false)
const slackUnread = atom({ plugin: 'desk-slack', key: 'unread' } as const, 0)
// desk-asana·desk-slack 의 패널이 지금 열려 있는지(그쪽이 ui.open·ui.close 로 맞춘다). /desk-fold 가 접을지 펼지 고른다.
const asanaShown = atom({ plugin: 'desk-asana', key: 'shown' } as const, false)
const slackShown = atom({ plugin: 'desk-slack', key: 'shown' } as const, false)

// 스피너 시계: 엔진은 모드가 바뀔 때만 Spinner 를 다시 그리므로 직접 tick 을 올려 다시 그리게 한다.
// 스피너가 사라지면(마지막으로 그린 지 2초가 지나면) 스스로 멈춘다.
const SPINNER_TICK = 500
// 답 글 블록째 보여주기: 마지막 블록을 내보낸 뒤 턴을 끝내기 전에 기다리는 시간(엔진의 글 묶음 100ms 보다 길게).
const GATHER_SETTLE_MS = 150
// /desk-update 가 답한 뒤 /reload-plugins 를 부르기까지(답 줄이 먼저 찍히게).
const RELOAD_AFTER_MS = 300
let ticker: Timer | null = null
const THEME_POLL = 3000
let themeWatch: Timer | null = null
let spinnerSeen = 0
let spinnerFallbackStart = 0

// 스트림이 막 엔진에 넘긴 도구 호출: 기록(session.append)에 나오기 전까지 묶음에 미리 넣어 둔다.
let runCursor: RunCursor = null
// 턴 도중에 끼워 넣은 입력이 다음 메인 단계에 실리는지: 그 단계에서 effort 가 새로 선다(effortInForce).
let inputIntoTurn = false
// 컨텍스트 패널의 세션 흐름. 패널을 닫아 둬도 쌓이지만 따로 묻거나 그리지 않는다:
// 메인 턴이 끝날 때 칩을 위해 이미 읽은 값을 메모리에 한 점 적을 뿐이다(상태에 쓰지 않으니 다시 그리는 것도 없다).
// 플러그인을 다시 올리면 비고, 창 안에서 세션을 바꾸면 refreshSessionState 가 비운다.
const CONTEXT_POINTS = 400
const CONTEXT_COMPACTIONS = 50
let contextPoints: ContextPoint[] = []
let contextCompactions: ContextCompaction[] = []
let predicted: PredictedCall[] = []
// 진행 띠가 Bash 가 띄운 프로세스를 읽는 시계와 직전 표본. claudePid 는 /proc/self/stat 에서 한 번 읽고,
// /proc 이 없으면(macOS) null 로 두어 다시 읽지 않는다.
let procTimer: Timer | null = null
let procSample: ProcSample | null = null
let claudePid: number | null | undefined
// 시작했지만 아직 메인 작업(도구 호출·호출 앞 설명)이 없는 턴의 시작 시각. /desk-activity 기록은 첫 메인 작업이 올 때
// 이 턴으로 바꾼다: 그 전에는 지난 턴을 그대로 보이고, 글로만 답한 턴이나 백그라운드 끝남 알림 턴은 기록을 건드리지 않는다.
let pendingLogStart: number | null = null
// 패널 시계: 막대와 시간은 2초 단위면 충분하다(스피너처럼 초당 두 번 그리면 턴 중 비용이 크게 는다).
const ACTIVITY_TICK = 2000
let activityTimer: Timer | null = null
let activitySeen = 0
// 엔진이 백그라운드 안내("(ctrl+b to run in background)")를 띄운 호출과 그 글. 스피너 줄 끝에 단다.
const backgroundHints = new Map<string, string>()

const FILE_EDITING = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const CARD_ROWS = 3
// 턴 기록은 최근 60턴, 복사할 답변은 턴마다 5만 자까지만 둔다.
const TURN_CARDS = 60
const MAX_COPY = 50_000

// 같은 파일을 여러 번 고치면 한 줄로 합친다.
export function mergeEdit(list: TurnEdit[], edit: TurnEdit): TurnEdit[] {
  const index = list.findIndex(item => item.path === edit.path)
  if (index === -1) return [...list, edit]
  return list.map((item, at) =>
    at === index ? { ...item, added: item.added + edit.added, removed: item.removed + edit.removed } : item,
  )
}


const lastLine = (text: string) => text.trim().split('\n').pop() ?? ''

// `claude plugin update --json` 의 결과 한 줄을 사람에게 보일 문장으로.
function updateResult(stdout: string): { outcome?: string; updateOutcome?: string; oldVersion?: string; newVersion?: string; message?: string } | null {
  try {
    return JSON.parse(lastLine(stdout))
  } catch {
    return null
  }
}

// 새 버전을 받았는지: 그때만 플러그인을 다시 불러온다.
export function isUpdated(exitCode: number, stdout: string): boolean {
  const result = updateResult(stdout)
  return exitCode === 0 && result?.outcome === 'ok' && result.updateOutcome !== 'up_to_date'
}

export function updateMessage(exitCode: number, stdout: string, stderr: string): string {
  const result = updateResult(stdout)
  if (exitCode !== 0 || result?.outcome !== 'ok') return T.updateFailed(result?.message ?? lastLine(stderr || stdout))
  if (result.updateOutcome === 'up_to_date') return T.updateLatest(result.newVersion ?? '')
  return T.updateDone(result.oldVersion ?? '', result.newVersion ?? '')
}

// desk-asana·desk-slack 을 올렸을 때만 한 줄. 최신이거나 설치하지 않아 실패했으면 null.
export function siblingUpdate(name: string, exitCode: number, stdout: string): string | null {
  if (!isUpdated(exitCode, stdout)) return null
  const result = updateResult(stdout)
  return T.siblingUpdated(name, result?.oldVersion ?? '', result?.newVersion ?? '')
}

// 세션 편집: 파일별로 합치고 헌크는 편집 순서대로 붙인다. 최근 파일 SESSION_FILES 개, 파일마다 헌크 SESSION_PATCHES 개까지.
const SESSION_FILES = 50
const SESSION_PATCHES = 20

export function mergeSessionEdit(list: SessionEdit[], edit: SessionEdit): SessionEdit[] {
  const old = list.find(item => item.path === edit.path)
  const merged = old
    ? { path: edit.path, added: old.added + edit.added, removed: old.removed + edit.removed, patches: [...old.patches, ...edit.patches].slice(-SESSION_PATCHES) }
    : edit
  return [...list.filter(item => item.path !== edit.path), merged].slice(-SESSION_FILES)
}

// 대화 기록(runs)의 성공한 편집 도구 호출을 파일별로 모은다. 기록에서 다시 계산하므로 재시작·resume 뒤에도 남는다.
export function sessionEditsOf(state: Runs): SessionEdit[] {
  let list: SessionEdit[] = []
  for (const call of Object.values(state.calls).flat()) {
    if (!FILE_EDITING.has(call.tool) || call.isRunning) continue
    const fields = fieldsOf(call.input)
    const path = stringField(fields, 'file_path') ?? stringField(fields, 'notebook_path')
    const stat = diffStat(call)
    if (path && stat) list = mergeSessionEdit(list, { path, ...stat, patches: editPatches(call.tool, call.input, call.output) })
  }
  return list
}

// diff 패널에 git 대신 세션 기록으로 보일 편집: git diff 가 잡지 못하는 저장소 밖(또는 저장소가 아닌 곳) 파일과
// 저장소 안이지만 git 이 무시하는 파일(.gitignore). 그 밖의 저장소 안 파일은 git 이 정본이다(커밋했으면 패널에서 빠지는 게 맞다).
export function outsideEdits(edits: ReadonlyArray<SessionEdit>, info: RepoInfo | null): SessionEdit[] {
  if (info?.isRepo !== true) return [...edits]
  const root = info.root
  const ignored = new Set(info.ignored ?? [])
  return root ? edits.filter(edit => !edit.path.startsWith(`${root}/`) || ignored.has(edit.path)) : []
}

// 소요 시간 줄과 턴 기록을 durationMs 로 짝짓는다. 둘이 같은 값을 재지만 반올림 차이를 1초까지 봐준다.
export function cardFor(cards: ReadonlyArray<TurnCard>, durationMs: number): TurnCard | undefined {
  let best: TurnCard | undefined
  for (const card of cards) {
    const gap = Math.abs(card.durationMs - durationMs)
    if (gap <= 1000 && (best === undefined || gap < Math.abs(best.durationMs - durationMs))) best = card
  }
  return best
}

const EDITING_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'Bash'])

type Call = Pick<ToolGroupCall, 'tool' | 'input' | 'isRunning' | 'isErrored' | 'isInterrupted' | 'output'>

type Category = 'command' | 'read' | 'edit' | 'create' | 'search' | 'web' | 'agent' | 'todo' | 'ask' | 'other'

const CATEGORY_OF: Record<string, Category> = {
  Bash: 'command',
  BashOutput: 'command',
  KillShell: 'command',
  PowerShell: 'command',
  Read: 'read',
  NotebookRead: 'read',
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Write: 'create',
  Grep: 'search',
  Glob: 'search',
  LS: 'search',
  ToolSearch: 'search',
  WebFetch: 'web',
  WebSearch: 'web',
  Agent: 'agent',
  Task: 'agent',
  TodoWrite: 'todo',
  TaskCreate: 'todo',
  TaskUpdate: 'todo',
  TaskList: 'todo',
  AskUserQuestion: 'ask',
}

// 데스크톱의 "Ran 2 commands, created a file, edited 3 files, and 3 more actions" 문구.
const PHRASES: Record<Category, [string, (count: number) => string]> = {
  command: ['ran a command', count => `ran ${count} commands`],
  read: ['read a file', count => `read ${count} files`],
  edit: ['edited a file', count => `edited ${count} files`],
  create: ['created a file', count => `created ${count} files`],
  search: ['searched', count => `searched ${count} times`],
  web: ['fetched a page', count => `fetched ${count} pages`],
  agent: ['ran an agent', count => `ran ${count} agents`],
  todo: ['updated todos', () => 'updated todos'],
  ask: ['asked a question', count => `asked ${count} questions`],
  other: ['used a tool', count => `used ${count} tools`],
}

const VERB: Record<Category, string> = {
  command: 'Ran',
  read: 'Read',
  edit: 'Edited',
  create: 'Created',
  search: 'Searched',
  web: 'Fetched',
  agent: 'Agent',
  todo: 'Updated todos',
  ask: 'Asked',
  other: 'Used',
}

const categoryOf = (tool: string): Category => CATEGORY_OF[tool] ?? 'other'

export function describeCalls(calls: ReadonlyArray<Call>): string {
  const counts = new Map<Category, number>()
  for (const call of calls) {
    const category = categoryOf(call.tool)
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  const entries = [...counts]
  const phrase = ([category, count]: [Category, number]) =>
    count === 1 ? PHRASES[category][0] : PHRASES[category][1](count)
  const shown = entries.slice(0, 3).map(phrase)
  const rest = entries.slice(3).reduce((sum, [, count]) => sum + count, 0)
  const text = rest > 0 ? `${shown.join(', ')}, and ${rest} more action${rest === 1 ? '' : 's'}` : shown.join(', ')
  const failed = calls.filter(call => call.isErrored).length
  return text.charAt(0).toUpperCase() + text.slice(1) + (failed > 0 ? ` (${failed} failed)` : '')
}

const fieldsOf = (input: unknown): Record<string, unknown> =>
  typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}

const stringField = (fields: Record<string, unknown>, key: string) =>
  typeof fields[key] === 'string' ? (fields[key] as string) : undefined

// 동사 옆에 붙는 회색 대상: 파일명, 명령, 패턴, URL.
export function summarize(tool: string, input: unknown): string {
  const fields = fieldsOf(input)
  const path = stringField(fields, 'file_path') ?? stringField(fields, 'notebook_path') ?? stringField(fields, 'path')
  const questions = Array.isArray(fields.questions) ? fields.questions.map(fieldsOf) : []
  const summary =
    (tool === 'Bash' ? stringField(fields, 'command') : undefined) ??
    (tool === 'AskUserQuestion' ? stringField(questions[0] ?? {}, 'question') : undefined) ??
    (path ? path.split('/').pop() : undefined) ??
    stringField(fields, 'pattern') ??
    stringField(fields, 'url') ??
    stringField(fields, 'query') ??
    stringField(fields, 'description') ??
    stringField(fields, 'prompt') ??
    Object.values(fields).find((value): value is string => typeof value === 'string') ??
    ''
  return summary.split('\n')[0] ?? ''
}

// 질문 도구의 답: 결과의 answers 값들. 없으면 null.
export function askAnswer(output: unknown): string | null {
  let value = output
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  const answers = fieldsOf(fieldsOf(value).answers)
  const list = Object.values(answers).filter((answer): answer is string => typeof answer === 'string' && answer !== '')
  return list.length > 0 ? list.join(' · ') : null
}

function verbOf(tool: string): string {
  if (tool === PREVIEW_TOOL) return 'Previewed'
  const category = categoryOf(tool)
  if (category !== 'other') return VERB[category]
  // mcp__server__tool → tool
  return `Used ${tool.startsWith('mcp__') ? (tool.split('__').pop() ?? tool) : tool}`
}

// 끝 줄바꿈은 줄을 하나 더 만들지 않는다('a\nb\n' 은 2줄).
const lineCount = (text: unknown) => (typeof text === 'string' ? linesOf(text.replace(/\n$/, '')).length : 0)

// 앞뒤로 같은 줄 수. 편집은 old_string 에 문맥 줄을 함께 넣으니 그 줄은 바뀐 것으로 치지 않는다.
function commonEnds(before: string[], after: string[]): { head: number; tail: number } {
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head++
  let tail = 0
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++
  return { head, tail }
}

const linesOf = (text: string) => (text === '' ? [] : text.split('\n'))

// Edit 의 old/new 는 바꾼 줄 앞뒤 문맥 줄을 함께 담는다. 앞뒤 공통 줄을 걷어내고 남은 줄만 센다.
export function lineChange(oldText: string, newText: string): { added: number; removed: number } {
  const before = linesOf(oldText)
  const after = linesOf(newText)
  const { head, tail } = commonEnds(before, after)
  return { added: after.length - head - tail, removed: before.length - head - tail }
}

// 편집 도구의 +/− 줄 수: 데스크톱의 초록·빨강 칩.
export function diffStat(call: Call): { added: number; removed: number } | null {
  if (call.isErrored || call.isInterrupted) return null
  const fields = fieldsOf(call.input)
  switch (call.tool) {
    case 'Edit':
      return lineChange(stringField(fields, 'old_string') ?? '', stringField(fields, 'new_string') ?? '')
    case 'MultiEdit': {
      const edits = Array.isArray(fields.edits) ? fields.edits.map(fieldsOf) : []
      const changes = edits.map(edit => lineChange(stringField(edit, 'old_string') ?? '', stringField(edit, 'new_string') ?? ''))
      return {
        added: changes.reduce((sum, change) => sum + change.added, 0),
        removed: changes.reduce((sum, change) => sum + change.removed, 0),
      }
    }
    case 'Write': {
      // 있던 파일을 덮어쓰면 결과에 헌크가 온다. 새 파일은 헌크가 비어 내용 줄 수를 쓴다.
      const hunks = (call.output as { structuredPatch?: unknown } | null | undefined)?.structuredPatch
      if (Array.isArray(hunks) && hunks.length > 0) {
        const lines = hunks.flatMap(hunk => (hunk as { lines?: unknown }).lines).filter((line): line is string => typeof line === 'string')
        return { added: lines.filter(line => line.startsWith('+')).length, removed: lines.filter(line => line.startsWith('-')).length }
      }
      return { added: lineCount(fields.content), removed: 0 }
    }
    case 'NotebookEdit':
      return { added: lineCount(fields.new_source), removed: 0 }
    default:
      return null
  }
}

export function outputText(output: unknown): string {
  if (output === undefined || output === null) return ''
  if (typeof output === 'string') return output
  const fields = fieldsOf(output)
  const stdout = stringField(fields, 'stdout')
  if (stdout !== undefined) return [stdout, stringField(fields, 'stderr') ?? ''].filter(Boolean).join('\n')
  const file = fieldsOf(fields.file)
  const content = stringField(file, 'content') ?? stringField(fields, 'content')
  if (content !== undefined) return content
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

function cap(text: string, lines: number): string {
  const all = text.replace(/\s+$/, '').split('\n')
  return all.length <= lines ? all.join('\n') : `${all.slice(0, lines).join('\n')}\n${T.moreLines(all.length - lines)}`
}

// Edit·MultiEdit 결과의 structuredPatch: 파일 기준 줄 번호와 앞뒤 문맥이 붙은 헌크. 없으면 null.
export function patchOf(output: unknown): string | null {
  const hunks = (output as { structuredPatch?: unknown } | null | undefined)?.structuredPatch
  if (!Array.isArray(hunks) || hunks.length === 0) return null
  return hunks
    .map(hunk => {
      const part = hunk as { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }
      return [`@@ -${part.oldStart},${part.oldLines} +${part.newStart},${part.newLines} @@`, ...part.lines].join('\n')
    })
    .join('\n')
}

// 성공한 편집 도구 호출의 헌크들: 결과의 structuredPatch, 없으면 입력에서 만든다(새로 쓴 파일은 전부 +).
export function editPatches(tool: string, input: unknown, result: unknown): string[] {
  const fromResult = patchOf(result)
  if (fromResult) return [fromResult]
  const fields = fieldsOf(input)
  switch (tool) {
    case 'Edit':
      return [editHunk(stringField(fields, 'old_string') ?? '', stringField(fields, 'new_string') ?? '')]
    case 'MultiEdit':
      return (Array.isArray(fields.edits) ? fields.edits.map(fieldsOf) : []).map(edit =>
        editHunk(stringField(edit, 'old_string') ?? '', stringField(edit, 'new_string') ?? ''),
      )
    case 'Write': {
      const lines = linesOf((stringField(fields, 'content') ?? '').replace(/\n$/, ''))
      return lines.length === 0 ? [] : [[`@@ -0,0 +1,${lines.length} @@`, ...lines.map(line => `+${line}`)].join('\n')]
    }
    default:
      return []
  }
}

// 편집 하나를 diff 헌크로(결과에 헌크가 없을 때): 바뀐 줄만 −/+, 앞뒤 같은 줄은 문맥으로 두 줄까지.
export function editHunk(oldText: string, newText: string, context = 2): string {
  const before = linesOf(oldText)
  const after = linesOf(newText)
  const { head, tail } = commonEnds(before, after)
  const lead = before.slice(Math.max(0, head - context), head)
  const trail = before.slice(before.length - tail, before.length - tail + context)
  const removed = before.slice(head, before.length - tail)
  const added = after.slice(head, after.length - tail)
  const start = head - lead.length + 1
  return [
    `@@ -${start},${lead.length + removed.length + trail.length} +${start},${lead.length + added.length + trail.length} @@`,
    ...lead.map(line => ` ${line}`),
    ...removed.map(line => `-${line}`),
    ...added.map(line => `+${line}`),
    ...trail.map(line => ` ${line}`),
  ].join('\n')
}

// 패널이 그릴 diff 만 상태에 둔다. 엔진은 atom 값 하나를 4 MiB 글자로 묶어 넘으면 $.state.set 이 던지고,
// 한 번 그리는 글자도 10만 자에서 자른다. 한 줄이 아주 긴 파일(빌드 결과물·minified)이나 아주 큰 파일은 내용을
// 비우고 +/− 수만 남긴다. clara-apm 의 3.8 MB 번들 커밋이 브랜치 diff 와 함께 7.6 M 자가 되어 커밋 줄이 안 펴졌다.
const PATCH_LINE_MAX = 2000
const PATCH_MAX = 200_000
// atom 하나에 넣는 diff 내용의 합계. 4 MiB 에서 경로·커밋 목록 몫을 남긴다.
const PATCHES_MAX = 3_000_000

// `git diff` 출력을 파일 단위로 나눈다. Code format: 'diff' 는 @@ 헌크부터 받는다.
export function parseDiff(text: string, isNew = false): FileDiff[] {
  const files: FileDiff[] = []
  for (const chunk of text.split(/^diff --git /m).slice(1)) {
    const lines = chunk.split('\n')
    const header = lines[0] ?? ''
    const path = header.replace(/^a\/.* b\/(.*)$/, '$1')
    const firstHunk = lines.findIndex(line => line.startsWith('@@'))
    const hunks = firstHunk === -1 ? [] : lines.slice(firstHunk)
    const patch = hunks.join('\n').trimEnd()
    const file = {
      path,
      added: hunks.filter(line => line.startsWith('+')).length,
      removed: hunks.filter(line => line.startsWith('-')).length,
      patch,
      isNew,
    }
    files.push(patch.length > PATCH_MAX || hunks.some(line => line.length > PATCH_LINE_MAX) ? { ...file, patch: '', large: true } : file)
  }
  return files
}

// 한 atom 에 함께 들어갈 diff 묶음들을 합계 안으로 줄인다: 큰 파일부터 내용을 비운다. 묶음 모양은 그대로.
export function fitDiffs(groups: FileDiff[][], room = PATCHES_MAX): FileDiff[][] {
  const sized = groups.flat().map(file => ({ file, size: JSON.stringify(file.patch).length }))
  let total = sized.reduce((sum, entry) => sum + entry.size, 0)
  const dropped = new Set<FileDiff>()
  for (const entry of sized.sort((a, b) => b.size - a.size)) {
    if (total <= room) break
    dropped.add(entry.file)
    total -= entry.size
  }
  return dropped.size === 0 ? groups : groups.map(files => files.map(file => (dropped.has(file) ? { ...file, patch: '', large: true } : file)))
}

// 브랜치 전체와 펼친 커밋들은 diffView 한 atom 에 산다.
export function fitView(view: DiffView): DiffView {
  const shas = Object.keys(view.commitFiles)
  const [files = [], ...commits] = fitDiffs([view.files, ...shas.map(sha => view.commitFiles[sha] ?? [])])
  return { ...view, files, commitFiles: Object.fromEntries(shas.map((sha, index) => [sha, commits[index] ?? []])) }
}

// 사용자 git 설정(diff.mnemonicPrefix·noprefix)과 상관없이 머리말을 a/ b/ 로 고정해 경로를 읽는다.
// git 을 부르는 자리마다 명령 전체를 고정 글자로 쓴다(디렉터리 검사가 무엇을 실행하는지 끝까지 읽게). diff 는 늘
// --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ 로 같은 모양을 받는다. 길이가 변하는 목록(경로·커밋)은 stdin 으로.

// update 는 fn 이 같은 값을 돌려줘도 늘 써서 판을 올리고, 그 atom 을 읽는 그림을 모두 다시 그린다.
// 다시 읽어 온 값은 먼저 read 로 견주고 바뀔 때만 쓴다(대기 중 테마를 3초마다 읽을 때 화면 전체를 다시 그리던 것).
// 엔진 검사가 read·update 의 atom 을 호출 자리에서 찾아서 함수로 묶지 못한다.
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// 컨텍스트 칩의 숫자: 인자 없는 usage() 는 상태 줄의 값이라 공짜다. 턴이 끝날 때마다 다시 읽는다.
// 메인 턴이 끝나서 읽을 때(ended)는 읽은 값을 세션 흐름에 한 점 더한다.
async function refreshUsage($: EngineInterface, ended?: { usage?: ModelUsage }) {
  const [raw, now] = await Promise.all([$.session.usage(), $.clock.now()])
  const next = toUsage(raw, now)
  if (ended) contextPoints = [...contextPoints, { at: now, tokens: next.tokens, percent: next.percent, costUsd: next.costUsd, turn: splitOf(ended.usage) }].slice(-CONTEXT_POINTS)
  if (!sameJson({ ...(await read($, usage)), at: 0 }, { ...next, at: 0 })) await update($, usage, () => next)
}

// 패널을 열 때만 항목별 내역을 계산한다. summary 는 로컬 추정이라 API 요청이 없다(full 은 도구마다 요청).
// 내역을 칩 값보다 먼저 쓴다: 칩 값이 먼저 바뀌면 그 사이 그림이 내역을 오래됐다고 보고 한 번 더 계산했다.
// 열기·↻·그림이 함께 부르면 도는 계산 하나를 나눠 받는다.
let breakdownRun: Promise<void> | null = null
function refreshBreakdown($: EngineInterface): Promise<void> {
  breakdownRun ??= (async () => {
    const [raw, now] = await Promise.all([$.session.usage({ breakdown: 'summary' }), $.clock.now()])
    await update($, usageBreakdown, () => toBreakdown(raw, now))
    // 칩 값은 바뀌었을 때만 쓴다: 같은 값을 다시 쓰면 패널과 아래턱이 한 번 더 그려진다.
    const next = toUsage(raw, now)
    if (!sameJson({ ...(await read($, usage)), at: 0 }, { ...next, at: 0 })) await update($, usage, () => next)
  })().finally(() => {
    breakdownRun = null
  })
  return breakdownRun
}

// 2.1.311 Pane backgroundColor: omarchy 테마를 읽을 수 있으면 desk 패널 바탕을 말풍선 회색으로.
// 엔진 테마 키에는 바탕용 키가 없어, 테마를 못 읽으면 기본 그림 그대로 둔다.
async function paneLook($: EngineInterface): Promise<{ backgroundColor?: string }> {
  const face = await read($, surface).catch(() => null)
  return face ? { backgroundColor: face.bubble } : {}
}

async function openContext($: EngineInterface) {
  await refreshBreakdown($).catch(() => undefined)
  await $.ui.open({ ...(await paneLook($)), id: CONTEXT_PANE, title: T.paneContext, focus: true })
}

// 줄 전체가 눌리는 버튼: 라벨 뒤에 칩·흐린 설명(Text)을 함께 넣는다.
type RowButtonProps = { key: string; dimColor?: boolean; hotkey?: string; hover?: TextHoverProps; onPress: (press: UiPressArgument) => void }

function rowButton(els: Els, props: RowButtonProps, label: string, ...rest: unknown[]) {
  const { Button } = els
  const parts = rest.filter(part => part !== null && part !== undefined && part !== false && part !== '')
  return (
    <Button plain {...props}>
      {label}
      {parts as never}
    </Button>
  )
}

// 막대 덩어리(barRuns)를 한 줄 안의 Text 로. 색이 없는 덩어리는 빈칸이다.
function barTexts(els: Els, key: string, runs: ReadonlyArray<BarRun>) {
  const { Text } = els
  return runs.map((run, index) => (
    <Text key={`${key}-${index}`} {...(run.color ? { color: run.color as never } : {})} {...(run.background ? { backgroundColor: run.background as never } : {})}>
      {run.text}
    </Text>
  ))
}

// 컨텍스트 막대의 조각: 쓰는 항목(엔진이 /context 에 칠하는 색), 남은 자리(옅은 선 ─), 압축 여유분(┄).
// 내역을 아직 못 읽었으면 칩의 % 하나로.
function windowParts(detail: UsageBreakdown | null, percent: number): BarPart[] {
  if (!detail) return [{ value: Math.min(100, percent), color: COLORS.clay }, { value: Math.max(0, 100 - percent), color: COLORS.border, glyph: '─' }]
  const of = (kind: string) => detail.categories.filter(category => category.kind === kind)
  return [
    ...of('used').map(category => ({ value: category.tokens, color: category.color })),
    ...of('free').map(category => ({ value: category.tokens, color: COLORS.border, glyph: '─' })),
    ...of('buffer').map(category => ({ value: category.tokens, color: COLORS.muted, glyph: '┄' })),
  ]
}

// 항목별 내역: 표시·이름·가로 막대(가장 큰 항목이 꽉 찬 길이)·토큰·창에서 차지하는 몫. 남은 자리와 압축 여유분은 막대 없이.
function categoryRows(els: Els, detail: UsageBreakdown, columns: number) {
  const { Box, Text } = els
  const order = ['used', 'free', 'buffer']
  const rows = [...detail.categories].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
  const nameWidth = Math.min(20, Math.max(0, ...rows.map(row => cellWidth(row.name))))
  const barWidth = Math.min(20, columns - nameWidth - 16)
  const top = Math.max(1, ...rows.filter(row => row.kind === 'used').map(row => row.tokens))
  return (
    <Box flexDirection="column">
      <Text color={COLORS.muted}>{T.breakdown(detail.model)}</Text>
      {rows.map(row => {
        const isUsed = row.kind === 'used'
        const share = detail.max > 0 ? Math.round((row.tokens / detail.max) * 100) : 0
        return (
          <Box key={`cat-${row.name}`} columnGap={1}>
            <Text color={(isUsed ? row.color : COLORS.muted) as never}>{row.kind === 'free' ? '─' : row.kind === 'buffer' ? '┄' : '■'}</Text>
            <Text color={isUsed ? COLORS.text : COLORS.muted}>{padCells(clip(row.name, nameWidth), nameWidth)}</Text>
            {barWidth >= 4 && <Text>{isUsed ? (barTexts(els, `cat-bar-${row.name}`, barRuns([{ value: row.tokens, color: row.color }], top, barWidth)) as never) : ' '.repeat(barWidth)}</Text>}
            <Text color={COLORS.muted}>{formatTokens(row.tokens).padStart(6)}</Text>
            <Text color={COLORS.muted}>{`${share}%`.padStart(4)}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

// 컨텍스트에 실린 것: MCP 서버, 메모리 파일, 스킬, 커스텀 에이전트. 묶음마다 접혀 있고 누르면 펼친다.
// 묶음 토큰은 목록에서 더한 값이라 위 항목별 줄과 조금 다를 수 있다(둘 다 추정). 이름으로 항목 줄을 찾지 않는다.
const LOADED_ROWS = 8
type LoadedRow = { key: string; name: string; note?: string; tokens: number }

function loadedGroups(els: Els, $: EngineInterface, detail: UsageBreakdown, openState: Record<string, boolean>, columns: number, home: string | undefined) {
  const { Box, Text } = els
  const servers = detail.mcpServers ?? []
  const files = detail.memoryFiles ?? []
  const skills = detail.skills ?? null
  const agentList = detail.agents ?? []
  const sum = (list: ReadonlyArray<{ tokens: number }>) => list.reduce((total, item) => total + item.tokens, 0)
  const tilde = (path: string) => (home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path)
  const groups: Array<{ id: string; label: string; tokens: number; rows: LoadedRow[] }> = [
    ...(servers.length > 0
      ? [{ id: 'mcp', label: T.loadedMcp(servers.reduce((total, server) => total + server.tools, 0), servers.length, servers.reduce((total, server) => total + server.onDemand, 0)), tokens: sum(servers), rows: servers.map(server => ({ key: server.name, name: server.name, note: T.mcpServer(server.tools, server.onDemand), tokens: server.tokens })) }]
      : []),
    ...(files.length > 0 ? [{ id: 'memory', label: T.loadedMemory(files.length), tokens: sum(files), rows: files.map(file => ({ key: file.path, name: file.type, note: tilde(file.path), tokens: file.tokens })) }] : []),
    ...(skills && skills.total > 0 ? [{ id: 'skills', label: T.loadedSkills(skills.included, skills.total), tokens: skills.tokens, rows: skills.list.map(skill => ({ key: skill.name, name: skill.name, tokens: skill.tokens })) }] : []),
    ...(agentList.length > 0 ? [{ id: 'agents', label: T.loadedAgents(agentList.length), tokens: sum(agentList), rows: agentList.map(agent => ({ key: agent.name, name: agent.name, tokens: agent.tokens })) }] : []),
  ]
  if (groups.length === 0) return null
  return (
    <Box flexDirection="column">
      <Text color={COLORS.muted}>{T.loadedTitle}</Text>
      {groups.map(group => {
        const isOpen = openState[`context:${group.id}`] ?? false
        return (
          <Box key={`loaded-${group.id}`} flexDirection="column">
            <Box>
              <Box flexGrow={1} flexShrink={1} overflow="hidden">
                {rowButton(els, { key: `context-group-${group.id}`, onPress: () => void toggle($, `context:${group.id}`) }, isOpen ? '⌄ ' : '› ', <Text color={COLORS.text}>{clip(group.label, columns - 10)}</Text>)}
              </Box>
              {group.tokens > 0 && <Text color={COLORS.muted}>{formatTokens(group.tokens).padStart(7)}</Text>}
            </Box>
            {isOpen &&
              group.rows.slice(0, LOADED_ROWS).map(row => (
                <Box key={`loaded-${group.id}-${row.key}`}>
                  <Box flexGrow={1} flexShrink={1} overflow="hidden" columnGap={1} paddingLeft={2}>
                    <Text color={COLORS.text} wrap="truncate-end">
                      {row.name}
                    </Text>
                    {row.note && (
                      <Text color={COLORS.muted} wrap="truncate-middle">
                        {row.note}
                      </Text>
                    )}
                  </Box>
                  {row.tokens > 0 && <Text color={COLORS.muted}>{formatTokens(row.tokens).padStart(7)}</Text>}
                </Box>
              ))}
            {isOpen && group.rows.length > LOADED_ROWS && <Text color={COLORS.muted}>{`  ${T.moreItems(group.rows.length - LOADED_ROWS)}`}</Text>}
          </Box>
        )
      })}
    </Box>
  )
}

// 이 세션의 흐름: 턴이 끝날 때마다의 채움 그래프(┈ 자동 압축 높이, ▲ 압축), 캐시(지난 턴·기록된 턴), 턴마다 비용.
// 모두 턴 끝에 이미 읽은 값이라 턴마다 바뀌어도 따로 묻지 않는다.
// 다시 올린 뒤나 /resume 뒤에는 그때부터 쌓으니 제목에 시작 시각을 단다.
const CHART_ROWS = 4
const CHART_GUTTER = 5

function sessionFlow(els: Els, live: UsageInfo | null, detail: UsageBreakdown | null, columns: number) {
  const { Box, Text } = els
  const points = contextPoints
  const first = points[0]
  const last = points[points.length - 1]
  const marks = compactionPoints(points, contextCompactions)
  const width = Math.max(8, columns - CHART_GUTTER)
  const values = points.map(point => (point.percent === null ? null : Math.min(100, point.percent)))
  const chart = chartColumns(values, width)
  const top = chartTop(values)
  const compactPercent = live && detail?.compactAt != null && live.window > 0 ? (detail.compactAt / live.window) * 100 : null
  const guide = compactPercent !== null && compactPercent <= top ? compactPercent : null
  const levelColor = { muted: COLORS.clay, warning: COLORS.warning, danger: COLORS.danger, fill: COLORS.border, guide: COLORS.border, empty: null } as const
  const markerLine = marks.length > 0 ? chart.map((_, column) => (marks.some(index => columnOf(index, points.length, width) === column) ? '▲' : ' ')).join('') : null
  const timeLine = first && last && points.length > 1 ? hhmm(first.at) + ' '.repeat(Math.max(1, width - 10)) + hhmm(last.at) : null
  const turns = points.flatMap(point => (point.turn ? [point.turn] : []))
  const lastTurn = turns[turns.length - 1]
  const lastShare = lastTurn ? cacheShares(lastTurn) : null
  const turnShare = turns.length > 1 ? cacheShares(sumSplits(turns)) : null
  const costs = turnCosts(points)
  const labelWidth = Math.max(cellWidth(T.cacheTitle), cellWidth(T.costTitle))
  const sparkWidth = Math.max(4, Math.min(24, columns - labelWidth - 32))
  const lastCost = costs[costs.length - 1]
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="column">
        <Text color={COLORS.muted}>{first ? [T.sessionFlow(hhmm(first.at), points.length), marks.length > 0 ? T.compactions(marks.length) : null].filter(Boolean).join(' · ') : T.flowEmpty}</Text>
        {first &&
          chartRows(chart, CHART_ROWS, top, guide).map((runs, row) => (
            <Text key={`flow-row-${row}`}>
              <Text color={COLORS.muted}>{`${(row === 0 ? `${top}%` : row === CHART_ROWS - 1 ? '0%' : '').padStart(CHART_GUTTER - 1)}│`}</Text>
              {runs.map((run, index) => {
                const color = levelColor[run.level]
                return (
                  <Text key={`flow-${row}-${index}`} {...(color ? { color } : {})}>
                    {run.text}
                  </Text>
                )
              })}
            </Text>
          ))}
        {markerLine && <Text color={COLORS.warning}>{' '.repeat(CHART_GUTTER) + markerLine}</Text>}
        {timeLine && <Text color={COLORS.muted}>{' '.repeat(CHART_GUTTER) + timeLine}</Text>}
      </Box>
      {(lastShare || live?.costUsd != null) && (
        <Box flexDirection="column">
          {lastShare && (
            <Box columnGap={1}>
              <Text color={COLORS.muted}>{padCells(T.cacheTitle, labelWidth)}</Text>
              <Text>
                {
                  barTexts(
                    els,
                    'cache-bar',
                    barRuns(
                      [
                        { value: lastShare.read, color: COLORS.success },
                        { value: lastShare.write, color: COLORS.link },
                        { value: lastShare.fresh, color: COLORS.border },
                      ],
                      100,
                      10,
                    ),
                  ) as never
                }
              </Text>
              <Text color={COLORS.muted}>{T.cacheLast(lastShare.read, lastShare.write, lastShare.fresh)}</Text>
            </Box>
          )}
          {lastShare && turnShare && <Text color={COLORS.muted}>{' '.repeat(labelWidth + 12) + T.cacheTurns(turnShare.read, turns.length)}</Text>}
          {live?.costUsd != null && (
            <Box columnGap={1}>
              <Text color={COLORS.muted}>{padCells(T.costTitle, labelWidth)}</Text>
              <Text color={COLORS.text}>{`$${live.costUsd.toFixed(2)}`}</Text>
              {costs.length >= 2 && <Text color={COLORS.clay}>{sparkline(costs.slice(-sparkWidth))}</Text>}
              {costs.length >= 2 && <Text color={COLORS.muted}>{T.costPerTurn}</Text>}
              {lastCost !== undefined && <Text color={COLORS.muted}>{`· ${T.costLast(lastCost.toFixed(2))}`}</Text>}
            </Box>
          )}
        </Box>
      )}
    </Box>
  )
}

// 사용 한도: 이름·가는 막대(━ 쓴 몫, ─ 남은 몫)·%·초기화까지.
const LIMIT_BAR = 14

function limitRows(els: Els, live: UsageInfo) {
  const { Box, Text } = els
  const nameWidth = Math.max(...live.limits.map(limit => cellWidth(limitName(limit.kind))))
  return (
    <Box flexDirection="column">
      <Text color={COLORS.muted}>{T.limits}</Text>
      {live.limits.map(limit => {
        const left = resetIn(limit.resetsAt, live.at)
        const level = meterLevel(limit.percentUsed)
        const filled = Math.min(LIMIT_BAR, Math.max(0, Math.round((limit.percentUsed / 100) * LIMIT_BAR)))
        return (
          <Box key={`limit-${limit.kind}`} columnGap={1}>
            <Text color={COLORS.text}>{padCells(limitName(limit.kind), nameWidth)}</Text>
            <Text>
              <Text color={level === 'muted' ? COLORS.clay : COLORS[level]}>{'━'.repeat(filled)}</Text>
              <Text color={COLORS.border}>{'─'.repeat(LIMIT_BAR - filled)}</Text>
            </Text>
            <Text color={COLORS.text}>{`${limit.percentUsed}%`.padStart(4)}</Text>
            {left && <Text color={COLORS.muted}>{T.resetsIn(left)}</Text>}
          </Box>
        )
      })}
    </Box>
  )
}

// 아래턱 오른쪽의 "◔ 62%": 링은 단계 색, 칩 전체가 컨텍스트 패널을 여는 버튼.
function contextMeter(els: Els, $: EngineInterface, info: UsageInfo | null, mode: ContextChipMode) {
  const percent = info?.percent ?? null
  if (!showsChip(mode, percent)) return null
  const { Box, Text, Button } = els
  const level = meterLevel(percent)
  const label = `${percent}%`
  return {
    width: 2 + cellWidth(label),
    node: (
      <Button key="context-chip" plain dimColor={level === 'muted'} onPress={() => void openContext($)}>
        <Text color={COLORS[level]}>{ring(percent)}</Text>
        {` ${label}`}
      </Button>
    ),
  }
}

// 아래턱 오른쪽의 PR 칩 "#12 ✓ 5/5": 누르면 /desk-pr 패널.
function prChip(els: Els, $: EngineInterface, state: PrState | null) {
  const info = state?.pr
  if (!info) return null
  const { Box, Text, Button } = els
  const parts = prChipParts(info)
  const text = parts.map(part => part.text).join(' ')
  const colored = parts.slice(1).map((part, index) => (
    <Text key={`pr-part-${index}`} color={COLORS[part.color]}>{` ${part.text}`}</Text>
  ))
  return {
    width: cellWidth(text),
    node: (
      <Button key="pr-chip" plain dimColor onPress={() => void openPr($)}>
        {parts[0]!.text}
        {colored as never}
      </Button>
    ),
  }
}

async function refreshDiff($: EngineInterface) {
  const opts = { timeoutMs: 5000 }
  const inside = await $.process.run(['git', 'rev-parse', '--is-inside-work-tree'], opts)
  if (inside.exitCode !== 0) {
    const cwd = await $.session.cwd()
    await update($, repo, () => ({ name: cwd.split('/').pop() ?? cwd, branch: null, isRepo: false }))
    await update($, diff, () => [])
    return
  }
  const [top, branch, tracked, untracked] = await Promise.all([
    $.process.run(['git', 'rev-parse', '--show-toplevel'], opts),
    $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], opts),
    $.process.run(['git', 'diff', 'HEAD', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'], opts).then(ran => (ran.exitCode === 0 ? ran : $.process.run(['git', 'diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'], opts))),
    $.process.run(['git', 'ls-files', '--others', '--exclude-standard'], opts),
  ])
  // 새로 만든 파일은 `git diff HEAD` 에 안 잡힌다. 데스크톱처럼 보이도록 최대 20개까지 붙인다.
  const fresh = untracked.stdout.split('\n').filter(Boolean).slice(0, 20)
  const freshDiffs = await Promise.all(fresh.map(path => $.process.run(['git', 'diff', '--no-index', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--', '/dev/null', path], opts)))
  const files = [
    ...parseDiff(tracked.stdout),
    ...freshDiffs.flatMap(ran => parseDiff(ran.stdout, true)),
  ]
  // 이 세션이 고친 저장소 안 파일 중 git 이 무시하는 것은 git diff·ls-files 어디에도 안 잡힌다. 세션 기록으로 보이게 골라 둔다.
  const root = top.stdout.trim()
  const inRepo = root ? sessionEditsOf(await read($, runs)).map(edit => edit.path).filter(path => path.startsWith(`${root}/`)) : []
  const ignored = inRepo.length ? (await $.process.run(['git', 'check-ignore', '--stdin'], { ...opts, stdin: `${inRepo.join('\n')}\n` })).stdout.split('\n').filter(Boolean) : []
  await update($, repo, () => ({
    name: root.split('/').pop() ?? '',
    branch: branch.exitCode === 0 ? branch.stdout.trim() : null,
    isRepo: true,
    root: root || undefined,
    ignored,
  }))
  await update($, diff, () => fitDiffs([files])[0] ?? [])
}

// diff 패널의 되돌리기: 처음 누르면 5초 동안 확인 상태, 그 안에 한 번 더 누르면 HEAD 로 되돌린다.
// 커밋하지 않은 변경을 버리는 일이라 두 번 눌러야 하고, git 이 아는 파일만 대상이다(새 파일은 지우게 되므로 없음).
const REVERT_ARM_MS = 5000

async function revertFile($: EngineInterface, path: string, isArmed: boolean) {
  const key = `revert:${path}`
  if (!isArmed) {
    await update($, open, state => ({ ...state, [key]: true }))
    $.clock.after(REVERT_ARM_MS, () => void update($, open, state => ({ ...state, [key]: false })))
    return
  }
  await update($, open, state => ({ ...state, [key]: false }))
  const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { timeoutMs: 5000 })
  const ran = await $.process.run(['git', 'restore', '--source=HEAD', '--staged', '--worktree', '--', path], {
    cwd: top.stdout.trim() || undefined,
    timeoutMs: 5000,
  })
  $.ui.toast(ran.exitCode === 0 ? T.reverted(path) : T.revertFailed(ran.stderr.trim().split('\n')[0] ?? ''))
  await refreshDiff($)
}

// 처음 상태가 펼침인 행(묶음 안의 편집)도 있어서, 지금 보이는 상태를 받아 뒤집는다.
const toggle = ($: EngineInterface, id: string, shown?: boolean) =>
  update($, open, state => ({ ...state, [id]: !(state[id] ?? shown ?? false) }))

// 턴 끝 카드의 파일(도구가 준 경로, 보통 절대 경로)이나 /desk-diff 에 준 이름(뒷부분)에 맞는
// diff 패널 파일(저장소 기준 경로). 절대 경로 쪽은 가장 길게 맞는 것, 이름 쪽은 첫 번째.
export function matchDiffFile(files: ReadonlyArray<{ path: string }>, path: string): string | null {
  const whole = files.filter(file => file.path === path || path.endsWith(`/${file.path}`))
  const best = whole.sort((a, b) => b.path.length - a.path.length)[0]
  return best?.path ?? files.find(file => file.path.endsWith(`/${path}`))?.path ?? null
}

// 앞을 줄인다: 경로는 파일 이름 쪽이 중요하다.
export function clipStart(text: string, width: number): string {
  if (cellWidth(text) <= width) return text
  let out = ''
  for (const ch of [...text].reverse()) {
    if (cellWidth(ch + out) > width - 1) break
    out = ch + out
  }
  return `…${out}`
}

// diff 패널에서 세션 기록으로 보이는 파일의 키 앞머리.
const OUTSIDE = 's:'
// git 밖 편집 묶음 전체의 접기 키. 파일 접기 키(fold:경로)와 겹치지 않게 따로 둔다.
const OUTSIDE_GROUP = 'group:outside'

// 데스크톱처럼 턴 끝 카드의 파일을 누르면 diff 패널을 그 파일에서 연다(접혀 있으면 펼쳐서).
// 문서를 읽어 미리보기 상태에 둔다. 경로는 실제 경로로 바꿔 둬서 나중에 다른 모양의 경로로 온 편집도 같은 문서로 안다.
// 못 읽으면 던지지 않고 사유를 담는다.
async function loadPreview($: EngineInterface, asked: string): Promise<PreviewFile> {
  const path = await $.fs.stat(asked, { resolve: true }).then(
    stat => stat.realPath ?? asked,
    () => asked,
  )
  const file: PreviewFile = await $.fs.read(path).then(
    text => ({ path, text }),
    (error: unknown) => ({ path, text: '', error: error instanceof Error ? error.message : String(error) }),
  )
  await update($, previewFile, () => file)
  return file
}

async function openPreview($: EngineInterface, path: string, focus = false) {
  const file = await loadPreview($, path)
  const opened = await $.ui.open({ ...(await paneLook($)), id: PREVIEW_PANE, title: fileName(file.path), ...(focus ? { focus: true as const } : {}) })
  return { file, isPlaced: opened.isPlaced }
}

// o: 미리보기 문서를 브라우저 창으로. 패널은 터미널의 45%를 넘지 못해 창 전체로 보려면 바깥 창이 필요하다.
// 엔진 임시 폴더에 HTML 을 쓰고 엔진이 브라우저를 여는 것처럼 xdg-open(없으면 macOS 의 open)으로 연다.
async function openPreviewInBrowser($: EngineInterface, file: PreviewFile) {
  const root = await findTempRoot($)
  if (root === null) return $.ui.toast(T.browserFailed('id -u'))
  const page = `${root}/desk-look/${fileName(file.path).replace(/\.[^.]+$/, '')}.html`
  await $.fs.write(page, previewHtml(file.text, file.path))
  const failed = (error: unknown) => ({ exitCode: 1, stderr: error instanceof Error ? error.message : String(error) })
  let ran: { exitCode: number; stderr: string }
  try {
    ran = await $.process.run(['xdg-open', page], { timeoutMs: 10_000 })
  } catch {
    ran = await $.process.run(['open', page], { timeoutMs: 10_000 }).catch(failed)
  }
  $.ui.toast(ran.exitCode === 0 ? T.browserOpened(page) : T.browserFailed(ran.stderr.trim() || `exit ${ran.exitCode}`))
}

// 보고 있는 문서인지. 열 때 실제 경로로 바꿔 뒀으니 다른 모양의 경로도 실제 경로로 견준다.
async function isPreviewed($: EngineInterface, path: string) {
  const shown = await read($, previewFile)
  if (shown === null) return false
  if (shown.path === path) return true
  const real = await $.fs.stat(path, { resolve: true }).then(
    stat => stat.realPath,
    () => undefined,
  )
  return real === shown.path
}

// 행 끝의 ◫ 칩: 쉴 때는 흐리고 마우스 아래에서 진해진다.
function previewChip(els: Els, $: EngineInterface, key: string, path: string, label = T.previewChip) {
  return <els.Button key={`preview-${key}`} plain dimColor label={label} onPress={() => void openPreview($, path).catch(() => undefined)} />
}

async function openDiffAt($: EngineInterface, path: string) {
  await refreshDiffView($, 'uncommitted')
  const inGit = matchDiffFile(await read($, diff), path)
  // git 이 모르는 파일(저장소 밖)은 세션 편집 기록에서 찾는다. 경로는 도구가 준 절대 경로다.
  const outside = inGit === null ? matchDiffFile(outsideEdits(sessionEditsOf(await read($, runs)), await read($, repo)), path) : null
  const target = inGit ?? (outside === null ? null : `${OUTSIDE}${outside}`)
  await $.ui.open({ ...(await paneLook($)), id: PANE, title: T.paneChanges, focus: true })
  if (target === null) {
    $.ui.toast(T.notInDiff)
    return
  }
  // git 밖 파일이면 묶음도 편다: 접힌 묶음 안의 파일 머리 띠는 그리지 않아 스크롤해 갈 곳이 없다.
  await update($, open, state => ({ ...onlyOpen(state, target), ...(inGit === null ? { [OUTSIDE_GROUP]: false } : {}) }))
  await scrollToFile($, target)
}

// 창 맨 위 행이 속한 파일: 머리 띠가 그 행이거나 그 위에 있는 마지막 파일. 첫 머리 띠보다 위면 -1.
export function headAt(heads: ReadonlyArray<{ top: number }>, offset: number): number {
  let at = -1
  heads.forEach((head, index) => {
    if (head.top <= offset) at = index
  })
  return at
}

// n·p 가 기준으로 삼는 지금 파일: 하나만 펴져 있으면 그것, 아니면 마지막으로 스크롤해 간 파일, 그것도 없으면 창 맨 위 행의 파일.
// 창 위치만 보면 안 된다: 뒤쪽 파일은 내용이 짧아 엔진이 창을 끝에서 깎아, 머리 띠가 맨 위에 오지 못하고 창 맨 위는 앞 파일이 된다.
export function currentHead(heads: ReadonlyArray<{ id: string; top: number }>, folds: Record<string, boolean>, cursor: string | null, offset: number): number {
  const opened = heads.flatMap((head, index) => (folds[`fold:${head.id}`] === false ? [index] : []))
  if (opened.length === 1) return opened[0]!
  const at = cursor === null ? -1 : heads.findIndex(head => head.id === cursor)
  return at !== -1 ? at : headAt(heads, offset)
}

// n·p: 다음·이전 파일. 하나만 펴 보는 중이면(펴진 파일이 하나 이하) 그 파일을 펴고(앞 파일은 접힌다), 여럿 펴 두었으면 머리 띠로 간다.
async function stepFile($: EngineInterface, by: 1 | -1) {
  const heads = diffHeads
  const state = await read($, open)
  const at = currentHead(heads, state, diffCursor, paneOffsets.get(PANE) ?? 0)
  const target = at === -1 ? (by > 0 ? heads[0] : undefined) : heads[at + by]
  if (!target) return
  const opened = heads.filter(head => state[`fold:${head.id}`] === false).length
  if ((state[`fold:${target.id}`] ?? true) && opened <= 1) await pickFile($, target.id)
  else await scrollToFile($, target.id)
}

// diff 패널 파일은 하나만 펴진다: 펴 둔 파일 키를 모두 접고 이것만 편다. 기록이 없는 파일은 접힌 것이다.
function onlyOpen(state: Record<string, boolean>, id: string): Record<string, boolean> {
  const others = Object.keys(state).filter(key => key.startsWith('fold:') && !state[key])
  return { ...state, ...Object.fromEntries(others.map(key => [key, true])), [`fold:${id}`]: false }
}

// 파일 머리 띠를 누름: 접혀 있으면 그것만 펴고 그 머리 띠로 스크롤한다(위에 펴져 있던 파일이 접혀 자리가 당겨진다). 펴져 있으면 접는다.
async function pickFile($: EngineInterface, id: string) {
  const isOpening = (await read($, open))[`fold:${id}`] ?? true
  await update($, open, state => (isOpening ? onlyOpen(state, id) : { ...state, [`fold:${id}`]: true }))
  if (isOpening) await scrollToFile($, id)
}

// 상태를 바꾼 직후 스크롤하면 엔진은 아직 앞 그림(위 파일이 펴진 자리)으로 머리 띠를 찾아 엉뚱한 곳에 선다.
// 그 파일이 펴진 그림이 그려질 때까지 기다린다. 막 연 패널은 아직 그려지기 전이라 스크롤이 거부되니("not this plugin's site") 잠깐 다시 한다.
async function scrollToFile($: EngineInterface, id: string) {
  for (let tries = 0; tries < 20 && diffDrawnFolds[`fold:${id}`] !== false; tries++) await $.clock.sleep(25).catch(() => undefined)
  for (let tries = 0; tries < 8; tries++) {
    const moved = await $.ui.scroll({ to: { key: `file-${id}` }, in: PANE, block: 'start' }).catch(() => ({ deny: 'failed' }))
    if (!moved.deny) {
      diffCursor = id
      return
    }
    await $.clock.sleep(100).catch(() => undefined)
  }
}

// PR 바: 턴이 끝날 때마다 다시 읽되 30초 안에는 건너뛴다(gh·glab 은 네트워크를 탄다). 도구가 없거나 어느
// 호스트의 저장소도 아니면(isSticky) 같은 브랜치에서는 다시 묻지 않는다. 패널을 열거나 ↻ 를 누르면 바로 읽는다.
// 체크(GitLab 은 파이프라인 job)가 도는 동안은 턴 밖에서도 다시 읽고, 다 끝나면 멈춘다. 결과가 오지 않는 체크
// (GitHub EXPECTED, runner 를 기다리는 job)는 끝나지 않으므로, 체크 상태가 그대로면 간격을 PR_POLL 에서 두 배씩
// PR_POLL_MAX 까지 늘린다(gh·glab 사용 한도). 무엇이든 바뀌거나 새로 푸시하면 PR_POLL 로 돌아간다.
const PR_TTL = 30_000
const PR_POLL = 15_000
const PR_POLL_MAX = 120_000
let prFetch: Promise<void> | null = null
let prPoll: Timer | null = null
let prDelay = PR_POLL
let prSeen: string | null = null

const isChecking = (state: PrState | null | undefined) =>
  state?.status === 'ok' && state.pr?.state === 'OPEN' && state.pr.checks.some(check => check.state === 'pending')

// 다음 주기: 지난번 읽은 것과 head·체크 상태가 같으면 늘리고, 다르면 처음으로.
function pacePr(state: PrState) {
  const seen = JSON.stringify([state.pr?.headSha, state.pr?.checks.map(check => [check.name, check.state])])
  prDelay = seen === prSeen ? Math.min(prDelay * 2, PR_POLL_MAX) : PR_POLL
  prSeen = seen
}

function watchPr($: EngineInterface) {
  if (prPoll !== null) return
  prPoll = $.clock.after(prDelay, () => {
    prPoll = null
    // 다시 읽어 체크가 아직 돌면 refreshPr 이 다음 주기를 건다.
    void refreshPr($, false).catch(() => undefined)
  })
}

async function refreshPr($: EngineInterface, force: boolean) {
  if (prFetch) return prFetch
  prFetch = (async () => {
    const [branchRan, now] = await Promise.all([
      $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 5000 }).catch(() => null),
      $.clock.now(),
    ])
    const branch = branchRan?.exitCode === 0 ? branchRan.stdout.trim() : null
    const last = await read($, pr)
    if (branch === null || branch === 'HEAD') {
      await update($, pr, (): PrState => ({ status: 'none', branch, pr: null, at: now }))
      return
    }
    const ttl = isChecking(last) ? PR_POLL / 2 : PR_TTL
    if (!force && last && last.branch === branch && ((last.status === 'off' && last.isSticky) || now - last.at < ttl)) {
      // 다시 불러온 모듈은 타이머가 없다: 저장된 상태에 도는 체크가 있으면 다시 건다.
      if (isChecking(last)) watchPr($)
      return
    }
    if (force || last?.branch !== branch) await update($, pr, (previous): PrState => ({ status: 'loading', branch, pr: previous?.branch === branch ? previous.pr : null, at: now }))
    const next = await fetchReview($, branch, now)
    await update($, pr, () => next)
    // 다음 주기는 방금 읽은 때부터 센다(↻·턴 끝에서 바뀐 것을 보면 길게 걸어 둔 타이머 대신 PR_POLL 로).
    prPoll?.cancel()
    prPoll = null
    if (isChecking(next)) {
      pacePr(next)
      watchPr($)
    } else {
      prDelay = PR_POLL
      prSeen = null
    }
  })().finally(() => {
    prFetch = null
  })
  return prFetch
}

async function openDiff($: EngineInterface, scope?: DiffScope) {
  await refreshDiffView($, scope)
  await $.ui.open({ ...(await paneLook($)), id: PANE, title: T.paneChanges, focus: true })
  // 맨 위에서 보여 준다. 다시 연 패널의 창과 적어 둔 위치(diffWindow)도 이 스크롤로 맞춰진다.
  await $.ui.scroll({ to: 'start', in: PANE }).catch(() => undefined)
}

// 열린 패널이 있으면 접고(닫되 제목·스크롤을 적어 둔다), 없으면 접어 둔 패널을 다시 연다.
// 내용은 store 에 그대로 남아 있어 다시 그리면 같은 화면이다. 엔진에는 패널을 남긴 채 숨기는 API 가 없다.
// desk-asana·desk-slack 은 folded 의 state.set 을 훅해 자기 패널을 따라 접고 편다(엔진은 다른 플러그인의 패널을
// 보여 주지도 닫게 하지도 않는다). 그래서 접을 내 패널이 없어도 빈 목록을 써서 알리고, 접은 수는 그쪽 folded 를 더한다.
async function siblingsFolded($: EngineInterface): Promise<number> {
  const [asanaPanes, slackPanes] = await Promise.all([read($, asanaFolded), read($, slackFolded)])
  return (asanaPanes?.length ?? 0) + (slackPanes?.length ?? 0)
}

// 열린 패널이 하나라도 있으면(desk-asana·desk-slack 것 포함) 접고, 없으면 접어 둔 것을 편다. 이미 접어 둔 것이
// 있으면 새로 접는 것을 그 목록에 더한다(접은 뒤 다른 패널을 열어 다시 접어도 처음 것이 남는다).
async function toggleFold($: EngineInterface): Promise<string> {
  const panes = (await $.ui.panes()).filter(pane => pane.isPlaced)
  const saved = await read($, folded)
  const [asanaOpen, slackOpen] = await Promise.all([read($, asanaShown), read($, slackShown)])
  if (panes.length > 0 || asanaOpen || slackOpen || saved === null) {
    const fresh = panes.map(pane => ({ id: pane.id, title: pane.title, isShown: pane.isShown, offset: paneOffsets.get(pane.id) ?? 0 }))
    await update($, folded, () => [...(saved ?? []).filter(pane => !fresh.some(item => item.id === pane.id)), ...fresh])
    for (const pane of panes) await $.ui.close({ id: pane.id }).catch(() => undefined)
    // desk-asana·desk-slack 은 패널이 하나씩이라 열려 있던 것이 접힌 수다.
    const count = panes.length + Number(asanaOpen) + Number(slackOpen)
    if (count > 0) return T.folded(count)
    if ((saved ?? []).length === 0 && (await siblingsFolded($)) === 0) await update($, folded, () => null)
    return T.foldNothing
  }
  const count = saved.length + (await siblingsFolded($))
  await update($, folded, () => null)
  if (count === 0) return T.foldNothing
  // 앞에 있던 패널을 마지막에 열어 앞에 오게 한다.
  const order = [...saved.filter(pane => !pane.isShown), ...saved.filter(pane => pane.isShown)]
  for (const pane of order) {
    await $.ui.open({ ...(await paneLook($)), id: pane.id, title: pane.title, ...(pane.isShown ? { focus: true as const } : {}) })
    if (pane.offset > 0) await restoreScroll($, pane.id, pane.offset)
  }
  return T.unfolded(count)
}

// 막 연 패널은 아직 그려지기 전이라 스크롤이 거부되거나("not this plugin's site") 빈 내용에 맞춰 0 으로 깎인다.
// 적어 둔 위치는 ui.scroll 훅이 내용이 그려진 뒤에 offset 으로 바꿔 넣고 지운다. 지워질 때까지 잠깐 다시 한다.
// 창이 이미 가 있는 끝으로는 움직이지 않아 훅이 불리지 않으므로 양 끝을 차례로 청한다.
// 명령 안에서 기다린다: 명령이 끝난 뒤 백그라운드에서 돌리면 clock.sleep 이 기다려 주지 않아 그리기 전에 시도가 다 끝났다.
async function restoreScroll($: EngineInterface, id: string, offset: number) {
  restoreOffsets.set(id, offset)
  try {
    for (let tries = 0; tries < 8 && restoreOffsets.has(id); tries++) {
      for (const to of ['end', 'start'] as const) {
        if (!restoreOffsets.has(id)) break
        await $.ui.scroll({ to, in: id }).catch(() => undefined)
      }
      if (restoreOffsets.has(id)) await $.clock.sleep(100).catch(() => undefined)
    }
  } finally {
    restoreOffsets.delete(id)
  }
}

async function openPr($: EngineInterface) {
  const shown = refreshPr($, true).catch(() => undefined)
  await $.ui.open({ ...(await paneLook($)), id: PR_PANE, title: 'PR', focus: true })
  await shown
}

// PR 패널의 머지: Revert 처럼 5초 안에 두 번 눌러야 한다. 누른 순간 패널이 보여 준 PR(head 커밋)로 머지하고
// 결과를 알린 뒤 다시 읽는다. 도는 체크가 있으면 통과하면 머지되게 건다.
const MERGE_ARM_MS = 5000
let merging = false

async function mergeFromPane($: EngineInterface, info: PrInfo, action: MergeAction, isArmed: boolean) {
  const key = `merge:${info.url}`
  if (!isArmed) {
    await update($, open, state => ({ ...state, [key]: true }))
    $.clock.after(MERGE_ARM_MS, () => void update($, open, state => ({ ...state, [key]: false })))
    return
  }
  await update($, open, state => ({ ...state, [key]: false }))
  if (merging) return
  merging = true
  try {
    $.ui.toast(T.merging(prRef(info)))
    const result = await mergePr($, info, action)
    if (!result.ok) $.ui.toast(T.mergeFailed(result.error))
    else $.ui.toast([result.merged ? T.merged(prRef(info)) : T.autoMergeSet(prRef(info)), result.note].filter(Boolean).join(' · '))
  } finally {
    merging = false
  }
  await refreshPr($, true).catch(() => undefined)
}

// 줄 댓글의 diff 범위: 모델이 줄 번호가 어느 판의 것인지 알게.
function commentScope(prefix: string, base: string | undefined): string {
  if (prefix === OUTSIDE) return 'an edit made this session, outside git'
  if (prefix === 'b:') return base ? `branch changes since ${base}` : 'branch changes'
  const commit = /^c:([^:]+):$/.exec(prefix)
  return commit ? `commit ${commit[1]}` : 'uncommitted changes'
}

// 줄 번호 누름: 범위를 정하고 입력칸으로 포커스를 옮긴다(다음 그림에 생기는 입력칸을 엔진이 기다려 준다).
// 패널 버튼을 클릭해도 패널이 키를 갖지 않아 focus 가 거절되므로, 패널을 focus 로 다시 열어 키를 가져온다.
async function pickLine($: EngineInterface, at: LinePress) {
  const before = await read($, commentDraft)
  const next = pressLine(before, at)
  if (!next || before?.patch !== next.patch) draftText = ''
  await update($, commentDraft, () => next)
  if (!next) return
  await $.ui.open({ ...(await paneLook($)), id: PANE, title: T.paneChanges, focus: true })
  await $.ui.focus({ requestId: PANE, key: draftInputKey(next) }).catch(() => undefined)
}

// 지우기: 범위는 두고 쓴 글만 비운 칸을 새로 그려 그리로 돌아간다.
async function clearComment($: EngineInterface) {
  draftText = ''
  draftRound++
  const draft = await read($, commentDraft)
  await update($, commentDraft, current => (current ? { ...current } : current))
  if (!draft) return
  await $.ui.open({ ...(await paneLook($)), id: PANE, title: T.paneChanges, focus: true })
  await $.ui.focus({ requestId: PANE, key: draftInputKey(draft) }).catch(() => undefined)
}

async function cancelComment($: EngineInterface) {
  draftText = ''
  await update($, commentDraft, () => null)
}

// Enter: 글이 있으면 그 범위 줄들과 함께 쌓고, 비었으면 닫는다.
async function saveComment($: EngineInterface, draft: CommentDraft, lines: DiffLine[], value: string) {
  const body = value.trim()
  await cancelComment($)
  if (body === '' || lines.length === 0) return
  const end = lines[lines.length - 1] as DiffLine
  const id = String(++commentSeq)
  await update($, lineComments, list => [...list, { id, patch: draft.patch, path: draft.path, scope: draft.scope, end: lineRef(end), lines, body }])
}

// 2.1.311 $.prompt.paint: 입력창의 인용 줄(> …)을 대화 기록의 인용처럼. 표시는 흐리게, 글은 기울여 흐린 색.
export function quoteDecorations(text: string) {
  const runs: { start: number; end: number; dimColor?: boolean; italic?: boolean; color?: string }[] = []
  let offset = 0
  for (const line of text.split('\n')) {
    const mark = /^>\s?/.exec(line)
    if (mark) {
      runs.push({ start: offset, end: offset + mark[0].length, color: COLORS.border })
      if (line.length > mark[0].length) runs.push({ start: offset + mark[0].length, end: offset + line.length, italic: true, color: COLORS.muted })
    }
    offset += line.length + 1
  }
  return runs
}

// "Claude에게 맡기기": 입력창이 비어 있으면 채우고, 쓰던 글이 있으면 뒤에 붙인다.
async function fillPrompt($: EngineInterface, text: string, done = T.filled) {
  const box = await $.prompt.read().catch(() => ({ text: '', cursor: 0 }))
  const isEmpty = box.text.trim() === ''
  const filled = await $.prompt.fill({ text: isEmpty ? text : `\n\n${text}`, mode: isEmpty ? 'replace' : 'append' }).catch(() => null)
  $.ui.toast(filled?.isFilled ? done : T.fillFailed)
}

// 대화 기록에서 고른 글을 인용으로(턴 끝 줄의 ❝ 칩, /desk-quote). 엔진은 고를 때 알려 주지 않고, 누르거나
// 명령을 쳐도 마지막 선택은 남아 있어서 그때 읽는다. 아래 빈 줄은 물어볼 말을 쓸 자리.
export function quoteText(text: string): string {
  const lines = text.replace(/\s+$/, '').split('\n').map(line => line.trimEnd())
  return `${lines.map(line => (line === '' ? '>' : `> ${line}`)).join('\n')}\n\n`
}

// 쓰던 글이 있으면 인용을 그 위에(앞서 넣은 인용들 다음에) 넣고, 커서는 쓰던 자리에 그대로 둔다.
// 질문은 인용 아래에 오고, 치던 손이 끊기지 않는다. 커서가 앞 인용 안에 있었으면 글 첫머리로.
export function quoteInto(draft: string, cursor: number, quote: string): { text: string; cursor: number } {
  if (draft.trim() === '') return { text: quote, cursor: quote.length }
  const lead = /^(?:>[^\n]*(?:\n|$)|\n)*/.exec(draft)?.[0] ?? ''
  const head = lead.includes('>') ? lead.replace(/\n*$/, '\n\n') : ''
  const rest = draft.slice(lead.length)
  const start = head.length + quote.length
  return { text: head + quote + rest, cursor: start + Math.max(0, cursor - lead.length) }
}

// 고른 글이 이 답 안의 것인지. 선택은 어느 행인지만 알려 줘 턴을 모르고, 그려진 글은 마크다운 기호·줄바꿈·표 선이
// 빠져 있어 글자와 숫자만 남겨 비교한다. 링크는 글만 그려지니 주소를 뺀다.
export function selectionIn(answer: string, selected: string): boolean {
  const bare = (text: string) => text.replace(/[^\p{L}\p{N}]+/gu, '')
  const part = bare(selected)
  return part !== '' && bare(answer.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')).includes(part)
}

// answer 는 턴 끝 줄의 ❝ 칩이 넘기는 그 턴의 답: 그 안에서 고른 글이 있으면 그 글, 없으면 답 전체를 인용한다.
// /desk-quote 는 답 없이 불러 고른 글만 인용한다.
async function quoteSelection($: EngineInterface, answer = '') {
  const selected = await $.ui.selection().catch(() => undefined)
  const picked = selected && selected.text.trim() !== '' ? selected.text : ''
  const text = answer.trim() !== '' && !(picked !== '' && selectionIn(answer, picked)) ? answer : picked
  if (text === '') {
    $.ui.toast(T.quoteNone)
    return
  }
  const box = await $.prompt.read().catch(() => ({ text: '', cursor: 0 }))
  const next = quoteInto(box.text, box.cursor, quoteText(text))
  const filled = await $.prompt.fill({ text: next.text, mode: 'replace', cursor: next.cursor }).catch(() => null)
  // 채우기는 prompt.edit 를 거치지 않으니 넣은 인용을 여기서 칠한다.
  if (filled?.isFilled) void $.prompt.paint({ text: next.text, decorations: quoteDecorations(next.text) }).catch(() => undefined)
  $.ui.toast(filled?.isFilled ? T.quoted : T.fillFailed)
}

// diff 패널의 브랜치·커밋 범위. 커밋 안 한 변경은 refreshDiff 의 diff 를 그대로 쓴다.
async function findBase($: EngineInterface) {
  const opts = { timeoutMs: 8000 }
  const [originHead, state, view] = await Promise.all([$.process.run(['git', 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], opts), read($, pr), read($, diffView)])
  // 사람이 고른 기준이 먼저, 그 브랜치가 없어졌으면 자동 후보로.
  const auto = baseCandidates(state?.pr?.base ?? null, originHead.exitCode === 0 ? originHead.stdout.trim() : null)
  const candidates = view.baseRef ? [view.baseRef, ...auto.filter(ref => ref !== view.baseRef)] : auto
  for (const ref of candidates) {
    const found = await $.process.run(['git', 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], opts)
    if (found.exitCode !== 0) continue
    const base = await $.process.run(['git', 'merge-base', 'HEAD', ref], opts)
    if (base.exitCode === 0 && base.stdout.trim() !== '') return { ref, sha: base.stdout.trim() }
  }
  return null
}

// 기준 고르기: 목록이 열려 있으면 닫고, 아니면 최근 커밋 순 브랜치(로컬·원격)를 읽어 연다. 지금 기준이 목록에 없으면 맨 앞에.
async function toggleBases($: EngineInterface) {
  const view = await read($, diffView)
  if (view.bases) {
    await update($, diffView, previous => ({ ...previous, bases: null }))
    return
  }
  const opts = { timeoutMs: 5000 }
  const [refs, branch] = await Promise.all([
    $.process.run(['git', 'for-each-ref', '--sort=-committerdate', '--count=40', '--format=%(refname)', 'refs/heads', 'refs/remotes'], opts).catch(() => null),
    $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], opts).catch(() => null),
  ])
  const found = refs?.exitCode === 0 ? branchChoices(refs.stdout, branch?.exitCode === 0 ? branch.stdout.trim() : null) : []
  const now = view.base?.ref
  const bases = now && !found.includes(now) ? [now, ...found].slice(0, 8) : found
  await update($, diffView, previous => ({ ...previous, bases }))
}

// 기준을 고르면(null 은 자동) 목록을 닫고 브랜치 전체·커밋별을 그 기준으로 다시 읽는다.
async function pickBase($: EngineInterface, ref: string | null) {
  await update($, diffView, previous => ({ ...previous, baseRef: ref, bases: null }))
  await refreshDiffView($)
}

// 안 바뀐 구간을 누름: 새 쪽 파일(작업 트리, 커밋별이면 그 커밋)에서 구간의 줄을 읽어 그 자리에 편다.
// 읽은 줄 수가 구간과 다르면 파일이 diff 를 읽은 뒤 바뀐 것이라 diff 를 다시 읽는다.
type GapSource = { kind: 'worktree' } | { kind: 'commit'; sha: string }
type GapPress = { key: string; patch: string; path: string; source: GapSource; gap: Gap }

async function openGap($: EngineInterface, at: GapPress) {
  const lines = await gapSource($, at.path, at.source)
  if (lines === null) {
    $.ui.toast(T.gapUnreadable)
    return
  }
  const hidden = lines.slice(at.gap.newStart - 1, at.gap.newStart - 1 + at.gap.count)
  if (hidden.length !== at.gap.count) {
    await refreshDiffView($)
    return
  }
  await update($, diffGaps, gaps => {
    const kept = gaps[at.key]?.patch === at.patch ? (gaps[at.key]?.lines ?? {}) : {}
    return { ...gaps, [at.key]: { patch: at.patch, lines: { ...kept, [at.gap.newStart]: hidden.map(untab) } } }
  })
}

// 새 쪽 파일의 줄들. 커밋 안의 파일은 git cat-file 로(커밋:경로는 stdin 으로), 첫 줄은 머리말이고 끝에 줄바꿈 하나가 붙는다.
async function gapSource($: EngineInterface, path: string, source: GapSource): Promise<string[] | null> {
  if (source.kind === 'worktree') {
    const root = (await read($, repo))?.root
    const text = root ? await $.fs.read(`${root}/${path}`).catch(() => null) : null
    return text === null ? null : text.split('\n')
  }
  const ran = await $.process.run(['git', 'cat-file', '--batch'], { timeoutMs: 5000, stdin: `${source.sha}:${path}\n` }).catch(() => null)
  const end = ran?.exitCode === 0 ? ran.stdout.indexOf('\n') : -1
  if (!ran || end < 0 || !ran.stdout.slice(0, end).includes(' blob ')) return null
  return ran.stdout.slice(end + 1).replace(/\n$/, '').split('\n')
}

// 거르기 줄: 열면 입력칸에 키를 준다(막 그려지는 중이면 잠깐 다시). 닫으면 거른 글도 지운다.
async function toggleFilter($: EngineInterface) {
  const filter = await read($, diffFilter)
  if (filter.isOpen) {
    await update($, diffFilter, () => ({ isOpen: false, query: '' }))
    return
  }
  await update($, diffFilter, previous => ({ ...previous, isOpen: true }))
  await $.ui.open({ ...(await paneLook($)), id: PANE, title: T.paneChanges, focus: true })
  await focusInPane($, PANE, 'diff-filter')
}

// 패널을 열고 그 안의 입력칸으로 포커스를 옮긴다. 막 열린 패널은 아직 그려지지 않아 몇 번 다시 해 본다.
async function focusInPane($: EngineInterface, requestId: string, key: string) {
  for (let tries = 0; tries < 10; tries++) {
    const moved = await $.ui.focus({ requestId, key }).catch(() => ({ deny: 'failed' }))
    if (!moved.deny) return
    await $.clock.sleep(50).catch(() => undefined)
  }
}

async function refreshDiffView($: EngineInterface, scope?: DiffScope) {
  const view = await read($, diffView)
  const next = scope ?? view.scope
  if (next === 'uncommitted') {
    await refreshDiff($)
    await update($, diffView, previous => ({ ...previous, scope: next }))
    return
  }
  const opts = { timeoutMs: 8000 }
  const base = await findBase($)
  if (next === 'branch') {
    await refreshDiff($)
    const ran = base ? await $.process.run(['git', 'diff', base.sha, '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'], opts) : null
    // 브랜치 전체에도 아직 git 에 없는 새 파일을 넣는다(커밋 안 한 변경 쪽에서 이미 읽었다)
    const fresh = (await read($, diff)).filter(file => file.isNew)
    const files = ran && ran.exitCode === 0 ? [...parseDiff(ran.stdout), ...fresh] : []
    await update($, diffView, previous => fitView({ ...previous, scope: next, base, files }))
    return
  }
  const log = base
    ? await $.process.run(['git', 'log', LOG_FORMAT, `-n${MAX_COMMITS}`, `${base.sha}..HEAD`], opts)
    : await $.process.run(['git', 'log', LOG_FORMAT, `-n${MAX_COMMITS}`], opts)
  const commits = log.exitCode === 0 ? parseCommits(log.stdout) : []
  // 목록에 남은 커밋만 펼친 채로 둔다
  const keep = new Set(commits.map(commit => commit.sha))
  await update($, diffView, previous => ({
    ...previous,
    scope: next,
    base,
    commits,
    commitFiles: Object.fromEntries(Object.entries(previous.commitFiles).filter(([sha]) => keep.has(sha))),
  }))
}

// 커밋들의 diff 를 git show 한 번으로 읽는다(커밋은 stdin 으로). 커밋마다 \x1e<sha> 줄로 시작한다.
async function commitDiffs($: EngineInterface, shas: string[]): Promise<Record<string, FileDiff[]>> {
  // 시간을 넘기거나 git 을 못 띄우면 빈 커밋으로 둔다: 커밋 줄·z 는 결과를 기다리지 않아 던지면 아무도 못 받는다.
  const stdin = `${shas.join('\n')}\n`
  const ran = await $.process.run(['git', 'show', '--stdin', '--format=%x1e%H', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'], { timeoutMs: 8000, stdin }).catch(() => ({ exitCode: 1, stdout: '' }))
  const found = ran.exitCode === 0 ? splitCommitDiffs(ran.stdout) : {}
  return Object.fromEntries(shas.map(sha => [sha, found[sha] ?? []]))
}

export function splitCommitDiffs(text: string): Record<string, FileDiff[]> {
  return Object.fromEntries(
    text
      .split('\x1e')
      .slice(1)
      .map(chunk => {
        const end = chunk.indexOf('\n')
        return end < 0 ? [chunk, []] : [chunk.slice(0, end), parseDiff(chunk.slice(end + 1))]
      }),
  )
}

// 커밋 줄을 누르면 그 커밋의 diff 를 펼치고, 다시 누르면 접는다. 여러 커밋을 함께 펼쳐 둘 수 있다.
async function pickCommit($: EngineInterface, sha: string) {
  const view = await read($, diffView)
  if (view.commitFiles[sha]) {
    await update($, diffView, previous => ({ ...previous, commitFiles: Object.fromEntries(Object.entries(previous.commitFiles).filter(([open]) => open !== sha)) }))
    return
  }
  const files = await commitDiffs($, [sha])
  await update($, diffView, previous => fitView({ ...previous, commitFiles: { ...previous.commitFiles, ...files } }))
}

// 커밋별 탭의 모두 접기·펴기: 하나라도 펼쳐져 있으면 모두 접고, 아니면 목록의 커밋과 그 안의 파일을 모두 편다.
async function foldCommits($: EngineInterface) {
  const view = await read($, diffView)
  if (Object.keys(view.commitFiles).length > 0) {
    await update($, diffView, previous => ({ ...previous, commitFiles: {} }))
    return
  }
  const files = await commitDiffs($, view.commits.map(commit => commit.sha))
  const ids = view.commits.flatMap(commit => (files[commit.sha] ?? []).map(file => `c:${commit.short}:${file.path}`))
  await update($, open, state => ({ ...state, ...Object.fromEntries(ids.map(id => [`fold:${id}`, false])) }))
  await update($, diffView, previous => fitView({ ...previous, commitFiles: files }))
}

async function refreshSurface($: EngineInterface) {
  const home = await $.env.get('HOME')
  const toml = home ? await $.fs.read(`${home}/${OMARCHY_COLORS}`).catch(() => null) : null
  const parsed = toml === null ? null : parseSurface(toml)
  const [colorterm, tmux] = await Promise.all([$.env.get('COLORTERM').catch(() => undefined), $.env.get('TMUX').catch(() => undefined)])
  const truecolor = isTruecolor({ COLORTERM: colorterm, TMUX: tmux })
  // 256색(tmux 안)에서는 말풍선 회색을 팔레트의 회색으로: 섞은 색은 엔진이 색 큐브로 줄여 어두운 테마에서 #5f5f5f 로 밝아진다.
  // 말풍선·코드 바탕·파일 줄·패널 바탕·모서리 그림이 모두 이 값을 쓰므로 여기서 한 번 바꾼다.
  const next = parsed && !truecolor ? { ...parsed, bubble: gray256(parsed.bubble) } : parsed
  diffColors = next ? diffPalette(next.mode, next.background, COLORS.muted, truecolor) : null
  if (!sameJson(await read($, surface), next)) await update($, surface, () => next)
}

// diff 색: 터미널 바탕(Omarchy 테마)을 알 때만. 모르면 엔진 diff 그대로(말풍선 등과 같은 규칙).
// 대화 속 편집 행(callDetail)은 비동기 읽기 없이 그려서 테마를 읽을 때 같이 맞춰 둔다.
let diffColors: DiffPalette | null = null

async function refreshGraphics($: EngineInterface) {
  const [TMUX, TMUX_PANE, ZELLIJ, HERDR_ENV, TERM, TERM_PROGRAM, TERM_PROGRAM_VERSION, CLAUDE_CODE_FORCE_TERMINAL_IMAGES, CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT] =
    await Promise.all([
      $.env.get('TMUX'),
      $.env.get('TMUX_PANE'),
      $.env.get('ZELLIJ'),
      $.env.get('HERDR_ENV'),
      $.env.get('TERM'),
      $.env.get('TERM_PROGRAM'),
      $.env.get('TERM_PROGRAM_VERSION'),
      $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES'),
      $.env.get('CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT'),
    ])
  const herdr = HERDR_ENV === '1' && herdrGraphicsOn(await readHerdrConfig($))
  const tmux = TMUX && TMUX_PANE ? await readTmuxGraphics($, TMUX_PANE) : null
  const env = { TMUX, ZELLIJ, HERDR_ENV, TERM, TERM_PROGRAM, TERM_PROGRAM_VERSION, CLAUDE_CODE_FORCE_TERMINAL_IMAGES, CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT }
  inHerdr = HERDR_ENV === '1'
  await update($, graphics, () => graphicsOf(env, herdr, tmux))
  await refreshHerdrRemote($)
}

let inHerdr = false
// 마지막으로 pgrep 으로 판정했을 때 herdr-client.sock 에 붙어 있던 연결과 그 판정.
let herdrSeen: { clients: string; remote: boolean } | null = null

// 원격 클라이언트는 이 기계의 bridge 프로세스(`herdr remote-client-bridge`, 이름 있는 세션은 `herdr --session <이름> remote-client-bridge`)로 붙는다. pgrep 은 한 번에 CPU 60~110ms 라
// 타이머로 훑지 않고 세션을 열 때와 프롬프트를 보낼 때만 보며, herdr 밖이거나 어차피 그림을 안 그리면 보지 않는다. 그래서 원격으로 막 붙었으면 첫 프롬프트를 보낼 때까지는
// 전의 모습이고, 보낸 말풍선도 판정이 올 때까지 잠깐 전의 모습으로 그려졌다가 다시 그려진다.
// bridge 도 로컬 클라이언트처럼 herdr-client.sock 에 붙으므로, 그 연결이 지난 판정 때 그대로면 붙거나 떨어진 클라이언트가 없어
// pgrep 없이 넘어간다(/proc/net/unix 읽기는 CPU 2ms). 못 읽거나(/proc 없는 macOS) 소켓 줄이 없으면 늘 pgrep 으로 본다.
// /clear·/resume 은 atom 만 기본값으로 비우므로 지난 판정이 지금 atom 과 같은지도 본다.
async function refreshHerdrRemote($: EngineInterface) {
  if (!inHerdr || (await read($, graphics)) === null) return
  const clients = herdrClientsOf(await $.fs.read('/proc/net/unix').catch(() => ''))
  if (clients && herdrSeen?.clients === clients && herdrSeen.remote === (await read($, herdrRemote))) return
  const ran = await $.process.run(['pgrep', '-f', '^\\S*herdr( --session \\S+)? remote-client-bridge'], { timeoutMs: 3000 }).catch(() => null)
  // pgrep 은 찾으면 0, 없으면 1. 실패는 판정하지 않는다.
  if (!ran || (ran.exitCode !== 0 && ran.exitCode !== 1)) return
  const remote = ran.exitCode === 0
  herdrSeen = clients ? { clients, remote } : null
  if ((await read($, herdrRemote)) !== remote) await update($, herdrRemote, () => remote)
}

// /proc/net/unix 한 줄은 `Num RefCount Protocol Flags Type St Inode Path` 이고, 서버가 받아 준 연결도 듣는 소켓의 경로를 달고 나온다.
// 그래서 herdr-client.sock 줄의 inode 들(듣는 소켓 하나 포함)이 붙은 클라이언트다. 개수만 보면 원격이 나가고 로컬이 들어온 걸 놓친다.
function herdrClientsOf(table: string): string {
  return table.split('\n').filter(line => line.endsWith('/herdr-client.sock')).map(line => line.trim().split(/\s+/)[6]).sort().join(' ')
}

// 엔진처럼 이 창(TMUX_PANE)의 바깥 터미널과 그림 통과 설정을 tmux 에 묻는다. 못 물으면 null(그리지 않는다).
async function readTmuxGraphics($: EngineInterface, pane: string): Promise<string | null> {
  const ran = await $.process.run(['tmux', 'display-message', '-p', '-t', pane, TMUX_GRAPHICS_FORMAT], { timeoutMs: 3000 }).catch(() => null)
  return ran?.exitCode === 0 ? ran.stdout : null
}

async function readHerdrConfig($: EngineInterface): Promise<string> {
  const [xdg, home] = await Promise.all([$.env.get('XDG_CONFIG_HOME'), $.env.get('HOME')])
  const base = xdg || (home ? `${home}/.config` : '')
  return base ? $.fs.read(`${base}/herdr/config.toml`).catch(() => '') : ''
}

async function refreshImages($: EngineInterface) {
  const next = await listImages($).catch(() => ({}))
  if (!sameJson(await read($, images), next)) await update($, images, () => next)
}

// 이 세션의 images 폴더(/tmp/claude-<uid>/<프로젝트>/<세션>/images). 찾으면 기억한다: 프롬프트마다 다시 훑지 않게.
let userId: string | null = null
let imagesDir: string | null = null
// 같은 그림(경로·수정 시각)은 PNG 머리를 다시 읽지 않는다.
const imageSizes = new Map<string, { width: number; height: number } | null>()
// iTerm2 와 tmux 안의 kitty 는 파일 이름을 그리지 않아 PNG 바이트(base64)를 넘긴다. Image 가 받는 2 MiB 를 넘으면 null(글자로 둔다).
const imageBytes = new Map<string, string | null>()
const IMAGE_BYTES_MAX = 2 * 1024 * 1024

async function imagePng($: EngineInterface, path: string): Promise<string | null> {
  if (!imageBytes.has(path)) {
    const read = await $.fs.read(path, { as: 'bytes' }).catch(() => null)
    imageBytes.set(path, read && (read.base64.length * 3) / 4 <= IMAGE_BYTES_MAX ? read.base64 : null)
  }
  return imageBytes.get(path) ?? null
}

// 엔진의 임시 폴더 /tmp/claude-<uid>. uid 를 모르면 null.
async function findTempRoot($: EngineInterface): Promise<string | null> {
  if (userId === null) {
    const ran = await $.process.run(['id', '-u'], { timeoutMs: 3000 })
    userId = ran.exitCode === 0 ? ran.stdout.trim() : ''
  }
  return userId === '' ? null : `/tmp/claude-${userId}`
}

async function findImagesDir($: EngineInterface): Promise<string | null> {
  if (imagesDir !== null) return imagesDir
  const root = await findTempRoot($)
  if (root === null) return null
  const sessionId = await $.session.id()
  for (const project of await $.fs.list(root).catch(() => [])) {
    if (project.kind !== 'dir') continue
    const dir = `${root}/${project.name}/${sessionId}/images`
    if (await $.fs.exists(dir).catch(() => false)) return (imagesDir = dir)
  }
  return null
}

async function listImages($: EngineInterface): Promise<Record<string, ImageInfo>> {
  const dir = await findImagesDir($)
  if (dir === null) return {}
  const found: Record<string, ImageInfo> = {}
  for (const file of await $.fs.list(dir)) {
    const number = imageNumber(file.name)
    if (number === null || file.kind !== 'file') continue
    const path = `${dir}/${file.name}`
    const key = `${path}@${file.mtimeMs}`
    if (!imageSizes.has(key)) {
      // 앞 24바이트만 십진수로($.fs.read 는 그림 전체를 옮기고 4 MiB 가 넘으면 거절한다)
      const ran = await $.process.run(['od', '-An', '-tu1', '-N', '24', path], { timeoutMs: 3000 }).catch(() => null)
      imageSizes.set(key, ran?.exitCode === 0 ? pngSize(ran.stdout.trim().split(/\s+/).map(Number)) : null)
    }
    const size = imageSizes.get(key)
    if (size) found[number] = { path, ...size }
  }
  return found
}

// 세션마다 비워지는 상태를 다시 채운다: 세션이 시작될 때(플러그인을 다시 올릴 때 포함)와 창 안에서 다른 세션으로 넘어간 뒤.
function refreshSessionState($: EngineInterface, showPr: boolean) {
  contextPoints = []
  contextCompactions = []
  void refreshDiff($).catch(() => undefined)
  void refreshUsage($).catch(() => undefined)
  if (showPr) void refreshPr($, false).catch(() => undefined)
  void refreshSurface($).catch(() => undefined)
  // 다른 세션의 예측이 섞이지 않게 비우고 다시 읽는다.
  runCursor = null
  predicted = []
  void refreshRuns($).catch(() => undefined)
  void refreshImages($).catch(() => undefined)
  void refreshAgents($).catch(() => undefined)
  void refreshGraphics($).catch(() => undefined)
  void refreshOpenSessions($).catch(() => undefined)
  void update($, lang, () => currentLang()).catch(() => undefined)
}

// 0.55.0 에서 Asana·Slack 패널이 desk-asana·desk-slack 플러그인으로 옮겨 갔다. 그 MCP 서버를 쓰는데 플러그인이
// 없으면 한 번 알린다. MCP 도구는 세션이 시작된 뒤에, 서버마다 다른 때 붙으므로 턴이 시작될 때마다 보고,
// Asana·Slack 을 저마다 그 도구가 보인 때 한 번 판단한다. 판단한 것은 store 에 남긴다(0.55.0 의 true 는 둘 다).
// MCP 서버를 쓰지 않는 사람도 있어 세션마다 몇 턴까지만 본다.
let movedChecked = false
let movedTurns = 0
const MOVED_CHECK_TURNS = 5
// 한 번뿐인 안내라 기본(4초)보다 오래 둔다.
const MOVED_NOTICE_MS = 10_000
const MOVED = [
  { name: 'desk-asana', tool: /asana/i, ready: 'asana' },
  { name: 'desk-slack', tool: /slack/i, ready: 'slack' },
] as const

// 이번 턴의 판단: 도구가 새로 보인 플러그인은 판단한 것에 더하고, 그중 이 세션에 없는 것을 알린다.
export function movedStep(
  tools: ReadonlyArray<{ name: string; mcp?: boolean }>,
  ready: { asana: boolean; slack: boolean },
  decided: readonly string[],
): { decided: string[]; notice: string[] } {
  const mcp = tools.filter(tool => tool.mcp)
  const seen = MOVED.filter(item => !decided.includes(item.name) && mcp.some(tool => item.tool.test(tool.name)))
  return { decided: [...decided, ...seen.map(item => item.name)], notice: seen.filter(item => !ready[item.ready]).map(item => item.name) }
}

async function noticeMoved($: EngineInterface) {
  if (movedChecked) return
  const kept = await $.store.get('movedNotice').catch(() => undefined)
  const decided = kept === true ? MOVED.map(item => item.name) : Array.isArray(kept) ? kept.filter((name): name is string => typeof name === 'string') : []
  if (decided.length === MOVED.length) return void (movedChecked = true)
  const step = movedStep(await $.tool.list(), { asana: await read($, asanaReady), slack: await read($, slackReady) }, decided)
  if (step.decided.length > decided.length) await $.store.set('movedNotice', step.decided)
  if (step.notice.length > 0) $.ui.toast(T.movedNotice(step.notice), { timeoutMs: MOVED_NOTICE_MS })
  if (step.decided.length === MOVED.length || ++movedTurns >= MOVED_CHECK_TURNS) movedChecked = true
}

// 세션 패널이 열려 있을 때만 목록을 다시 읽는다(기록 파일 80개를 읽는다).
async function refreshOpenSessions($: EngineInterface) {
  const panes = await $.ui.panes().catch(() => [])
  if (panes.some(pane => pane.id === SESSIONS_PANE && pane.isPlaced)) await refreshSessions($)
}

async function refreshSessions($: EngineInterface) {
  // 빈 세션을 걸러 낸 뒤에도 40개가 차도록 넉넉히 읽는다
  const [next] = await Promise.all([listSessions($, 80).catch(() => []), refreshLive($)])
  await update($, sessions, () => next.slice(0, 40))
}

// 지금 떠 있는 세션(다른 창·백그라운드)과 그 상태. 엔진의 agents 화면이 쓰는 목록과 같다.
async function refreshLive($: EngineInterface) {
  const ran = await $.process.run(['claude', 'agents', '--json'], { timeoutMs: 5000 }).catch(() => null)
  const next = ran?.exitCode === 0 ? liveSessionsOf(ran.stdout) : {}
  await update($, liveSessions, () => next)
  return next
}

// 기록 파일이 작으면 통째로 읽고, 크면 앞(작업 폴더)과 끝(제목)만 head·tail 로 읽는다($.fs.read 는 4 MiB 까지).
const SESSION_WHOLE = 320 * 1024

async function listSessions($: EngineInterface, count: number) {
  const home = await $.env.get('HOME')
  if (!home) return []
  const root = `${home}/.claude/projects`
  const folders = (await $.fs.list(root)).filter(entry => entry.kind === 'dir')
  const files = (
    await Promise.all(
      folders.map(async folder =>
        (await $.fs.list(`${root}/${folder.name}`).catch(() => []))
          .filter(entry => entry.kind === 'file' && entry.name.endsWith('.jsonl'))
          .map(entry => ({ path: `${root}/${folder.name}/${entry.name}`, id: entry.name.slice(0, -'.jsonl'.length), size: entry.size, mtimeMs: entry.mtimeMs })),
      ),
    )
  )
    .flat()
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, count)
  const entries = await Promise.all(
    files.map(async file => {
      if (file.size <= SESSION_WHOLE) {
        const text = await $.fs.read(file.path).catch(() => '')
        return sessionOf(file.id, file.mtimeMs, text, text)
      }
      const [head, tail] = await Promise.all([
        $.process.run(['head', '-c', '262144', file.path], { timeoutMs: 5000 }).catch(() => ({ stdout: '' })),
        $.process.run(['tail', '-c', '262144', file.path], { timeoutMs: 5000 }).catch(() => ({ stdout: '' })),
      ])
      return sessionOf(file.id, file.mtimeMs, head.stdout, tail.stdout)
    }),
  )
  return entries.filter(entry => entry !== null)
}

// 세션 줄을 눌렀을 때. 지금 창에서 그 세션으로 넘어간다: 다른 폴더면 /cd 로 옮긴 뒤 /resume <id>.
// $.command.run 은 턴이 기다리는 훅(/desk-sessions 의 command.run) 안에서는 거부되므로, 훅이 끝난 뒤
// 타이머로 실행한다. 그래도 실패하면 같은 폴더는 입력창에 채워 Enter 한 번으로, 다른 폴더는 셸 명령을 복사한다.
// 떠 있는 세션은 엔진이 /resume 을 거부한다: 다른 창의 세션은 herdr 안이면 그 탭으로 옮기고 아니면 안내만,
// 백그라운드 세션은 claude stop 으로 멈춘 뒤 가져온다(대화는 남는다). 작업 중이면 하던 턴이 끊기므로
// 5초 안에 한 번 더 눌러야 한다.
async function openSession($: EngineInterface, entry: SessionEntry) {
  const cwd = await $.session.cwd()
  if (entry.id === (await $.session.id())) return
  const live = (await refreshLive($))[entry.id]
  if (live?.kind === 'interactive') {
    $.ui.toast((await focusHerdrSession($, entry.id)) ? T.movedToPane(entry.title) : T.openElsewhere(entry.title))
    return
  }
  if (entry.cwd !== cwd && !(await $.fs.list(entry.cwd).then(() => true, () => false))) {
    $.ui.toast(T.folderGone(entry.cwd || T.unknownFolder))
    return
  }
  if (live?.job) {
    const key = `take:${entry.id}`
    if (live.status === 'busy' && !(await read($, open))[key]) {
      await update($, open, state => ({ ...state, [key]: true }))
      $.clock.after(STOP_ARM_MS, () => void update($, open, state => ({ ...state, [key]: false })))
      return
    }
    await update($, open, state => ({ ...state, [key]: false }))
    const stopped = await $.process.run(['claude', 'stop', live.job], { timeoutMs: 15_000 }).catch((error: unknown) => ({ exitCode: 1, stdout: '', stderr: String(error) }))
    if (stopped.exitCode !== 0) {
      $.ui.toast(T.takeFailed(lastLine(stopped.stderr || stopped.stdout)))
      return
    }
    void refreshLive($)
  }
  if (entry.cwd === cwd) {
    $.clock.after(50, () => {
      void $.command.run({ command: 'resume', args: entry.id }).catch(async () => {
        await $.prompt.fill({ text: `/resume ${entry.id}` })
        $.ui.toast(T.resumeHint(entry.title))
      })
    })
    return
  }
  $.clock.after(50, () => {
    void (async () => {
      await $.command.run({ command: 'cd', args: entry.cwd })
      await $.command.run({ command: 'resume', args: entry.id })
    })().catch(() => copyCommand($, `cd '${entry.cwd.replace(/'/g, "'\\''")}' && claude --resume ${entry.id}`, T.otherFolderCopied, T.otherFolder))
  })
}

// herdr 안이면 그 세션이 열린 패널의 작업공간·탭으로 화면을 옮긴다. herdr 가 아니거나 못 찾으면 false.
async function focusHerdrSession($: EngineInterface, sessionId: string): Promise<boolean> {
  if ((await $.env.get('HERDR_ENV')) !== '1') return false
  const listed = await $.process.run(['herdr', 'pane', 'list'], { timeoutMs: 3000 }).catch(() => null)
  const pane = listed?.exitCode === 0 ? herdrPaneOf(listed.stdout, sessionId) : null
  if (!pane) return false
  const workspace = await $.process.run(['herdr', 'workspace', 'focus', pane.workspace], { timeoutMs: 3000 }).catch(() => null)
  const tab = await $.process.run(['herdr', 'tab', 'focus', pane.tab], { timeoutMs: 3000 }).catch(() => null)
  return workspace?.exitCode === 0 && tab?.exitCode === 0
}

async function copyCommand($: EngineInterface, shell: string, copiedText: (shell: string) => string, plainText: (shell: string) => string) {
  const copied = await $.process.run(['wl-copy', '--', shell], { timeoutMs: 2000 }).catch(() => null)
  $.ui.toast(copied?.exitCode === 0 ? copiedText(shell) : plainText(shell))
}

// 엔진의 /copy 와 같은 길(클립보드 도구, 없으면 OSC 52)로 복사한다. 멀티플렉서·SSH 안에서도 된다.
async function copyText($: EngineInterface, text: string, press: UiPressArgument, what: 'code' | 'answer') {
  const copied = await $.ui.copy({ text, surface: press.surface })
  const lines = text.split('\n').length
  $.ui.toast(copied.isCopied ? T.copied(what, lines) : T.copyFailed(copied.reason))
}

async function refreshRuns($: EngineInterface) {
  const messages = await $.session.messages()
  // 이 읽기보다 늦게 스트림에서 온 호출은 아직 기록에 없다: 지우지 않고 예측 자리에 둔다.
  const computed = computeRuns(messages)
  predicted = predicted.filter(item => computed.firstOf[item.call.tool_use_id] === undefined)
  const next = withPredicted(computed, predicted)
  if (!sameJson(await read($, runs), next)) await update($, runs, () => next)
  // 이번 턴에 모델이 쓴 가장 늦은 설명 글: 할 일 도구가 없을 때 진행 띠 윗줄의 단계.
  const said = turnNarration(messages)
  const state = await read($, turnActivity)
  if (said?.text !== state.say?.text || said?.count !== state.say?.count) {
    await update($, turnActivity, current => ({ ...current, say: said === null ? null : { text: said.text, count: said.count } }))
  }
  // 설명 뒤 호출은 설명보다 늦게 기록에 붙으니, 같은 설명이라도 호출이 늘면 다시 시각을 맞춘다.
  // 스트림에서 막 넘긴 호출(아직 기록에 없는 것)도 가장 늦은 설명 뒤의 호출이다.
  if (said !== null) void logSay($, said.text, [...said.ids, ...predicted.map(item => item.call.tool_use_id)]).catch(() => undefined)
  const list = computeTasks(messages)
  if (!sameJson(await read($, tasks), list)) {
    await update($, tasks, () => list)
    // 하는 중이 된 할 일은 그때부터 시간을 잰다(띠의 "◉ 검증 8m").
    const now = await $.clock.now()
    await update($, turnActivity, state => ({ ...state, taskSince: taskSinceOf(list, state.taskSince ?? {}, now) }))
  }
}

export function taskSinceOf(list: ReadonlyArray<TaskItem>, since: Record<string, number>, now: number): Record<string, number> {
  return Object.fromEntries(list.filter(item => item.status === 'in_progress').map(item => [item.id, since[item.id] ?? now]))
}

// 진행 띠 "지금" 줄의 호출 글: Bash 는 설명(없으면 명령 첫 줄), 나머지는 도구 이름과 대상.
export function callLabel(tool: string, input: unknown): string {
  const description = stringField(fieldsOf(input), 'description')
  if (tool === 'Bash') return description ?? summarize(tool, input)
  if (isAgentTool(tool)) return description ?? tool
  const target = summarize(tool, input)
  return target === '' ? tool : `${tool} ${target}`
}

async function settleCall($: EngineInterface, id: string, tool: string) {
  const now = await $.clock.now()
  await update($, turnActivity, state => {
    const calls = (state.calls ?? []).filter(call => call.id !== id)
    return {
      ...state,
      calls,
      idleSince: calls.length === 0 ? now : state.idleSince,
      commands: (state.commands ?? 0) + (tool === 'Bash' ? 1 : 0),
      agents: (state.agents ?? 0) + (isAgentTool(tool) ? 1 : 0),
    }
  })
  if (!callsOf(await read($, turnActivity)).some(call => call.tool === 'Bash')) stopProcWatch()
}

const callsOf = (state: ActivityState) => state.calls ?? []

function startProcWatch($: EngineInterface) {
  if (procTimer !== null || claudePid === null) return
  procSample = null
  procTimer = $.clock.every(PROC_POLL_MS, () => void pollProc($).catch(() => undefined))
}

function stopProcWatch() {
  procTimer?.cancel()
  procTimer = null
  procSample = null
}

// 가장 먼저 시작해 아직 도는 Bash 호출이 띄운 프로세스들을 읽는다: CPU 틱·입출력 바이트를 합쳐 직전 표본과 비교하고,
// 이름은 가장 늦게 뜬 말단 명령(bash -c 래퍼 아래의 java·ssh …). 리눅스 /proc 만 본다.
// ps 로 모든 프로세스를 훑지 않고(한 번에 명령어 2,300만 개) claude 의 자식에서 셸 래퍼만 따라 내려간다.
async function pollProc($: EngineInterface) {
  const state = await read($, turnActivity)
  const bash = callsOf(state).find(call => call.tool === 'Bash')
  if (!bash) return stopProcWatch()
  if (claudePid === undefined) claudePid = statPid(await $.fs.read('/proc/self/stat').catch(() => ''))
  if (claudePid === null) return stopProcWatch()
  const now = await $.clock.now()
  const uptime = uptimeTicks(await $.fs.read('/proc/uptime').catch(() => ''))
  if (uptime === null) return
  const since = Math.ceil((now - bash.startedAt) / 1000)
  const rows: ProcRow[] = []
  const ticksOf = new Map<number, number>()
  let queue = childPids(await $.fs.read(`/proc/${claudePid}/task/${claudePid}/children`).catch(() => ''))
  for (let depth = 0; queue.length > 0 && depth < PROC_DEPTH; depth++) {
    const next: number[] = []
    for (const pid of queue) {
      const row = statRow(await $.fs.read(`/proc/${pid}/stat`).catch(() => ''))
      if (!row) continue
      const etimes = etimesOf(uptime, row.startTicks)
      // claude 의 자식 가운데 이 호출 전부터 있던 것(MCP 서버)이나 셸이 아닌 것(desk-look 이 띄운 git 등)은 내려가지 않는다
      if (depth === 0 && !isCallRoot({ ...row, etimes }, since)) continue
      rows.push({ pid: row.pid, ppid: row.ppid, etimes, name: row.name })
      ticksOf.set(row.pid, row.ticks)
      next.push(...childPids(await $.fs.read(`/proc/${pid}/task/${pid}/children`).catch(() => '')))
    }
    queue = next
  }
  const tree = callProcesses(rows, claudePid, since)
  const leaf = tree.leaves[0]
  if (!leaf) return
  let ticks = 0
  let io = 0
  for (const pid of tree.pids) {
    ticks += ticksOf.get(pid) ?? 0
    io += ioBytes(await $.fs.read(`/proc/${pid}/io`).catch(() => '')) ?? 0
  }
  const sample = { at: now, ticks, io }
  const view = procView(leaf.name, procSample, sample, state.proc ?? null)
  procSample = sample
  if (!sameJson(state.proc, view)) await update($, turnActivity, current => ({ ...current, proc: view }))
}

// /desk-activity 패널의 턴 기록. 메인 대화의 호출은 턴이 열려 있는 동안, 에이전트의 호출은 턴이 끝난 뒤에도
// 다음 턴이 시작될 때까지 쌓는다(턴이 띄운 백그라운드 에이전트는 턴보다 오래 돈다).
const logLabel = (tool: string, input: unknown) => (FILE_EDITING.has(tool) ? summarize(tool, input) : callLabel(tool, input))

// 기다리던 턴이 있으면 꺼낸다: 그 턴의 빈 기록을 열 시작 시각(메인 작업이 처음 왔을 때만 부른다).
function takeLogStart(): ActivityLog | null {
  const startedAt = pendingLogStart
  pendingLogStart = null
  return startedAt === null ? null : { startedAt, endedAt: null, events: [], says: [] }
}

async function logCall($: EngineInterface, event: ActivityLog['events'][number]) {
  const fresh = event.loop === undefined ? takeLogStart() : null
  await update($, activityLog, current => {
    const log = fresh ?? current
    if (log === null || (log.endedAt !== null && event.loop === undefined)) return log
    // 오래 도는 에이전트의 호출이 상한을 채워도 메인 대화의 호출은 밀어내지 않는다.
    const events = [...log.events, event]
    const kept = new Set([...events.filter(item => item.loop === undefined).slice(-LOG_EVENTS), ...events.filter(item => item.loop !== undefined).slice(-LOG_EVENTS)])
    return { ...log, events: events.filter(item => kept.has(item)) }
  })
}

async function settleLog($: EngineInterface, id: string) {
  const now = await $.clock.now()
  await update($, activityLog, log => (log === null ? log : { ...log, events: log.events.map(event => (event.id === id && event.end === undefined ? { ...event, end: now } : event)) }))
}

async function patchLog($: EngineInterface, id: string, patch: { isError: boolean; added?: number; removed?: number }) {
  await update($, activityLog, log => (log === null ? log : { ...log, events: log.events.map(event => (event.id === id ? { ...event, ...patch } : event)) }))
}

// 설명 글은 그 메시지가 기록에 붙을 때(호출이 이미 시작된 뒤) 오므로, 같은 메시지 호출의 가장 이른 시작으로 시각을 당긴다.
async function logSay($: EngineInterface, text: string, ids: ReadonlyArray<string>) {
  const now = await $.clock.now()
  // 호출이 붙지 않은 글(턴 끝 답, 글로만 답한 턴)은 새 턴 기록을 열지 않는다.
  const fresh = ids.length > 0 ? takeLogStart() : null
  await update($, activityLog, current => {
    const log = fresh ?? current
    if (log === null || log.endedAt !== null) return log
    const last = log.says[log.says.length - 1]
    const at = Math.min(last?.text === text ? last.at : now, ...log.events.filter(event => ids.includes(event.id)).map(event => event.start))
    if (last?.text === text) return at === last.at ? log : { ...log, says: [...log.says.slice(0, -1), { at, text }] }
    return { ...log, says: [...log.says, { at, text }].slice(-LOG_EVENTS) }
  })
}

// 턴 끝 줄의 요약: 진행 띠를 띄운 긴 턴에서 셀 것이 있을 때만.
export function turnStats(state: ActivityState, list: ReadonlyArray<TaskItem>, durationMs: number): TurnStats | undefined {
  if (durationMs < NOW_AFTER_MS) return undefined
  const stats = {
    commands: state.commands ?? 0,
    failed: state.failed ?? 0,
    agents: state.agents ?? 0,
    tasksDone: list.filter(item => item.status === 'completed').length,
    tasksTotal: list.length,
  }
  return stats.commands + stats.agents + stats.tasksTotal > 0 ? stats : undefined
}

type StepChunk = Chunk<'turn.step'>

// 도구 청크를 엔진에 넘기기 전에 그 호출을 묶음에 넣는다. 엔진은 청크를 받자마자 행을 그리는데, 묶음은
// session.append 뒤 기록을 다시 읽어야 채워져서, 그 사이 새 호출이 제 줄을 따로 그렸다가 윗줄 묶음으로
// 합쳐지며 대화가 한 줄씩 오르내렸다.
// $ 는 넘기지 않고 저장만 받는다: 디렉터리 검사가 yield* 안의 placeCalls($, …) 를 막았다(0.55.3).
async function* placeCalls(
  stream: { next(): Promise<IteratorResult<StepChunk, TurnStepResult>> },
  save: () => Promise<unknown>,
): AsyncGenerator<StepChunk, TurnStepResult> {
  while (true) {
    const step = await stream.next()
    if (step.done === true) return step.value
    const chunk = step.value
    if (chunk.kind === 'text' && chunk.text.trim() !== '') runCursor = null
    if (chunk.kind === 'tool') {
      const placed = placeCall(runCursor, chunk.id, chunk.name)
      runCursor = placed.cursor
      const call: RunCall = { tool_use_id: chunk.id, tool: chunk.name, input: {}, isRunning: true, isErrored: false, isInterrupted: false }
      predicted = [...predicted, { first: placed.first, call }]
      await save().catch(() => undefined)
    }
    yield chunk
  }
}

// 백그라운드 안내를 띄운 호출 중 아직 도는 것의 안내 글. 없으면 null.
function backgroundHintOf(state: Runs): string | null {
  for (const [id, hint] of backgroundHints) {
    const call = state.calls[state.firstOf[id] ?? '']?.find(item => item.tool_use_id === id)
    if (call?.isRunning) return hint.replace(/^\((.*)\)$/, '$1')
  }
  return null
}

type Els = Elements['terminal']

// 에이전트 패널: 엔진 목록을 기록에 합친다. 끝난 에이전트는 목록에서 곧 빠지므로 기록이 남긴다.
async function refreshAgents($: EngineInterface) {
  const [list, now] = await Promise.all([$.agent.list(), $.clock.now()])
  const records = await read($, agents)
  if (!sameJson(mergeAgents(records, list, now), records)) await update($, agents, records => mergeAgents(records, list, now))
  await settleShells($, now)
  if (Object.values(await read($, agents)).some(agent => isLive(agent.status))) startAgentClock($)
}

// 서브에이전트가 띄운 셸의 끝남 알림은 그 서브에이전트의 턴 안으로 배달돼 메인의 prompt.submit 에 오지 않는다.
// 그래서 출력 파일 끝의 종료 줄로도 끝을 읽는다. 파일 크기가 바뀌었을 때만 다시 읽는다.
const shellSizes = new Map<string, number>()

async function settleShells($: EngineInterface, now: number) {
  const live = Object.values(await read($, agents)).filter(task => task.kind === 'shell' && isLive(task.status) && task.outputFile)
  for (const task of live) {
    const file = task.outputFile ?? ''
    const size = (await $.fs.stat(file).catch(() => null))?.size
    if (size === undefined || shellSizes.get(task.id) === size) continue
    shellSizes.set(task.id, size)
    const raw = await $.fs.read(file).catch(() => null)
    const status = typeof raw === 'string' ? exitStatusOf(raw) : undefined
    if (status) await update($, agents, records => applyNotices(records, [{ id: task.id, status }], now))
  }
}

// 도는 에이전트가 있는 동안 1초마다 경과 시간을 다시 그리고, 2초마다 엔진 목록으로 상태를 맞춘다.
const AGENT_TICK = 1000
let agentTimer: Timer | null = null

function startAgentClock($: EngineInterface) {
  if (agentTimer !== null) return
  let count = 0
  agentTimer = $.clock.every(AGENT_TICK, () => {
    void (async () => {
      count++
      await update($, agentClock, () => count * AGENT_TICK)
      if (count % 2 === 0) await refreshAgents($)
      if (!Object.values(await read($, agents)).some(agent => isLive(agent.status))) {
        agentTimer?.cancel()
        agentTimer = null
      }
    })().catch(() => undefined)
  })
}

// 에이전트(포크된 스킬 /code-review 등 포함)는 활동이 처음 보일 때 엔진 목록을 다시 읽어 올린다.
// 목록에 없는 루프(압축·워크플로 포크)로 거듭 묻지 않도록 id 마다 한 번만. 도구 실행을 붙잡지 않게 뒤에서 한다.
const askedAgents = new Set<string>()

async function patchAgent($: EngineInterface, id: string, patch: (agent: AgentRecord) => Partial<AgentRecord>) {
  let isKnown = true
  const apply = (records: Record<string, AgentRecord>) => {
    const agent = records[id]
    isKnown = agent !== undefined
    return agent ? { ...records, [id]: { ...agent, ...patch(agent) } } : records
  }
  await update($, agents, apply)
  if (isKnown || askedAgents.has(id)) return
  askedAgents.add(id)
  void refreshAgents($)
    .then(() => update($, agents, apply))
    .catch(() => undefined)
}

// 셸·모니터 상세에 보일 출력 끝부분. 출력 파일은 끝남 알림이 알려 줘서 그 전에는 없다.
const OUTPUT_LINES = 40

async function refreshAgentDetail($: EngineInterface) {
  const id = await read($, agentView)
  if (id === null) return
  const task = (await read($, agents))[id]
  if (task?.kind === 'shell' || task?.kind === 'monitor') {
    const raw = task.outputFile ? await $.fs.read(task.outputFile).catch(() => null) : null
    const text = typeof raw === 'string' ? tailOf(raw, OUTPUT_LINES) : null
    await update($, taskOutput, () => ({ id, text }))
    return
  }
  const found = await $.session.messages({ agentId: id })
  const next = Array.isArray(found) ? agentDetailOf(id, found) : null
  if (!sameJson(await read($, agentDetail), next)) await update($, agentDetail, () => next)
}

async function openAgents($: EngineInterface, id: string | null = null) {
  await update($, agentView, () => id)
  await refreshAgents($).catch(() => undefined)
  await refreshAgentDetail($).catch(() => undefined)
  await openInFront($, { ...(await paneLook($)), id: AGENTS_PANE, title: T.paneAgents, focus: true })
}

// 사람이 다른 내 패널을 잡고 있으면(그 패널의 버튼을 눌렀을 때) 엔진은 focus 를 거절해 연 패널을 그 탭 뒤에 둔다.
// 그때는 앞에 있던 패널을 닫았다가 뒤에 다시 열어, 연 패널이 앞에 오게 한다(스크롤 위치는 되돌린다).
async function openInFront($: EngineInterface, pane: Parameters<EngineInterface['ui']['open']>[0]) {
  await $.ui.open(pane)
  // 앞으로 올리기는 연 뒤의 덤이다: 패널 목록을 못 읽으면 연 것으로 끝낸다.
  const panes = await $.ui.panes().catch(() => [])
  const front = panes.find(item => item.isShown)
  if (!front || front.id === pane.id || !panes.some(item => item.id === pane.id)) return
  const offset = paneOffsets.get(front.id) ?? 0
  await $.ui.close({ id: front.id })
  await $.ui.open(pane)
  await $.ui.open({ ...(await paneLook($)), id: front.id, title: front.title })
  if (offset > 0) await restoreScroll($, front.id, offset)
}

// 패널이 한동안 그려지지 않았거나(닫힘·접힘), 턴도 끝나고 도는 에이전트·셸도 없으면 멈춘다.
function startActivityClock($: EngineInterface) {
  activityTimer = $.clock.every(ACTIVITY_TICK, () => {
    void (async () => {
      const [at, startedAt, records] = await Promise.all([$.clock.now(), read($, turnStartedAt), read($, agents)])
      const busy = startedAt !== null || Object.values(records).some(agent => isLive(agent.status))
      if (at - activitySeen > 2 * ACTIVITY_TICK + 1000 || !busy) {
        activityTimer?.cancel()
        activityTimer = null
        // 멈추기 전에 한 번 더 그려 끝난 모습을 남긴다.
        await update($, activityClock, () => at)
        return
      }
      await update($, activityClock, () => at)
    })()
  })
}

async function openActivity($: EngineInterface) {
  await openInFront($, { ...(await paneLook($)), id: ACTIVITY_PANE, title: T.paneActivity, focus: true })
}

// 에이전트 대화를 메인 화면에 띄운다(엔진의 작업 목록에서 고른 것처럼). 그 뒤 Enter 는 그 에이전트에게 간다. id 가 없으면 메인 대화로.
async function viewInMain($: EngineInterface, id: string | undefined) {
  const shown = await $.ui.view(id === undefined ? {} : { agentId: id }).catch((error: unknown) => ({ deny: String(error) }))
  if (shown.deny) $.ui.toast(shown.deny)
}

// 작업 멈추기: Revert 처럼 5초 안에 두 번 눌러야 한다. 엔진의 TaskStop 도구를 부른다(셸·모니터·백그라운드 에이전트).
const STOP_ARM_MS = 5000
const GONE = /No task found/

async function stopTask($: EngineInterface, task: AgentRecord, isArmed: boolean) {
  const key = `stop:${task.id}`
  if (!isArmed) {
    await update($, open, state => ({ ...state, [key]: true }))
    $.clock.after(STOP_ARM_MS, () => void update($, open, state => ({ ...state, [key]: false })))
    return
  }
  await update($, open, state => ({ ...state, [key]: false }))
  const ran = await $.tool.call({ tool: 'TaskStop', task_id: task.id } as never).catch((error: unknown) => ({ deny: String(error) }))
  if ('deny' in ran && ran.deny !== undefined) {
    $.ui.toast(T.stopFailed(ran.deny))
    return
  }
  const now = await $.clock.now()
  // 엔진이 그런 작업이 없다고 하면 끝을 놓친 것이다. 끝남으로 두어 도는 목록에서 뺀다.
  if (ran.isError && GONE.test(ran.text ?? '')) {
    await patchAgent($, task.id, agent => ({ status: isLive(agent.status) ? 'completed' : agent.status, endedAt: agent.endedAt ?? now, activity: undefined }))
    $.ui.toast(T.alreadyEnded(task.description))
    return
  }
  if (ran.isError) {
    $.ui.toast(T.stopFailed(ran.text ?? ''))
    return
  }
  await patchAgent($, task.id, agent => ({ status: 'killed', endedAt: agent.endedAt ?? now, activity: undefined }))
  $.ui.toast(T.stopped(task.description))
}

// 아래턱 오른쪽의 "⋯ 2": 도는 백그라운드 작업(에이전트·셸·모니터) 수, 누르면 /desk-tasks 패널.
// PR 칩이 안 풀린 리뷰를 ◆ 로 쓰므로 겹치지 않는 기호를 쓴다.
function agentsChip(els: Els, $: EngineInterface, records: Record<string, AgentRecord>) {
  const live = Object.values(records).filter(agent => isLive(agent.status)).length
  if (live === 0) return null
  const { Box, Text, Button } = els
  const label = String(live)
  return {
    width: 2 + cellWidth(label),
    node: (
      <Button key="agents-chip" plain dimColor onPress={() => void openAgents($)}>
        <Text color={COLORS.clay}>⋯</Text>
        {` ${label}`}
      </Button>
    ),
  }
}

// 턴 끝 "Waiting for 2 background agents to finish" 아래 줄들: "··· route-agent  설명 ›"(이름 없으면 설명만). 끝나면 상태를 단다.
// 그 줄은 에이전트가 끝나도 남으니 지금 상태는 에이전트 기록에서 읽는다. 기록이 아직 없으면 종류만.
function waitingRows(els: Els, $: EngineInterface, waited: ReadonlyArray<{ id: string; agentType: string }>, records: Record<string, AgentRecord>, columns: number) {
  if (waited.length === 0) return null
  const { Box, Text } = els
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {waited.map(({ id, agentType }) => {
        const agent = records[id]
        const live = agent === undefined || isLive(agent.status)
        const label = agent ? AGENT_LABEL(agent) : agentType
        return (
          <Box key={`waiting-${id}`} columnGap={1}>
            <Text color={COLORS.clay}>{live ? '···' : '◆'}</Text>
            {label && <Text color={COLORS.muted}>{label}</Text>}
            {rowButton(
              els,
              { key: `waiting-row-${id}`, dimColor: true, onPress: () => void openAgents($, id) },
              clip(agent?.description ?? '', Math.max(10, columns - cellWidth(label ?? '') - 24)),
              !live && <Text color={AGENT_STATUS_COLOR[agent.status] ?? COLORS.muted}>{` ${T.agentStatus[agent.status] ?? agent.status}`}</Text>,
              <Text color={COLORS.muted}> ›</Text>,
            )}
          </Box>
        )
      })}
    </Box>
  )
}

// 아래턱의 "✉ 3": desk-slack 플러그인이 세는 안 읽은 Slack 메시지 수(desk-slack 이 없으면 0).
// 누르면 desk-slack 의 Slack 패널: $.command.run 은 immediate 명령도 턴이 끝날 때까지 줄을 서서,
// 턴 중에 눌러도 열리도록 slackOpen 을 올려 desk-slack 이 바로 열게 한다.
function slackChip(els: Els, $: EngineInterface, count: number) {
  if (count === 0) return null
  const { Text, Button } = els
  const label = String(count)
  return {
    width: 2 + cellWidth(label),
    node: (
      <Button key="slack-chip" plain dimColor onPress={() => void update($, slackOpenCount, count => count + 1).catch(() => undefined)}>
        <Text color={COLORS.accent}>✉</Text>
        {` ${label}`}
      </Button>
    ),
  }
}

// 아래턱의 "✎ 2": 다음 프롬프트에 같이 갈 줄 댓글 수(데스크톱 입력창의 Comment 카드). 누르면 diff 패널.
function commentsChip(els: Els, $: EngineInterface, list: LineComment[]) {
  if (list.length === 0) return null
  const { Text, Button } = els
  const label = String(list.length)
  return {
    width: 2 + cellWidth(label),
    node: (
      <Button key="comments-chip" plain dimColor onPress={() => void openDiff($).catch(() => undefined)}>
        <Text color={COLORS.link}>✎</Text>
        {` ${label}`}
      </Button>
    ),
  }
}

const AGENT_STATUS_COLOR: Record<string, string> = { completed: COLORS.success, failed: COLORS.danger }

function agentFacts(agent: AgentRecord): string[] {
  return [
    modelLabel(agent.model),
    agent.tokens !== undefined ? T.agentTokens(formatTokens(agent.tokens)) : undefined,
    T.agentToolUses(agent.toolUses),
  ].filter((fact): fact is string => fact !== undefined)
}

const agentElapsed = (agent: AgentRecord, now: number) =>
  agent.startedAt === undefined ? undefined : formatElapsed((agent.endedAt ?? now) - agent.startedAt)

// 목록의 카드 한 장: 데스크톱 Background tasks 처럼 제목, 종류·시간, 모델·토큰·도구 수·하는 일·대화 보기.
const KIND_LABEL = (agent: AgentRecord) => (agent.kind === 'shell' ? T.kindShell : agent.kind === 'monitor' ? T.kindMonitor : agent.type)
// 설명 앞 줄머리: 엔진 하단 목록처럼 SendMessage 이름(route-agent 등)이고, 이름 없는 에이전트는 비운다(설명만).
// 셸·모니터는 종류. 에이전트 종류(general-purpose)는 여럿이 같아 구별이 안 된다.
const AGENT_LABEL = (agent: AgentRecord) => agent.name ?? ((agent.kind ?? 'agent') === 'agent' ? undefined : KIND_LABEL(agent))
// 이름표 하나만 쓰는 곳(진행 띠, 레인): 줄머리가 없으면 설명.
const AGENT_TITLE = (agent: AgentRecord) => AGENT_LABEL(agent) ?? agent.description

// 도는 작업의 멈춤 버튼: 한 번 누르면 "멈출까요?", 5초 안에 한 번 더 누르면 멈춘다.
function stopButton(els: Els, $: EngineInterface, agent: AgentRecord, armed: Record<string, boolean>) {
  const isArmed = armed[`stop:${agent.id}`] ?? false
  return (
    <els.Button
      key={`stop-${agent.id}`}
      plain
      dimColor={!isArmed}
      label={isArmed ? T.stopConfirm : T.stop}
      onPress={() => void stopTask($, agent, isArmed).catch(() => undefined)}
    />
  )
}

// 목록의 카드 한 장: 데스크톱 Background tasks 처럼 제목, 종류·시간·상태, 그 아래 수치(에이전트) 또는 명령(셸·모니터).
function agentRow(els: Els, $: EngineInterface, agent: AgentRecord, number: number, now: number, columns: number, armed: Record<string, boolean>, inView: string | undefined) {
  const { Box, Text } = els
  const live = isLive(agent.status)
  const elapsed = agentElapsed(agent, now)
  const isAgent = agent.kind === undefined || agent.kind === 'agent'
  const open = () => void openAgents($, agent.id)
  return (
    <Box key={`agent-card-${agent.id}`} flexDirection="column" borderStyle="round" borderColor={live ? COLORS.clay : COLORS.border} paddingX={1}>
      {rowButton(els, { key: `agent-title-${agent.id}`, onPress: open }, clip(agent.description, Math.max(10, columns - 6)))}
      <Box columnGap={1}>
        <Text color={COLORS.muted}>{`${number}`}</Text>
        {AGENT_LABEL(agent) && <Text color={COLORS.muted}>{AGENT_LABEL(agent)}</Text>}
        {elapsed && <Text color={COLORS.muted}>{elapsed}</Text>}
        {!live && <Text color={AGENT_STATUS_COLOR[agent.status] ?? COLORS.muted}>{T.agentStatus[agent.status] ?? agent.status}</Text>}
        {agent.id === inView && <Text color={COLORS.clay}>{`◉ ${T.agentInView}`}</Text>}
      </Box>
      <Box columnGap={2} flexWrap="wrap">
        {isAgent ? (
          <Text color={COLORS.muted}>{agentFacts(agent).join('  ')}</Text>
        ) : (
          agent.command && agent.command !== agent.description && <Text color={COLORS.muted}>{clip(agent.command.split('\n')[0] ?? '', Math.max(10, columns - 30))}</Text>
        )}
        {live && agent.activity && <Text color={COLORS.clay}>{agent.activity}</Text>}
        {rowButton(els, { key: `agent-view-${agent.id}`, onPress: open }, isAgent ? T.viewTranscript : T.viewDetails)}
        {live && stopButton(els, $, agent, armed)}
        {!live && (
          <els.Button key={`dismiss-${agent.id}`} plain dimColor label={T.taskDismiss} onPress={() => void update($, agents, records => dismissAgents(records, [agent.id]))} />
        )}
      </Box>
    </Box>
  )
}

// diff 행 묶음(가상 스크롤 없이): 대화 속 편집 행처럼 짧은 곳에 쓴다. more 가 양수면 잘린 행 수를 흐리게.
function diffLines(els: Pick<Els, 'Box' | 'Text' | 'Code'>, palette: DiffPalette, rows: DiffRow[], key: string, path: string | undefined, columns: number, more = 0) {
  const options = { path, gutter: gutterWidth(rows), columns, unmodified: T.unmodifiedLines }
  return (
    <els.Box flexDirection="column">
      {diffBlocks(rows).map((block, index) => diffBlock(els, palette, block, `${key}.${index}`, options))}
      {more > 0 && <els.Text color={COLORS.muted}>{T.moreLines(more)}</els.Text>}
    </els.Box>
  )
}

// /desk-diff 패널 몸통(테마를 알 때): 모든 것을 높이가 정해진 항목으로 편 뒤 창(ui.scroll 이 알려 준 위치) 앞뒤 한 화면만
// 실제로 그리고, 나머지 연달은 항목은 높이만 있는 빈 Box 하나로 둔다. 다 그리면 3000줄에 초 단위가 걸린다.
type DiffSection =
  | { kind: 'note'; key: string; text: string; indent?: number }
  | { kind: 'element'; key: string; node: unknown }
  | { kind: 'file'; file: FileDiff; prefix: string; canRevert: boolean; indent: number; source: GapSource }
  | { kind: 'session'; edit: SessionEdit }

type VirtualDiff = {
  els: Els
  palette: DiffPalette
  window: { offset: number; bodyRows: number }
  columns: number
  head: unknown[]
  sections: DiffSection[]
  isFolded: (id: string) => boolean
  fileHeader: (file: FileDiff, prefix: string, canRevert: boolean, indent: number) => unknown
  sessionHeader: (edit: SessionEdit) => unknown
  notes: DiffNotes
  // 편 안 바뀐 구간(패치 키마다)과 구간 누름. git 파일만 편다(세션 기록의 편집은 그때의 줄 번호라 지금 파일과 안 맞는다).
  gaps: Record<string, OpenedGaps>
  onGap: (at: GapPress) => void
}

// 편 구간을 넣은 행과 덩어리: 스크롤마다 다시 만들지 않게 패치 키마다 하나 기억한다.
const openedCache = new Map<string, { patch: string; starts: string; made: { rows: DiffRow[]; blocks: DiffBlock[] } }>()

function withOpenedGaps(key: string, patch: string, opened: OpenedGaps | undefined): { rows: DiffRow[]; blocks: DiffBlock[] } {
  const made = patchBlocks(patch)
  if (!opened || opened.patch !== patch) return made
  const starts = Object.keys(opened.lines).join(',')
  const hit = openedCache.get(key)
  if (hit && hit.patch === patch && hit.starts === starts) return hit.made
  const rows = openGaps(made.rows, new Map(Object.entries(opened.lines).map(([start, lines]) => [Number(start), lines])))
  const next = { rows, blocks: diffBlocks(rows) }
  openedCache.set(key, { patch, starts, made: next })
  return next
}

// 줄 댓글을 패널에 잇는 것들: 고른 범위·단 댓글, diff 범위 이름, 번호 누름, 끼울 행 두 가지(높이 1).
type DiffNotes = {
  draft: CommentDraft | null
  comments: LineComment[]
  scopeOf: (prefix: string) => string
  onLine: (at: LinePress) => void
  draftRow: (key: string, draft: CommentDraft, lines: DiffLine[], pad: number) => unknown
  commentRow: (key: string, comment: LineComment, pad: number) => unknown
}

// 창이 아직 없을 때(막 열림) 한 화면으로 치는 행 수.
const DIFF_BODY_GUESS = 60

function virtualDiff(v: VirtualDiff) {
  const { Box, Text } = v.els
  type Item = { key: string; height: number; always?: boolean; node: () => unknown }
  const items: Item[] = []
  const tops = new Map<string, number>()
  // 창: 항목을 다 편 뒤 끝을 넘지 않게 깎는다(아래). 항목의 node 는 그 뒤에 불린다.
  const rows = v.window.bodyRows || DIFF_BODY_GUESS
  let windowTop = v.window.offset
  const isOnScreen = (key: string, height: number) => {
    const at = tops.get(key) ?? 0
    return at + height > windowTop && at < windowTop + rows
  }
  const spacer = (key: string) => items.push({ key, height: 1, node: () => <Box key={key} height={1} /> })
  const rowItems = (patch: string, key: string, path: string, indent: number, scope: string, source?: GapSource) => {
    const { rows, blocks } = source ? withOpenedGaps(key, patch, v.gaps[key]) : patchBlocks(patch)
    const gap = source ? { Button: v.els.Button, onPress: (at: Gap) => v.onGap({ key, patch, path, source, gap: at }) } : undefined
    const options = { path, gutter: gutterWidth(rows), columns: v.columns - indent, unmodified: T.unmodifiedLines, ...(gap ? { gap } : {}) }
    // 이 패치에 단 댓글과 쓰는 중인 댓글은 범위 끝 줄 뒤에 한 행씩 끼운다: 덩어리를 그 줄에서 나눈다.
    const pad = indent + 1 + options.gutter
    const draft = v.notes.draft?.patch === key ? v.notes.draft : null
    const picked = draft ? rangeOf(rows, draft.anchor, draft.end) : null
    const after = new Map<number, Item[]>()
    const insert = (row: number, item: Item) => after.set(row, [...(after.get(row) ?? []), item])
    v.notes.comments.forEach(comment => {
      const row = comment.patch === key ? rowOf(rows, comment.end) : -1
      if (row !== -1) insert(row, { key: `cm-${comment.id}`, height: 1, node: () => v.notes.commentRow(`cm-${comment.id}`, comment, pad) })
    })
    if (draft && picked) insert(picked[1], { key: 'cm-draft', height: COMMENT_ROWS, node: () => v.notes.draftRow('cm-draft', draft, linesIn(rows, picked), pad) })
    const cuts = [...after.keys()].sort((a, b) => a - b)
    const cutBlocks =
      cuts.length === 0
        ? blocks
        : [...cuts, rows.length - 1].flatMap((cut, index) => diffBlocks(rows.slice(index === 0 ? 0 : (cuts[index - 1] ?? 0) + 1, cut + 1)))
    const pick = {
      Button: v.els.Button,
      mark: COLORS.link,
      isPicked: (row: number) => picked !== null && row >= picked[0] && row <= picked[1],
      onPress: (row: number) => {
        const at = rows[row]
        if (at?.kind === 'line') v.notes.onLine({ patch: key, path, scope, line: at.line })
      },
    }
    let row = 0
    cutBlocks.forEach((block, index) => {
      const rowKey = `${key}.${index}`
      const first = row
      row += block.kind === 'gap' ? 1 : block.lines.length
      items.push({
        key: rowKey,
        height: blockHeight(block),
        node: () => {
          const blockOptions = block.kind === 'lines' && isOnScreen(rowKey, blockHeight(block)) ? { ...options, pick: { ...pick, first } } : options
          if (indent === 0) return diffBlock(v.els, v.palette, block, rowKey, blockOptions)
          return (
            <Box key={rowKey} paddingLeft={indent}>
              {diffBlock(v.els, v.palette, block, `${rowKey}.r`, blockOptions)}
            </Box>
          )
        },
      })
      items.push(...(after.get(row - 1) ?? []))
    })
  }
  // 안내 글은 좁은 패널에서 잘리지 않게 줄바꿈한다. 높이는 폭으로 셈해 정해 둔다(세 줄까지).
  const note = (key: string, text: string, indent = 0) => {
    const height = Math.min(3, Math.max(1, Math.ceil(cellWidth(text) / Math.max(10, v.columns - indent))))
    items.push({
      key,
      height,
      node: () => (
        <Box key={key} height={height} overflow="hidden" paddingLeft={indent}>
          <Text color={COLORS.muted}>{text}</Text>
        </Box>
      ),
    })
  }

  // 머리(범위 탭 아래 한 칸), 그리고 목록 앞과 git 밖 편집 묶음 앞에만 빈 줄. 파일 머리 띠끼리는 띄우지 않는다(데스크톱처럼 띠 바탕으로 나뉜다).
  v.head.forEach((node, index) => {
    if (index === 1) spacer('h-gap')
    items.push({ key: `h-${index}`, height: 1, always: true, node: () => node })
  })
  const heads: { id: string; key: string }[] = []
  v.sections.forEach((section, index) => {
    if (index === 0 || (section.kind === 'element' && section.key === 'outside')) spacer(`gap-${items.length}`)
    rowSection(section)
  })
  function rowSection(section: DiffSection) {
    if (section.kind === 'note') note(`note-${section.key}`, section.text, section.indent)
    else if (section.kind === 'element') {
      items.push({
        key: `el-${section.key}`,
        height: 1,
        always: true,
        node: () => (
          <Box key={`el-${section.key}`} height={1} overflow="hidden">
            {section.node as never}
          </Box>
        ),
      })
    }
    else if (section.kind === 'file') {
      const { file, prefix, indent } = section
      const id = `${prefix}${file.path}`
      heads.push({ id, key: `fh-${id}` })
      items.push({ key: `fh-${id}`, height: 1, always: true, node: () => v.fileHeader(file, prefix, section.canRevert, indent) })
      if (v.isFolded(id)) return
      if (!file.patch) note(`bin-${id}`, file.large ? T.largeDiff : T.binary, indent + 2)
      else rowItems(file.patch, `d-${id}`, file.path, indent, v.notes.scopeOf(prefix), section.source)
    } else {
      const { edit } = section
      const id = `${OUTSIDE}${edit.path}`
      heads.push({ id, key: `fh-${id}` })
      items.push({ key: `fh-${id}`, height: 1, always: true, node: () => v.sessionHeader(edit) })
      if (v.isFolded(id)) return
      if (edit.patches.length === 0) note(`bin-${id}`, T.binary, 2)
      // 편집마다 따로: 서로 다른 시점의 줄 번호를 한 diff 로 잇지 않는다.
      edit.patches.forEach((patch, index) => {
        if (index > 0) note(`next-${id}-${index}`, T.nextEdit, 2)
        rowItems(patch, `s-${id}-${index}`, edit.path, 0, v.notes.scopeOf(OUTSIDE))
      })
    }
  }

  // 누를 수 있는 번호 칸(줄마다 버튼)은 지금 보이는 덩어리에만: 앞뒤로 미리 그리는 두 화면까지 달면 스크롤이 35~45% 무거워진다.
  let top = 0
  for (const item of items) {
    tops.set(item.key, top)
    top += item.height
  }
  diffHeads = heads.map(head => ({ id: head.id, top: tops.get(head.key) ?? 0 }))
  // 내용이 줄어 창이 끝을 넘으면 엔진은 다시 묻지 않고 창을 끝으로 깎는다. 그 자리를 미리 그린다.
  windowTop = Math.max(0, Math.min(windowTop, top - rows))
  const steps = windowPlan(items, windowTop, rows)
  const drawn = steps.map((step, index) => ('skip' in step ? <Box key={`skip-${index}`} height={step.skip} /> : items[step.draw]?.node()))
  return <Box flexDirection="column">{drawn as never}</Box>
}

// 호출 하나를 펼쳤을 때: 명령과 출력, 편집 diff, 새 파일 내용.
function callDetail({ Box, Text, Code }: Els, call: RunCall, columns: number) {
  const fields = fieldsOf(call.input)
  const filePath = stringField(fields, 'file_path') ?? stringField(fields, 'notebook_path')
  const output = outputText(call.output)
  switch (call.tool) {
    case 'Bash':
      return (
        <Box flexDirection="column">
          <Code source={stringField(fields, 'command') ?? ''} language="bash" wrap="wrap" />
          {output && <Text color={COLORS.muted}>{cap(output, 30)}</Text>}
        </Box>
      )
    case 'Edit':
    case 'MultiEdit': {
      const edits = call.tool === 'Edit' ? [fields] : Array.isArray(fields.edits) ? fields.edits.map(fieldsOf) : []
      const guessed = edits.map(edit => editHunk(stringField(edit, 'old_string') ?? '', stringField(edit, 'new_string') ?? ''))
      const patch = patchOf(call.output) ?? guessed.join('\n')
      if (!diffColors) return <Code source={cap(patch, 40)} path={filePath} format="diff" />
      // 데스크톱 모양 diff. 대화 안이라 안 바뀐 구간 표시는 빼고 40행까지.
      const rows = diffRows(parseHunks(patch), false)
      return diffLines({ Box, Text, Code }, diffColors, rows.slice(0, 40), `edit-${call.tool_use_id}`, filePath, columns, rows.length - 40)
    }
    case 'Write':
      return <Code source={cap(stringField(fields, 'content') ?? '', 40)} path={filePath} />
    default:
      return <Text color={COLORS.muted}>{cap(output || JSON.stringify(call.input, null, 2), 20)}</Text>
  }
}

// 백그라운드 작업이 끝났다는 알림 한 줄: "✓ Find chin in README  completed · 5s".
// 제목은 그 작업을 띄운 호출의 설명(에이전트) 또는 요약(명령), 모르면 알림 글의 첫 줄.
const TASK_MARK: Record<string, { mark: string; color: string }> = {
  completed: { mark: '✓', color: COLORS.success },
  failed: { mark: '✕', color: COLORS.danger },
  killed: { mark: '■', color: COLORS.muted },
}

function taskRow(els: Els, task: { status?: string; toolUseId?: string; durationMs?: number }, text: string, state: Runs) {
  const { Box, Text } = els
  const call = Object.values(state.calls)
    .flat()
    .find(item => item.tool_use_id === task.toolUseId)
  const fields = fieldsOf(call?.input)
  const title =
    stringField(fields, 'description') ?? (call ? summarize(call.tool, call.input) : undefined) ?? text.split('\n')[0] ?? ''
  const style = TASK_MARK[task.status ?? ''] ?? { mark: '◆', color: COLORS.clay }
  const facts = [task.status, task.durationMs !== undefined ? formatElapsed(task.durationMs) : null].filter(Boolean).join(' · ')
  return (
    <Box columnGap={1}>
      <Text color={style.color}>{style.mark}</Text>
      <Text color={COLORS.text} wrap="truncate-end">
        {title}
      </Text>
      {facts !== '' && <Text color={COLORS.muted}>{facts}</Text>}
    </Box>
  )
}

// 글을 짧은 키로(같은 메시지는 같은 키): 펼침 상태를 메시지마다 기억한다.
export function textKey(text: string): string {
  let hash = 5381
  for (let index = 0; index < text.length; index++) hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0
  return (hash >>> 0).toString(36)
}

// 에이전트가 보낸 메시지: "◆ Explore  첫 줄 미리보기 ›", 누르면 본문을 마크다운으로.
function peerRow(els: Els, $: EngineInterface, name: string, text: string, openState: Record<string, boolean>, columns: number) {
  const { Box, Text, Button } = els
  const key = `peer-${textKey(name + text)}`
  const isOpen = openState[key] ?? false
  const preview = text.split('\n').find(line => line.trim() !== '')?.trim() ?? ''
  const who = name.replace(/^@/, '')
  return (
    <Box flexDirection="column">
      <Box columnGap={1}>
        <Text color={COLORS.clay}>◆</Text>
        {rowButton(
          els,
          { key, onPress: () => toggle($, key, isOpen) },
          who,
          !isOpen && preview !== '' && <Text color={COLORS.muted}>{` ${clip(preview, Math.max(10, columns - cellWidth(who) - 6))}`}</Text>,
          <Text color={COLORS.muted}>{isOpen ? ' ⌄' : ' ›'}</Text>,
        )}
      </Box>
      {isOpen && (
        <Box marginLeft={2} paddingX={1} borderStyle="round" borderColor={COLORS.border} flexDirection="column">
          {renderMarkdown(text, els, COLORS, Math.max(20, columns - 8))}
        </Box>
      )}
    </Box>
  )
}

// 긴 붙여넣기: 엔진이 모델에게 경계를 알리려 <pasted_content id="…"> 로 감싼 글. 화면에서는 태그를 걷어 낸다.
const PASTE_BLOCK = /<pasted_content id="([^"]*)">\n?([\s\S]*?)\n?<\/pasted_content(?: id="\1")?>/g

export function splitPastes(text: string): { text: string; pastes: string[] } {
  const pastes: string[] = []
  const rest = text.replace(PASTE_BLOCK, (_block, _id, body: string) => {
    pastes.push(body)
    return ''
  })
  return { text: rest, pastes }
}

// 붙여넣은 글 한 줄 칩: "❐ 붙여넣은 글 · 3줄  첫 줄 미리보기 ›", 누르면 그 자리에서 펼친다. ctrl+o 화면은 늘 펼침.
function pasteChip(els: Els, $: EngineInterface, body: string, index: number, openState: Record<string, boolean>, columns: number, isExpanded: boolean, edge: 'flex-start' | 'flex-end') {
  const { Box, Text } = els
  const key = `paste-${textKey(body)}-${index}`
  const isOpen = isExpanded || (openState[key] ?? false)
  const label = T.pasted(body.split('\n').length)
  const preview = body.split('\n').find(line => line.trim() !== '')?.trim() ?? ''
  const width = Math.floor(columns * 0.85)
  return (
    <Box key={key} flexDirection="column" alignItems={edge}>
      <Box columnGap={1}>
        <Text color={COLORS.clay}>❐</Text>
        {rowButton(
          els,
          { key, onPress: () => toggle($, key, isOpen) },
          label,
          !isOpen && preview !== '' && <Text color={COLORS.muted}>{`  ${clip(preview, Math.max(10, width - cellWidth(label) - 6))}`}</Text>,
          !isExpanded && <Text color={COLORS.muted}>{isOpen ? ' ⌄' : ' ›'}</Text>,
        )}
      </Box>
      {isOpen && (
        <Box width={width} paddingX={1} borderStyle="round" borderColor={COLORS.border}>
          <Text color={COLORS.text}>{body}</Text>
        </Box>
      )}
    </Box>
  )
}

// 서브에이전트 카드: 데스크톱처럼 에이전트마다 한 장. 종류·설명, 끝나면 도구 수·토큰·시간·바꾼 줄.
// 설명을 누르면 결과 글을 마크다운으로 펼친다.
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${Number((count / 1_000_000).toFixed(1))}M`
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count)
}

function agentCard(els: Els, $: EngineInterface, call: RunCall, openState: Record<string, boolean>) {
  const { Box, Text, Button } = els
  const fields = fieldsOf(call.input)
  const id = call.tool_use_id
  const isOpen = openState[id] ?? false
  const summary = agentOf(call.output)
  const kind = stringField(fields, 'subagent_type') ?? summary?.type ?? 'agent'
  const title = stringField(fields, 'description') ?? stringField(fields, 'name') ?? 'Agent'
  const isBackground = summary?.status === 'async_launched'
  const facts = [
    summary?.toolUses !== undefined ? `${summary.toolUses} tool use${summary.toolUses === 1 ? '' : 's'}` : null,
    summary?.tokens !== undefined ? `${formatTokens(summary.tokens)} tokens` : null,
    summary?.durationMs !== undefined ? formatElapsed(summary.durationMs) : null,
  ].filter((fact): fact is string => fact !== null)
  const changed = (summary?.added ?? 0) + (summary?.removed ?? 0) > 0
  const body = summary?.text ?? (isOpen ? cap(stringField(fields, 'prompt') ?? '', 12) : '')

  return (
    <Box flexDirection="column" alignSelf="flex-start" borderStyle="round" borderColor={call.isRunning ? COLORS.clay : COLORS.border} paddingX={1}>
      <Box columnGap={1}>
        <Text color={COLORS.clay}>{call.isRunning ? '···' : '◆'}</Text>
        <Text color={COLORS.muted}>{kind}</Text>
        {rowButton(
          els,
          { key: `agent-${id}`, onPress: () => toggle($, id, isOpen) },
          title,
          call.isRunning && <Text color={COLORS.muted}> running</Text>,
          isBackground && <Text color={COLORS.muted}> in background</Text>,
          call.isErrored && !call.isInterrupted && <Text color={COLORS.danger}> failed</Text>,
          call.isInterrupted && <Text color={COLORS.muted}> interrupted</Text>,
          body !== '' && <Text color={COLORS.muted}>{isOpen ? ' ⌄' : ' ›'}</Text>,
        )}
      </Box>
      {(facts.length > 0 || changed) && (
        <Box columnGap={1}>
          <Text color={COLORS.muted}>{facts.join(' · ')}</Text>
          {changed && diffChips(Text, summary?.added ?? 0, summary?.removed ?? 0)}
        </Box>
      )}
      {isOpen && body !== '' && (
        <Box marginTop={1} flexDirection="column">
          {summary?.text ? renderMarkdown(cap(summary.text, 40), els, COLORS, 76) : <Text color={COLORS.muted}>{body}</Text>}
        </Box>
      )}
    </Box>
  )
}

// 계획 카드에서 접힌 채 보일 만큼: 줄 수가 넘으면 그다음 빈 줄(코드 울타리 밖)에서 자른다.
const PLAN_ROWS = 14

export function splitPlan(plan: string, rows: number): { head: string; hidden: number } {
  const lines = plan.split('\n')
  let fenced = false
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? ''
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    if (index >= rows && !fenced && line.trim() === '') {
      const hidden = lines.slice(index).filter(rest => rest.trim() !== '').length
      return hidden > 0 ? { head: lines.slice(0, index).join('\n'), hidden } : { head: plan, hidden: 0 }
    }
  }
  return { head: plan, hidden: 0 }
}

// 계획(ExitPlanMode): 데스크톱처럼 묶음에 섞지 않고 카드로. 승인 창은 엔진 것이고 이건 기록에 남는 모습.
function planCard(els: Els, $: EngineInterface, call: RunCall, openState: Record<string, boolean>, columns: number) {
  const { Box, Text } = els
  // 거절된 호출(고칠 점을 받은 것 등)은 결과에 계획이 없어 입력의 계획을 그린다.
  const given = (call.input as { plan?: unknown } | undefined)?.plan
  const plan = planOf(call.output)?.plan ?? (typeof given === 'string' ? given : '')
  const key = `plan-${call.tool_use_id}`
  const isOpen = openState[key] ?? false
  // 승인 창이 떠 있는 동안 엔진은 이 호출을 아직 시작 전으로 넘긴다(isRunning false, 결과·오류 없음).
  const isWaiting = call.isRunning || (call.output === undefined && !call.isErrored)
  const status = isWaiting
    ? { label: T.planWaiting, color: COLORS.muted }
    : call.isInterrupted
      ? { label: T.planInterrupted, color: COLORS.muted }
      : call.isErrored
        ? { label: T.planRejected, color: COLORS.danger }
        : { label: T.planApproved, color: COLORS.success }
  const width = Math.max(30, Math.min(columns - 2, 100))
  const { head, hidden } = splitPlan(plan, PLAN_ROWS)
  const empty = isWaiting ? T.planInDialog : T.planMissing
  return (
    <Box flexDirection="column" width={width} borderStyle="round" borderColor={COLORS.clay} paddingX={1}>
      <Box columnGap={1}>
        <Text color={COLORS.clay}>◇</Text>
        <Text color={COLORS.text} weight="semibold">
          Plan
        </Text>
        <Text color={status.color}>{status.label}</Text>
      </Box>
      {plan === '' ? <Text color={COLORS.muted}>{empty}</Text> : renderMarkdown(isOpen ? plan : head, els, COLORS, width - 4)}
      {hidden > 0 &&
        rowButton(els, { key, dimColor: true, onPress: () => toggle($, key) }, isOpen ? 'Show less' : `Show all · ${hidden} more lines`)}
    </Box>
  )
}

// 호출 한 줄: "Edited register.tsx +12 −3 ›", 누르면 아래로 펼친다.
function callLine(els: Els, $: EngineInterface, call: RunCall, openState: Record<string, boolean>, columns: number, indent = 0, openFirst = false) {
  if (isAgentTool(call.tool)) return agentCard(els, $, call, openState)
  if (isPlanTool(call.tool)) return planCard(els, $, call, openState, columns)
  const { Box, Text, Button } = els
  const id = call.tool_use_id
  const isOpen = openState[id] ?? openFirst
  const stat = diffStat(call)
  const answer = call.tool === 'AskUserQuestion' ? askAnswer(call.output) : null
  // 마크다운 문서를 쓰거나 고친 행, preview 도구 행: 줄 끝에 미리보기 칩.
  const doc = previewOf(call)
  // 버튼 안의 글은 칸에 맞춰 잘리지 않으니 직접 자른다(동사·칩·꺾쇠 몫을 빼고).
  const room = Math.max(12, columns - indent - cellWidth(verbOf(call.tool)) - (stat ? 16 : 0) - (doc ? cellWidth(T.previewChip) + 1 : 0) - 8)
  return (
    <Box flexDirection="column" paddingLeft={indent}>
      <Box columnGap={1}>
        {call.isRunning && <Text color={COLORS.clay}>···</Text>}
        {rowButton(
          els,
          { key: `row-${id}`, dimColor: true, onPress: () => toggle($, id, isOpen) },
          verbOf(call.tool),
          <Text color={COLORS.muted}>{` ${clip(summarize(call.tool, call.input), answer ? Math.ceil(room / 2) : room)}`}</Text>,
          stat && ' ',
          stat && diffChips(els.Text, stat.added, stat.removed),
          answer && <Text color={COLORS.text}>{` → ${clip(answer, Math.floor(room / 2))}`}</Text>,
          call.isErrored && !call.isInterrupted && <Text color={COLORS.danger}> failed</Text>,
          call.isInterrupted && <Text color={COLORS.muted}> interrupted</Text>,
          <Text color={COLORS.muted}>{isOpen ? ' ⌄' : ' ›'}</Text>,
        )}
        {doc !== null && previewChip(els, $, id, doc)}
      </Box>
      {isOpen && (
        <Box marginLeft={2} borderStyle="round" borderColor={COLORS.border} paddingX={1} flexDirection="column">
          {callDetail(els, call, columns - indent - 6)}
        </Box>
      )}
    </Box>
  )
}

// 묶음 한 줄: "Ran 2 commands, edited 3 files +54 −12 ›", 펼치면 호출마다 한 줄.
// 데스크톱처럼 성공한 편집은 펼치자마자 diff 까지 보인다.
function runLine(els: Els, $: EngineInterface, runId: string, calls: RunCall[], openState: Record<string, boolean>, columns: number) {
  // 에이전트만 모인 묶음은 접지 않고 카드를 쌓는다.
  if (calls.length > 0 && calls.every(call => isAgentTool(call.tool))) {
    return <els.Box flexDirection="column">{calls.map(call => agentCard(els, $, call, openState))}</els.Box>
  }
  const { Box, Text, Button } = els
  const key = `run-${runId}`
  const isOpen = openState[key] ?? false
  const stats = calls.map(diffStat).filter((stat): stat is { added: number; removed: number } => stat !== null)
  const added = stats.reduce((sum, stat) => sum + stat.added, 0)
  const removed = stats.reduce((sum, stat) => sum + stat.removed, 0)
  // 접힌 묶음 줄은 파일 이름을 말하지 않으니 칩에 문서 이름을 단다(둘까지). 펼치면 호출 줄마다 칩이 있다.
  const docs = isOpen ? [] : [...new Set(calls.map(previewOf).filter((path): path is string => path !== null))].slice(0, 2)
  return (
    <Box flexDirection="column">
      <Box columnGap={1}>
        {calls.some(call => call.isRunning) && <Text color={COLORS.clay}>···</Text>}
        {rowButton(
          els,
          { key, dimColor: true, onPress: () => toggle($, key) },
          describeCalls(calls),
          stats.length > 0 && ' ',
          stats.length > 0 && diffChips(els.Text, added, removed),
          <Text color={COLORS.muted}>{isOpen ? ' ⌄' : ' ›'}</Text>,
        )}
        {docs.map(path => previewChip(els, $, `${runId}-${path}`, path, `◫ ${clipStart(fileName(path), 24)}`))}
      </Box>
      {isOpen && calls.map(call => callLine(els, $, call, openState, columns, 2, isEditShown(call)))}
    </Box>
  )
}

const isEditShown = (call: RunCall) => FILE_EDITING.has(call.tool) && call.tool !== 'Write' && diffStat(call) !== null

export type RowPlan = { kind: 'hide' } | { kind: 'run'; first: string; calls: RunCall[] } | { kind: 'own' }

// 행(ToolUse 하나, 또는 엔진이 접은 ToolGroup 하나)이 맡은 호출 id 들로 무엇을 그릴지 정한다.
// 묶음 첫 호출을 가진 행이 묶음 전체를 그리고, 그 묶음의 다른 행은 비운다.
export function planRow(ids: ReadonlyArray<string>, runs: Runs): RowPlan {
  const first = ids[0] !== undefined ? runs.firstOf[ids[0]] : undefined
  if (first === undefined) return { kind: 'own' }
  if (!ids.includes(first)) return { kind: 'hide' }
  const calls = runs.calls[first] ?? []
  return calls.length > ids.length ? { kind: 'run', first, calls } : { kind: 'own' }
}

// 묶음에 호출 말고 다른 줄(떠올린 메모리, 훅 시간)이 섞였는지. 그 줄은 props 에 없어 그릴 수 없으니 엔진에 맡긴다.
// isCallsOnly 는 실패·중단된 호출에도 false 라, 그런 호출이 있으면 가릴 수 없어 desk-look 이 그린다(실패는 직접 알린다).
// 더 큰 묶음의 일부인 행에는 쓰지 않는다: 그 묶음의 다른 행이 비어 있어 넘기면 호출이 사라진다.
export const hasOtherRows = (props: { calls: ReadonlyArray<ToolGroupCall>; isCallsOnly?: boolean }) =>
  props.isCallsOnly === false && !props.calls.some(call => call.isErrored || call.isInterrupted)

const asRunCall = (call: ToolGroupCall | (Call & { tool_use_id: string })): RunCall => ({
  tool_use_id: call.tool_use_id ?? '',
  tool: call.tool,
  input: call.input,
  isRunning: call.isRunning,
  isErrored: call.isErrored,
  isInterrupted: call.isInterrupted,
  output: call.output,
})

// 내 말풍선 위치(설정 메뉴의 bubbleSide). 왼쪽이 기본: 엔진이 말풍선 아래에 그리는 첨부 줄(└ …)이 왼쪽이라 나란해진다.
export function bubbleSide(options: Record<string, unknown>): 'left' | 'right' {
  return options.bubbleSide === 'right' ? 'right' : 'left'
}

// 턴이 끝난 뒤 진행 띠를 남겨 두는 시간(설정 메뉴의 bandAfterTurn). 0 은 바로 접고, Infinity 는 ✕ 로 닫을 때까지.
export function bandStayMs(options: Record<string, unknown>): number {
  const value = options.bandAfterTurn
  if (value === 'off') return 0
  if (value === 'keep') return Infinity
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 30_000
}

export const register: Register = (on, options) => {
  const side = bubbleSide(options)
  const edge = side === 'right' ? 'flex-end' : 'flex-start'
  const chipMode = contextChipMode(options)
  const showPr = options.prBar !== 'off'
  const bandStay = bandStayMs(options)
  // 화면 언어: 설정이 en·ko 면 그것, auto 면 세션이 시작될 때 Claude Code /config 의 language 를 따른다.
  const language = langSetting(options)
  setLang(language === 'auto' ? 'en' : language)
  registerAsk(on, options.askNotify !== 'off')
  registerPlanAsk(on, options.askNotify !== 'off')
  const isGather = options.replyInBlocks !== 'off'
  const isPreviewAuto = options.previewAutoOpen !== 'off'

  on('session.start', async ($, e, next) => {
    if (language === 'auto') {
      const row = (await $.config.list().catch(() => [])).find(item => item.key === 'language')
      if (setLang(langFromConfig(row?.value))) $.ui.invalidate('ui.render')
    }
    // 도구를 못 걸어도(엔진이 거절) 아래 명령·언어 설정은 그대로 한다.
    await $.tool.register(previewTool(isPreviewAuto)).catch(() => undefined)
    // 패널만 여는 명령은 턴 중에도 바로 연다(immediate). 큐에 넣지 않고, 턴 상태에 기대지 않는다.
    await $.command.register({ name: 'desk-preview', description: T.cmdPreview, argumentHint: T.cmdPreviewHint, immediate: true })
    await $.command.register({
      name: 'desk-sessions',
      description: T.cmdSessions,
      argumentHint: T.cmdSessionsHint,
      immediate: true,
    })
    await $.command.register({
      name: 'desk-diff',
      description: T.cmdDiff,
      argumentHint: T.cmdDiffHint,
      immediate: true,
    })
    await $.command.register({
      name: 'desk-pr',
      description: T.cmdPr,
      immediate: true,
    })
    await $.command.register({
      name: 'desk-context',
      description: T.cmdContext,
      immediate: true,
    })
    await $.command.register({
      name: 'desk-activity',
      description: T.cmdActivity,
      immediate: true,
    })
    await $.command.register({
      name: 'desk-tasks',
      description: T.cmdAgents,
      argumentHint: T.cmdAgentsHint,
      immediate: true,
    })
    await $.command.register({
      name: 'desk-fold',
      description: T.cmdFold,
      immediate: true,
    })
    await $.command.register({
      name: 'desk-quote',
      description: T.cmdQuote,
      immediate: true,
    })
    await $.command.register({
      name: 'desk-update',
      description: T.cmdUpdate,
    })
    refreshSessionState($, showPr)
    // 테마를 바꾸면 3초 안에 말풍선·아래턱 색이 따라간다. 바뀌지 않았으면 다시 그리지 않는다.
    themeWatch?.cancel()
    themeWatch = $.clock.every(THEME_POLL, () => void refreshSurface($).catch(() => undefined))
    return next(e)
  })

  // 창 안의 /resume·/clear 는 이 세션을 끝내고 새 세션으로 이어 가지만 session.start 는 오지 않는다.
  // 상태(atom)는 세션마다라 비워진 채 칩·패널만 남으므로, 넘어간 뒤 다시 읽는다.
  on('session.end', async ($, e, next) => {
    const done = await next(e)
    if (e.reason === 'resume' || e.reason === 'clear') $.clock.after(300, () => refreshSessionState($, showPr))
    return done
  })

  // 압축은 컨텍스트 패널의 세션 흐름에 ▲ 로 남긴다. 압축이 일어날 때만 불려 평소엔 하는 일이 없다.
  // precompute 는 아무것도 바꾸지 않고, 에이전트의 압축은 메인 대화의 창이 아니다.
  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && done.skip === undefined) {
      const at = await $.clock.now()
      contextCompactions = [...contextCompactions, { at, trigger: e.trigger, before: done.tokensBefore ?? null, after: done.tokensAfter ?? null }].slice(-CONTEXT_COMPACTIONS)
    }
    return done
  })

  // 타이핑·붙여넣기는 prompt.edit 로 온다. 편집이 만든 상자를 칠한다. 인용을 넣는 채우기는 quoteSelection 이 칠한다.
  // prompt.change(기록 불러오기·채우기)는 훅으로 받지 않는다: 디렉터리가 아직 모르는 이벤트라 mod 가 거부된다.
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    const decorations = quoteDecorations(box.text)
    if (decorations.length > 0 || quoteDecorations(e.text).length > 0) void $.prompt.paint({ text: box.text, decorations }).catch(() => undefined)
    return box
  })

  // 테마를 바꿨을 수 있으니 프롬프트마다 다시 읽는다(타이머를 기다리지 않게).
  on('prompt.submit', async ($, e, next) => {
    void refreshSurface($).catch(() => undefined)
    // 턴 도중에 끼어든 프롬프트도 열린 도구 묶음을 닫는다(computeRuns 가 프롬프트에서 끊듯이)
    runCursor = null
    // 실행 중인 턴에 들어가는 입력(슬래시 명령·턴 끝까지 기다리게 한 것은 빼고)은 다음 단계의 effort 를 세운다
    if (e.turnId !== undefined && e.command === undefined && !e.wait) inputIntoTurn = true
    // 사람이 어디서 입력했는지: 질문 카드가 Remote Control 세션에서 카드를 띄울지 고른다(ask.tsx)
    const origin = e.origin.kind
    if (origin === 'composer' || origin === 'bridge') await update($, promptOrigin, () => origin).catch(() => undefined)
    // 백그라운드 작업이 끝났다는 알림: 셸·모니터는 이것으로만 끝을 안다.
    if (e.origin.kind === 'task-notification') {
      const notices = parseNotices(e.text)
      if (notices.length > 0) {
        const now = await $.clock.now()
        await update($, agents, records => applyNotices(records, notices, now)).catch(() => undefined)
        const view = await read($, agentView)
        if (notices.some(notice => notice.id === view)) void refreshAgentDetail($).catch(() => undefined)
      }
    }
    // 줄 댓글은 사람이 친 프롬프트에 보이지 않는 context 로 붙여 보내고 비운다(슬래시 명령에는 붙이지 않는다).
    const notes = !e.command && (origin === 'composer' || origin === 'bridge') ? await read($, lineComments) : []
    const submitted = await next(notes.length > 0 ? { ...e, context: [...(e.context ?? []), commentContext(notes)] } : e)
    if (notes.length > 0 && !('drop' in submitted)) {
      await update($, lineComments, list => list.filter(item => !notes.some(sent => sent.id === item.id)))
      $.ui.toast(T.commentsSent(notes.length))
    }
    // 붙여 넣은 이미지가 저장된 뒤 다시 훑는다. 말풍선이 이 값을 읽어 썸네일로 다시 그려진다.
    void refreshImages($).catch(() => undefined)
    return submitted
  })

  // 대화에 메시지가 붙을 때마다 도구 묶음을 다시 계산한다. 첫 행이 이 값을 읽어 다시 그려진다.
  on('session.append', async ($, e, next) => {
    const appended = await next(e)
    if (e.agentId === undefined && (e.message.type === 'assistant' || e.message.type === 'user')) {
      void refreshRuns($).catch(() => undefined)
    }
    if (e.agentId === undefined && e.message.type !== 'assistant') {
      void refreshImages($).catch(() => undefined)
    }
    if (e.agentId !== undefined && e.agentId === (await read($, agentView))) {
      void refreshAgentDetail($).catch(() => undefined)
    }
    return appended
  })

  on('turn.start', async ($, e, next) => {
    // 서브에이전트·팀원의 턴도 온다. 메인 턴의 상태는 두고, 끝났던 에이전트가 다시 돌면(SendMessage·재개) 바로 실행 중으로.
    if (e.agentId !== undefined) {
      const id = e.agentId
      await patchAgent($, id, agent => (isLive(agent.status) ? {} : { status: 'running', endedAt: undefined, dismissed: undefined, activity: undefined })).catch(() => undefined)
      if ((await read($, agents))[id] !== undefined) startAgentClock($)
      return next(e)
    }
    void refreshHerdrRemote($).catch(() => undefined)
    await update($, pendingEdits, () => [])
    await update($, previewWritten, () => null)
    const now = await $.clock.now()
    await update($, turnStartedAt, () => now)
    await update($, bandDoneAt, () => null)
    // 진행 띠의 셈은 턴마다 새로. 하는 중인 할 일도 이 턴 시작부터 잰다(턴 사이에 쉰 시간은 빼고).
    stopProcWatch()
    const openTasks = await read($, tasks)
    await update($, turnActivity, () => ({ ...IDLE_ACTIVITY, taskSince: taskSinceOf(openTasks, {}, now), idleSince: now }))
    pendingLogStart = now
    // 프롬프트가 열린 묶음을 닫는다. 끝내 기록에 오르지 못한 예측(중단된 스트림)도 여기서 버린다.
    runCursor = null
    predicted = []
    backgroundHints.clear()
    void noticeMoved($).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      const files = await read($, pendingEdits)
      const text = done.text.trim().slice(0, MAX_COPY)
      const stats = turnStats(await read($, turnActivity), await read($, tasks), e.durationMs)
      if (files.length > 0 || text !== '') {
        await update($, turnCards, cards => [...cards, { durationMs: e.durationMs, files, text, stats }].slice(-TURN_CARDS))
      }
      stopProcWatch()
      await update($, turnActivity, state => ({ ...state, calls: [], proc: null, idleSince: null }))
      // 메인 작업이 없던 턴(글로만 답한 턴, 백그라운드 끝남 알림)은 지난 턴 기록을 그대로 둔다.
      if (pendingLogStart !== null) pendingLogStart = null
      else await update($, activityLog, log => (log === null ? log : { ...log, endedAt: log.startedAt + e.durationMs }))
      await update($, pendingEdits, () => [])
      await update($, turnStartedAt, () => null)
      if (bandStay > 0) {
        const endedAt = await $.clock.now()
        await update($, bandDoneAt, () => endedAt)
        if (Number.isFinite(bandStay)) $.clock.after(bandStay, () => void update($, bandDoneAt, at => (at === endedAt ? null : at)).catch(() => undefined))
      }
      void refreshUsage($, { usage: e.usage }).catch(() => undefined)
      if (showPr) void refreshPr($, false).catch(() => undefined)
      // 이번 턴에 쓴 문서가 아직 패널에 없으면 연다.
      const doc = await read($, previewWritten)
      await update($, previewWritten, () => null)
      if (doc !== null && !(await isPreviewed($, doc).catch(() => false))) await openPreview($, doc).catch(() => undefined)
    } else {
      // 서브에이전트 한 번의 실행이 끝났다. 상태는 곧 엔진 목록으로 다시 맞춘다(다시 깨어날 수 있다).
      const now = await $.clock.now()
      const status = e.reason === 'answer' ? 'completed' : e.reason === 'aborted' ? 'killed' : 'failed'
      await patchAgent($, e.agentId, () => ({ status, endedAt: now, activity: undefined }))
      void refreshAgents($).catch(() => undefined)
    }
    return done
  })

  on('command.run', { command: 'desk-sessions' }, async ($, e) => {
    const index = Number.parseInt(e.args.trim(), 10)
    if (Number.isInteger(index) && index > 0) {
      const list = numbered(await read($, sessions), await $.session.cwd(), PER_GROUP, await $.session.id())
      const entry = list[index - 1]
      if (!entry) return { text: T.noSession(index) }
      await openSession($, entry)
      return { text: T.sessionPicked(index, entry.title) }
    }
    await refreshSessions($)
    await $.ui.open({ ...(await paneLook($)), id: SESSIONS_PANE, title: T.paneSessions, focus: true })
    return { text: T.sessionsOpened }
  })

  // 마켓 목록을 새로 받고 desk-look 을 올린다. 올라갔으면 /reload-plugins 도 대신 실행한다: 명령 훅 안에서 부르면
  // 이 훅이 잡은 턴을 기다리게 돼 엔진이 거절해서, 훅이 답한 뒤(clock.after)에 부른다.
  on('command.run', { command: 'desk-update' }, async $ => {
    // 이 플러그인(desk-look@cc-desktop-mod, 마켓플레이스 저장소 이름 그대로). 명령은 고정 글자로.
    const market = await $.process.run(['claude', 'plugin', 'marketplace', 'update', 'cc-desktop-mod'], { timeoutMs: 150_000 })
    if (market.exitCode !== 0) return { text: T.updateFailed(lastLine(market.stderr || market.stdout)) }
    const ran = await $.process.run(['claude', 'plugin', 'update', 'desk-look@cc-desktop-mod', '--json'], { timeoutMs: 150_000 })
    // 같은 마켓의 desk-asana·desk-slack 도 함께 올린다. 설치하지 않았으면 실패하는데, 그건 알리지 않는다.
    const [asanaRan, slackRan] = await Promise.all([
      $.process.run(['claude', 'plugin', 'update', 'desk-asana@cc-desktop-mod', '--json'], { timeoutMs: 150_000 }),
      $.process.run(['claude', 'plugin', 'update', 'desk-slack@cc-desktop-mod', '--json'], { timeoutMs: 150_000 }),
    ])
    const siblings = [siblingUpdate('desk-asana', asanaRan.exitCode, asanaRan.stdout), siblingUpdate('desk-slack', slackRan.exitCode, slackRan.stdout)]
    if (isUpdated(ran.exitCode, ran.stdout) || siblings.some(note => note !== null)) {
      $.clock.after(RELOAD_AFTER_MS, () => void $.command.run({ command: 'reload-plugins' }).catch(() => $.ui.toast(T.reloadFailed)))
    }
    return { text: [updateMessage(ran.exitCode, ran.stdout, ran.stderr), ...siblings.filter(note => note !== null)].join('\n') }
  })

  on('command.run', { command: 'desk-preview' }, async ($, e) => {
    const asked = e.args.trim() || (await read($, previewFile))?.path
    if (!asked) return { text: T.previewNothing }
    const { file } = await openPreview($, asked, true)
    return { text: file.error === undefined ? T.previewOpened(fileName(file.path)) : T.previewUnreadable(file.error) }
  })

  on('tool.call', { tool: PREVIEW_TOOL }, async ($, e) => {
    const path = stringField(fieldsOf(e), 'path')
    if (!path) return { deny: 'Give path: the .md file to preview.' }
    const { file, isPlaced } = await openPreview($, path)
    if (file.error !== undefined) return { deny: `Couldn't open ${path} for preview (${file.error}).` }
    return {
      result: isPlaced
        ? `Showing ${file.path} in the preview pane.`
        : `The terminal is too narrow for the preview pane; the person can press ◫ on this row to open ${file.path}.`,
    }
  })

  on('command.run', { command: 'desk-fold' }, async $ => ({ text: await toggleFold($) }))

  on('command.run', { command: 'desk-quote' }, async $ => {
    await quoteSelection($)
    return {}
  })

  on('command.run', { command: 'desk-context' }, async $ => {
    await openContext($)
    return { text: T.contextOpened }
  })

  on('command.run', { command: 'desk-diff' }, async ($, e) => {
    const name = e.args.trim()
    const scope = scopeOf(name)
    if (name !== '' && scope === null) {
      await openDiffAt($, name)
      return { text: T.diffOpenedAt(name) }
    }
    await openDiff($, scope ?? undefined)
    return { text: T.diffOpened }
  })

  on('command.run', { command: 'desk-activity' }, async $ => {
    await openActivity($)
    return { text: T.activityOpened }
  })

  on('command.run', { command: 'desk-tasks' }, async ($, e) => {
    const index = Number.parseInt(e.args.trim(), 10)
    if (Number.isInteger(index) && index > 0) {
      await refreshAgents($).catch(() => undefined)
      const { live, done } = orderAgents(await read($, agents))
      const agent = [...live, ...done][index - 1]
      if (!agent) return { text: T.noAgent(index) }
      await openAgents($, agent.id)
      return { text: T.agentPicked(index, agent.description) }
    }
    await openAgents($)
    return { text: T.agentsOpened }
  })

  // 에이전트 패널의 수치: 모델·컨텍스트 토큰(turn.step), 도구 수·하는 일(tool.call). 에이전트는 첫 턴(turn.start)에 엔진 목록으로 올린다.
  // agent.spawn 은 걸지 않는다: 디렉터리 검사가 그 훅을 권한 결정을 가져갈 수 있는 훅으로 보고 리뷰어에게 넘긴다.
  // 메인 대화의 단계는 설정(replyInBlocks)이 켜져 있으면 글을 블록째 모아 내보낸다(gather.ts).
  // 마지막 사람 입력이 앱(Remote Control)에서 왔으면 그대로 흘린다: 늦춘 스트림은 앱에도 덩어리로 가서,
  // 받은 글을 고르게 풀어 그리는 앱의 흐름을 깬다(claude.ai/code 웹 실측). 단계(모델 요청)마다 다시 본다.
  on('turn.step', async function* ($, e, next) {
    const id = e.agentId
    if (id === undefined) {
      const withInput = inputIntoTurn
      inputIntoTurn = false
      await update($, stepEffort, held => effortInForce(held, e.index, e.effort, withInput))
      const savePredicted = () => update($, runs, state => withPredicted(state, predicted))
      if (!isGather || (await read($, promptOrigin)) === 'bridge') return yield* placeCalls(next(e), savePredicted)
      return yield* placeCalls(gather(next(e), () => $.clock.sleep(GATHER_SETTLE_MS)), savePredicted)
    }
    // 단계의 모델은 시작할 때 이미 정해져 있다. 단계를 붙잡지 않게 기다리지 않는다.
    void patchAgent($, id, () => ({ model: e.model })).catch(() => undefined)
    const response = yield* next(e)
    const used = response.usage
    if (used) {
      // 첫 단계의 모델 기록이 목록 다시 읽기와 엇갈려 빠졌으면 여기서 채운다
      await patchAgent($, id, agent => ({ tokens: stepTokens(used), model: agent.model ?? used.model }))
    }
    return response
  })

  on('command.run', { command: 'desk-pr' }, async $ => {
    await openPr($)
    const state = await read($, pr)
    return { text: T.prOpened(state?.pr ? prRef(state.pr) : null) }
  })

  on('tool.call', async ($, e, next) => {
    // 서브에이전트 안의 호출: 에이전트 패널의 도구 수와 지금 하는 일.
    const agentId = e.agentId
    const activity = activityOf(String(e.tool))
    if (agentId !== undefined) await patchAgent($, agentId, agent => ({ toolUses: agent.toolUses + 1, activity })).catch(() => undefined)
    const startedAt = await $.clock.now()
    // 메인 대화의 호출은 진행 띠의 "지금" 줄에. Bash 는 띄운 프로세스도 읽는다(짧은 명령은 첫 읽기 전에 끝난다).
    const tool = String(e.tool)
    await logCall($, { id: e.tool_use_id, loop: agentId, tool, label: logLabel(tool, e), kind: kindOf(tool, stringField(fieldsOf(e), 'command')), start: startedAt }).catch(() => undefined)
    if (agentId === undefined) {
      const call = { id: e.tool_use_id, tool, label: callLabel(tool, e), startedAt }
      await update($, turnActivity, state => ({ ...state, calls: [...(state.calls ?? []), call] })).catch(() => undefined)
      if (tool === 'Bash') startProcWatch($)
    }
    const ran = await next(e).finally(() => {
      void settleLog($, e.tool_use_id).catch(() => undefined)
      if (agentId !== undefined) return
      void settleCall($, e.tool_use_id, tool).catch(() => undefined)
    })
    const editStat = FILE_EDITING.has(tool) && !ran.isError ? diffStat({ tool, input: e, isRunning: false, isErrored: false, isInterrupted: false, output: ran.result }) : null
    if (ran.isError === true || editStat) void patchLog($, e.tool_use_id, { isError: ran.isError === true, ...(editStat ?? {}) }).catch(() => undefined)
    if (agentId === undefined && tool === 'Bash' && ran.isError === true) void update($, turnActivity, state => ({ ...state, failed: (state.failed ?? 0) + 1 })).catch(() => undefined)
    if (agentId !== undefined) await patchAgent($, agentId, agent => (agent.activity === activity ? { activity: undefined } : {})).catch(() => undefined)
    // 백그라운드로 넘어간 셸·모니터는 백그라운드 작업 패널에 올린다. 모델이 멈춘 작업은 멈춤으로.
    if (!ran.isError && ran.result !== undefined) {
      const found = backgroundTaskOf(String(e.tool), fieldsOf(e), ran.result, startedAt)
      const outputFile = outputFileOf(ran.text)
      const task = found && outputFile ? { ...found, outputFile } : found
      if (task) {
        await update($, agents, records => ({ ...records, [task.id]: task })).catch(() => undefined)
        startAgentClock($)
      }
      const stopped = String(e.tool) === 'TaskStop' || String(e.tool) === 'KillShell' ? stringField(fieldsOf(ran.result), 'task_id') ?? stringField(fieldsOf(ran.result), 'shell_id') : undefined
      if (stopped) await patchAgent($, stopped, agent => ({ status: 'killed', endedAt: agent.endedAt ?? startedAt, activity: undefined })).catch(() => undefined)
    }
    // 턴 끝 카드용: 성공한 편집만 파일별 +/− 로 모은다
    if (FILE_EDITING.has(tool) && !ran.isError) {
      const fields = fieldsOf(e)
      const path = stringField(fields, 'file_path') ?? stringField(fields, 'notebook_path')
      const stat = editStat
      if (path && stat) {
        await update($, pendingEdits, list => mergeEdit(list, { path, ...stat }))
      }
      // 마크다운 문서: 보고 있는 것이면 바로 다시 읽고, 메인 대화가 새로 쓴 것은 턴 끝에 열 후보로 둔다.
      if (isMarkdown(path)) {
        if (await isPreviewed($, path).catch(() => false)) await loadPreview($, path).catch(() => undefined)
        else if (tool === 'Write' && isPreviewAuto && !isPrivate(path) && e.agentId === undefined) await update($, previewWritten, () => path)
      }
    }
    // 도구 결과를 git 실행 시간만큼 붙잡지 않도록 기다리지 않는다. 실패는 패널이 비어 보일 뿐이다.
    if (EDITING_TOOLS.has(String(e.tool))) {
      void refreshDiff($).catch(() => undefined)
    }
    return ran
  })

  // 사용자 프롬프트: 오른쪽 정렬 말풍선. omarchy 테마를 읽었으면 데스크톱처럼 회색 면, 아니면 둥근 테두리.
  // [Image #N] 은 데스크톱처럼 말풍선 위 썸네일로 바꾼다(kitty 그래픽·iTerm2 인라인 그림, 안 되는 터미널은 alt 글자).
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    // 백그라운드 작업 알림과 에이전트가 보낸 메시지: 데스크톱처럼 그 자리에서 펼치는 줄. ctrl+o 화면은 엔진 그대로.
    if (e.surface === 'terminal' && !e.props.isExpanded && (e.props.from || e.props.task)) {
      const els = $.ui.resolve(e)
      const [openState, state] = await Promise.all([read($, open), read($, runs)])
      if (e.props.task) return taskRow(els, e.props.task, e.props.text, state)
      return peerRow(els, $, e.props.from?.name ?? 'agent', e.props.text, openState, e.viewport?.columns ?? 80)
    }
    if (e.surface !== 'terminal' || e.props.origin.kind !== 'composer') {
      return next(e)
    }
    const els = $.ui.resolve(e)
    const { Box, Text, Image } = els
    const [face, known, kind, openState, remote] = await Promise.all([read($, surface), read($, images), read($, graphics), read($, open), read($, herdrRemote)])
    // iTerm2 는 전체 화면 그리기에서만 그린다(엔진 기본 화면은 줄마다 그림을 다시 보내야 해서 alt 글자).
    // herdr 원격 클라이언트(foot 등)가 붙어 있으면 그림이 버려져 썸네일 자리가 비고 모서리 칸이 빠져 위·아래 줄이
    // 짧아지므로, 그동안은 그림을 못 그리는 터미널처럼 글리프 모서리로 그리고 그림 알림은 엔진의 └ [Image #N] 줄에 맡긴다.
    const canDraw = !remote && (kind === 'kitty' || kind === 'kitty-bytes' || (kind === 'iterm' && e.viewport?.isFullscreen === true))
    const columns = e.viewport?.columns ?? 80
    const { text: typed, pastes } = splitPastes(e.props.text)
    const found = [...typed.matchAll(IMAGE_TOKEN)]
      .map(match => ({ number: match[1] ?? '', info: known[match[1] ?? ''] }))
      .filter((image): image is { number: string; info: ImageInfo } => canDraw && image.info !== undefined)
    const attached = (
      await Promise.all(
        found.map(async image => {
          if (kind === 'kitty') return { ...image, source: { file: image.info.path, format: 'png' as const } }
          const png = await imagePng($, image.info.path)
          return png === null ? null : { ...image, source: { png } }
        }),
      )
    ).filter(image => image !== null)
    const shown = new Set(attached.map(image => image.number))
    // 그림을 못 그리는 터미널에서는 [Image #N] 을 지운다. 엔진이 말풍선 아래 └ [Image #N] 줄로 이미 알려 준다.
    const text = typed
      .replace(IMAGE_TOKEN, (token, number: string) => (shown.has(number) || !canDraw ? '' : token))
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/^\s*\n|\n\s*$/g, '')
      .trim()
    const longest = Math.max(0, ...text.split('\n').map(cellWidth))
    const width = Math.max(8, Math.min(longest + 4, Math.floor(columns * 0.85)))
    const thumbColumns = Math.min(36, Math.floor(columns * 0.4))

    return (
      <Box flexDirection="column" alignItems={edge} marginTop={1} rowGap={(attached.length > 0 ? 1 : 0) + (pastes.length > 0 ? 1 : 0) + (text ? 1 : 0) > 1 ? 1 : 0}>
        {attached.length > 0 && (
          <Box flexDirection="row" columnGap={1} flexWrap="wrap" justifyContent={edge}>
            {attached.map(image => (
              <Image
                key={`image-${image.number}`}
                source={image.source}
                alt={`[Image #${image.number}]`}
                {...thumbnailSize(image.info, thumbColumns)}
              />
            ))}
          </Box>
        )}
        {pastes.length > 0 && (
          <Box flexDirection="column" alignItems={edge}>
            {pastes.map((body, index) => pasteChip(els, $, body, index, openState, columns, e.props.isExpanded, edge))}
          </Box>
        )}
        {text !== '' &&
          (face ? (
            bubbleLines(Box, Text, canDraw ? Image : null, wrapText(text, Math.floor(columns * 0.85) - 6), face.bubble)
          ) : (
            <Box width={width} borderStyle="round" borderColor={COLORS.border} paddingX={1}>
              <Text color={COLORS.text}>{text}</Text>
            </Box>
          ))}
      </Box>
    )
  })

  // 어시스턴트 답변: 서명·불릿 없이 데스크톱 산문 스타일 마크다운.
  // 도구 호출 사이 글의 요약(isSummary)도 데스크톱처럼 불릿 없이 같은 모양으로 그린다.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') {
      return next(e)
    }
    const els = $.ui.resolve(e)
    const face = await read($, surface)
    const columns = (e.viewport?.columns ?? 80) - 2

    return (
      <els.Box flexDirection="column" marginTop={e.props.isFirstOfReply ? 1 : 0}>
        {renderMarkdown(e.props.text, els, { ...COLORS, ...(face ? { codeBg: face.bubble } : {}) }, columns, { onCopy: (source, press) => void copyText($, source, press, 'code') })}
      </els.Box>
    )
  })

  // 도구 호출 행. 묶음의 첫 행이 묶음 전체 한 줄을 그리고, 나머지 행은 비운다.
  // ctrl+o 화면·--verbose 는 엔진 그대로(호출마다 전부 보이게).
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isExpanded) {
      return next(e)
    }
    const els = $.ui.resolve(e)
    const [state, openState] = await Promise.all([read($, runs), read($, open)])
    const plan = planRow([e.props.tool_use_id], state)
    if (plan.kind === 'hide') return <els.Box display="none" />
    if (plan.kind === 'run') return runLine(els, $, plan.first, plan.calls, openState, e.viewport?.columns ?? 80)
    const own = asRunCall(e.props)
    // 계획은 엔진이 준 결과에 계획 글이 없을 수 있어(결과 글만 남은 기록) 저장해 둔 요약을 먼저 쓴다.
    // 승인 직후엔 저장한 결과가 먼저 오고 이 행의 props 는 아직 실행 중일 수 있어, 상태도 저장한 쪽을 따른다.
    const saved = isPlanTool(own.tool) ? state.calls[state.firstOf[own.tool_use_id] ?? '']?.find(item => item.tool_use_id === own.tool_use_id) : undefined
    const call =
      saved && planOf(saved.output)
        ? { ...own, output: saved.output, isRunning: false, isErrored: own.isErrored || saved.isErrored, isInterrupted: own.isInterrupted || saved.isInterrupted }
        : own
    return callLine(els, $, call, openState, e.viewport?.columns ?? 80)
  })

  // 데스크톱은 결과를 따로 그리지 않는다. 펼친 행 안에서 보여 준다.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isExpanded) {
      return next(e)
    }
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })

  // 엔진이 접은 읽기·검색 묶음. 더 큰 묶음의 일부면 그 묶음 규칙을 따른다.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isExpanded) {
      return next(e)
    }
    const els = $.ui.resolve(e)
    const [state, openState] = await Promise.all([read($, runs), read($, open)])
    const ids = e.props.calls.map(call => call.tool_use_id).filter((id): id is string => id !== undefined)
    const plan = planRow(ids, state)
    if (plan.kind === 'hide') return <els.Box display="none" />
    if (plan.kind === 'run') return runLine(els, $, plan.first, plan.calls, openState, e.viewport?.columns ?? 80)
    if (hasOtherRows(e.props)) return next(e)
    return runLine(els, $, e.requestId, e.props.calls.map(asRunCall), openState, e.viewport?.columns ?? 80)
  })

  // 진행 표시: 데스크톱의 "··· Running… 2m 29s". 클레이색 점 셋이 돌고, 경과 시간은 흐리게.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const [now, startedAt, , list, state, agentRecords, asked, effort] = await Promise.all([
      $.clock.now(),
      read($, turnStartedAt),
      read($, tick),
      read($, tasks),
      read($, turnActivity),
      read($, agents),
      read($, asking),
      read($, stepEffort),
    ])
    const isCarded = asked !== null || (await read($, planAsking)) !== null
    if (now - spinnerSeen > 2 * SPINNER_TICK + 1000) spinnerFallbackStart = now
    spinnerSeen = now
    if (ticker === null) {
      ticker = $.clock.every(SPINNER_TICK, () => {
        void (async () => {
          const at = await $.clock.now()
          if (at - spinnerSeen > 2000) {
            ticker?.cancel()
            ticker = null
            return
          }
          await update($, tick, () => at)
        })()
      })
    }
    const elapsed = now - (startedAt ?? spinnerFallbackStart)
    const hint = backgroundHintOf(await read($, runs))
    // 한 줄을 넘지 않게 자른다: 줄이 접혀 늘면 그 위 대화가 밀려 오르내린다.
    const line = (
      <Text wrap="truncate-end">
        <Text color={COLORS.clay}>{spinnerDots(now)}</Text>
        <Text color={COLORS.text}>{` ${spinnerWord(e.props.mode, e.props.message)}${e.props.suffix}`}</Text>
        <Text color={COLORS.muted}>{`  ${formatElapsed(elapsed)}`}</Text>
        {effort !== null && <Text color={COLORS.muted}>{` · ${effortLabel(effort)}`}</Text>}
        {gatheredLines() > 0 && <Text color={COLORS.muted}>{` · ${T.gathered(gatheredLines())}`}</Text>}
        {hint !== null && <Text color={COLORS.muted}>{` · ${hint}`}</Text>}
      </Text>
    )
    // 진행 띠는 턴 동안 스피너 바로 아래에 그린다: 스피너는 어차피 초당 두 번 다시 그려지니, 띠의 시간을 가게 하려고
    // 입력창 위 띠 전체(아래턱·칩)를 다시 그리지 않아도 된다(명령어 수로 재면 그 다시 그리기가 턴 중 비용의 대부분이었다).
    // 질문·계획 카드가 떠 있으면 카드가 자리를 차지하니 띠는 숨긴다.
    const band = startedAt !== null && !isCarded ? activityBand(els, { list, state, agents: agentRecords, turnStartedAt: startedAt, now, columns: e.viewport?.columns ?? 80, onOpen: () => void openActivity($) }) : null
    if (!band) return line
    return (
      <Box flexDirection="column">
        {line}
        {band}
      </Box>
    )
  })

  // 긴 명령 아래 잠깐 생기는 백그라운드 안내 줄은 생겼다 사라지며 대화를 한 줄씩 밀어 올렸다 내렸다.
  // 그 줄은 비우고, 같은 안내를 늘 있는 스피너 줄 끝에 단다.
  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.kind !== 'background_hint') return next(e)
    backgroundHints.set(e.props.tool_use_id, e.props.hint)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  })

  // 모드 라벨(focus, memory paused …): 흐린 글자 대신 데스크톱 입력창의 알약 칩으로.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.modes.length === 0) return next(e)
    const face = await read($, surface)
    if (!face) return next(e)
    const { Text } = $.ui.resolve(e)
    return (
      <Text>
        {e.props.modes.map((mode, index) => (
          <Text>
            {index > 0 ? ' ' : ''}
            <Text color={face.bubble}>{EDGES.single[0]}</Text>
            <Text color={COLORS.muted} backgroundColor={face.bubble}>
              {mode}
            </Text>
            <Text color={face.bubble}>{EDGES.single[1]}</Text>
          </Text>
        ))}
      </Text>
    )
  })

  // 명령 출력: 표·제목·코드·인용이 든 출력만 답변처럼 마크다운으로. 나머지(엔진 명령의 평문)는 그대로.
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isErrored || !looksLikeMarkdown(e.props.text)) return next(e)
    const els = $.ui.resolve(e)
    const face = await read($, surface)
    return renderMarkdown(e.props.text, els, { ...COLORS, ...(face ? { codeBg: face.bubble } : {}) }, (e.viewport?.columns ?? 80) - 4)
  })

  // 힌트 줄: 질문·계획 카드가 떠 있으면 답하는 키를 엔진 줄 끝에 덧붙인다.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isDraft) return next(e)
    const state = await read($, asking)
    const question = state?.questions[state.step]
    if (question) return next({ ...e, props: { ...e.props, tail: askHint(question) } })
    if ((await read($, planAsking)) !== null) return next({ ...e, props: { ...e.props, tail: `  ${T.planHint}` } })
    return next(e)
  })

  // 입력창 위: 할 일 카드, 질문 카드, "저장소  브랜치  +63 −29" 아래턱. 다른 플러그인의 밴드는 위에 그대로 둔다.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) {
      return next(e)
    }
    const below = await next(e)
    const [info, list, state, agentRecords, startedAt, doneAt] = await Promise.all([read($, repo), read($, tasks), read($, turnActivity), read($, agents), read($, turnStartedAt), read($, bandDoneAt)])
    const els = $.ui.resolve(e)
    // 턴 동안 진행 띠는 스피너가 그린다. 턴 밖에서는 끝난 띠를 남겨 둔 동안(bandAfterTurn) 그 단계 줄을, 아니면 남은 할 일이 있을 때만
    // 단계 줄을(시간 없이) 여기에.
    const plan =
      startedAt === null
        ? activityBand(els, {
            list,
            state,
            agents: agentRecords,
            turnStartedAt: null,
            now: 0,
            columns: e.props.bodyColumns,
            onOpen: () => void openActivity($),
            ...(doneAt !== null ? { onClose: () => void update($, bandDoneAt, () => null) } : {}),
          })
        : null
    askBand = e.requestId
    const asked = (await askCard($, els, e.props.bodyColumns, e.props.maxRows)) ?? (await planAskCard($, els, e.props.bodyColumns, e.props.maxRows))
    const meter = contextMeter(els, $, await read($, usage), chipMode)
    const prState = showPr ? prChip(els, $, await read($, pr)) : null
    const agentState = agentsChip(els, $, await read($, agents))
    const notesState = commentsChip(els, $, await read($, lineComments))
    const slackState = slackChip(els, $, await read($, slackUnread))
    const extras = [notesState, agentState, slackState, prState, meter].filter((chip): chip is NonNullable<typeof chip> => chip !== null)
    const reserve = extras.reduce((sum, chip) => sum + chip.width + 1, 0)
    const repoChin = info === null ? null : await chinBand($, els, info, e.props.bodyColumns - reserve)
    // PR·컨텍스트 칩은 아래턱 알약 오른쪽 바깥에(버튼에는 색을 줄 수 없어 알약 안에 넣지 않는다).
    const chin =
      extras.length === 0 ? repoChin : (
        <els.Box columnGap={1} paddingX={repoChin === null ? 1 : 0}>
          {repoChin}
          {extras.map(chip => chip.node) as never}
        </els.Box>
      )
    // 질문 중에는 질문이 띠를 차지한다(엔진 설문처럼): 다른 밴드·할 일 카드는 숨기고, 남는 줄이 있을 때만 아래턱.
    if (asked) {
      return (
        <els.Box flexDirection="column">
          {asked.card}
          {asked.rows < e.props.maxRows ? chin : null}
        </els.Box>
      )
    }
    if (plan === null && chin === null) return below
    return (
      <els.Box flexDirection="column">
        {below}
        {plan}
        {chin}
      </els.Box>
    )
  })

  // 턴 끝 카드: 데스크톱의 "Edited N files +51 −37" 상자. 편집이 없던 턴은 원래 줄만 둔다.
  // 백그라운드 에이전트를 기다리는 줄이면 그 아래에 에이전트마다 한 줄(누르면 /desk-tasks 의 그 작업).
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const engineLine = await next(e)
    if (e.surface !== 'terminal') return engineLine
    const { Box, Text, Button } = $.ui.resolve(e)
    const waited = e.props.waitingFor && !e.props.isExpanded ? waitingRows($.ui.resolve(e), $, e.props.waitingFor.agents, await read($, agents), e.viewport?.columns ?? 80) : null
    const line = waited ? (
      <Box flexDirection="column">
        {engineLine}
        {waited}
      </Box>
    ) : (
      engineLine
    )
    const card = cardFor(await read($, turnCards), e.props.durationMs)
    if (!card) return line
    const answer = card.text ?? ''
    // 데스크톱 답변 아래의 복사 버튼: 턴 끝 줄과 나란히, 오른쪽 끝에 흐리게. 그 줄이 위에 빈 줄을
    // 두면(paneline 등) 버튼은 그 빈 줄, 곧 답변 바로 아래에 놓인다. 줄은 늘지 않는다.
    const head = (
      <Box columnGap={2}>
        {line}
        {answer !== '' && (
          <Button
            key={`copy-turn-${card.durationMs}`}
            plain
            dimColor
            label="⧉ copy"
            onPress={press => void copyText($, answer, press, 'answer')}
          />
        )}
        <Button key={`quote-turn-${card.durationMs}`} plain dimColor label="❝ quote" onPress={() => void quoteSelection($, answer)} />
      </Box>
    )
    // 진행 띠를 띄운 긴 턴의 셈: 엔진 줄에는 덧붙일 자리가 없어 그 아래 흐린 한 줄로.
    const stats = card.stats ? (
      <Box flexDirection="column">
        {head}
        <Text color={COLORS.muted} wrap="truncate-end">{`  ${T.turnStats(card.stats)}`}</Text>
      </Box>
    ) : (
      head
    )
    if (card.files.length === 0) return stats
    const key = `card-${card.durationMs}`
    const isOpen = (await read($, open))[key] ?? false
    const added = card.files.reduce((sum, file) => sum + file.added, 0)
    const removed = card.files.reduce((sum, file) => sum + file.removed, 0)
    const shown = isOpen ? card.files : card.files.slice(0, CARD_ROWS)
    const hidden = card.files.length - shown.length
    const width = Math.max(30, Math.min((e.viewport?.columns ?? 80) - 4, 72))
    const name = (path: string) => path.split('/').pop() ?? path
    const els = $.ui.resolve(e)
    // 파일 줄은 누르면 diff 패널의 그 파일로. 이름을 채워 칩을 오른쪽 끝에 맞춘다(테두리·여백 4칸).
    // 마크다운 문서 줄은 끝에 ◫(미리보기)를 더 둔다. 그 두 칸은 모든 줄이 비워 둬서 칩 열이 맞는다.
    const docSlot = card.files.some(file => isMarkdown(file.path)) ? 2 : 0
    const fileRow = (file: TurnEdit) => {
      const chips = ` +${file.added}  −${file.removed} `
      const room = Math.max(8, width - 4 - cellWidth(chips) - docSlot)
      const label = clipStart(name(file.path), room)
      const row = rowButton(
        els,
        { key: `diffat-${card.durationMs}-${file.path}`, onPress: () => void openDiffAt($, file.path).catch(() => undefined) },
        label + ' '.repeat(Math.max(0, room - cellWidth(label))),
        diffChips(Text, file.added, file.removed),
      )
      if (docSlot === 0) return row
      return (
        <Box columnGap={1}>
          {row}
          {isMarkdown(file.path) ? previewChip(els, $, `card-${card.durationMs}-${file.path}`, file.path, '◫') : <Text> </Text>}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {stats}
        <Box flexDirection="column" width={width} borderStyle="round" borderColor={COLORS.border} paddingX={1}>
          <Box justifyContent="space-between">
            <Text color={COLORS.text} weight="semibold">
              {`Edited ${card.files.length} file${card.files.length === 1 ? '' : 's'}`}
            </Text>
            {diffChips(Text, added, removed)}
          </Box>
          {shown.map(fileRow)}
          {(hidden > 0 || isOpen) && card.files.length > CARD_ROWS && (
            <Button
              key={key}
              plain
              dimColor
              label={isOpen ? 'Show less' : `Show ${hidden} more`}
              onPress={() => toggle($, key)}
            />
          )}
        </Box>
      </Box>
    )
  })

  // /desk-activity: 이번(끝났으면 지난) 턴에 무엇이 언제 돌았는지. 위는 메인·에이전트·백그라운드의 시간 막대,
  // 아래는 설명 글과 호출의 흐름, 이 턴의 에이전트와 백그라운드 작업(도는 셸은 출력 끝 줄).
  on('ui.render', { component: 'Pane', requestId: ACTIVITY_PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    // 턴이나 이 턴이 띄운 일이 도는 동안은 패널 시계(2초)로 다시 그려 막대와 시간이 간다.
    const [log, records, startedAt, top, expanded, clockAt] = await Promise.all([read($, activityLog), read($, agents), read($, turnStartedAt), read($, activityTop), read($, activityAgentOpen), read($, activityClock)])
    if (log === null) return <Text color={COLORS.muted}>{T.activityNone}</Text>
    const now = await $.clock.now()
    activitySeen = now
    const columns = Math.max(30, e.props.bodyColumns)
    const bodyRows = (e.props as { scroll?: { bodyRows: number } }).scroll?.bodyRows ?? 0
    const interactive = {
      columns,
      bodyRows,
      top,
      expanded,
      openAgent: (id: string) => void openAgents($, id),
      toggleAgent: (id: string) => void update($, activityAgentOpen, current => (current === id ? null : id)),
    }
    // 시계가 도는 동안 에이전트·호출 기록은 걸음마다 바뀌어(에이전트가 여럿이면 1초에도 몇 번) 이 훅을 다시 부른다.
    // 그때마다 지금 시각으로 그리면 막대가 2초보다 자주 가므로, 다음 시계까지는 지난 그림의 입력을 그대로 쓰고
    // 스크롤·펼침·폭만 새로 넣는다. 턴이 바뀐 것(백그라운드 끝남 알림 턴 등)도 다음 시계를 기다린다.
    const held = activityTimer !== null && activityFrame !== null && activityFrame.clockAt === clockAt && now - activityFrame.at < ACTIVITY_TICK ? activityFrame : null
    // 도는 것이 있을 때만 시계를 건다(멈춘 뒤 마지막 한 번 그릴 때 다시 걸지 않게).
    if (activityTimer === null && (startedAt !== null || Object.values(records).some(agent => isLive(agent.status)))) startActivityClock($)
    if (held) {
      const drawn = activityPane(els, { ...held.input, ...interactive })
      activityWindow = drawn.window
      return drawn.tree
    }
    const turnEnd = log.endedAt ?? now
    const inTurn = (agent: AgentRecord) => (agent.startedAt ?? 0) >= log.startedAt - 1000 && (agent.startedAt ?? 0) <= turnEnd
    // 에이전트는 앞 턴에 띄웠어도 이 턴 동안(또는 지금) 돌았으면 함께 그린다: 그 호출도 이 기록에 쌓인다.
    // 턴이 끝난 뒤 사람이 띄운 에이전트(/code-review 같은 빌트인 백그라운드)도: 턴을 열지 않아 이 기록이 마지막 턴이다.
    // 셸은 띄운 턴에만: 개발 서버처럼 계속 떠 있는 셸이 턴마다 붙지 않게.
    const overlaps = (agent: AgentRecord) => isLive(agent.status) || (agent.endedAt ?? 0) >= log.startedAt
    const all = [...orderAgents(records).live, ...orderAgents(records).done].reverse()
    const turnAgents = all.filter(agent => (agent.kind ?? 'agent') === 'agent' && (inTurn(agent) || overlaps(agent)))
    const shells = all.filter(agent => (agent.kind === 'shell' || agent.kind === 'monitor') && inTurn(agent))
    const tail = await shellTail($, shells, now)
    // 턴이 끝났어도 이 턴에 띄운 에이전트·셸이 아직 돌면 지금까지, 끝났으면 가장 늦게 끝난 때까지 시간 축을 늘린다.
    const spawned = [...turnAgents, ...shells]
    const end = spawned.some(agent => isLive(agent.status)) ? now : Math.max(turnEnd, ...spawned.map(agent => agent.endedAt ?? turnEnd))
    const input: PaneInput = { log, now, end, turnAgents, shells, tail, ...interactive }
    activityFrame = { input, at: now, clockAt }
    const drawn = activityPane(els, input)
    activityWindow = drawn.window
    return drawn.tree
  })

  // 세션 패널: 프로젝트별로 묶은 최근 세션. 현재 세션은 클레이색 ●.
  on('ui.render', { component: 'Pane', requestId: SESSIONS_PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Input } = els
    const [list, query, cwd, current, now, home, live, folds] = await Promise.all([
      read($, sessions),
      read($, sessionQuery),
      $.session.cwd(),
      $.session.id(),
      $.clock.now(),
      $.env.get('HOME'),
      read($, liveSessions),
      read($, open),
    ])
    const room = Math.max(16, e.props.bodyColumns - 12)
    const label = (path: string) => (home && path.startsWith(home) ? `~${path.slice(home.length)}` : path)
    // 번호는 거르기 전 목록 기준이라 /desk-sessions <번호> 와 늘 맞는다.
    const order = numbered(list, cwd, PER_GROUP, current).map(entry => entry.id)
    const shown = filterSessions(list, query)
    const groups = groupSessions(shown, cwd)
    // 검색 중에는 맞은 세션이 숨지 않도록 모두 편다.
    const isSearching = query.trim() !== ''
    const isFolded = (group: string) => !isSearching && isGroupFolded(folds, group, cwd)
    // 하나라도 펴져 있으면 모두 접고, 다 접혀 있으면 모두 편다(diff 패널의 모두 접기와 같다).
    const anyOpen = groups.some(group => !isFolded(group.cwd))
    const hasGroups = groupSessions(list, cwd).length > 1
    const foldAll = () => update($, open, state => ({ ...state, ...Object.fromEntries(groups.map(group => [`sessions:fold:${group.cwd}`, anyOpen])) }))
    // 줄 끝 칩: 떠 있는 세션의 상태. 작업 중인 백그라운드 세션을 한 번 누르면 확인 문구로 바뀐다.
    const chip = (entry: SessionEntry) => {
      const state = live[entry.id]
      if (!state || entry.id === current) return null
      if (folds[`take:${entry.id}`]) return <Text color={COLORS.warning}>{` ${T.takeConfirm}`}</Text>
      if (state.kind === 'interactive') return <Text color={COLORS.muted}>{` · ${T.liveElsewhere}`}</Text>
      const [label, color] = state.status === 'busy' ? [T.liveBusy, COLORS.clay] : state.status === 'waiting' ? [T.liveWaiting, COLORS.warning] : [T.liveIdle, COLORS.muted]
      return <Text color={color}>{` · ${label}`}</Text>
    }

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box columnGap={1}>
          <Text color={COLORS.text} weight="semibold">
            {T.recentSessions(list.length)}
          </Text>
          <Button key="sessions-refresh" plain dimColor hotkey="r" label="↻" onPress={() => refreshSessions($)} />
          <Button key="sessions-search-focus" plain dimColor hotkey="f" label={T.search} onPress={() => void focusInPane($, SESSIONS_PANE, 'sessions-search')} />
          {/* 검색 중에도 그린다: 입력칸 앞 버튼이 사라지면 입력칸이 포커스를 잃는다 */}
          {hasGroups && <Button key="sessions-fold-all" plain dimColor hotkey="z" label={anyOpen ? T.foldAll : T.unfoldAll} onPress={() => void foldAll()} />}
        </Box>
        <Input
          key="sessions-search"
          label={T.search}
          placeholder={T.searchPlaceholder}
          value={query}
          submitLabel={T.openFirst}
          onInput={value => void update($, sessionQuery, () => value)}
          onSubmit={value => {
            const first = filterSessions(list, value).find(entry => entry.id !== current)
            if (first) void openSession($, first)
          }}
        />
        {query.trim() !== '' && shown.length === 0 && <Text color={COLORS.muted}>{T.noMatch}</Text>}
        <Box flexDirection="column">
          {groups.map(group => (
            <Box key={`group-${group.cwd}`} flexDirection="column" marginBottom={isFolded(group.cwd) ? 0 : 1}>
              {rowButton(
                els,
                { key: `group-fold-${group.cwd}`, onPress: () => void toggle($, `sessions:fold:${group.cwd}`, group.cwd !== cwd) },
                isFolded(group.cwd) ? '› ' : '⌄ ',
                <Text color={group.cwd === cwd ? COLORS.clay : COLORS.muted} weight="semibold">
                  {clip(label(group.cwd), room)}
                </Text>,
                <Text color={COLORS.muted}>{` · ${Math.min(group.sessions.length, PER_GROUP)}`}</Text>,
              )}
              {!isFolded(group.cwd) && group.sessions.slice(0, PER_GROUP).map(entry => (
                <Box key={`session-${entry.id}`} columnGap={1}>
                  <Text color={entry.id === current ? COLORS.clay : COLORS.muted}>
                    {entry.id === current ? ' ●' : String(order.indexOf(entry.id) + 1).padStart(2)}
                  </Text>
                  {rowButton(
                    els,
                    { key: `open-${entry.id}`, dimColor: entry.id !== current, onPress: () => openSession($, entry) },
                    clip(entry.title, room),
                    <Text color={COLORS.muted}>{` ${ago(entry.updatedAt, now)}`}</Text>,
                    chip(entry),
                  )}
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      </Box>
    )
  })

  // 에이전트 패널: 목록(실행 중·끝남)과, 한 에이전트를 누르면 그 대화(지시·답변·도구 묶음).
  on('ui.render', { component: 'Pane', requestId: AGENTS_PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const [records, view, detail, openState, now, output] = await Promise.all([
      read($, agents),
      read($, agentView),
      read($, agentDetail),
      read($, open),
      $.clock.now(),
      read($, taskOutput),
      read($, agentClock),
    ])
    const columns = Math.max(24, e.props.bodyColumns)
    // 메인 화면에 떠 있는 에이전트(엔진 작업 목록이나 '메인 화면에서 보기'로 연 것). 바뀌면 이 훅이 다시 돈다.
    const inView = e.props.view?.agentId

    const agent = view === null ? undefined : records[view]
    // 상세가 길면 위로 되돌아가지 않도록 맨 아래에도 같은 버튼을 둔다.
    const back = (key: string) => rowButton(els, { key, dimColor: true, hotkey: key === 'agent-back' ? 'b' : undefined, onPress: () => void openAgents($) }, `‹ ${T.agentBack}`)
    // 셸·모니터 상세: 데스크톱·엔진의 Shell details 처럼 상태, 실행 시간, 명령, 요약, 출력 끝부분.
    if (agent && (agent.kind === 'shell' || agent.kind === 'monitor')) {
      const live = isLive(agent.status)
      const shownOutput = output?.id === agent.id ? output.text : null
      const field = (label: string, value: unknown) => (
        <Box columnGap={1}>
          <Text color={COLORS.muted}>{label}</Text>
          {value as never}
        </Box>
      )
      return (
        <Box flexDirection="column" rowGap={1}>
          <Box columnGap={1}>
            {back('agent-back')}
            <Text color={COLORS.text} weight="semibold" wrap="truncate-end">
              {agent.description}
            </Text>
          </Box>
          <Box flexDirection="column">
            {field(T.taskStatus, <Text color={live ? COLORS.clay : AGENT_STATUS_COLOR[agent.status] ?? COLORS.muted}>{T.agentStatus[agent.status] ?? agent.status}</Text>)}
            {field(T.taskRuntime, <Text color={COLORS.text}>{agentElapsed(agent, now) ?? '—'}</Text>)}
            {field(T.taskKind, <Text color={COLORS.text}>{KIND_LABEL(agent)}</Text>)}
            {agent.summary && field(T.taskSummary, <Text color={COLORS.text}>{agent.summary}</Text>)}
          </Box>
          {agent.command && <els.Code source={agent.command} language="bash" wrap="wrap" />}
          <Box flexDirection="column">
            <Text color={COLORS.muted}>{T.taskOutput}</Text>
            <Text color={shownOutput ? COLORS.text : COLORS.muted}>{shownOutput ?? (live ? T.outputWhenDone : T.noOutput)}</Text>
          </Box>
          {live && stopButton(els, $, agent, openState)}
          <Box>{back('agent-back-end')}</Box>
        </Box>
      )
    }
    if (view !== null) {
      const shown = detail?.id === view ? detail : null
      const live = agent ? isLive(agent.status) : false
      const facts = agent
        ? [agent.tokens !== undefined ? T.agentTokens(formatTokens(agent.tokens)) : undefined, T.agentToolUses(agent.toolUses), agentElapsed(agent, now)].filter(Boolean).join(' · ')
        : ''
      return (
        <Box flexDirection="column" rowGap={1}>
          <Box columnGap={1}>
            {back('agent-back')}
            <Text color={COLORS.text} weight="semibold" wrap="truncate-end">
              {agent?.description ?? view}
            </Text>
            {view === inView
              ? rowButton(els, { key: 'agent-main-back', onPress: () => void viewInMain($, undefined) }, `‹ ${T.backToMain}`)
              : rowButton(els, { key: `agent-main-${view}`, onPress: () => void viewInMain($, view) }, T.viewInMain)}
            {agent && live && stopButton(els, $, agent, openState)}
          </Box>
          {agent && (
            <Box columnGap={1} flexWrap="wrap">
              <Text color={COLORS.muted}>{T.agentModel}</Text>
              <Text color={COLORS.text}>{modelLabel(agent.model) ?? agent.type}</Text>
              <Text color={live ? COLORS.clay : AGENT_STATUS_COLOR[agent.status] ?? COLORS.muted}>{T.agentStatus[agent.status] ?? agent.status}</Text>
              {facts !== '' && <Text color={COLORS.muted}>{facts}</Text>}
            </Box>
          )}
          {view === inView ? (
            <Text color={COLORS.muted}>{T.agentShownInMain}</Text>
          ) : shown === null ? (
            <Text color={COLORS.muted}>{T.agentGone}</Text>
          ) : (
            <Box flexDirection="column" rowGap={1}>
              {shown.prompt !== '' && (
                <Box flexDirection="column" borderStyle="round" borderColor={COLORS.border} paddingX={1}>
                  {renderMarkdown(shown.prompt, els, COLORS, columns - 4)}
                </Box>
              )}
              {shown.items.length === 0 && <Text color={COLORS.muted}>{T.agentNoItems}</Text>}
              {shown.items.map((item, index) => (
                <Box key={`agent-item-${index}`} flexDirection="column">
                  {item.kind === 'run'
                    ? runLine(els, $, item.id, item.calls, openState, columns)
                    : item.kind === 'user'
                      ? (
                          <Box flexDirection="column" borderStyle="round" borderColor={COLORS.border} paddingX={1}>
                            {renderMarkdown(item.text, els, COLORS, columns - 4)}
                          </Box>
                        )
                      : renderMarkdown(item.text, els, COLORS, columns)}
                </Box>
              ))}
              {live && agent?.activity && <Text color={COLORS.clay}>{`${spinnerDots(now)} ${agent.activity}`}</Text>}
            </Box>
          )}
          <Box>{back('agent-back-end')}</Box>
        </Box>
      )
    }

    const { live, done } = orderAgents(records)
    const doneFolded = openState[DONE_FOLDED] ?? false
    return (
      <Box flexDirection="column" rowGap={1}>
        {live.length === 0 && done.length === 0 && <Text color={COLORS.muted}>{Object.keys(records).length > 0 ? T.tasksAllCleared : T.noAgents}</Text>}
        {live.length > 0 && (
          <Box flexDirection="column">
            <Text color={COLORS.muted}>{T.agentsRunning}</Text>
            {live.map((item, index) => agentRow(els, $, item, index + 1, now, columns, openState, inView))}
          </Box>
        )}
        {done.length > 0 && (
          <Box flexDirection="column">
            {/* 끝남 머리글: z 로 접고 펴고, c 로 끝난 작업을 목록에서 모두 뺀다(패널에 포커스가 있을 때). */}
            <Box columnGap={2}>
              {rowButton(
                els,
                { key: 'tasks-done-fold', dimColor: true, hotkey: 'z', onPress: () => toggle($, DONE_FOLDED, doneFolded) },
                `${T.agentsDone} ${done.length}`,
                <Text color={COLORS.muted}>{doneFolded ? ' ›' : ' ⌄'}</Text>,
              )}
              <els.Button key="tasks-clear-done" plain dimColor hotkey="c" label={T.tasksClearDone} onPress={() => void update($, agents, records => dismissAgents(records))} />
            </Box>
            {!doneFolded && done.map((item, index) => agentRow(els, $, item, live.length + index + 1, now, columns, openState, inView))}
          </Box>
        )}
      </Box>
    )
  })

  // 컨텍스트 패널: /context 의 항목별 내역을 막대로, 그 아래 사용 한도와 비용.
  // 미리보기 패널: 머리에 문서 이름·폴더와 r(다시 읽기)·d(변경 보기), 본문은 대화 답변과 같은 렌더러의 문서 모드.
  // 데스크톱 앱은 제 마크다운이 이미 데스크톱 모양이라 엔진 Markdown 으로 둔다.
  on('ui.render', { component: 'Pane', requestId: PREVIEW_PANE }, async ($, e) => {
    const file = await read($, previewFile)
    if (e.surface !== 'terminal') {
      const { Box, Text, Markdown } = $.ui.resolve(e)
      if (file === null) return <Text dimColor>{T.previewNothing}</Text>
      return (
        <Box flexDirection="column">
          <Text dimColor>{file.path}</Text>
          {file.error !== undefined ? <Text>{T.previewUnreadable(file.error)}</Text> : <Markdown text={file.text.slice(0, PREVIEW_ROOM)} />}
        </Box>
      )
    }
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    if (file === null) return <Text color={COLORS.muted}>{T.previewNothing}</Text>
    const face = await read($, surface)
    const columns = (e.props as { bodyColumns?: number }).bodyColumns ?? e.viewport?.columns ?? 80
    const isCut = file.text.length > PREVIEW_ROOM
    const folder = file.path.slice(0, Math.max(0, file.path.length - fileName(file.path).length - 1))
    return (
      <Box flexDirection="column">
        <Box columnGap={2}>
          <Box flexShrink={0}>
            <Text color={COLORS.text} weight="semibold">
              {fileName(file.path)}
            </Text>
          </Box>
          {/* 좁으면 폴더만 앞쪽부터 줄인다. 이름과 단축키는 늘 보인다. */}
          <Box flexGrow={1} flexShrink={1}>
            <Text color={COLORS.muted} wrap="truncate-start">
              {folder}
            </Text>
          </Box>
          <Box columnGap={2} flexShrink={0}>
            <Button key="preview-reload" plain dimColor hotkey="r" label={T.previewReload} onPress={() => void loadPreview($, file.path).catch(() => undefined)} />
            <Button key="preview-changes" plain dimColor hotkey="d" label={T.previewChanges} onPress={() => void openDiffAt($, file.path).catch(() => undefined)} />
            {file.error === undefined && <Button key="preview-browser" plain dimColor hotkey="o" label={T.previewBrowser} onPress={() => void openPreviewInBrowser($, file).catch(() => undefined)} />}
          </Box>
        </Box>
        <Text color={COLORS.border}>{'─'.repeat(Math.max(4, columns - 1))}</Text>
        <Box marginTop={1} flexDirection="column">
          {file.error !== undefined ? (
            <Text color={COLORS.danger}>{T.previewUnreadable(file.error)}</Text>
          ) : (
            renderMarkdown(isCut ? file.text.slice(0, PREVIEW_ROOM) : file.text, els, { ...COLORS, ...(face ? { codeBg: face.bubble } : {}) }, columns - 1, {
              document: true,
              onCopy: (source, press) => void copyText($, source, press, 'code'),
            })
          )}
        </Box>
        {isCut && (
          <Box marginTop={1}>
            <Text color={COLORS.muted}>{T.previewCut(PREVIEW_ROOM.toLocaleString('en-US'))}</Text>
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: CONTEXT_PANE }, async ($, e) => {
    const els = $.ui.resolve(e) as Els
    const { Box, Text, Button } = els
    const [live, detail, openState, home] = await Promise.all([read($, usage), read($, usageBreakdown), read($, open), $.env.get('HOME').catch(() => undefined)])
    // 항목별 내역은 열 때와 ↻ 때만 계산한다(턴마다 다시 계산하면 열린 동안 턴이 13% 더 들었다).
    // 그림이 부르는 것은 내역이 없을 때(창 안에서 세션이 바뀜)와 0.62.0 전에 계산해 목록이 없을 때 한 번뿐이다.
    if (live && (!detail || detail.mcpServers === undefined)) void refreshBreakdown($).catch(() => undefined)
    const percent = live?.percent ?? null
    const columns = Math.max(24, ((e.props as { bodyColumns?: number }).bodyColumns ?? e.viewport?.columns ?? 60) - 1)
    const summary = [
      live?.tokens != null ? T.tokensOf(formatTokens(live.tokens), formatTokens(live.window)) : live ? T.windowTokens(formatTokens(live.window)) : null,
      detail?.compactAt != null ? T.autoCompact(formatTokens(detail.compactAt)) : null,
    ]
      .filter(Boolean)
      .join(' · ')

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box columnGap={1}>
          <Text color={COLORS.text} weight="semibold">
            {T.contextTitle}
          </Text>
          {percent !== null && <Text color={COLORS[meterLevel(percent)]}>{`${ring(percent)} ${percent}%`}</Text>}
          <Button key="context-refresh" plain dimColor hotkey="r" label="↻" onPress={() => void refreshBreakdown($).catch(() => undefined)} />
        </Box>
        {percent === null ? (
          <Text color={COLORS.muted}>{T.noUsage}</Text>
        ) : (
          <Box flexDirection="column">
            <Text key="context-bar">{barTexts(els, 'context-bar', barRuns(windowParts(detail, percent), detail?.max ?? 100, columns))}</Text>
            <Text color={COLORS.muted}>{summary}</Text>
          </Box>
        )}
        {detail && categoryRows(els, detail, columns)}
        {detail && loadedGroups(els, $, detail, openState, columns, home)}
        {sessionFlow(els, live, detail, columns)}
        {live && live.limits.length > 0 && limitRows(els, live)}
      </Box>
    )
  })

  // diff 패널 창이 움직이면(휠·스크롤 키·openDiffAt 의 스크롤) 위치를 적어 그 앞뒤만 다시 그린다.
  // 그려 둔 범위는 창 앞뒤로 한 화면씩 남으므로, 적어 둔 위치에서 반 화면 안쪽으로 움직이는 동안은 다시 그리지 않는다
  // (휠 대부분은 엔진이 창만 옮긴다). 다시 그리기는 기다리지 않는다: 옮긴 창은 이미 그려 둔 줄 위에 있다.
  // 모든 패널의 위치도 적어 두고(/desk-fold 가 접을 때 가져간다), 다시 편 뒤 첫 스크롤은 적어 둔 위치로 바꾼다.
  on('ui.scroll', { component: 'Pane' }, async ($, e, next) => {
    if (!DESK_PANES.has(e.requestId)) return next(e)
    // 머리를 고정해 그린 /desk-activity 는 창이 늘 꽉 차 엔진이 옮길 것이 없다: 몸통 첫 줄만 옮겨 그 패널만 다시 그린다.
    // 쪽 넘김(·Home/End)은 창 높이만큼 오므로 몸통 높이만큼 넘긴다.
    if (e.requestId === ACTIVITY_PANE && activityWindow.pinned) {
      restoreOffsets.delete(e.requestId)
      paneOffsets.set(e.requestId, 0)
      const { room, max } = activityWindow
      const from = Math.min(await read($, activityTop), max)
      const by = Math.abs(e.by) >= e.bodyRows ? Math.sign(e.by) * room : e.by
      const top = Math.max(0, Math.min(max, from + by))
      if (top !== from) await update($, activityTop, () => (top >= max ? ACTIVITY_END : top))
      return {}
    }
    const restore = e.contentRows > 0 ? restoreOffsets.get(e.requestId) : undefined
    if (restore !== undefined) restoreOffsets.delete(e.requestId)
    const asked = restore === undefined ? e : { ...e, offset: restore }
    const moved = await next(asked)
    if (moved.deny !== undefined) return moved
    if (e.requestId === PANE && e.origin.kind === 'person' && asked.offset !== paneOffsets.get(PANE)) diffCursor = null
    paneOffsets.set(e.requestId, asked.offset)
    if (e.requestId === PANE) {
      void update($, diffWindow, w =>
        w.bodyRows === e.bodyRows && Math.abs(w.offset - asked.offset) * 2 <= e.bodyRows ? w : { offset: asked.offset, bodyRows: e.bodyRows },
      ).catch(() => undefined)
    }
    return moved
  })

  // 우측 diff 패널: 파일별 +/− 요약과 헌크.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // 이 패널은 /desk-diff 로만 열리고 터미널에서 그린다.
    const els = $.ui.resolve(e) as Els
    const { Box, Text, Button, Code, Input } = els
    const [uncommitted, view, armed, info, edits, home, face, window, draft, comments, gaps, filter] = await Promise.all([
      read($, diff),
      read($, diffView),
      read($, open),
      read($, repo),
      read($, runs),
      $.env.get('HOME').catch(() => undefined),
      read($, surface),
      read($, diffWindow),
      read($, commentDraft),
      read($, lineComments),
      read($, diffGaps),
      read($, diffFilter),
    ])
    diffDrawnFolds = armed
    // 패널 몸통 폭: viewport.columns 는 패널 폭이 아니다(구분선을 끌면 어긋나 단어 강조 조각이 일찍 잘렸다).
    const columns = (e.props as { bodyColumns?: number }).bodyColumns ?? e.viewport?.columns ?? 80
    // 그릴 범위는 ui.scroll 이 적어 둔 창으로 정하되, 엔진이 이번에 알려 준 창(props.scroll)이 그보다 반 화면 넘게
    // 떨어졌거나 높이가 다르면 그것을 쓴다. 스크롤 없이 창이 바뀌는 때(터미널 크기·원격 접속 해상도)에는 ui.scroll 이
    // 불리지 않아, 적어 둔 창만 보면 늘어난 아래쪽이 스크롤할 때까지 비었다.
    const seen = (e.props as { scroll?: { offset: number; bodyRows: number } }).scroll
    // 플러그인의 $.ui.scroll 은 ui.scroll 을 거치지 않아(2.1.304) 위치를 적지 못한다. 그린 창으로 적는다.
    if (seen && seen.bodyRows > 0) paneOffsets.set(PANE, seen.offset)
    const shown =
      seen && seen.bodyRows > 0 && (seen.bodyRows !== window.bodyRows || Math.abs(seen.offset - window.offset) * 2 > seen.bodyRows) ? seen : window
    const allFiles = view.scope === 'branch' ? view.files : uncommitted
    // 커밋 안 한 변경에는 git 이 못 보는 저장소 밖 편집을 세션 기록으로 덧붙인다.
    const allOutside = view.scope === 'uncommitted' ? outsideEdits(sessionEditsOf(edits), info) : []
    // 파일 이름 거르기: 목록·n·p·z 는 걸러진 파일만. 제목의 파일 수와 +/− 합계는 전체로 센다.
    const query = filter.query.trim()
    const isMatch = (path: string) => matchesPath(path, query)
    const files = allFiles.filter(file => isMatch(file.path))
    const outside = allOutside.filter(edit => isMatch(edit.path))
    const commitFilesOf = (sha: string) => view.commitFiles[sha]?.filter(file => isMatch(file.path))
    // 파일은 하나만 펴진다(pickFile): 펴 둔 기록이 없으면 접힌 것이라 패널은 접힌 목록으로 열린다.
    const isFolded = (id: string) => armed[`fold:${id}`] ?? true
    // git 밖 편집 묶음을 접으면 머리 줄만 남는다. 개수·+/− 합계에는 그대로 센다.
    const outsideFolded = armed[OUTSIDE_GROUP] ?? false
    const outsideShown = outsideFolded ? [] : outside
    const added = [...allFiles, ...allOutside].reduce((sum, file) => sum + file.added, 0)
    const removed = [...allFiles, ...allOutside].reduce((sum, file) => sum + file.removed, 0)
    const shortPath = (path: string) => (home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path)
    const empty =
      info?.isRepo === false
        ? T.notRepoDiff
        : view.scope === 'branch'
          ? view.base
            ? T.noChangesSince(view.base.ref)
            : T.noBase
          : T.noUncommitted

    // 파일 하나: 머리 줄(누르면 접고 폄)과 diff. 되돌리기는 커밋 안 한 변경에서만.
    const fileBlock = (file: FileDiff, prefix: string, canRevert: boolean) => (
      <Box key={`file-${prefix}${file.path}`} flexDirection="column">
        <Box columnGap={1}>
          {rowButton(
            els,
            { key: `fold-${prefix}${file.path}`, onPress: () => void pickFile($, `${prefix}${file.path}`) },
            clipStart(file.path, Math.max(12, columns - 34)),
            file.isNew && <Text color={COLORS.muted}> new</Text>,
            ' ',
            diffChips(Text, file.added, file.removed),
            <Text color={COLORS.muted}>{isFolded(`${prefix}${file.path}`) ? ' ›' : ' ⌄'}</Text>,
          )}
          {canRevert && !file.isNew && (
            <Button
              key={`revert-${file.path}`}
              plain
              dimColor={!armed[`revert:${file.path}`]}
              label={armed[`revert:${file.path}`] ? T.revertConfirm : T.revert}
              onPress={() => void revertFile($, file.path, armed[`revert:${file.path}`] ?? false)}
            />
          )}
        </Box>
        {isFolded(`${prefix}${file.path}`) ? null : file.patch ? (
          <Code source={file.patch} path={file.path} format="diff" />
        ) : (
          <Text color={COLORS.muted}>{file.large ? T.largeDiff : T.binary}</Text>
        )}
      </Box>
    )

    // 세션 기록의 파일 하나: 편집마다의 헌크를 차례로. 되돌리기는 없다(git 이 모르는 파일).
    const outsideBlock = (edit: SessionEdit) => {
      const id = `${OUTSIDE}${edit.path}`
      return (
        <Box key={`file-${id}`} flexDirection="column">
          {rowButton(
            els,
            { key: `fold-${id}`, onPress: () => void pickFile($, id) },
            clipStart(shortPath(edit.path), Math.max(12, columns - 34)),
            ' ',
            diffChips(Text, edit.added, edit.removed),
            <Text color={COLORS.muted}>{isFolded(id) ? ' ›' : ' ⌄'}</Text>,
          )}
          {!isFolded(id) &&
            (edit.patches.length > 0 ? (
              edit.patches.map((patch, index) => <Code key={`patch-${id}-${index}`} source={patch} path={edit.path} format="diff" />)
            ) : (
              <Text color={COLORS.muted}>{T.binary}</Text>
            ))}
        </Box>
      )
    }

    const shownCount = allFiles.length + allOutside.length
    // 모두 접기·펴기: 하나라도 펴져 있으면 모두 접고, 아니면 모두 편다.
    // 파일 탭은 지금 보이는 파일 블록의 접기 키(fileBlock·outsideBlock 과 같은 모양), 커밋별 탭은 커밋 줄이 대상이다.
    const foldIds = [...files.map(file => `${view.scope === 'branch' ? 'b:' : ''}${file.path}`), ...outsideShown.map(edit => `${OUTSIDE}${edit.path}`)]
    const foldCount = view.scope === 'commits' ? view.commits.length : foldIds.length
    // 걸러 낸 뒤 보이는 파일(커밋별은 펼친 커밋 안의 것): 거르기 줄의 개수와 Enter(첫 파일 열기).
    const matchIds =
      view.scope === 'commits'
        ? view.commits.flatMap(commit => (commitFilesOf(commit.sha) ?? []).map(file => `c:${commit.short}:${file.path}`))
        : foldIds
    const matchTotal = view.scope === 'commits' ? view.commits.reduce((sum, commit) => sum + (view.commitFiles[commit.sha]?.length ?? 0), 0) : shownCount
    const anyOpen = view.scope === 'commits' ? Object.keys(view.commitFiles).length > 0 : foldIds.some(id => !isFolded(id))
    const foldAll = () =>
      view.scope === 'commits' ? foldCommits($) : update($, open, state => ({ ...state, ...Object.fromEntries(foldIds.map(id => [`fold:${id}`, anyOpen])) }))
    const title =
      view.scope === 'commits'
        ? view.commits.length > 0
          ? `${view.commits.length} commit${view.commits.length === 1 ? '' : 's'}`
          : T.commitsTitle
        : shownCount > 0
          ? `Edited ${shownCount} file${shownCount === 1 ? '' : 's'}`
          : T.changesTitle

    // 커밋별 탭의 커밋 한 줄: 누르면 그 커밋의 파일을 펼친다.
    const commitRow = (commit: CommitInfo) => {
      const when = commit.authored ? `${commit.ago} (${T.commitAuthored(commit.authored)})` : commit.ago
      return rowButton(
        els,
        { key: `commit-${commit.sha}`, onPress: () => void pickCommit($, commit.sha) },
        commit.short,
        ' ',
        <Text color={COLORS.text}>{clip(commit.subject, Math.max(10, columns - cellWidth(when) - 16))}</Text>,
        <Text color={COLORS.muted}>{` · ${when}`}</Text>,
        <Text color={COLORS.muted}>{view.commitFiles[commit.sha] ? ' ⌄' : ' ›'}</Text>,
      )
    }

    // 데스크톱 diff 패널의 파일 머리 띠: 바탕색 한 줄에 ⌄ 이름(굵게) 흐린 폴더 +N −M, 되돌리기.
    // 띠 Box 의 key(file-…)는 openDiffAt 이 스크롤해 갈 곳이라 패널이 보이는 곳만 그려도 늘 그린다.
    const diffFileHeader = (path: string, prefix: string, plus: number, minus: number, isNew: boolean, canRevert: boolean, indent: number, shown = path) => {
      const id = `${prefix}${path}`
            const name = shown.split('/').pop() ?? shown
      const folder = shown.slice(0, Math.max(0, shown.length - name.length - 1))
      const room = Math.max(0, columns - indent - cellWidth(name) - cellWidth(` +${plus}  −${minus} `) - (canRevert ? cellWidth(T.revertConfirm) + 2 : 0) - (isNew ? 5 : 0) - 8)
      return (
        <Box key={`file-${id}`} height={1} overflow="hidden" columnGap={1} paddingLeft={indent} {...(face ? { backgroundColor: face.bubble } : {})}>
          <Box flexShrink={0}>
          {rowButton(
            els,
            { key: `fold-${id}`, onPress: () => void pickFile($, id) },
            isFolded(id) ? ' › ' : ' ⌄ ',
            <Text color={COLORS.text} weight="semibold">
              {name}
            </Text>,
            folder && room > 4 && <Text color={COLORS.muted}>{` ${clipStart(folder, room)}`}</Text>,
            isNew && <Text color={COLORS.muted}> new</Text>,
            ' ',
            diffChips(Text, plus, minus),
          )}
          </Box>
          {canRevert && !isNew && (
            <Button
              key={`revert-${path}`}
              plain
              dimColor={!armed[`revert:${path}`]}
              label={armed[`revert:${path}`] ? T.revertConfirm : T.revert}
              onPress={() => void revertFile($, path, armed[`revert:${path}`] ?? false)}
            />
          )}
        </Box>
      )
    }

    // git 밖 편집 묶음의 머리 줄: 누르면 묶음 전체를 접고 편다.
    const outsideHeader = rowButton(
      els,
      { key: 'fold-outside', onPress: () => toggle($, OUTSIDE_GROUP) },
      outsideFolded ? '› ' : '⌄ ',
      <Text color={COLORS.muted}>{T.outsideEdits}</Text>,
      <Text color={COLORS.muted}>{` · ${outside.length}`}</Text>,
    )

    const tabs = (
      <Box key="diff-tabs" columnGap={2} height={1} overflow="hidden">
        {SCOPES.map(scope => (
          <Box key={`scope-box-${scope}`} flexShrink={0}>
            <Button
              key={`scope-${scope}`}
              plain
              dimColor={scope !== view.scope}
              label={`${scope === view.scope ? '●' : '○'} ${scopeLabel(scope)}`}
              onPress={() => void refreshDiffView($, scope)}
            />
          </Box>
        ))}
      </Box>
    )
    const titleRow = (
      <Box key="diff-title" columnGap={1} height={1} overflow="hidden">
        <Box flexShrink={0}>
          <Text color={COLORS.text} weight="semibold">
            {title}
          </Text>
        </Box>
        {view.scope !== 'commits' && shownCount > 0 && <Box flexShrink={0}>{diffChips(Text, added, removed)}</Box>}
        {view.scope !== 'uncommitted' && (
          <Box flexShrink={0}>
            <Button key="base-pick" plain dimColor={!view.bases} hotkey="v" label={`${view.base ? `vs ${view.base.ref}` : T.pickBase} ${view.bases ? '⌃' : '⌄'}`} onPress={() => void toggleBases($)} />
          </Box>
        )}
      </Box>
    )
    // 도구 줄: 다시 읽기, 이전·다음 파일(데스크톱 모양일 때, 파일이 둘 이상), 거르기, 모두 접기·펴기.
    const canStep = !!(face && diffColors) && (view.scope === 'commits' ? matchIds.length : foldIds.length) > 1
    const tool = (node: unknown) => <Box flexShrink={0}>{node as never}</Box>
    const toolsRow = (
      <Box key="diff-tools" columnGap={2} height={1} overflow="hidden">
        {tool(<Button key="refresh" plain dimColor hotkey="r" label="↻" onPress={() => void refreshDiffView($)} />)}
        {canStep && tool(<Button key="file-prev" plain dimColor hotkey="p" label={T.prevFile} onPress={() => void stepFile($, -1)} />)}
        {canStep && tool(<Button key="file-next" plain dimColor hotkey="n" label={T.nextFile} onPress={() => void stepFile($, 1)} />)}
        {(matchTotal > 1 || filter.isOpen) && tool(<Button key="filter" plain dimColor={!filter.isOpen} hotkey="f" label={T.filterFiles} onPress={() => void toggleFilter($)} />)}
        {foldCount > 1 && tool(<Button key="fold-all" plain dimColor hotkey="z" label={anyOpen ? T.foldAll : T.unfoldAll} onPress={() => void foldAll()} />)}
      </Box>
    )
    // 거르기 줄: 입력칸, 걸러진 수, 닫기. Enter 는 걸러진 첫 파일을 편다.
    const filterRow = filter.isOpen && (
      <Box key="diff-filter-row" height={1} columnGap={1} overflow="hidden">
        <Box flexGrow={1} flexShrink={1} overflow="hidden">
          <Input
            key="diff-filter"
            label={T.filterLabel}
            placeholder={T.filterPlaceholder}
            value={filter.query}
            submitLabel={T.filterOpen}
            onInput={value => void update($, diffFilter, previous => ({ ...previous, query: value }))}
            onSubmit={() => {
              const first = matchIds[0]
              if (first) void pickFile($, first)
            }}
          />
        </Box>
        {/* 커밋별에서 펼친 커밋이 없으면 걸러 볼 파일이 아직 없다: "맞는 파일이 없어요" 대신 아무것도 */}
        {query !== '' && matchTotal > 0 && (
          <Box flexShrink={0}>
            <Text color={matchIds.length === 0 ? COLORS.danger : COLORS.muted}>{matchIds.length === 0 ? T.noFileMatch : `${matchIds.length}/${matchTotal}`}</Text>
          </Box>
        )}
        <Box flexShrink={0}>
          <Button key="filter-close" plain dimColor label="✕" onPress={() => void toggleFilter($)} />
        </Box>
      </Box>
    )
    // 기준 고르기 목록: 자동, 그리고 최근 커밋 순 브랜치. 고른 것에 ●.
    const baseRows = view.scope !== 'uncommitted' && view.bases
      ? [
          { key: 'base-auto', label: T.baseAuto(view.baseRef === null ? (view.base?.ref ?? null) : null), isOn: view.baseRef === null, ref: null },
          ...view.bases.map(ref => ({ key: `base-${ref}`, label: ref, isOn: view.baseRef === ref, ref })),
        ].map(row => (
          <Box key={`${row.key}-row`} height={1} overflow="hidden" paddingLeft={2}>
            <Button key={row.key} plain dimColor={!row.isOn} label={`${row.isOn ? '●' : '○'} ${row.label}`} onPress={() => void pickBase($, row.ref)} />
          </Box>
        ))
      : []
    const baseEmpty = view.scope !== 'uncommitted' && view.bases?.length === 0 && (
      <Box key="base-none" height={1} paddingLeft={2}>
        <Text color={COLORS.muted}>{T.noBranches}</Text>
      </Box>
    )
    // 거르기 줄은 도구 줄 위에: 치는 동안 걸러진 수에 따라 도구 버튼이 나고 들면, 그보다 뒤에 그린 입력칸은 키를 잃는다(실화면).
    const head = [tabs, titleRow, ...(filterRow ? [filterRow] : []), toolsRow, ...baseRows, ...(baseEmpty ? [baseEmpty] : [])]

    if (face && diffColors) {
      return virtualDiff({
        els,
        palette: diffColors,
        window: shown,
        columns,
        head,
        sections: [
          ...(view.scope !== 'commits' && shownCount === 0 ? [{ kind: 'note' as const, key: 'empty', text: empty }] : []),
          ...(view.scope !== 'commits'
            ? files.map(file => ({
                kind: 'file' as const,
                file,
                prefix: view.scope === 'branch' ? 'b:' : '',
                canRevert: view.scope === 'uncommitted',
                indent: 0,
                source: { kind: 'worktree' as const },
              }))
            : []),
          ...(outside.length > 0 ? [{ kind: 'element' as const, key: 'outside', node: outsideHeader }] : []),
          ...outsideShown.map(edit => ({ kind: 'session' as const, edit })),
          ...(view.scope === 'commits' && view.commits.length === 0
            ? [{ kind: 'note' as const, key: 'no-commits', text: info?.isRepo === false ? T.notRepo : view.base ? T.noCommitsSince(view.base.ref) : T.noCommits }]
            : []),
          ...(view.scope === 'commits'
            ? view.commits.flatMap(commit => [
                { kind: 'element' as const, key: `commit-${commit.sha}`, node: commitRow(commit) },
                ...(view.commitFiles[commit.sha]?.length === 0 ? [{ kind: 'note' as const, key: `empty-${commit.sha}`, text: T.emptyCommit, indent: 2 }] : []),
                ...(commitFilesOf(commit.sha) ?? []).map(file => ({
                  kind: 'file' as const,
                  file,
                  prefix: `c:${commit.short}:`,
                  canRevert: false,
                  indent: 2,
                  source: { kind: 'commit' as const, sha: commit.sha },
                })),
              ])
            : []),
        ],
        isFolded,
        gaps,
        onGap: at => void openGap($, at).catch(() => undefined),
        fileHeader: (file, prefix, canRevert, indent) => diffFileHeader(file.path, prefix, file.added, file.removed, file.isNew, canRevert, indent),
        sessionHeader: edit => diffFileHeader(edit.path, OUTSIDE, edit.added, edit.removed, false, false, 0, shortPath(edit.path)),
        notes: {
          draft,
          comments,
          scopeOf: prefix => commentScope(prefix, view.base?.ref),
          onLine: at => void pickLine($, at).catch(() => undefined),
          draftRow: (key, picked, lines, pad) => (
            <Box key={key} height={COMMENT_ROWS} paddingLeft={pad} columnGap={1}>
              <Box flexGrow={1} flexShrink={1} overflow="hidden">
                <Input
                  key={draftInputKey(picked)}
                  label={T.commentLabel(rangeLabel(lines))}
                  placeholder={T.commentPlaceholder}
                  rows={COMMENT_ROWS}
                  value={draftText}
                  submitLabel={T.commentSave}
                  onInput={value => (draftText = value)}
                  onSubmit={value => void saveComment($, picked, lines, value).catch(() => undefined)}
                />
              </Box>
              <Button key="comment-clear" plain dimColor label={T.inputClear} onPress={() => void clearComment($)} />
              <Button key="comment-cancel" plain dimColor label={T.cancel} onPress={() => void cancelComment($)} />
            </Box>
          ),
          commentRow: (key, comment, pad) => (
            <Box key={key} height={1} paddingLeft={pad} columnGap={1}>
              <Box flexGrow={1} flexShrink={1} overflow="hidden">
                <Text wrap="truncate-end">
                  <Text color={COLORS.link}>{`✎ ${rangeLabel(comment.lines)}`}</Text>
                  {`  ${comment.body.replaceAll('\n', ' ↵ ')}`}
                </Text>
              </Box>
              <Button key={`comment-del-${comment.id}`} plain dimColor label="✕" onPress={() => void update($, lineComments, list => list.filter(item => item.id !== comment.id))} />
            </Box>
          ),
        },
      })
    }

    // 테마를 모를 때(엔진 diff): 이전·다음 파일은 없다(머리 띠 자리를 셈하지 않는다).
    diffHeads = []
    return (
      <Box flexDirection="column" rowGap={1}>
        {tabs}
        <Box flexDirection="column">{head.slice(1) as never}</Box>
        {view.scope !== 'commits' && shownCount === 0 && <Text color={COLORS.muted}>{empty}</Text>}
        {view.scope !== 'commits' && (
          <Box flexDirection="column">{files.map(file => fileBlock(file, view.scope === 'branch' ? 'b:' : '', view.scope === 'uncommitted'))}</Box>
        )}
        {outside.length > 0 && outsideHeader}
        {outsideShown.map(outsideBlock)}
        {view.scope === 'commits' && view.commits.length === 0 && (
          <Text color={COLORS.muted}>{info?.isRepo === false ? T.notRepo : view.base ? T.noCommitsSince(view.base.ref) : T.noCommits}</Text>
        )}
        {view.scope === 'commits' &&
          view.commits.map(commit => {
            const changed = commitFilesOf(commit.sha)
            return (
              <Box key={`commit-${commit.sha}`} flexDirection="column">
                {commitRow(commit)}
                {changed && (
                  <Box flexDirection="column" paddingLeft={2}>
                    {changed.length === 0 && <Text color={COLORS.muted}>{T.emptyCommit}</Text>}
                    {changed.map(file => fileBlock(file, `c:${commit.short}:`, false))}
                  </Box>
                )}
              </Box>
            )
          })}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PR_PANE }, async ($, e) => {
    const els = $.ui.resolve(e) as Els
    const { Box, Text, Button, Link } = els
    const [state, armed] = await Promise.all([read($, pr), read($, open)])
    const columns = e.viewport?.columns ?? 80
    // ↻ 로 다시 읽는 동안은 … : 다 읽은 PR 이 그대로여도 다시 읽었는지 보이게(15초 자동 갱신은 바꾸지 않는다)
    const isLoading = state?.status === 'loading'
    const refresh = <Button key="pr-refresh" plain dimColor hotkey="r" label={isLoading ? '…' : '↻'} onPress={() => void refreshPr($, true).catch(() => undefined)} />
    const info = state?.pr ?? null

    if (!info) {
      const message =
        state === null || state.status === 'loading'
          ? T.prLoading
          : state.status === 'none'
            ? state.branch
              ? T.prNone(state.branch)
              : T.prDetached
            : T.prFailed(state.error)
      return (
        <Box flexDirection="column" rowGap={1}>
          <Box columnGap={1}>
            <Text color={COLORS.text} weight="semibold">
              PR
            </Text>
            {refresh}
          </Box>
          <Text color={COLORS.muted}>{message}</Text>
        </Box>
      )
    }

    const summary = checkSummary(info.checks)
    const stateWord = info.state === 'MERGED' ? 'Merged' : info.state === 'CLOSED' ? 'Closed' : info.isDraft ? 'Draft' : 'Open'
    const stateColor = info.state === 'OPEN' ? (info.isDraft ? COLORS.muted : COLORS.success) : COLORS.muted
    const passes = info.checks.filter(check => check.state === 'pass' || check.state === 'skip')
    const showPasses = armed['pr:passes'] ?? false
    const nameWidth = Math.max(12, columns - 30)
    const action = mergeAction(info)
    const mergeKey = `merge:${info.url}`

    const checkRow = (check: PrCheck) => {
      const mark = check.state === 'fail' ? '✗' : check.state === 'pending' ? '●' : check.state === 'skip' ? '–' : '✓'
      const color = check.state === 'fail' ? COLORS.danger : check.state === 'pending' ? COLORS.warning : check.state === 'skip' ? COLORS.muted : COLORS.success
      return (
        <Box key={`check-${check.name}`} columnGap={1}>
          <Text color={color}>{mark}</Text>
          {check.url ? (
            <Link href={check.url}>{clip(check.name, nameWidth)}</Link>
          ) : (
            <Text color={check.state === 'pass' || check.state === 'skip' ? COLORS.muted : COLORS.text}>{clip(check.name, nameWidth)}</Text>
          )}
          {check.state === 'fail' && (
            <Button key={`fix-check-${check.name}`} plain label={T.handToClaude} onPress={() => void fillPrompt($, checkPrompt(info, check))} />
          )}
        </Box>
      )
    }

    const threadRow = (thread: PrThread, index: number) => (
      <Box key={`thread-${index}`} flexDirection="column">
        <Box columnGap={1}>
          <Text color={COLORS.warning}>◆</Text>
          <Text color={COLORS.text}>{clip(thread.line === null ? thread.path : `${thread.path}:${thread.line}`, Math.max(12, columns - 40))}</Text>
          <Text color={COLORS.muted}>{thread.author}</Text>
          {thread.isOutdated && <Text color={COLORS.muted}>outdated</Text>}
          <Button key={`fix-thread-${index}`} plain label={T.handToClaude} onPress={() => void fillPrompt($, threadPrompt(info, thread))} />
        </Box>
        <Box paddingLeft={2}>
          <Text color={COLORS.muted}>{clip(thread.body.split('\n').find(line => line.trim() !== '') ?? '', Math.max(10, columns - 4))}</Text>
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="column">
          <Box columnGap={1}>
            <Text color={COLORS.muted}>{`\uf407 ${prNumber(info)}`}</Text>
            <Text color={COLORS.text} weight="semibold">
              {clip(info.title, Math.max(10, columns - 14))}
            </Text>
            {refresh}
          </Box>
          <Box columnGap={1}>
            <Text color={stateColor}>{stateWord}</Text>
            <Text color={COLORS.muted}>{`· ${clip(`${info.base} ← ${info.head}`, Math.max(10, columns - 30))} ·`}</Text>
            {info.added !== null && info.removed !== null && diffChips(els.Text, info.added, info.removed)}
          </Box>
          {(info.reviewDecision || (info.state === 'OPEN' && info.mergeState)) && (
            <Box columnGap={1}>
              {info.reviewDecision && (
                <Text color={info.reviewDecision === 'APPROVED' ? COLORS.success : info.reviewDecision === 'CHANGES_REQUESTED' ? COLORS.danger : COLORS.muted}>
                  {T.review(reviewName(info.reviewDecision))}
                </Text>
              )}
              {info.reviewDecision && info.state === 'OPEN' && info.mergeState && <Text color={COLORS.muted}>·</Text>}
              {info.state === 'OPEN' && info.mergeState && <Text color={COLORS[mergeLevel(info.mergeState)]}>{mergeName(info.mergeState)}</Text>}
            </Box>
          )}
          {info.state === 'OPEN' && info.autoMerge && <Text color={COLORS.warning}>{T.autoMergeOn}</Text>}
          {action !== null && (
            <Button
              key="pr-merge"
              plain
              label={armed[mergeKey] ? (action === 'auto' ? T.mergeAutoConfirm : T.mergeConfirm) : action === 'auto' ? T.mergeAuto(info.provider) : T.merge}
              onPress={() => void mergeFromPane($, info, action, armed[mergeKey] ?? false)}
            />
          )}
          <Link href={info.url}>{T.openOn(info.provider)}</Link>
        </Box>
        <Box flexDirection="column">
          <Box columnGap={1}>
            <Text color={COLORS.text} weight="semibold">
              {info.provider === 'gitlab' ? 'Pipeline' : 'Checks'}
            </Text>
            <Text color={COLORS.muted}>
              {summary.total === 0
                ? T.checksNone
                : [T.passedOf(summary.passed, summary.total), summary.failed > 0 ? T.failedCount(summary.failed) : null, summary.pending > 0 ? T.runningCount(summary.pending) : null].filter(Boolean).join(' · ')}
            </Text>
          </Box>
          {info.checks.filter(check => check.state === 'fail' || check.state === 'pending').map(checkRow)}
          {passes.length > 0 &&
            rowButton(
              els,
              { key: 'pr-passes', dimColor: true, onPress: () => toggle($, 'pr:passes') },
              showPasses ? T.passesShown(passes.length) : T.passesFolded(passes.length),
              showPasses ? ' ⌄' : ' ›',
            )}
          {showPasses && passes.map(checkRow)}
        </Box>
        <Box flexDirection="column">
          <Box columnGap={1}>
            <Text color={COLORS.text} weight="semibold">
              {T.unresolved}
            </Text>
            <Text color={COLORS.muted}>{info.threads === null ? T.unreadable : T.count(info.threads.length)}</Text>
          </Box>
          {(info.threads ?? []).map(threadRow)}
        </Box>
      </Box>
    )
  })
}

// 명령 출력이 마크다운인지: 표·제목·코드 블록·인용이 하나라도 있으면.
export function looksLikeMarkdown(text: string): boolean {
  return parseBlocks(text).some(block => block.kind === 'table' || block.kind === 'heading' || block.kind === 'code' || block.kind === 'quote')
}

export function askHint(question: { kind: string; multiSelect: boolean }): string {
  const how = question.kind !== 'choice' ? T.askHowText : question.multiSelect ? T.askHowMulti : T.askHowPick
  return `  ${how} · ${T.askHintTail}`
}

// 질문 카드(입력창 위 띠). 묻는 상태와 도구 호출 훅은 ask.tsx, 그리기와 버튼은 여기($ 는 파일을 넘지 못한다).
// 답은 기다리는 cat 의 파이프(answer)에 tee 로 넘긴다(ask.tsx).
async function replyAsk($: EngineInterface, dir: string, payload: AskReply) {
  await $.process.run(['tee', `${dir}/answer`], { stdin: JSON.stringify(payload), timeoutMs: 3000 })
}

// 카드를 건드렸다고 알린다: Remote Control 세션에서 엔진 창으로 넘기는 시계를 다시 센다(ask.tsx).
// 매번 다른 글을 써서 기다리는 훅이 바뀐 것을 안다(답과 같은 tee 로).
let askTouches = 0
function touchAsk($: EngineInterface, dir: string) {
  void $.process.run(['tee', `${dir}/touched`], { stdin: String(++askTouches), timeoutMs: 3000 }).catch(() => undefined)
}

// 지금 질문에 답을 정하고 다음 질문으로, 마지막이면 답을 보낸다.
// 선택지 하나를 눌렀을 때. 질문이 바뀐 직후(ASK_SETTLE)의 키는 앞 질문에서 넘어온 것이라 버린다:
// 키를 누르고 떼는 사이에 질문이 바뀌면 다음 질문의 같은 번호가 함께 눌리기 때문이다.
const ASK_SETTLE = 350

async function pickAsk($: EngineInterface, state: AskState, label: string, isPicked: boolean) {
  if ((await $.clock.now()) - state.shownAt < ASK_SETTLE) return
  const question = state.questions[state.step]
  if (!question) return
  if (!question.multiSelect) return advanceAsk($, state, [label], '')
  const picks = state.picks[state.step] ?? []
  const value = isPicked ? picks.filter(item => item !== label) : [...picks, label]
  touchAsk($, state.dir)
  await update($, asking, current =>
    current && current.id === state.id ? { ...current, picks: current.picks.map((item, index) => (index === current.step ? value : item)) } : current,
  )
}

async function advanceAsk($: EngineInterface, state: AskState, picks: string[], text: string) {
  const question = state.questions[state.step]
  if (!question) return
  const problem = numberProblem(question, text)
  if (problem) {
    $.ui.toast(problem)
    return
  }
  const nextPicks = state.picks.map((value, index) => (index === state.step ? picks : value))
  const nextTexts = state.texts.map((value, index) => (index === state.step ? text : value))
  if (state.step + 1 < state.questions.length) {
    touchAsk($, state.dir)
    const shownAt = await $.clock.now()
    await update($, asking, current =>
      current && current.id === state.id ? { ...current, step: current.step + 1, picks: nextPicks, texts: nextTexts, shownAt } : current,
    )
    return
  }
  const answers = Object.fromEntries(
    state.questions.map((item, index) => [item.question, answerOf(item, nextPicks[index] ?? [], nextTexts[index] ?? '')]),
  )
  await replyAsk($, state.dir, { kind: 'answer', answers })
}

// 입력창 위 띠의 질문 카드. 묻는 중이 아니면 null.
// 질문 카드가 차지할 줄 수. 띠가 모자라면(낮은 터미널) 선택지 밖으로 밀린 버튼은 숫자 키가 먹지 않으므로
// 간단한 모양(제목·질문 한 줄 + 선택지, 여러 개 고르기면 제출 줄)으로, 그래도 모자라면 테두리 없는 두 줄로 줄인다.
export function askRows(question: { kind: string; description?: string; multiSelect: boolean; options: { preview?: string }[] }, compact: boolean, textRows = 1): number {
  if (compact) return 2 + 1 + (question.kind === 'choice' ? question.options.length : 1) + (question.multiSelect ? 1 : 0)
  const choice = question.kind === 'choice'
  const hint = question.options.some(option => option.preview) ? 1 : 0
  return 2 + 2 + (question.description ? 1 : 0) + (choice ? 1 + question.options.length + hint : 0) + 1 + textRows + 1
}

// 넉넉한 카드의 직접 입력칸 높이: 두 줄에서 쓴 줄 수만큼 ASK_TEXT_ROWS 까지 자란다. 숫자는 한 줄.
// 한 줄 칸에서는 엔진이 \⏎ 도 제출로 받아 줄바꿈을 시작할 수 없으므로 두 줄부터다.
export function askTextRows(question: { kind: string }, text: string): number {
  return question.kind === 'number' ? 1 : Math.min(ASK_TEXT_ROWS, Math.max(2, text.split('\n').length))
}

// 띠 줄 수에 맞는 모양: 다 들어가면 full, 아니면 테두리 카드(compact), 그것도 안 되면 두 줄(inline).
export type AskMode = 'full' | 'compact' | 'inline'
export function askMode(question: Parameters<typeof askRows>[0], room: number, textRows = 1): { mode: AskMode; rows: number } {
  if (askRows(question, false, textRows) <= room) return { mode: 'full', rows: askRows(question, false, textRows) }
  if (askRows(question, true) <= room) return { mode: 'compact', rows: askRows(question, true) }
  return { mode: 'inline', rows: 2 }
}

// 질문 카드 입력칸의 키 차례와 카드를 그린 띠의 id: 지우기를 누르면 빈 칸을 새로 그려 그리로 돌아간다.
let askClearRound = 0
let askBand: string | null = null

async function clearAskText($: EngineInterface, state: AskState) {
  touchAsk($, state.dir)
  askClearRound++
  await update($, asking, current =>
    current && current.id === state.id ? { ...current, texts: current.texts.map((item, index) => (index === current.step ? '' : item)) } : current,
  )
  if (askBand) await $.ui.focus({ requestId: askBand, key: `ask-text-${state.id}-${state.step}-${askClearRound}` }).catch(() => undefined)
}

async function askCard($: EngineInterface, els: Elements['terminal'], columns: number, room: number) {
  const { Box, Text, Button, Input } = els
  const state = await read($, asking)
  const question = state?.questions[state.step]
  if (!state || !question) return null
  const done = (card: JSX.Element) => ({ card, rows })
  const picks = state.picks[state.step] ?? []
  const text = state.texts[state.step] ?? ''
  const total = state.questions.length
  const isLast = state.step + 1 === total
  const k = `${state.id}-${state.step}`
  const setText = (value: string) => {
    touchAsk($, state.dir)
    return update($, asking, current =>
      current && current.id === state.id ? { ...current, texts: current.texts.map((item, index) => (index === current.step ? value : item)) } : current,
    )
  }
  const unit = question.unit ? ` (${question.unit})` : ''
  const width = Math.max(30, Math.min(columns, 100))
  const textRows = askTextRows(question, text)
  const { mode, rows } = askMode(question, room, textRows)
  const compact = mode !== 'full'
  const inline = mode === 'inline'

  // 가장 낮은 띠: 테두리 없이 두 줄(제목·질문 / 선택지를 한 줄에 나란히).
  if (inline) {
    return done(
      <Box flexDirection="column" width={width} paddingX={1}>
        <Text wrap="truncate-end">
          {question.header !== '' && <Text color={COLORS.clay} weight="semibold">{`${question.header} `}</Text>}
          {total > 1 && <Text color={COLORS.muted}>{`${state.step + 1}/${total} `}</Text>}
          <Text color={COLORS.text} weight="semibold">
            {question.question}
          </Text>
        </Text>
        <Box columnGap={2} flexWrap="wrap">
          {question.kind === 'choice' ? (
            question.options.map((option, index) => {
              const isPicked = picks.includes(option.label)
              const mark = question.multiSelect ? (isPicked ? '☑ ' : '☐ ') : ''
              return (
                <Box key={`opt-${k}-${index}`}>
                  <Button
                    key={`ask-${k}-${index}`}
                    plain
                    hover={{ color: COLORS.clay }}
                    hotkey={index < 8 ? String(index + 1) : undefined}
                    label={`${mark}${option.label}`}
                    onPress={() => void pickAsk($, state, option.label, isPicked)}
                  />
                </Box>
              )
            })
          ) : (
            <Button key={`ask-engine-${k}`} plain hotkey="9" label={T.answerInDefault} onPress={() => void replyAsk($, state.dir, { kind: 'engine' })} />
          )}
          {question.multiSelect && (
            <Button key={`ask-next-${k}`} plain hotkey="0" label={isLast ? T.submit : T.nextArrow} onPress={() => void advanceAsk($, state, picks, text)} />
          )}
        </Box>
      </Box>
    )
  }

  if (compact) {
    return done(
      <Box flexDirection="column" width={width} borderStyle="round" borderColor={COLORS.clay} paddingX={1}>
        <Text wrap="truncate-end">
          {question.header !== '' && <Text color={COLORS.clay} weight="semibold">{`${question.header} `}</Text>}
          {total > 1 && <Text color={COLORS.muted}>{`${state.step + 1}/${total} `}</Text>}
          <Text color={COLORS.text} weight="semibold">
            {question.question}
          </Text>
        </Text>
        {question.kind === 'choice' ? (
          question.options.map((option, index) => {
            const isPicked = picks.includes(option.label)
            const mark = question.multiSelect ? (isPicked ? '☑ ' : '☐ ') : ''
            return (
              <Box key={`opt-${k}-${index}`}>
                <Button
                  key={`ask-${k}-${index}`}
                  plain
                  hover={{ color: COLORS.clay }}
                  hotkey={index < 8 ? String(index + 1) : undefined}
                  label={`${mark}${option.label}`}
                  onPress={() => void pickAsk($, state, option.label, isPicked)}
                />
              </Box>
            )
          })
        ) : (
          <Button key={`ask-engine-${k}`} plain hotkey="9" label={T.answerInDefault} onPress={() => void replyAsk($, state.dir, { kind: 'engine' })} />
        )}
        {question.multiSelect && (
          <Button key={`ask-next-${k}`} hotkey="0" label={isLast ? T.submit : T.nextArrow} onPress={() => void advanceAsk($, state, picks, text)} />
        )}
      </Box>
    )
  }

  return done(
    <Box flexDirection="column" width={width} borderStyle="round" borderColor={COLORS.clay} paddingX={1}>
      <Box columnGap={1}>
        {question.header !== '' && (
          <Text color={COLORS.clay} weight="semibold">
            {question.header}
          </Text>
        )}
        {total > 1 && <Text color={COLORS.muted}>{`${state.step + 1}/${total}`}</Text>}
      </Box>
      <Text color={COLORS.text} weight="semibold">
        {question.question}
      </Text>
      {question.description && <Text color={COLORS.muted}>{question.description}</Text>}
      {question.kind === 'choice' && (
        <Box flexDirection="column" marginTop={1}>
          {question.options.map((option, index) => {
            const isPicked = picks.includes(option.label)
            const mark = question.multiSelect ? (isPicked ? '☑ ' : '☐ ') : ''
            return (
              <Box key={`opt-${k}-${index}`} columnGap={2} hover={option.preview ? { scope: `askp-${k}-${index}` } : undefined}>
                {rowButton(
                  els,
                  {
                    key: `ask-${k}-${index}`,
                    hover: { color: COLORS.clay },
                    hotkey: index < 8 ? String(index + 1) : undefined,
                    onPress: () => void pickAsk($, state, option.label, isPicked),
                  },
                  `${mark}${option.label}`,
                  option.description && option.description !== option.label && (
                    <Text color={COLORS.muted}>{`  ${clip(option.description, Math.max(10, columns - cellWidth(mark + option.label) - 10))}`}</Text>
                  ),
                )}
              </Box>
            )
          })}
          {question.options.some(option => option.preview) && <Text color={COLORS.muted}>{T.hoverPreview}</Text>}
          {question.options.map((option, index) => {
            if (!option.preview) return null
            // 카드 오른쪽, 제목 줄 높이부터 겹쳐 그린다(카드가 커지면 띠가 위로 자라 선택지가 커서 밑에서 밀려나므로).
            // 상자 배경은 칠해지지 않아 줄마다 같은 폭의 공백으로 채워 아래 글자를 덮는다.
            const lines = cap(option.preview, 10).split('\n')
            const inner = Math.max(...lines.map(cellWidth))
            return (
              <Box
                key={`askp-box-${k}-${index}`}
                position="absolute"
                top={-(question.description ? 4 : 3)}
                right={0}
                display="none"
                hover={{ scope: `askp-${k}-${index}`, display: 'flex' }}
                flexDirection="column"
                borderStyle="round"
                borderColor={COLORS.clay}
              >
                {lines.map(line => (
                  <Text color={COLORS.text}>{` ${line}${' '.repeat(inner - cellWidth(line))} `}</Text>
                ))}
              </Box>
            )
          })}
        </Box>
      )}
      <Box marginTop={1}>
        <Input
          key={`ask-text-${k}-${askClearRound}`}
          label={question.kind === 'choice' ? 'Other' : T.answerLabel(unit)}
          placeholder={question.placeholder ?? (question.kind === 'number' ? T.numberPlaceholder : T.otherPlaceholder)}
          rows={textRows}
          value={text}
          submitLabel={isLast ? T.submit : T.next}
          onInput={value => void setText(value)}
          onSubmit={value => void advanceAsk($, state, question.multiSelect ? picks : [], value)}
        />
      </Box>
      <Box columnGap={2}>
        {question.multiSelect && (
          <Button key={`ask-next-${k}`} hotkey="0" label={isLast ? T.submit : T.nextArrow} onPress={() => void advanceAsk($, state, picks, text)} />
        )}
        {question.kind !== 'number' && <Button key={`ask-clear-${k}`} plain dimColor label={T.inputClear} onPress={() => void clearAskText($, state)} />}
        <Button key={`ask-engine-${k}`} plain dimColor hotkey="9" label={T.toDefault} onPress={() => void replyAsk($, state.dir, { kind: 'engine' })} />
        <Button key={`ask-close-${k}`} plain dimColor label={T.close} onPress={() => void replyAsk($, state.dir, { kind: 'dismiss' })} />
      </Box>
    </Box>
  )
}

// 계획 카드 훅(어떻게·왜는 plan.ts). 계획 파일을 미리보기 패널로 여는 함수가 이 파일에 있어 여기서 등록한다.
// 계획 파일이 없으면(계획을 인자로만 받는 세션) 펼쳐 볼 곳이 없어 엔진 창 그대로.
function registerPlanAsk(on: Parameters<Register>[0], notify: boolean) {
  on('classic.PreToolUse', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    const input = planInput(e as unknown as Record<string, unknown>)
    const plan = typeof input.plan === 'string' ? input.plan : ''
    const path = typeof input.planFilePath === 'string' && isMarkdown(input.planFilePath) ? input.planFilePath : ''
    if (plan.trim() === '' || path === '') return next(e)
    const session = await cardSession($)
    if (session === null) return next(e)
    const dir = await openReplyPipe($)
    if (dir === '') return next(e)
    const shownAt = await $.clock.now()
    await update($, planAsking, () => ({ id: e.tool_use_id ?? dir, dir, plan, path, text: '', shownAt }))
    if (notify) void $.ui.notify(planTitle(plan) || T.planAskQuestion, { title: T.planAskTitle }).catch(() => undefined)
    await openPreview($, path).catch(() => undefined)
    const answered = await awaitReply($, next.signal, dir, session.isRemote, shownAt)
    await update($, planAsking, () => null)
    if (answered === null) return next(e)
    let answer: PlanReply = { kind: 'cancel' }
    try {
      answer = JSON.parse(answered) as PlanReply
    } catch {
      answer = { kind: 'cancel' }
    }
    switch (answer.kind) {
      case 'approve':
        return { allow: true, updatedInput: input }
      case 'revise':
        return { deny: reviseReason(answer.text) }
      case 'engine':
        return next(e)
      case 'dismiss':
        return { deny: DISMISS_REASON }
      case 'cancel':
        return { deny: CANCEL_REASON }
    }
  })
}

async function replyPlan($: EngineInterface, dir: string, payload: PlanReply) {
  await $.process.run(['tee', `${dir}/answer`], { stdin: JSON.stringify(payload), timeoutMs: 3000 })
}

// 띄운 직후(ASK_SETTLE)의 숫자 키는 카드가 뜨기 전에 누른 것이라 버린다.
async function approvePlan($: EngineInterface, state: PlanAskState) {
  if ((await $.clock.now()) - state.shownAt < ASK_SETTLE) return
  await replyPlan($, state.dir, { kind: 'approve' })
}

async function revisePlan($: EngineInterface, state: PlanAskState, text: string) {
  if (text.trim() === '') {
    $.ui.toast(T.planReviseEmpty)
    return
  }
  await replyPlan($, state.dir, { kind: 'revise', text })
}

async function viewPlan($: EngineInterface, state: PlanAskState) {
  touchAsk($, state.dir)
  if (state.path) await openPreview($, state.path, true).catch(() => undefined)
}

// 계획 카드가 차지할 줄 수: 테두리 2, 제목·물음 2, 버튼 줄과 그 위 빈 줄 2, 고칠 점 칸과 그 위 빈 줄, 아래 버튼 줄 1.
// 띠가 모자라면 고칠 점 칸 없는 테두리 카드(4줄), 그것도 안 되면 테두리 없는 두 줄.
export function planAskMode(room: number, textRows: number): { mode: AskMode; rows: number } {
  const full = 2 + 2 + 2 + 1 + textRows + 1
  if (full <= room) return { mode: 'full', rows: full }
  if (4 <= room) return { mode: 'compact', rows: 4 }
  return { mode: 'inline', rows: 2 }
}

async function planAskCard($: EngineInterface, els: Elements['terminal'], columns: number, room: number) {
  const { Box, Text, Button, Input } = els
  const state = await read($, planAsking)
  if (!state) return null
  const k = state.id
  const title = planTitle(state.plan)
  const width = Math.max(30, Math.min(columns, 100))
  const textRows = askTextRows({ kind: 'text' }, state.text)
  const { mode, rows } = planAskMode(room, textRows)
  const setText = (value: string) => {
    touchAsk($, state.dir)
    return update($, planAsking, current => (current && current.id === state.id ? { ...current, text: value } : current))
  }
  const head = (
    <Text wrap="truncate-end">
      <Text color={COLORS.clay}>◇ </Text>
      <Text color={COLORS.text} weight="semibold">
        {title || 'Plan'}
      </Text>
    </Text>
  )
  const actions = (
    <Box columnGap={2}>
      <Button key={`plan-approve-${k}`} hotkey="1" label={T.planApprove} onPress={() => void approvePlan($, state)} />
      <Button key={`plan-view-${k}`} plain hotkey="2" label={T.planView} onPress={() => void viewPlan($, state)} />
      {mode !== 'full' && <Button key={`plan-engine-${k}`} plain dimColor hotkey="9" label={T.toDefault} onPress={() => void replyPlan($, state.dir, { kind: 'engine' })} />}
    </Box>
  )
  if (mode === 'inline') {
    return {
      rows,
      card: (
        <Box flexDirection="column" width={width} paddingX={1}>
          {head}
          {actions}
        </Box>
      ),
    }
  }
  if (mode === 'compact') {
    return {
      rows,
      card: (
        <Box flexDirection="column" width={width} borderStyle="round" borderColor={COLORS.clay} paddingX={1}>
          {head}
          {actions}
        </Box>
      ),
    }
  }
  return {
    rows,
    card: (
      <Box flexDirection="column" width={width} borderStyle="round" borderColor={COLORS.clay} paddingX={1}>
        {head}
        <Text color={COLORS.muted}>{T.planAskQuestion}</Text>
        <Box marginTop={1}>{actions}</Box>
        <Box marginTop={1}>
          <Input
            key={`plan-text-${k}`}
            label={T.planReviseLabel}
            placeholder={T.otherPlaceholder}
            rows={textRows}
            value={state.text}
            submitLabel={T.planRevise}
            onInput={value => void setText(value)}
            onSubmit={value => void revisePlan($, state, value)}
          />
        </Box>
        <Box columnGap={2}>
          <Button key={`plan-engine-${k}`} plain dimColor hotkey="9" label={T.toDefault} onPress={() => void replyPlan($, state.dir, { kind: 'engine' })} />
          <Button key={`plan-close-${k}`} plain dimColor label={T.close} onPress={() => void replyPlan($, state.dir, { kind: 'dismiss' })} />
        </Box>
      </Box>
    ),
  }
}

// 데스크톱 입력창의 회색 아래턱: 폭을 채운 알약 띠, 왼쪽에 저장소·브랜치, 오른쪽에 diff 칩.
// omarchy 테마를 못 읽으면 띠 없이 칩만.
async function chinBand($: EngineInterface, els: Elements['terminal'], info: RepoInfo, columns: number) {
  const { Box, Text, Button } = els
  const face = await read($, surface)
  const files = await read($, diff)
  const added = files.reduce((sum, file) => sum + file.added, 0)
  const removed = files.reduce((sum, file) => sum + file.removed, 0)
  // +/− 칩은 누르면 diff 패널(데스크톱처럼).
  const chips =
    files.length === 0 ? null : (
      <Button key="chin-diff" plain onPress={() => void openDiff($).catch(() => undefined)}>
        {diffChips(Text, added, removed)}
      </Button>
    )
  if (!face) {
    return (
      <Box columnGap={2} paddingX={1}>
        <Text color={COLORS.muted}>{info.name}</Text>
        {info.branch && <Text color={COLORS.muted}>{info.branch}</Text>}
        {chips}
      </Box>
    )
  }
  const left = chinLabel(info.name, info.branch)
  const chipText = files.length > 0 ? ` +${added}  −${removed} ` : ''
  const gap = Math.max(1, columns - 2 - cellWidth(left) - cellWidth(chipText) - 1)
  // 버튼은 Text 안에 넣을 수 없어 한 줄을 Box 로 잇는다.
  return (
    <Box>
      <Text>
        <Text color={face.bubble}>{EDGES.single[0]}</Text>
        <Text color={COLORS.muted} backgroundColor={face.bubble}>
          {left}
        </Text>
        <Text backgroundColor={face.bubble}>{' '.repeat(gap)}</Text>
      </Text>
      {chips}
      <Text>
        <Text backgroundColor={face.bubble}> </Text>
        <Text color={face.bubble}>{EDGES.single[1]}</Text>
      </Text>
    </Box>
  )
}

// 입력창 위 진행 띠(plan-progress 를 대신한다). 윗줄은 할 일 단계 칸(✓ 끝난 일·◉ 하는 중·○ 남은 일),
// 아랫줄은 지금 도는 일(도구 호출·에이전트·Bash 가 띄운 프로세스, 도구가 없으면 응답 중).
// 윗줄은 남은 할 일이 있을 때, 아랫줄은 턴이 NOW_AFTER_MS 를 넘겼거나 할 일이 있을 때만. 턴이 끝나면 아랫줄은 접힌다.
export type BandInput = {
  list: ReadonlyArray<TaskItem>
  state: ActivityState
  agents: Readonly<Record<string, AgentRecord>>
  turnStartedAt: number | null
  now: number
  columns: number
  // 띠를 누르면 /desk-activity 패널을 연다.
  onOpen?: () => void
  // 턴이 끝난 띠를 남겨 둔 동안: 마지막 단계까지 끝난 것으로 그리고 줄 끝에 ✕ 를 둔다.
  onClose?: () => void
}

const STRIP_STYLE = {
  completed: { mark: COLORS.success, text: COLORS.muted },
  in_progress: { mark: COLORS.clay, text: COLORS.text },
  pending: { mark: COLORS.muted, text: COLORS.muted },
  more: { mark: COLORS.muted, text: COLORS.muted },
} as const

export function activityBand(els: Elements['terminal'], input: BandInput) {
  const { Box, Text } = els
  const { list, state, now, turnStartedAt } = input
  const isDone = input.onClose !== undefined
  const hasTasks = list.length > 0 && (isDone || list.some(item => item.status !== 'completed'))
  // 할 일 도구가 없으면(Claude 5 모델) 턴 동안 모델의 설명 글을 단계로.
  const say = !hasTasks && (turnStartedAt !== null || isDone) ? (state.say ?? null) : null
  const hasPlan = hasTasks || say !== null
  const isLong = turnStartedAt !== null && now - turnStartedAt >= NOW_AFTER_MS
  const hasNow = turnStartedAt !== null && (isLong || hasPlan)
  if (!hasPlan && !hasNow) return null
  const width = Math.max(24, input.columns - 2)
  const done = list.filter(item => item.status === 'completed').length
  const count = say ? T.bandStep(say.count) : `${done}/${list.length}`
  const since = state.taskSince ?? {}
  const label = (item: TaskItem) => {
    const text = item.activeForm ?? item.subject
    const at = since[item.id]
    return at === undefined || turnStartedAt === null ? text : `${text} ${formatElapsed(now - at)}`
  }
  const room = width - cellWidth(count) - 2 - (isDone ? 3 : 0)
  const sayParts = say ? sayStrip(say.text, say.count - 1, room) : []
  const parts = say ? (isDone ? sayParts.map(finishPart) : sayParts) : hasTasks ? stepStrip(list, room, label) : []
  const strip = hasPlan
    ? parts.map((part, index) => {
        const style = STRIP_STYLE[part.kind]
        const [mark, ...rest] = part.text.split(' ')
        return (
          <Text>
            {index > 0 ? '  ' : ''}
            <Text color={style.mark}>{part.kind === 'more' ? part.text : mark}</Text>
            {part.kind !== 'more' && (
              <Text color={style.text} weight={part.kind === 'in_progress' ? 'semibold' : undefined}>
                {` ${rest.join(' ')}`}
              </Text>
            )}
          </Text>
        )
      })
    : null
  return (
    <Box flexDirection="column" paddingX={1}>
      {strip && (
        <Box columnGap={2} width={width}>
          <Box flexGrow={1}>
            <Text wrap="truncate-end">{strip as never}</Text>
          </Box>
          <Text color={COLORS.muted}>{count}</Text>
          {input.onClose && <els.Button key="band-close" plain dimColor label="✕" onPress={input.onClose} />}
        </Box>
      )}
      {hasNow &&
        (input.onOpen ? (
          <els.Button key="band-now" plain onPress={input.onOpen}>
            <Text wrap="truncate-end">{nowLine(els, input) as never}</Text>
          </els.Button>
        ) : (
          <Text wrap="truncate-end">{nowLine(els, input) as never}</Text>
        ))}
    </Box>
  )
}

// 끝난 턴의 마지막 설명은 하는 중(◉)이 아니라 끝난 것(✓)으로.
const finishPart = (part: StripPart): StripPart => (part.kind === 'in_progress' ? { kind: 'completed', text: `✓${part.text.slice(1)}` } : part)

// "지금" 줄의 글 조각들.
function nowLine(els: Elements['terminal'], input: BandInput) {
  const { Text } = els
  const { state, now } = input
  const running = state.calls ?? []
  const first = running[0]
  if (!first) {
    const from = state.idleSince ?? input.turnStartedAt ?? now
    return [<Text color={COLORS.muted}>{`${T.bandResponding} · ${formatElapsed(now - from)}`}</Text>]
  }
  const more = running.length > 1 ? <Text color={COLORS.muted}>{`  +${running.length - 1}`}</Text> : null
  if (isAgentTool(first.tool)) {
    const live = orderAgents(input.agents).live
    const shown = live.slice(0, 2).map((agent, index) => (
      <Text>
        {index > 0 ? '   ' : ''}
        <Text color={COLORS.link}>{clip(AGENT_TITLE(agent), 24)}</Text>
        <Text color={COLORS.muted}>{` ${agent.activity ?? T.bandThinking} · ${T.bandTools(agent.toolUses)}${agent.startedAt ? ` · ${formatElapsed(now - agent.startedAt)}` : ''}`}</Text>
      </Text>
    ))
    if (shown.length > 0) {
      return [...shown, live.length > 2 ? <Text color={COLORS.muted}>{`   +${live.length - 2}`}</Text> : null]
    }
  }
  const proc = first.tool === 'Bash' ? state.proc : null
  const quiet = proc?.quietSince != null && now - proc.quietSince >= QUIET_AFTER_MS ? now - proc.quietSince : null
  return [
    <Text color={COLORS.clay}>▶ </Text>,
    <Text color={COLORS.text}>{first.label}</Text>,
    <Text color={COLORS.muted}>{` · ${formatElapsed(now - first.startedAt)}`}</Text>,
    proc ? <Text color={COLORS.muted}>{` · ${proc.name}${proc.cpu === null ? '' : ` ${proc.cpu}%`}`}</Text> : null,
    quiet === null ? null : proc?.isNetwork ? (
      <Text color={COLORS.muted}>{` · ${T.bandNoIo(formatElapsed(quiet))}`}</Text>
    ) : (
      <Text color={COLORS.warning} weight="semibold">{` · ${T.bandQuiet(formatElapsed(quiet))}`}</Text>
    ),
    more,
  ]
}

// ── /desk-activity 패널 ──
const LANE_LABEL = 11
const LANE_AGENTS = 4
const FLOW_ROWS = 60
// 머리를 고정하려면 몸통에 이만큼은 남아야 한다. 그보다 작은 창은 예전처럼 엔진이 통째로 스크롤한다.
const ACTIVITY_MIN_ROOM = 5
// 막대 색: 가장 길게 이어지는 명령은 진행 띠의 ▶ 와 같은 강조색, 나머지는 서로 다른 테마 색(글자색 검정은 쓰지 않는다).
const KIND_COLOR: Record<LaneSegment['kind'], string> = {
  explore: COLORS.link,
  edit: COLORS.success,
  test: 'merged',
  command: COLORS.clay,
  agent: 'planMode',
  other: COLORS.muted,
  idle: COLORS.muted,
  none: COLORS.muted,
  gap: COLORS.muted,
}

// 도는 백그라운드 셸의 출력 끝 줄: 다시 그릴 때마다 읽지 않게 3초에 한 번만 출력 파일을 읽는다.
let tailCache: { id: string; at: number; text: string | null } | null = null

async function shellTail($: EngineInterface, shells: ReadonlyArray<AgentRecord>, now: number): Promise<{ id: string; text: string } | null> {
  const shell = shells.find(item => isLive(item.status) && item.outputFile)
  if (!shell?.outputFile) return null
  if (tailCache?.id !== shell.id || now - tailCache.at >= PROC_POLL_MS) {
    const raw = await $.fs.read(shell.outputFile).catch(() => null)
    const last = typeof raw === 'string' ? raw.trimEnd().split('\n').pop()?.trim() : undefined
    tailCache = { id: shell.id, at: now, text: last || null }
  }
  return tailCache.text === null ? null : { id: shell.id, text: tailCache.text }
}

type PaneInput = {
  log: ActivityLog
  now: number
  end: number
  columns: number
  turnAgents: ReadonlyArray<AgentRecord>
  shells: ReadonlyArray<AgentRecord>
  tail: { id: string; text: string } | null
  // 엔진이 몸통에 준 줄 수(모르면 0)와 몸통 첫 줄(activityTop).
  bodyRows: number
  top: number
  // 호출을 펼친 에이전트.
  expanded: string | null
  openAgent: (id: string) => void
  toggleAgent: (id: string) => void
}

export function activityPane(els: Elements['terminal'], input: PaneInput) {
  const { Box, Text } = els
  const { log, now, end, columns } = input
  const width = Math.max(10, columns - LANE_LABEL)
  const main = log.events.filter(event => event.loop === undefined)
  const turnEnd = log.endedAt ?? now
  const lane = (name: string, segments: LaneSegment[], key: string) => (
    <Box key={key}>
      <Text color={COLORS.muted}>{`${padCells(clipWidth(name, LANE_LABEL - 1), LANE_LABEL)}`}</Text>
      <Text>
        {segments.map(segment => (
          <Text color={KIND_COLOR[segment.kind]}>{segment.text}</Text>
        ))}
      </Text>
    </Box>
  )
  const shownAgents = input.turnAgents.slice(-LANE_AGENTS)
  const aliveOf = (agent: AgentRecord) => ({ start: agent.startedAt ?? log.startedAt, end: agent.endedAt ?? end })
  // 모든 줄이 한 축을 쓴다. 아무 줄도 살아 있지 않던 긴 시간은 한 칸(┆)으로 접는다.
  const cells = laneCells(
    [{ start: log.startedAt, end: turnEnd }, ...shownAgents.map(aliveOf), ...input.shells.map(shell => ({ start: shell.startedAt ?? log.startedAt, end: shell.endedAt ?? end }))],
    log.startedAt,
    end,
    width,
  )
  const folded = cells.reduce((sum, cell) => sum + (cell.gap ?? 0), 0)
  const lanes = [
    lane(T.laneMain, laneSegments(main, { start: log.startedAt, end: turnEnd }, log.startedAt, end, width, cells), 'lane-main'),
    ...shownAgents.map(agent =>
      lane(
        AGENT_TITLE(agent),
        laneSegments(
          log.events.filter(event => event.loop === agent.id),
          aliveOf(agent),
          log.startedAt,
          end,
          width,
          cells,
        ),
        `lane-${agent.id}`,
      ),
    ),
    ...(input.shells.length > 0
      ? [
          lane(
            T.laneBackground,
            laneSegments(
              input.shells.map(shell => ({ kind: 'command' as ActivityKind, start: shell.startedAt ?? log.startedAt, end: shell.endedAt })),
              { start: 0, end: 0 },
              log.startedAt,
              end,
              width,
              cells,
            ),
            'lane-bg',
          ),
        ]
      : []),
  ]
  const total = formatElapsed(end - log.startedAt)
  const axis = `${' '.repeat(LANE_LABEL)}0${' '.repeat(Math.max(1, width - 1 - total.length))}${total}`
  // 기타(MCP·Skill·질문 등)는 그 턴에 있을 때만: 늘 붙이면 범례가 길어진다.
  const kinds: ActivityKind[] = ['explore', 'edit', 'test', 'command', 'agent', ...(log.events.some(event => event.kind === 'other') ? (['other'] as const) : [])]
  const legend = (
    <Text wrap="truncate-end">
      {' '.repeat(LANE_LABEL)}
      {kinds.map(kind => (
        <Text>
          <Text color={KIND_COLOR[kind]}>{KIND_GLYPH[kind]}</Text>
          <Text color={COLORS.muted}>{` ${T.kindName[kind]}  `}</Text>
        </Text>
      ))}
      <Text color={COLORS.muted}>{`─ ${T.bandResponding}`}</Text>
      {folded > 0 && <Text color={COLORS.muted}>{`  ${GAP_GLYPH} ${T.activityGap(formatElapsed(folded))}`}</Text>}
    </Text>
  )
  const commands = main.filter(event => event.tool === 'Bash')
  const failed = commands.filter(event => event.isError).length
  const files = new Set(main.filter(event => event.kind === 'edit' && !event.isError).map(event => event.label)).size
  const facts = [
    log.says.length > 0 ? T.bandStep(log.says.length) : '',
    commands.length > 0 ? T.turnStats({ commands: commands.length, failed, agents: 0, tasksDone: 0, tasksTotal: 0 }) : '',
    files > 0 ? T.activityFiles(files) : '',
  ].filter(Boolean)
  // 흐름 한 줄. 펼친 에이전트의 호출은 indent 만큼 들여 그 에이전트 줄 아래에 둔다.
  const flowLine = (row: FlowRow, key: string, indent = '') => {
    const at = (row: FlowRow) => <Text color={COLORS.muted}>{`${indent}${clockOf(row.at - log.startedAt)}  `}</Text>
    if (row.kind === 'say') {
      return (
        <Text key={key} wrap="truncate-end">
          {at(row)}
          <Text color={COLORS.clay}>◉ </Text>
          <Text color={COLORS.text} weight="semibold">{row.text}</Text>
        </Text>
      )
    }
    if (row.kind === 'explore') {
      return (
        <Text key={key} wrap="truncate-end">
          {at(row)}
          <Text color={KIND_COLOR.explore}>{`${KIND_GLYPH.explore} `}</Text>
          <Text color={COLORS.muted}>{row.text}</Text>
        </Text>
      )
    }
    if (row.kind === 'edit') {
      return (
        <Text key={key} wrap="truncate-end">
          {at(row)}
          <Text color={row.isError ? COLORS.danger : KIND_COLOR.edit}>{`${KIND_GLYPH.edit} `}</Text>
          <Text color={COLORS.text}>{row.text}</Text>
          {(row.added > 0 || row.removed > 0) && <Text>{' '}</Text>}
          {row.added > 0 && <Text color={COLORS.success}>{`+${row.added} `}</Text>}
          {row.removed > 0 && <Text color={COLORS.danger}>{`−${row.removed}`}</Text>}
        </Text>
      )
    }
    const mark = row.ms === null ? '▶' : row.isError ? '✗' : row.kind === 'agent' ? '◆' : '✓'
    const markColor = row.ms === null ? COLORS.clay : row.isError ? COLORS.danger : row.kind === 'agent' ? COLORS.warning : COLORS.success
    return (
      <Text key={key} wrap="truncate-end">
        {at(row)}
        <Text color={markColor}>{`${mark} `}</Text>
        {row.kind === 'test' && <Text color={KIND_COLOR.test}>{`${T.kindName.test} `}</Text>}
        <Text color={COLORS.text}>{row.text}</Text>
        <Text color={COLORS.muted}>{` · ${formatElapsed(row.ms ?? now - row.at)}`}</Text>
      </Text>
    )
  }
  const flow = flowRows(log)
    .slice(-FLOW_ROWS)
    .map((row, index) => flowLine(row, `flow-${index}`))
  const turnAgentRow = (agent: AgentRecord) => {
    const live = isLive(agent.status)
    const failedAgent = agent.status === 'failed' || agent.status === 'killed'
    const isAgent = (agent.kind ?? 'agent') === 'agent'
    const facts = [agent.activity && live ? agent.activity : undefined, isAgent ? T.bandTools(agent.toolUses) : undefined, agentElapsed(agent, now)].filter(Boolean).join(' · ')
    const parts = [
      <Text color={live ? COLORS.clay : failedAgent ? COLORS.danger : COLORS.success}>{live ? '▶ ' : failedAgent ? '✗ ' : '✓ '}</Text>,
      AGENT_LABEL(agent) && <Text color={COLORS.text}>{`${AGENT_LABEL(agent)} `}</Text>,
      <Text color={COLORS.muted}>{`${agent.description} · ${facts}`}</Text>,
    ]
    if (!isAgent) return rowButton(els, { key: `activity-agent-${agent.id}`, onPress: () => input.openAgent(agent.id) }, '', ...parts)
    // 에이전트 줄은 누르면 그 호출을 펴고 접는다. 대화는 행 끝 칩으로 에이전트 패널에서 본다.
    return (
      <Box columnGap={1}>
        <Box flexGrow={1} flexShrink={1} overflow="hidden">
          {rowButton(
            els,
            { key: `activity-agent-${agent.id}`, onPress: () => input.toggleAgent(agent.id) },
            '',
            <Text color={COLORS.muted}>{input.expanded === agent.id ? '▾ ' : '▸ '}</Text>,
            ...parts,
          )}
        </Box>
        <Box flexShrink={0}>{rowButton(els, { key: `activity-agent-open-${agent.id}`, dimColor: true, onPress: () => input.openAgent(agent.id) }, T.viewTranscript)}</Box>
      </Box>
    )
  }
  // 펼친 에이전트의 호출: 이 기록에 쌓인 것만(앞 턴 기록의 호출은 그 턴과 함께 지나갔다).
  const agentFlow = (agent: AgentRecord) => {
    const rows = flowRows(log, agent.id).slice(-FLOW_ROWS)
    if (rows.length === 0) return [<Text key={`agent-flow-${agent.id}-none`} color={COLORS.muted}>{`    ${T.activityAgentNoCalls}`}</Text>]
    return rows.map((row, index) => flowLine(row, `agent-flow-${agent.id}-${index}`, '    '))
  }
  // 머리 아래는 모두 한 줄짜리 줄의 목록이다: 창의 줄 수로 잘라 그릴 수 있게.
  const one = (key: string, row: unknown) => (
    <Box key={key} height={1} overflow="hidden">
      {row as never}
    </Box>
  )
  const section = (title: string, key: string) => (
    <Text key={key} color={COLORS.text} weight="semibold">
      {title}
    </Text>
  )
  const body: unknown[] = []
  const gap = (key: string) => body.length > 0 && body.push(<Text key={key}> </Text>)
  if (flow.length > 0) body.push(section(T.activityFlow, 'flow-title'), ...flow)
  if (input.turnAgents.length > 0) {
    gap('agents-gap')
    body.push(section(T.activityAgents, 'agents-title'))
    for (const agent of input.turnAgents) {
      body.push(one(`agent-${agent.id}`, turnAgentRow(agent)))
      if (input.expanded === agent.id) body.push(...agentFlow(agent))
    }
  }
  if (input.shells.length > 0) {
    gap('shells-gap')
    body.push(section(T.laneBackground, 'shells-title'))
    for (const shell of input.shells) {
      body.push(one(`shell-${shell.id}`, turnAgentRow(shell)))
      if (input.tail?.id === shell.id) body.push(<Text key={`tail-${shell.id}`} color={COLORS.muted} wrap="truncate-end">{`  └ ${input.tail.text}`}</Text>)
    }
  }
  // 머리: 제목 줄, 빈 줄, 막대들, 축, 범례, 빈 줄. 몸통에 몇 줄이라도 남을 만큼 창이 크면 머리를 고정하고 몸통의 창만 그린다.
  const head = lanes.length + 5
  const room = input.bodyRows - head
  const pinned = room >= ACTIVITY_MIN_ROOM
  const max = pinned ? Math.max(0, body.length - room) : 0
  const top = Math.min(input.top, max)
  const shown = pinned ? body.slice(top, top + room) : body
  const tree = (
    <Box flexDirection="column" rowGap={1} {...(pinned ? { height: Math.min(input.bodyRows, head + shown.length), overflow: 'hidden' as const } : {})}>
      <Box columnGap={2} width={columns}>
        <Box flexGrow={1}>
          <Text color={COLORS.text} weight="semibold">{`${log.endedAt === null ? T.activityThisTurn : T.activityLastTurn} · ${formatElapsed(turnEnd - log.startedAt)}`}</Text>
          {/* 글로만 답한 턴 뒤에도 기록은 도구를 쓴 마지막 턴에 머문다: 그 턴이 언제 끝났는지 붙여 멈춘 것으로 보이지 않게. */}
          {log.endedAt !== null && now - log.endedAt >= 60_000 && <Text color={COLORS.muted}>{` · ${T.activityEndedAgo(ago(log.endedAt, now))}`}</Text>}
        </Box>
        <Text color={COLORS.muted} wrap="truncate-end">{facts.join(' · ')}</Text>
      </Box>
      <Box flexDirection="column">
        {lanes}
        <Text color={COLORS.muted}>{axis}</Text>
        {legend}
      </Box>
      {shown.length > 0 && <Box flexDirection="column">{shown as never}</Box>}
    </Box>
  )
  return { tree, window: { pinned, room, max } }
}

const padCells = (text: string, width: number) => text + ' '.repeat(Math.max(0, width - cellWidth(text)))

// 터미널은 Box 배경을 칠하지 않으므로 말풍선의 모든 칸을 글자 바탕으로 칠한다.
// 양 끝 칸은 줄 위치로 고른다: 한 줄이면 Nerd Font 반원(  )으로 알약 모양, 여러 줄이면
// 첫 줄은 위 모서리만, 마지막 줄은 아래 모서리만 사선으로 깎은 칸(Symbols for Legacy Computing),
// 가운데 줄은 꽉 찬 칸. 그러면 여러 줄도 한 덩어리의 둥근 상자가 된다.
// 반원은 Nerd Font 글리프라 omarchy 테마를 읽었을 때(= Nerd Font 기본 설치)만 이 모양을 쓴다.
const EDGES = {
  single: ['\ue0b6', '\ue0b4'],
  top: ['\u{1FB41}', '\u{1FB4C}'],
  bottom: ['\u{1FB52}', '\u{1FB5D}'],
} as const

// 각 줄의 왼쪽·오른쪽 끝 칸. null 이면 말풍선 색으로 꽉 채운 칸.
export function bubbleEdges(count: number): Array<readonly [string | null, string | null]> {
  return Array.from({ length: count }, (_, index) => {
    if (count === 1) return EDGES.single
    if (index === 0) return EDGES.top
    if (index === count - 1) return EDGES.bottom
    return [null, null] as const
  })
}

export function bubbleRows(lines: string[]): string[] {
  const inner = Math.max(1, ...lines.map(cellWidth))
  return lines.map(line => `  ${line}${' '.repeat(inner - cellWidth(line))}  `)
}

// 여러 줄 말풍선의 위·아래 줄 끝 칸을 그림으로 그릴 수 있으면(kitty 그래픽, iTerm2 3.5 이상) 글리프 대신 둥근 모서리 그림을 쓴다.
// 사선 글리프는 모서리를 깎을 뿐이고, 한 칸 높이를 다 쓰는 반원은 줄 사이에 홈을 낸다.
// 그림은 말풍선 색으로 칠하므로 테마 색마다 한 번 만들어 둔다.
const cornerCache = new Map<string, string>()

function cornerSource(corner: Corner, fill: string) {
  const key = `${corner} ${fill}`
  let rgba = cornerCache.get(key)
  if (rgba === undefined) {
    rgba = cornerPixels(corner, fill).toBase64()
    cornerCache.set(key, rgba)
  }
  return { rgba, ...CORNER_SIZE }
}

function bubbleLines(
  Box: Elements['terminal']['Box'],
  Text: Elements['terminal']['Text'],
  Image: Elements['terminal']['Image'] | null,
  lines: string[],
  fill: string,
) {
  const edges = bubbleEdges(lines.length)
  const edge = (glyph: string | null) =>
    glyph === null ? <Text backgroundColor={fill}> </Text> : <Text color={fill}>{glyph}</Text>
  const corner = (key: string, at: Corner) =>
    Image && <Image key={key} source={cornerSource(at, fill)} columns={1} rows={1} alt=" " />
  return (
    <>
      {bubbleRows(lines).map((row, index) => {
        const body = (
          <Text color={COLORS.text} backgroundColor={fill}>
            {row}
          </Text>
        )
        const side = lines.length > 1 && index === 0 ? 'top' : lines.length > 1 && index === lines.length - 1 ? 'bottom' : null
        if (Image && side) {
          return (
            <Box flexDirection="row">
              {corner(`bubble-${index}-left`, `${side}-left`)}
              {body}
              {corner(`bubble-${index}-right`, `${side}-right`)}
            </Box>
          )
        }
        return (
          <Text>
            {edge(edges[index]?.[0] ?? null)}
            {body}
            {edge(edges[index]?.[1] ?? null)}
          </Text>
        )
      })}
    </>
  )
}

// 칸 수 기준 줄바꿈: 공백에서 끊고, 한 단어가 너무 길면 글자 단위로 끊는다.
export function wrapText(text: string, width: number): string[] {
  const max = Math.max(4, width)
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/(?<= )/)) {
      if (cellWidth(line + word.trimEnd()) <= max) {
        line += word
        continue
      }
      if (line.trim() !== '') out.push(line.trimEnd())
      line = ''
      for (const ch of word) {
        if (cellWidth(line + ch) > max) {
          out.push(line)
          line = ''
        }
        line += ch
      }
    }
    out.push(line.trimEnd())
  }
  return out
}

// 스피너 글자: 엔진이 덮어쓴 문구가 있으면 그것, 없으면 하는 일에 맞춘 데스크톱 낱말.
const SPINNER_WORDS = {
  requesting: 'Working',
  thinking: 'Thinking',
  responding: 'Responding',
  'tool-input': 'Preparing',
  'tool-use': 'Running',
} as const

export function spinnerWord(mode: keyof typeof SPINNER_WORDS, message: string | null): string {
  return message ?? SPINNER_WORDS[mode] ?? 'Working'
}

// 밝은 점 하나가 왼쪽에서 오른쪽으로 도는 세 칸.
export function spinnerDots(now: number): string {
  const frame = Math.floor(now / SPINNER_TICK) % 3
  return ['●', '·', '·'].map((_, index) => (index === frame ? '●' : '·')).join('')
}

// 지금 서 있는 effort(turn.step 의 effort, 2.1.312 주석): 메시지마다 effort 를 받는 모델에서는 사람 입력이 든 단계에서
// 정한 수준이 그 뒤 도구 단계 내내 서고, 턴 중에 바꾼 수준은 다음 입력까지 기다린다. 입력은 턴의 첫 단계만이 아니라
// 턴 중에 끼워 넣은 메시지가 실린 단계에도 든다. 숫자는 바로 나간다.
// 모델이 메시지마다 받는지는 mod API 에 없어 늘 이 규칙을 따른다(아니면 바뀐 수준이 다음 입력부터 보일 뿐이다).
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | number

export function effortInForce(held: Effort | null, index: number, effort: Effort | undefined, withInput: boolean): Effort | null {
  if (effort === undefined) return null
  if (index === 0 || withInput || held === null || typeof effort === 'number') return effort
  return held
}

export function effortLabel(effort: Effort): string {
  return typeof effort === 'number' ? `effort ${effort}` : effort
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

// 아래턱 왼쪽 글자. 아이콘은 Nerd Font(폴더 U+F07B, 브랜치 U+E0A0). 폴더 아이콘은 두 칸으로 그려지니 뒤에 빈칸 두 개를 둔다.
export function chinLabel(name: string, branch: string | null | undefined): string {
  return branch ? ` \uf07b  ${name}   \ue0a0 ${branch}` : ` \uf07b  ${name}`
}

// 데스크톱의 초록·빨강 diff 칩.
function diffChips(Text: Elements['terminal']['Text'], added: number, removed: number) {
  return (
    <Text>
      <Text color={COLORS.success} backgroundColor="diffAddedDimmed">{` +${added} `}</Text>
      <Text color={COLORS.danger} backgroundColor="diffRemovedDimmed">{` −${removed} `}</Text>
    </Text>
  )
}

// ── PR·MR 읽기와 머지(gh·glab) ─────────────────────────────────────────────────
// 읽은 JSON 을 고치는 일은 pr.ts. 프로그램을 부르는 일은 여기서: 부르는 자리마다 명령을 고정 글자로 쓰고
// ($.process.run([...])), $ 는 같은 파일 함수에만 넘긴다. 디렉터리 검사가 둘 다 끝까지 따라가게.
// 테스트는 $ 대신 { process: { run } } 을 넘긴다.
const READ_MS = 15_000
const MERGE_MS = 30_000

// gh 가 없거나(실행 실패), GitHub 저장소가 아니면 off. PR 이 없는 브랜치는 none.
async function fetchPr($: EngineInterface, branch: string | null, at: number): Promise<PrState> {
  const view = await $.process.run(['gh', 'pr', 'view', '--json', PR_FIELDS], { timeoutMs: READ_MS }).catch(error => ({ exitCode: 127, stdout: '', stderr: String(error) }))
  if (view.exitCode !== 0) {
    const reason = view.stderr.trim().split('\n')[0] ?? ''
    return /no (open )?pull requests? found/i.test(view.stderr)
      ? { status: 'none', branch, pr: null, at }
      : { status: 'off', branch, pr: null, at, error: reason, isSticky: isLocalFailure(view) }
  }
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(view.stdout) as Record<string, unknown>
  } catch {
    return { status: 'off', branch, pr: null, at, error: T.outputUnreadable('gh') }
  }
  const where = prRepo(String(raw.url ?? ''))
  let threads: PrThread[] | null = null
  if (where) {
    const ran = await $.process.run(
      [
      'gh',
      'api',
      'graphql',
      '--hostname',
      where.host,
      '-f',
      `query=${THREADS_QUERY}`,
      '-F',
      `owner=${where.owner}`,
      '-F',
      `name=${where.name}`,
      '-F',
      `number=${Number(raw.number)}`,
      ],
      { timeoutMs: READ_MS },
    ).catch(() => null)
    if (ran?.exitCode === 0) {
      try {
        threads = toThreads(JSON.parse(ran.stdout))
      } catch {
        threads = null
      }
    }
  }
  return { status: 'ok', branch, pr: toPr(raw, threads), at }
}

// glab mr view 를 인자 없이 쓰면 같은 브랜치에 병합된 MR 이 여럿일 때 고르라며 실패한다. 그래서 열린 MR 을
// 브랜치로 먼저 찾고 번호로 읽는다.
async function fetchMr($: EngineInterface, branch: string | null, at: number): Promise<PrState> {
  const failed = (error: unknown) => ({ exitCode: 127, stdout: '', stderr: String(error) })
  const reasonOf = (stderr: string) => stderr.split('\n').map(line => line.trim()).find(line => line !== '' && line !== 'ERROR') ?? ''
  if (branch === null) return { status: 'none', branch, pr: null, at }
  const list = await $.process.run(['glab', 'mr', 'list', '--source-branch', branch, '--output', 'json'], { timeoutMs: READ_MS }).catch(failed)
  if (list.exitCode !== 0) return { status: 'off', branch, pr: null, at, error: reasonOf(list.stderr), isSticky: isLocalFailure(list) }
  let iid: number | undefined
  try {
    iid = (JSON.parse(list.stdout) as Array<{ iid?: number }>)[0]?.iid
  } catch {
    return { status: 'off', branch, pr: null, at, error: T.outputUnreadable('glab') }
  }
  if (iid === undefined) return { status: 'none', branch, pr: null, at }
  const view = await $.process.run(['glab', 'mr', 'view', String(iid), '--output', 'json'], { timeoutMs: READ_MS }).catch(failed)
  if (view.exitCode !== 0) return { status: 'off', branch, pr: null, at, error: reasonOf(view.stderr) }
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(view.stdout) as Record<string, unknown>
  } catch {
    return { status: 'off', branch, pr: null, at, error: T.outputUnreadable('glab') }
  }
  const webUrl = String(raw.web_url ?? '')
  const host = /^https?:\/\/([^/]+)\//.exec(webUrl)?.[1]
  const api = (path: string) =>
    (host ? $.process.run(['glab', 'api', '--hostname', host, path], { timeoutMs: READ_MS }) : $.process.run(['glab', 'api', path], { timeoutMs: READ_MS }))
      .then(ran => (ran.exitCode === 0 ? (JSON.parse(ran.stdout) as unknown) : null))
      .catch(() => null)
  const pipeline = (raw.head_pipeline ?? raw.pipeline) as { id?: number; status?: string; web_url?: string } | null
  const refs = raw.diff_refs as { base_sha?: string; head_sha?: string } | null
  const [jobs, discussions, stat] = await Promise.all([
    pipeline?.id ? api(`projects/${raw.project_id}/pipelines/${pipeline.id}/jobs?per_page=100`) : Promise.resolve(null),
    api(`projects/${raw.project_id}/merge_requests/${raw.iid}/discussions?per_page=100`),
    refs?.base_sha && refs.head_sha
      ? $.process.run(['git', 'diff', '--shortstat', refs.base_sha, refs.head_sha], { timeoutMs: READ_MS })
          .then(ran => (ran.exitCode === 0 ? shortStat(ran.stdout) : null))
          .catch(() => null)
      : Promise.resolve(null),
  ])
  // job 목록을 못 읽으면 파이프라인 전체 상태 하나를 체크로
  const checks = jobs !== null ? toJobs(jobs) : pipeline?.status ? [{ name: 'pipeline', state: jobState(pipeline), url: pipeline.web_url ?? null }] : []
  return { status: 'ok', branch, pr: toMr(raw, checks, toDiscussions(discussions, webUrl), stat), at }
}

const firstLine = (text: string) => text.split('\n').map(line => line.trim()).find(line => line !== '' && line !== 'ERROR') ?? ''

// GitHub: 저장소가 허용하는 방식(merge → squash → rebase 순)으로, 본 head 커밋일 때만. 원격 브랜치는 머지된 뒤
// 지운다. gh 의 --delete-branch 는 로컬 브랜치까지 지우고 기본 브랜치로 체크아웃하므로 쓰지 않는다.
// 자동 머지는 나중에 일어나서 지울 수 없다(저장소의 "Automatically delete head branches" 를 따른다).
// GitLab: REST 로 머지한다. squash 는 MR 설정(프로젝트 기본값)을 따르고 원격 브랜치는 지운다.
// 자동 머지 파라미터는 옛 이름(merge_when_pipeline_succeeds)과 새 이름(auto_merge)을 함께 보낸다.
export async function mergePr($: EngineInterface, pr: PrInfo, action: MergeAction): Promise<MergeResult> {
  const failed = (error: unknown): Ran => ({ exitCode: 127, stdout: '', stderr: String(error) })
  if (pr.headSha === null) return { ok: false, error: T.mergeNoHead }
  if (pr.provider === 'gitlab') {
    if (pr.projectId === undefined) return { ok: false, error: T.mergeNoHead }
    const host = /^https?:\/\/([^/]+)\//.exec(pr.url)?.[1]
    const isAuto = action === 'auto'
    const path = `projects/${pr.projectId}/merge_requests/${pr.number}/merge`
    const sha = `sha=${pr.headSha}`
    const whenPipeline = `merge_when_pipeline_succeeds=${isAuto}`
    const autoMerge = `auto_merge=${isAuto}`
    const ran = await (
      host
        ? $.process.run(['glab', 'api', '--hostname', host, '-X', 'PUT', path, '-f', sha, '-F', 'should_remove_source_branch=true', '-F', whenPipeline, '-F', autoMerge], { timeoutMs: MERGE_MS })
        : $.process.run(['glab', 'api', '-X', 'PUT', path, '-f', sha, '-F', 'should_remove_source_branch=true', '-F', whenPipeline, '-F', autoMerge], { timeoutMs: MERGE_MS })
    ).catch(failed)
    let body: Record<string, unknown> = {}
    try {
      body = JSON.parse(ran.stdout) as Record<string, unknown>
    } catch {
      body = {}
    }
    if (ran.exitCode !== 0) return { ok: false, error: typeof body.message === 'string' ? body.message : firstLine(ran.stderr) }
    return { ok: true, merged: body.state === 'merged' }
  }
  const where = prRepo(pr.url)
  if (!where) return { ok: false, error: T.mergeNoHead }
  const repo = `${where.host}/${where.owner}/${where.name}`
  const settings = await $.process.run(['gh', 'repo', 'view', repo, '--json', 'mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed,deleteBranchOnMerge'], { timeoutMs: MERGE_MS }).catch(failed)
  let allowed: Record<string, unknown> = {}
  try {
    allowed = settings.exitCode === 0 ? (JSON.parse(settings.stdout) as Record<string, unknown>) : {}
  } catch {
    allowed = {}
  }
  const method = allowed.mergeCommitAllowed !== false ? 'merge' : allowed.squashMergeAllowed !== false ? 'squash' : 'rebase'
  const how = `--${method}`
  const ran = await (
    action === 'auto'
      ? $.process.run(['gh', 'pr', 'merge', String(pr.number), '-R', repo, how, '--match-head-commit', pr.headSha, '--auto'], { timeoutMs: MERGE_MS })
      : $.process.run(['gh', 'pr', 'merge', String(pr.number), '-R', repo, how, '--match-head-commit', pr.headSha], { timeoutMs: MERGE_MS })
  ).catch(failed)
  if (ran.exitCode !== 0) return { ok: false, error: firstLine(ran.stderr) }
  if (action === 'auto') return { ok: true, merged: false }
  if (allowed.deleteBranchOnMerge === true) return { ok: true, merged: true }
  const removed = await $.process.run(['gh', 'api', '--hostname', where.host, '-X', 'DELETE', `repos/${where.owner}/${where.name}/git/refs/heads/${pr.head}`], { timeoutMs: MERGE_MS }).catch(failed)
  return removed.exitCode === 0 ? { ok: true, merged: true } : { ok: true, merged: true, note: T.branchKept(pr.head) }
}

// GitHub 저장소가 아니면 gh 는 네트워크 없이 곧바로 실패한다. 그때 glab 으로 다시 본다.
export async function fetchReview($: EngineInterface, branch: string | null, at: number): Promise<PrState> {
  const github = await fetchPr($, branch, at)
  if (github.status !== 'off') return github
  const gitlab = await fetchMr($, branch, at)
  if (gitlab.status !== 'off') return gitlab
  return { ...github, error: [github.error, gitlab.error].filter(Boolean).join(' / ') || undefined, isSticky: github.isSticky === true && gitlab.isSticky === true }
}
