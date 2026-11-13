import type { CommentDraft, LineComment, LineRef } from '../types'
import { untab } from './diffview'
import type { DiffLine, DiffRow } from './diffview'
import { isDocComment } from './preview'

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
// 미리보기 패널의 원문 줄 보기에서 단 댓글(문서 줄)은 diff 표시 없이 파일 줄 번호와 그 줄 원문으로 따로 모은다.
export function commentContext(comments: ReadonlyArray<LineComment>): string {
  const diffs = comments.filter(comment => !isDocComment(comment))
  const docs = comments.filter(isDocComment)
  const diffBlocks = diffs.map(comment => `${comment.path}:${rangeLabel(comment.lines)} (${comment.scope})\n\`\`\`diff\n${numbered(comment, true)}\n\`\`\`\n${comment.body}`)
  return [
    ...(diffs.length > 0
      ? [
          'The user left these comments on lines of a diff in the desk-look diff pane, as part of this message. Removed (-) lines use old-file line numbers; added (+) and unchanged lines use new-file numbers.',
          ...diffBlocks,
        ]
      : []),
    ...(docs.length > 0 ? [DOC_COMMENTS_HEAD, ...docs.map(docBlock)] : []),
  ].join('\n\n')
}

export const DOC_COMMENTS_HEAD =
  "The user left these comments on lines of a document in the desk-look preview pane, as part of this message. Line numbers are the file's, and each comment quotes the lines as they were when it was written."

// 문서 줄 댓글 하나: 파일:줄, 그 줄 원문, 댓글.
export const docBlock = (comment: LineComment) => `${comment.path}:${rangeLabel(comment.lines)}\n\`\`\`\n${numbered(comment, false)}\n\`\`\`\n${comment.body}`

// 댓글이 짚은 줄들: 번호를 오른쪽에 맞추고, diff 면 +·- 표시를 둔다.
function numbered(comment: LineComment, isDiff: boolean): string {
  const width = String(Math.max(...comment.lines.map(shownNo))).length
  return comment.lines.map(line => `${String(shownNo(line)).padStart(width)} ${isDiff ? `${mark(line)} ` : ''}${line.text}`).join('\n')
}

// 문서 줄 댓글이 지금 문서와 어긋났는지: 짚은 줄 가운데 하나라도 그 번호의 줄 글이 달라졌거나 사라졌으면.
// 댓글이 적어 둔 줄 글은 diff 줄처럼 탭을 펴고 제어 문자를 지운 것이라 지금 줄도 그렇게 견준다.
export function isStale(comment: LineComment, lines: ReadonlyArray<string>): boolean {
  return comment.lines.some(line => {
    const now = lines[shownNo(line) - 1]
    return now === undefined || untab(now) !== line.text
  })
}
