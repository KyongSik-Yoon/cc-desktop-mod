import type { CommitInfo, DiffScope } from '../types'

// 데스크톱 diff 패널의 범위: 커밋 안 한 변경 / 브랜치 전체(기본 브랜치에서 갈라진 뒤) / 커밋별.
// 데스크톱도 기본 브랜치와의 기준점을 merge-base 로 잡는다.
export const SCOPES: ReadonlyArray<{ scope: DiffScope; label: string }> = [
  { scope: 'uncommitted', label: '커밋 안 한 변경' },
  { scope: 'branch', label: '브랜치 전체' },
  { scope: 'commits', label: '커밋별' },
]

export function scopeOf(word: string): DiffScope | null {
  const found = SCOPES.find(item => item.scope === word || item.label === word)
  return found?.scope ?? null
}

export const LOG_FORMAT = '--format=%H%x1f%h%x1f%s%x1f%an%x1f%ar'
export const MAX_COMMITS = 50

export function parseCommits(text: string): CommitInfo[] {
  return text
    .split('\n')
    .filter(line => line.includes('\x1f'))
    .map(line => {
      const [sha = '', short = '', subject = '', author = '', ago = ''] = line.split('\x1f')
      return { sha, short, subject, author, ago }
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
