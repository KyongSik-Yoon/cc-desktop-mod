import type { PrCheck, PrInfo, PrState, PrThread } from '../types'
import { T } from './i18n'

// 데스크톱 Code 탭의 PR 바: 지금 브랜치의 PR 상태·체크·안 풀린 리뷰. 데스크톱도 gh 로 읽는다
// (같은 필드: state isDraft reviewDecision mergeStateStatus additions deletions statusCheckRollup).
// 바꾸는 일은 머지 하나뿐이다(패널에서 두 번 눌러야 한다, mergePr). Ready·승인·댓글은 넣지 않는다.
export const PR_FIELDS = 'number,title,url,state,isDraft,reviewDecision,mergeStateStatus,headRefName,headRefOid,baseRefName,additions,deletions,statusCheckRollup,autoMergeRequest'

export const THREADS_QUERY =
  'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved isOutdated path line comments(first:1){nodes{author{login} body url}}}}}}}'

type RawCheck = {
  __typename?: string
  name?: string
  context?: string
  status?: string
  conclusion?: string | null
  state?: string
  detailsUrl?: string | null
  targetUrl?: string | null
}

// CheckRun 은 status·conclusion, StatusContext(옛 커밋 상태)는 state 하나.
export function checkState(raw: RawCheck): PrCheck['state'] {
  if (raw.__typename === 'StatusContext' || (raw.status === undefined && raw.state !== undefined)) {
    return raw.state === 'SUCCESS' ? 'pass' : raw.state === 'PENDING' || raw.state === 'EXPECTED' ? 'pending' : 'fail'
  }
  if (raw.status !== 'COMPLETED') return 'pending'
  switch (raw.conclusion) {
    case 'SUCCESS':
      return 'pass'
    case 'NEUTRAL':
    case 'SKIPPED':
    case 'STALE':
      return 'skip'
    default:
      return 'fail'
  }
}

const CHECK_ORDER: Record<PrCheck['state'], number> = { fail: 0, pending: 1, pass: 2, skip: 3 }

export function toChecks(rollup: unknown): PrCheck[] {
  if (!Array.isArray(rollup)) return []
  return (rollup as RawCheck[])
    .map(raw => ({ name: raw.name ?? raw.context ?? '?', state: checkState(raw), url: raw.detailsUrl ?? raw.targetUrl ?? null }))
    .sort((a, b) => CHECK_ORDER[a.state] - CHECK_ORDER[b.state] || a.name.localeCompare(b.name))
}

export function checkSummary(checks: ReadonlyArray<PrCheck>) {
  const count = (state: PrCheck['state']) => checks.filter(check => check.state === state).length
  const passed = count('pass')
  const failed = count('fail')
  const pending = count('pending')
  return { passed, failed, pending, total: passed + failed + pending }
}

type RawThread = {
  isResolved?: boolean
  isOutdated?: boolean
  path?: string
  line?: number | null
  comments?: { nodes?: Array<{ author?: { login?: string } | null; body?: string; url?: string }> }
}

// 안 풀린 스레드만, 첫 코멘트로.
export function toThreads(response: unknown): PrThread[] | null {
  const nodes = (response as { data?: { repository?: { pullRequest?: { reviewThreads?: { nodes?: RawThread[] } } } } })?.data?.repository?.pullRequest
    ?.reviewThreads?.nodes
  if (!Array.isArray(nodes)) return null
  return nodes
    .filter(node => node.isResolved === false)
    .map(node => {
      const first = node.comments?.nodes?.[0]
      return {
        path: node.path ?? '',
        line: typeof node.line === 'number' ? node.line : null,
        author: first?.author?.login ?? '?',
        body: (first?.body ?? '').trim(),
        url: first?.url ?? null,
        isOutdated: node.isOutdated === true,
      }
    })
}

export function toPr(raw: Record<string, unknown>, threads: PrThread[] | null): PrInfo {
  const state = raw.state === 'MERGED' || raw.state === 'CLOSED' ? raw.state : 'OPEN'
  return {
    provider: 'github',
    number: Number(raw.number),
    title: String(raw.title ?? ''),
    url: String(raw.url ?? ''),
    state,
    isDraft: raw.isDraft === true,
    reviewDecision: typeof raw.reviewDecision === 'string' && raw.reviewDecision !== '' ? raw.reviewDecision : null,
    mergeState: typeof raw.mergeStateStatus === 'string' ? raw.mergeStateStatus : null,
    head: String(raw.headRefName ?? ''),
    base: String(raw.baseRefName ?? ''),
    added: Number(raw.additions ?? 0),
    removed: Number(raw.deletions ?? 0),
    checks: toChecks(raw.statusCheckRollup),
    threads,
    headSha: typeof raw.headRefOid === 'string' && raw.headRefOid !== '' ? raw.headRefOid : null,
    autoMerge: raw.autoMergeRequest !== null && raw.autoMergeRequest !== undefined,
  }
}

// https://github.com/owner/name/pull/12 → 호스트·owner·name (GitHub Enterprise 도).
export function prRepo(url: string): { host: string; owner: string; name: string } | null {
  const match = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/\d+/.exec(url)
  return match ? { host: match[1]!, owner: match[2]!, name: match[3]! } : null
}

// 칩 조각: 흐린 PR 번호, 그 뒤 상태 하나. color 는 COLORS 의 키.
export type ChipPart = { text: string; color: 'muted' | 'success' | 'danger' | 'warning' }

export function prChipParts(pr: PrInfo): ChipPart[] {
  const parts: ChipPart[] = [{ text: `\uf407 ${prNumber(pr)}`, color: 'muted' }]
  if (pr.state === 'MERGED') return [...parts, { text: 'merged', color: 'muted' }]
  if (pr.state === 'CLOSED') return [...parts, { text: 'closed', color: 'muted' }]
  if (pr.isDraft) parts.push({ text: 'draft', color: 'muted' })
  const { passed, failed, pending, total } = checkSummary(pr.checks)
  if (failed > 0) parts.push({ text: `✗ ${failed}`, color: 'danger' })
  else if (pending > 0) parts.push({ text: `● ${passed}/${total}`, color: 'warning' })
  else if (total > 0) parts.push({ text: `✓ ${passed}/${total}`, color: 'success' })
  if (pr.reviewDecision === 'CHANGES_REQUESTED') parts.push({ text: T.chipChangesRequested, color: 'danger' })
  const open = pr.threads?.length ?? 0
  if (open > 0) parts.push({ text: `◆ ${open}`, color: 'warning' })
  return parts
}

export function reviewName(decision: string): string {
  return T.reviewNames[decision] ?? decision
}

// GitHub mergeStateStatus(대문자)와 GitLab detailed_merge_status(소문자).
export function mergeName(state: string): string {
  return T.mergeNames[state] ?? state
}

export function mergeLevel(state: string): 'success' | 'danger' | 'muted' {
  return state === 'CLEAN' || state === 'HAS_HOOKS' || state === 'mergeable' ? 'success' : state === 'DIRTY' || state === 'conflict' ? 'danger' : 'muted'
}

// GitHub 은 PR #12, GitLab 은 MR !12.
export function prNumber(pr: Pick<PrInfo, 'provider' | 'number'>): string {
  return pr.provider === 'gitlab' ? `!${pr.number}` : `#${pr.number}`
}

export function prRef(pr: Pick<PrInfo, 'provider' | 'number'>): string {
  return `${pr.provider === 'gitlab' ? 'MR' : 'PR'} ${prNumber(pr)}`
}

// "Claude에게 맡기기" 가 입력창에 채우는 글.
export function checkPrompt(pr: PrInfo, check: PrCheck): string {
  return T.checkPrompt(prRef(pr), pr.provider === 'gitlab', check.name, check.url)
}

export function threadPrompt(pr: PrInfo, thread: PrThread): string {
  const where = thread.line === null ? thread.path : `${thread.path}:${thread.line}`
  const quoted = thread.body
    .slice(0, 1500)
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n')
  return `${T.threadPrompt(prRef(pr), where, thread.author)}\n${quoted}`
}

type Ran = { exitCode: number; stdout: string; stderr: string }

// 다시 물어도 같을 실패: 도구가 없음(실행 실패), git 저장소가 아님, gh 가 모르는 호스트.
export function isLocalFailure(ran: Ran): boolean {
  return ran.exitCode === 127 || /not a git repository|known GitHub host/i.test(ran.stderr)
}
// 프로그램을 부르는 자리마다 명령을 고정 글자로 쓴다($.process.run([...])): 디렉터리 검사가 무엇을 실행하는지 끝까지 읽게.
// 테스트는 { process: { run } } 을 넘긴다.
type Proc = { process: { run: (argv: string[], init?: { timeoutMs?: number }) => Promise<Ran> } }
const READ_MS = 15_000
const MERGE_MS = 30_000

// gh 가 없거나(실행 실패), GitHub 저장소가 아니면 off. PR 이 없는 브랜치는 none.
export async function fetchPr($: Proc, branch: string | null, at: number): Promise<PrState> {
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

// ── GitLab (glab) ──────────────────────────────────────────────────────────────
// glab mr view 는 지금 브랜치의 열린 MR 을 준다. 파이프라인 job 은 체크로, 풀 수 있는 토론 중 안 풀린 것은
// 리뷰 스레드로 옮긴다. MR JSON 에는 줄 수가 없어서 diff_refs 의 두 커밋으로 로컬 git 에서 센다.

const GITLAB_STATES: Record<string, PrInfo['state']> = { opened: 'OPEN', merged: 'MERGED', closed: 'CLOSED', locked: 'CLOSED' }

export function jobState(job: { status?: string; allow_failure?: boolean }): PrCheck['state'] {
  switch (job.status) {
    case 'success':
      return 'pass'
    case 'failed':
      return job.allow_failure ? 'skip' : 'fail'
    case 'canceled':
      return 'fail'
    case 'skipped':
    case 'manual':
      return 'skip'
    default:
      return 'pending'
  }
}

export function toJobs(jobs: unknown): PrCheck[] {
  if (!Array.isArray(jobs)) return []
  return (jobs as Array<{ name?: string; stage?: string; status?: string; allow_failure?: boolean; web_url?: string }>)
    .map(job => ({ name: job.stage ? `${job.stage} / ${job.name ?? '?'}` : (job.name ?? '?'), state: jobState(job), url: job.web_url ?? null }))
    .sort((a, b) => CHECK_ORDER[a.state] - CHECK_ORDER[b.state] || a.name.localeCompare(b.name))
}

type GitlabNote = {
  id?: number
  body?: string
  system?: boolean
  resolvable?: boolean
  resolved?: boolean
  author?: { username?: string } | null
  position?: { new_path?: string; new_line?: number | null; old_path?: string; old_line?: number | null } | null
}

export function toDiscussions(discussions: unknown, webUrl: string): PrThread[] | null {
  if (!Array.isArray(discussions)) return null
  return (discussions as Array<{ notes?: GitlabNote[] }>)
    .filter(discussion => (discussion.notes ?? []).some(note => note.resolvable === true && note.resolved !== true))
    .map(discussion => {
      const first = (discussion.notes ?? []).find(note => !note.system) ?? discussion.notes![0]!
      const position = first.position ?? null
      return {
        path: position?.new_path ?? position?.old_path ?? '',
        line: position?.new_line ?? position?.old_line ?? null,
        author: first.author?.username ?? '?',
        body: (first.body ?? '').trim(),
        url: first.id !== undefined && webUrl ? `${webUrl}#note_${first.id}` : null,
        isOutdated: false,
      }
    })
}

// detailed_merge_status 를 PR 의 리뷰 결정으로(승인 여부는 MR JSON 에 따로 없다).
export function gitlabReview(status: string | null): string | null {
  return status === 'requested_changes' ? 'CHANGES_REQUESTED' : status === 'not_approved' ? 'REVIEW_REQUIRED' : null
}

export function shortStat(text: string): { added: number; removed: number } | null {
  if (!/changed/.test(text)) return null
  return { added: Number(/(\d+) insertion/.exec(text)?.[1] ?? 0), removed: Number(/(\d+) deletion/.exec(text)?.[1] ?? 0) }
}

export function toMr(raw: Record<string, unknown>, checks: PrCheck[], threads: PrThread[] | null, stat: { added: number; removed: number } | null): PrInfo {
  const status = typeof raw.detailed_merge_status === 'string' ? raw.detailed_merge_status : null
  return {
    provider: 'gitlab',
    number: Number(raw.iid),
    title: String(raw.title ?? ''),
    url: String(raw.web_url ?? ''),
    state: GITLAB_STATES[String(raw.state)] ?? 'OPEN',
    isDraft: raw.draft === true || raw.work_in_progress === true,
    reviewDecision: gitlabReview(status),
    mergeState: raw.has_conflicts === true ? 'conflict' : status,
    head: String(raw.source_branch ?? ''),
    base: String(raw.target_branch ?? ''),
    added: stat?.added ?? null,
    removed: stat?.removed ?? null,
    checks,
    threads,
    headSha: typeof raw.sha === 'string' && raw.sha !== '' ? raw.sha : ((raw.diff_refs as { head_sha?: string } | null)?.head_sha ?? null),
    autoMerge: raw.merge_when_pipeline_succeeds === true,
    ...(typeof raw.project_id === 'number' ? { projectId: raw.project_id } : {}),
  }
}

// glab mr view 를 인자 없이 쓰면 같은 브랜치에 병합된 MR 이 여럿일 때 고르라며 실패한다. 그래서 열린 MR 을
// 브랜치로 먼저 찾고 번호로 읽는다.
export async function fetchMr($: Proc, branch: string | null, at: number): Promise<PrState> {
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

// ── 머지 ──────────────────────────────────────────────────────────────────────
// now 는 바로 머지, auto 는 도는 체크가 통과하면 머지(GitLab 은 파이프라인이 성공하면). 실패한 체크가 있거나
// 충돌·Draft·리뷰 미승인 같은 막힘이 있으면 버튼을 내지 않는다. GitLab 은 파이프라인 성공이 조건이 아닌
// 프로젝트에서 도는 중에도 mergeable 이라 하므로, 도는 체크가 있으면 늘 auto 로 한다.
export type MergeAction = 'now' | 'auto'

const GITHUB_MERGEABLE = new Set(['CLEAN', 'HAS_HOOKS', 'UNSTABLE'])
const GITLAB_MERGEABLE = new Set(['mergeable', 'ci_still_running', 'ci_must_pass'])

export function mergeAction(pr: PrInfo): MergeAction | null {
  if (pr.state !== 'OPEN' || pr.isDraft || pr.autoMerge || pr.headSha === null) return null
  if (pr.checks.some(check => check.state === 'fail')) return null
  const isPending = pr.checks.some(check => check.state === 'pending')
  const state = pr.mergeState ?? ''
  if (pr.provider === 'gitlab') {
    if (pr.projectId === undefined || !GITLAB_MERGEABLE.has(state)) return null
    return isPending || state !== 'mergeable' ? 'auto' : 'now'
  }
  if (GITHUB_MERGEABLE.has(state)) return isPending ? 'auto' : 'now'
  // 필수 체크가 도는 중이면 BLOCKED 다. 리뷰 때문에 막힌 게 아니면 자동 머지를 걸 수 있다.
  const isReviewBlocked = pr.reviewDecision === 'CHANGES_REQUESTED' || pr.reviewDecision === 'REVIEW_REQUIRED'
  return state === 'BLOCKED' && isPending && !isReviewBlocked ? 'auto' : null
}

export type MergeResult = { ok: true; merged: boolean; note?: string } | { ok: false; error: string }

const firstLine = (text: string) => text.split('\n').map(line => line.trim()).find(line => line !== '' && line !== 'ERROR') ?? ''

// GitHub: 저장소가 허용하는 방식(merge → squash → rebase 순)으로, 본 head 커밋일 때만. 원격 브랜치는 머지된 뒤
// 지운다. gh 의 --delete-branch 는 로컬 브랜치까지 지우고 기본 브랜치로 체크아웃하므로 쓰지 않는다.
// 자동 머지는 나중에 일어나서 지울 수 없다(저장소의 "Automatically delete head branches" 를 따른다).
// GitLab: REST 로 머지한다. squash 는 MR 설정(프로젝트 기본값)을 따르고 원격 브랜치는 지운다.
// 자동 머지 파라미터는 옛 이름(merge_when_pipeline_succeeds)과 새 이름(auto_merge)을 함께 보낸다.
export async function mergePr($: Proc, pr: PrInfo, action: MergeAction): Promise<MergeResult> {
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
export async function fetchReview($: Proc, branch: string | null, at: number): Promise<PrState> {
  const github = await fetchPr($, branch, at)
  if (github.status !== 'off') return github
  const gitlab = await fetchMr($, branch, at)
  if (gitlab.status !== 'off') return gitlab
  return { ...github, error: [github.error, gitlab.error].filter(Boolean).join(' / ') || undefined, isSticky: github.isSticky === true && gitlab.isSticky === true }
}
