import type { CommitInfo, DiffScope } from '../types'
import { T, allScopeLabels } from './i18n'

// 데스크톱 diff 패널의 범위: 커밋 안 한 변경 / 브랜치 전체(기본 브랜치에서 갈라진 뒤) / 커밋별.
// 데스크톱도 기본 브랜치와의 기준점을 merge-base 로 잡는다.
export const SCOPES: ReadonlyArray<DiffScope> = ['uncommitted', 'branch', 'commits']

export function scopeLabel(scope: DiffScope): string {
  return scope === 'branch' ? T.scopeBranch : scope === 'commits' ? T.scopeCommits : T.scopeUncommitted
}

// /desk-diff 의 인자: 범위 키(branch …)나 어느 언어의 탭 이름이든.
export function scopeOf(word: string): DiffScope | null {
  if ((SCOPES as readonly string[]).includes(word)) return word as DiffScope
  const found = allScopeLabels().find(([label]) => label.toLowerCase() === word.toLowerCase())
  return (found?.[1] as DiffScope | undefined) ?? null
}

// 시간은 목록 순서와 같은 커밋 시각(%cr). rebase·cherry-pick 으로 작성 시각(%ar)과 벌어지면 그것도 보인다.
export const LOG_FORMAT = '--format=%H%x1f%h%x1f%s%x1f%an%x1f%cr%x1f%ar%x1f%ct%x1f%at'
const AUTHORED_GAP_SECONDS = 600
export const MAX_COMMITS = 50

export function parseCommits(text: string): CommitInfo[] {
  return text
    .split('\n')
    .filter(line => line.includes('\x1f'))
    .map(line => {
      const [sha = '', short = '', subject = '', author = '', ago = '', authoredAgo = '', committedAt = '0', authoredAt = '0'] = line.split('\x1f')
      const authored = Math.abs(Number(committedAt) - Number(authoredAt)) >= AUTHORED_GAP_SECONDS ? authoredAgo : ''
      return { sha, short, subject, author, ago, authored }
    })
}

// 기준 브랜치 후보: PR 의 base 가 있으면 그것, 그다음 origin 의 기본 브랜치, 흔한 이름.
export function baseCandidates(prBase: string | null, originHead: string | null): string[] {
  const names = [
    prBase ? `origin/${prBase}` : null,
    prBase,
    originHead,
    'origin/main',
    'origin/master',
    'origin/develop',
    'main',
    'master',
    'develop',
  ]
  return [...new Set(names.filter((name): name is string => !!name))]
}

// 파일 이름 거르기: 띄어 쓴 조각이 모두 경로에 들어 있으면(대소문자 무시) 맞는다. 빈 글은 모두 맞는다.
export function matchesPath(path: string, query: string): boolean {
  const lower = path.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(part => lower.includes(part))
}

// 기준 고르기 목록: for-each-ref 의 전체 이름(최근 커밋 순)을 짧게. 원격의 HEAD 와 지금 브랜치는 뺀다.
export function branchChoices(text: string, current: string | null, max = 8): string[] {
  const names = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => !line.endsWith('/HEAD'))
    .map(line => line.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, ''))
    .filter(name => name !== '' && !name.startsWith('refs/') && name !== current)
  return [...new Set(names)].slice(0, max)
}
