import type { CommentDraft, LineComment, LineRef } from '../types'
import type { DiffLine, DiffRow } from './diffview'

// diff 줄 댓글: 데스크톱 Code 탭처럼 줄(또는 범위)에 남긴 말을 다음 프롬프트에 보이지 않는 context 로 붙인다.
// 줄은 패치 안 행 번호가 아니라 종류·옛 번호·새 번호로 기억한다: 파일이 더 바뀌어 행이 밀려도 같은 줄을 찾는다.
export type LinePress = { patch: string; path: string; scope: string; line: DiffLine }

export const lineRef = (line: DiffLine): LineRef => ({ kind: line.kind, oldNo: line.oldNo, newNo: line.newNo })
const isSame = (a: LineRef, b: LineRef) => a.kind === b.kind && a.oldNo === b.oldNo && a.newNo === b.newNo
// 화면에 보이는 번호: 지운 줄은 옛 파일, 나머지는 새 파일 번호.
export const shownNo = (line: LineRef) => (line.kind === '-' ? line.oldNo : line.newNo)

export function rowOf(rows: DiffRow[], ref: LineRef): number {
  return rows.findIndex(row => row.kind === 'line' && isSame(lineRef(row.line), ref))
}

// 두 줄 사이(순서 무관)의 행 범위. 둘 중 하나라도 패치에서 사라졌으면 null.
export function rangeOf(rows: DiffRow[], a: LineRef, b: LineRef): [number, number] | null {
  const from = rowOf(rows, a)
  const to = rowOf(rows, b)
  if (from === -1 || to === -1) return null
  return from <= to ? [from, to] : [to, from]
}

export function linesIn(rows: DiffRow[], [from, to]: [number, number]): DiffLine[] {
  return rows.slice(from, to + 1).flatMap(row => (row.kind === 'line' ? [row.line] : []))
}

// "61" 또는 "57–61".
export function rangeLabel(lines: ReadonlyArray<LineRef>): string {
  const first = lines[0]
  const last = lines[lines.length - 1]
  if (!first || !last) return ''
  const [a, b] = [shownNo(first), shownNo(last)]
  return a === b ? String(a) : `${a}–${b}`
}

// 줄 번호를 눌렀을 때: 처음이거나 다른 패치면 그 줄에서 시작, 같은 패치면 범위 끝을 옮긴다.
// 한 줄만 고른 상태에서 그 줄을 다시 누르면 닫는다.
export function pressLine(draft: CommentDraft | null, at: LinePress): CommentDraft | null {
  const ref = lineRef(at.line)
  if (!draft || draft.patch !== at.patch) return { patch: at.patch, path: at.path, scope: at.scope, anchor: ref, end: ref }
  if (isSame(ref, draft.anchor) && isSame(draft.end, draft.anchor)) return null
  return { ...draft, end: ref }
}

// 입력칸 키: 범위가 바뀌면 입력칸이 다른 자리에 새로 그려지므로 키도 바꾼다. 같은 키면 포커스가 곧 사라질
// 옛 입력칸에 가서, 다시 그릴 때 프롬프트로 빠진다.
const refKey = (ref: LineRef) => `${ref.kind === ' ' ? 'c' : ref.kind === '+' ? 'a' : 'd'}${ref.oldNo}.${ref.newNo}`
export const draftKey = (draft: CommentDraft) => `comment-input-${refKey(draft.anchor)}-${refKey(draft.end)}`

const mark = (line: DiffLine) => (line.kind === ' ' ? ' ' : line.kind)

// 모델이 읽을 블록 하나: 파일:줄, 그 줄들(diff 표시 포함), 댓글. 모델에게 가는 글이라 영어로 둔다.
export function commentContext(comments: ReadonlyArray<LineComment>): string {
  const blocks = comments.map(comment => {
    const width = String(Math.max(...comment.lines.map(shownNo))).length
    const code = comment.lines.map(line => `${String(shownNo(line)).padStart(width)} ${mark(line)} ${line.text}`).join('\n')
    return `${comment.path}:${rangeLabel(comment.lines)} (${comment.scope})\n\`\`\`diff\n${code}\n\`\`\`\n${comment.body}`
  })
  return [
    'The user left these comments on lines of a diff in the desk-look diff pane, as part of this message. Removed (-) lines use old-file line numbers; added (+) and unchanged lines use new-file numbers.',
    ...blocks,
  ].join('\n\n')
}
