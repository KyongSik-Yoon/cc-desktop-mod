import type { RunCall } from '../types'

// 미리보기 패널: 마크다운 문서를 대화와 같은 렌더러로 옆에 펼친다.
// 여는 길은 셋이다. 편집 행·턴 끝 카드의 ◫ 칩, /desk-preview, Claude 의 preview 도구.
// 한 턴에 새로 쓴 문서는 턴이 끝날 때 연다(쓰는 동안 패널이 들썩이지 않게). 열린 문서는 이후 쓰기·편집을 따라간다.
// 엔진을 부르는 부분($)은 import 를 건널 수 없어 register.tsx 에 있고, 여기는 순수 함수만 둔다.

export const PREVIEW_PANE = 'desk-preview'
export const PREVIEW_TOOL = 'mcp__desk-look__preview'
// 한 번 그리는 글자 수에는 한도가 있어 긴 문서는 여기서 자르고 그렇다고 적는다.
export const PREVIEW_ROOM = 90_000

export const isMarkdown = (path: unknown): path is string => typeof path === 'string' && /\.(md|markdown|mdx)$/i.test(path)

// Claude 가 스스로 쓰는 파일(메모리·설정·스킬·플랜)은 읽을 문서가 아니라 저절로 열지 않는다.
export const isPrivate = (path: string) => /(^|\/)\.claude\//.test(path)

export const fileName = (path: string) => path.split('/').pop() || path

// 행이 다룬 문서: 성공한 Write·Edit 의 file_path, preview 도구의 path.
export function previewOf(call: Pick<RunCall, 'tool' | 'input' | 'isErrored' | 'isRunning'>): string | null {
  if (call.isErrored || call.isRunning) return null
  const input = (call.input ?? {}) as Record<string, unknown>
  const path = call.tool === PREVIEW_TOOL ? input.path : ['Write', 'Edit', 'MultiEdit'].includes(call.tool) ? input.file_path : undefined
  return isMarkdown(path) ? path : null
}

// Claude 에게 내미는 preview 도구. 저절로 열기가 켜져 있으면 쓴 뒤에 따로 부를 필요가 없다고 알린다.
export function previewTool(isAuto: boolean) {
  return {
    name: 'preview',
    description: [
      "Opens a Markdown file in desk-look's preview pane beside the conversation, drawn like the transcript (tables, mermaid diagrams, alert boxes).",
      'Use it when the person asks to see, read or preview a .md file.',
      ...(isAuto ? ['A document you write during a turn opens by itself when the turn ends; you do not need to call this after writing one.'] : []),
    ].join(' '),
    inputSchema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'The Markdown file, absolute or relative to the working directory.' } },
      required: ['path'],
    },
  }
}
