import type { On, RenderSurface } from 'claude-code'
import { describe, expect, mock, test, type TestBody } from 'claude-code/testing'

import { setLang } from '../hooks/i18n'

import { bubbleEdges, bubbleRows, cardFor, chinLabel, describeCalls, formatElapsed, spinnerDots, spinnerWord, lineChange, mergeEdit, diffStat, editHunk, patchOf, askAnswer, parseDiff, planRow, summarize, wrapText } from '../hooks/register'
import { agentDetailOf, applyNotices, backgroundTaskOf, dismissAgents, exitStatusOf, mergeAgents, modelLabel, orderAgents, outputFileOf, parseNotices, stepTokens, tailOf } from '../hooks/agents'
import { cellWidth, columnWidths, inlineWidth, parseBlocks, parseInline, plainText, splitFrontMatter } from '../hooks/markdown'
import { previewOf } from '../hooks/preview'
import { previewHtml } from '../hooks/preview-html'
import { blockHeight, diffBlocks, diffPalette, diffRows, gutterWidth, isTruecolor, openGaps, parseHunks, rowHeight, windowPlan, wordSpan } from '../hooks/diffview'
import { branchChoices, matchesPath } from '../hooks/gitview'
import { bandStayMs, currentHead, headAt, quoteDecorations, quoteInto, selectionIn } from '../hooks/register'

// 기존 테스트는 한국어 화면을 확인한다(기본은 영어). 영어 기본값은 맨 아래 테스트가 본다.
const KO = { options: { language: 'ko' } }
const VIEWPORT = { columns: 100, rows: 40 }
const call = (tool: string, input: unknown, extra: Partial<{ isErrored: boolean; output: unknown }> = {}) => ({
  tool,
  input,
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  ...extra,
})

const REPLY = [
  '## 결과',
  '',
  '**완료**했어요. `main` 브랜치를 보세요: [문서](https://example.com/doc)',
  '',
  '| 이름 | 상태 |',
  '|---|:---:|',
  '| 말풍선 | 통과 |',
  '| 표 `md` | 통과 |',
  '',
  '- 첫째',
  '  - 둘째',
  '1. 번호',
  '',
  '> 인용문',
  '',
  '```ts',
  'const x = 1',
  '```',
].join('\n')

describe('응답 렌더링', () => {
  test('답변은 서명 없이 데스크톱 산문 스타일로 그린다', KO, async ($, on) => {
    const copied: string[] = []
    on('ui.copy', ($, e) => {
      copied.push(e.text)
      return { value: { isCopied: true } }
    })
    const reply = await $.ui.mount({
      plugin: 'desk-look',
      surface: 'terminal',
      component: 'AssistantMessage',
      viewport: VIEWPORT,
      props: { text: REPLY, isFirstOfReply: true },
    })
    expect(await reply.find({ type: 'Text', text: /✻ Claude/ })).toBeUndefined()
    expect(await reply.find({ type: 'Markdown' })).toBeUndefined()
    // 표: 둥근 외곽선 + 헤더 + 행 구분선, 셀 안 인라인 코드
    const drawn = JSON.stringify(await reply.drawn())
    expect(drawn).toContain('"borderStyle":"round"')
    expect(drawn).toContain('─')
    expect(await reply.find({ type: 'Text', text: /말풍선/ })).toBeDefined()
    expect(await reply.find({ type: 'Text', text: /^md$/ })).toBeDefined()
    // 링크, 인용 막대, 코드 블록, 불릿
    expect(drawn).toContain('"href":"https://example.com/doc"')
    expect(drawn).toContain('"borderStyle":"quote"')
    expect(await reply.find({ type: 'Code' })).toBeDefined()
    // 코드 블록 복사 버튼: 평소엔 숨고 마우스를 올리면 보인다
    expect(drawn).toContain('"hover":{"display":"flex"}')
    const copyKey = /"key":"(copymd\.\d+)"/.exec(drawn)?.[1]
    expect(copyKey).toBeDefined()
    await reply.press({ key: copyKey ?? '' })
    expect(copied.length).toBe(1)
    expect(REPLY).toContain(copied[0] ?? '∅')
    expect(await reply.find({ type: 'Text', text: '•' })).toBeDefined()
    await reply.unmount()
  })

  test('도구 사이 글의 요약도 불릿 없이 산문으로', KO, async $ => {
    const block = await $.ui.mount({
      plugin: 'desk-look',
      surface: 'terminal',
      component: 'AssistantMessage',
      viewport: VIEWPORT,
      props: { text: '상세 화면을 **확인**했습니다.', isFirstOfReply: true, isSummary: true },
    })
    expect(await block.find({ type: 'Markdown' })).toBeUndefined()
    const drawn = JSON.stringify(await block.drawn())
    expect(drawn).toContain('확인')
    expect(drawn).not.toContain('●')
    await block.unmount()
  })

  test('백틱 안 URL 은 코드 모양 그대로 링크로, 긴 주소는 줄여서', KO, async $ => {
    const long = 'https://example.com/docs/plugins/very/long/path/to/the/page?tab=api&lang=ko'
    const reply = await $.ui.mount({
      plugin: 'desk-look',
      surface: 'terminal',
      component: 'AssistantMessage',
      viewport: VIEWPORT,
      props: { text: `짧은 \`https://example.com/a/b\`, 긴 \`${long}\`, 맨 ${long}, \`npm run build\``, isFirstOfReply: true },
    })
    const drawn = JSON.stringify(await reply.drawn())
    expect(drawn).toContain('"href":"https://example.com/a/b"},"children":["https://example.com/a/b"]')
    // 줄이 넘어가면 엔진 Link 는 첫 줄에만 걸리므로 긴 주소는 한 줄에 드는 문구로, href 는 그대로
    expect(drawn.split(`"href":"${long}"},"children":["example.com/docs/plugins…tab=api&lang=ko"]`).length).toBe(3)
    expect(drawn.match(/"href"/g)?.length).toBe(3)
    await reply.unmount()
  })

  test('따옴표·괄호 안의 외톨이 \\ 는 엔진처럼 남긴다', KO, async $ => {
    const line = `Q1 "\\" Q2 (\\) Q3 a(\\) Q4 (\\)b Q5 **b**(\\) Q6 [\\] Q7 '\\' Q8 {\\} Q9 \\*(\\) Q10 (\\)(\\)\n\nQ11 [x(\\)](https://x.y)`
    const reply = await $.ui.mount({
      plugin: 'desk-look',
      surface: 'terminal',
      component: 'AssistantMessage',
      viewport: VIEWPORT,
      props: { text: line, isFirstOfReply: true },
    })
    const strings = (node: unknown): string =>
      typeof node === 'string' ? node : Array.isArray(node) ? node.map(strings).join('') : node && typeof node === 'object' && 'children' in node ? strings(node.children) : ''
    // 엔진 2.1.311 기본 그림과 같다: 글자·숫자에 붙었거나 다른 토큰 뒤의 여는 괄호면 이스케이프로 읽는다
    expect(strings(await reply.drawn())).toContain(`Q1 "\\" Q2 (\\) Q3 a() Q4 ()b Q5 b() Q6 [\\] Q7 '\\' Q8 {\\} Q9 *() Q10 (\\)(\\)Q11 x()`)
    await reply.unmount()
  })

  test('mermaid 는 박스 문자 그림으로, 한글 폭을 맞춰 그린다', KO, async $ => {
    const reply = await $.ui.mount({
      plugin: 'desk-look',
      surface: 'terminal',
      component: 'AssistantMessage',
      viewport: VIEWPORT,
      props: { text: '앞\n\n> [!NOTE]\n> 주의\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n> 그냥 인용', isFirstOfReply: true },
    })
    expect(await reply.find({ type: 'Markdown' })).toBeUndefined()
    const diagram = renderDiagram('flowchart LR\n  A[시작] --> B[끝]')
    const lines = (diagram?.rows ?? []).map(row => row.map(seg => seg.text).join(''))
    expect(lines.join('\n')).toContain('╭')
    // 렌더러가 한글 폭을 맞춘다: 상자 윗변과 글자 줄의 칸 수가 같다
    const label = lines.find(line => line.includes('시작')) ?? ''
    expect(cellWidth(label)).toBe(cellWidth(lines[0] ?? ''))
    expect(renderDiagram('this is not mermaid ((')).toBeNull()
    expect(JSON.stringify(await reply.drawn())).toContain('"borderStyle":"quote"')
    await reply.unmount()
  })

  test('속성 붙은 펜스, 알림 박스, 코드 바탕 폭', KO, async $ => {
    const blocks = parseBlocks('```ts title="a.ts"\nconst a = 1\n```\n\n## 다음\n\n````md\n```\n안쪽\n```\n````\n\n끝')
    expect(blocks.map(block => block.kind)).toEqual(['code', 'heading', 'code', 'paragraph'])
    expect(blocks[0]?.kind === 'code' && blocks[0].language).toBe('ts')
    expect(blocks[2]?.kind === 'code' && blocks[2].source).toBe('```\n안쪽\n```')
    expect(inlineWidth(parseInline('`ab` 한'), 1)).toBe(2 + 2 + 1 + 2)
    // breaks(채팅 글): 문단 줄바꿈과 줄 앞 들여쓰기, 목록 항목의 이어지는 줄을 그대로 둔다. 기본은 한 칸으로 잇는다
    expect(parseBlocks('a\n  b\n- x\n  {\n    "k": 1')).toEqual([
      { kind: 'paragraph', text: 'a b' },
      { kind: 'list', items: [{ level: 0, marker: '•', text: 'x { "k": 1' }] },
    ])
    expect(parseBlocks('a\n  b\n- x\n  {\n    "k": 1', true)).toEqual([
      { kind: 'paragraph', text: 'a\n  b' },
      { kind: 'list', items: [{ level: 0, marker: '•', text: 'x\n{\n  "k": 1' }] },
    ])

    const reply = await $.ui.mount({
      plugin: 'desk-look',
      surface: 'terminal',
      component: 'AssistantMessage',
      viewport: VIEWPORT,
      props: { text: '> [!WARNING]\n> 조심하세요', isFirstOfReply: true },
    })
    expect(await reply.find({ type: 'Text', text: /Warning/ })).toBeDefined()
    expect(await reply.find({ type: 'Text', text: /\[!WARNING\]/ })).toBeUndefined()
    await reply.unmount()
  })

  test('데스크톱 화면에서는 엔진 그림을 그대로 둔다', KO, async ($, on) => {
    on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine-drawn</Text>
    })
    const desktop = await $.ui.mount({
      plugin: 'desk-look',
      surface: 'desktop',
      component: 'AssistantMessage',
      props: { text: '데스크톱', isFirstOfReply: true },
    })
    expect(await desktop.find({ type: 'Text', text: 'engine-drawn' })).toBeDefined()
    await desktop.unmount()
  })

  test('사용자 프롬프트는 둥근 말풍선', KO, async $ => {
    const bubble = await $.ui.mount({
      plugin: 'desk-look',
      surface: 'terminal',
      component: 'UserMessage',
      viewport: VIEWPORT,
      props: { text: '안녕 Claude', origin: { kind: 'composer' }, isExpanded: true },
    })
    expect(JSON.stringify(await bubble.drawn())).toContain('"borderStyle":"round"')
    await bubble.unmount()
  })
})

describe('도구 활동', () => {
  test('편집 한 줄: 동사·파일명·칩, 누르면 diff 로 펼친다', KO, async $ => {
    const row = await $.ui.mount({
      plugin: 'desk-look',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: 'e1',
      viewport: VIEWPORT,
      props: {
        tool_use_id: 'e1',
        tool: 'Edit',
        input: { file_path: '/repo/src/app.ts', old_string: 'a', new_string: 'b\nc' },
        isRunning: false,
        isErrored: false,
        isInterrupted: false,
      },
    })
    expect(await row.find({ type: 'Text', text: 'app.ts' })).toBeDefined()
    expect(await row.find({ type: 'Text', text: ' +2 ' })).toBeDefined()
    expect(await row.find({ type: 'Code' })).toBeUndefined()
    await row.press({ key: 'row-e1' })
    expect(await row.find({ type: 'Code' })).toBeDefined()
    await row.unmount()
  })

  test('결과 블록은 숨긴다', KO, async $ => {
    const result = await $.ui.mount({
      plugin: 'desk-look',
      surface: 'terminal',
      component: 'ToolResult',
      viewport: VIEWPORT,
      props: { tool_use_id: 'r1', tool: 'Bash', output: { stdout: 'hi', stderr: '' }, isErrored: false },
    })
    expect(await result.find({ type: 'Text' })).toBeUndefined()
    await result.unmount()
  })

  test('묶음 한 줄 요약, 누르면 호출별 줄', KO, async $ => {
    const group = await $.ui.mount({
      plugin: 'desk-look',
      surface: 'terminal',
      component: 'ToolGroup',
      requestId: 'g1',
      viewport: VIEWPORT,
      props: {
        calls: [
          { tool_use_id: 'a', ...call('Read', { file_path: '/r/a.ts' }) },
          { tool_use_id: 'b', ...call('Read', { file_path: '/r/b.ts' }) },
          { tool_use_id: 'c', ...call('Grep', { pattern: 'TODO' }, { isErrored: true }) },
        ],
        isActive: false,
        isExpanded: false,
      },
    })
    expect(JSON.stringify(await group.drawn())).toContain('Read 2 files, searched (1 failed)')
    expect(await group.find({ type: 'Text', text: 'TODO' })).toBeUndefined()
    await group.press({ key: 'run-g1' })
    expect(await group.find({ type: 'Text', text: 'TODO' })).toBeDefined()
    await group.unmount()
  })

  test('묶음을 펼치면 편집 diff 가 바로, 다시 누르면 접힌다', KO, async $ => {
    const group = await $.ui.mount({
      plugin: 'desk-look',
      surface: 'terminal',
      component: 'ToolGroup',
      requestId: 'g2',
      viewport: VIEWPORT,
      props: {
        calls: [
          { tool_use_id: 'r', ...call('Read', { file_path: '/r/a.ts' }) },
          { tool_use_id: 'e', ...call('Edit', { file_path: '/r/a.ts', old_string: 'x\nold', new_string: 'x\nnew' }, { output: 'ok' }) },
        ],
        isActive: false,
        isExpanded: false,
      },
    })
    expect(await group.find({ type: 'Code' })).toBeUndefined()
    await group.press({ key: 'run-g2' })
    const code = JSON.stringify(await group.drawn())
    expect(code).toContain(' x\\n-old\\n+new')
    await group.press({ key: 'row-e' })
    expect(await group.find({ type: 'Code' })).toBeUndefined()
    await group.unmount()
  })

  test('ctrl+o 화면(isExpanded)에서는 도구 행·결과·묶음을 엔진이 그린다', KO, async ($, on) => {
    on('ui.render', { component: 'ToolUse' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine-use</Text>
    })
    on('ui.render', { component: 'ToolResult' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine-result</Text>
    })
    on('ui.render', { component: 'ToolGroup' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine-group</Text>
    })
    const use = await $.ui.mount({
      plugin: 'desk-look',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: 'x1',
      viewport: VIEWPORT,
      props: { tool_use_id: 'x1', ...call('Read', { file_path: '/r/a.ts' }), isExpanded: true },
    })
    expect(JSON.stringify(await use.drawn())).toContain('engine-use')
    await use.unmount()
    const result = await $.ui.mount({
      plugin: 'desk-look',
      surface: 'terminal',
      component: 'ToolResult',
      viewport: VIEWPORT,
      props: { tool_use_id: 'x1', tool: 'Bash', output: { stdout: 'hi', stderr: '' }, isErrored: false, isExpanded: true },
    })
    expect(JSON.stringify(await result.drawn())).toContain('engine-result')
    await result.unmount()
    const group = await $.ui.mount({
      plugin: 'desk-look',
      surface: 'terminal',
      component: 'ToolGroup',
      requestId: 'x2',
      viewport: VIEWPORT,
      props: { calls: [{ tool_use_id: 'x2', ...call('Read', { file_path: '/r/b.ts' }) }], isActive: false, isExpanded: true },
    })
    expect(JSON.stringify(await group.drawn())).toContain('engine-group')
    await group.unmount()
  })

  test('호출 말고 다른 줄이 섞인 묶음(isCallsOnly false)은 엔진이, 실패가 있으면 desk-look 이 그린다', KO, async ($, on) => {
    on('ui.render', { component: 'ToolGroup' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine-group</Text>
    })
    const mount = (requestId: string, isCallsOnly: boolean, isErrored: boolean) =>
      $.ui.mount({
        plugin: 'desk-look',
        surface: 'terminal',
        component: 'ToolGroup',
        requestId,
        viewport: VIEWPORT,
        props: {
          calls: [
            { tool_use_id: `${requestId}-a`, ...call('Read', { file_path: '/r/a.ts' }) },
            { tool_use_id: `${requestId}-b`, ...call('Grep', { pattern: 'TODO' }, { isErrored }) },
          ],
          isActive: false,
          isExpanded: false,
          isCallsOnly,
        },
      })
    const mixed = await mount('m1', false, false)
    expect(JSON.stringify(await mixed.drawn())).toContain('engine-group')
    await mixed.unmount()
    const failed = await mount('m2', false, true)
    expect(JSON.stringify(await failed.drawn())).toContain('Read a file, searched (1 failed)')
    await failed.unmount()
    const plain = await mount('m3', true, false)
    expect(JSON.stringify(await plain.drawn())).toContain('Read a file, searched')
    expect(JSON.stringify(await plain.drawn())).not.toContain('engine-group')
    await plain.unmount()
  })

  test('입력창 위 밴드는 다른 플러그인의 밴드를 지우지 않는다', KO, async ($, on) => {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>other-band</Text>
    })
    const band = await $.ui.mount({
      plugin: 'desk-look',
      surface: 'terminal',
      component: 'AbovePrompt',
      viewport: VIEWPORT,
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 10,
        bodyColumns: 98,
        scroll: { top: 0, height: 0, viewport: 0 },
        view: { mode: 'normal' },
      } as never,
    })
    expect(await band.find({ type: 'Text', text: 'other-band' })).toBeDefined()
    await band.unmount()
  })
})

test('순수 함수', KO, async () => {
  expect(cellWidth('ab한글')).toBe(6)
  expect(summarize('Edit', { file_path: '/a/b/c.ts' })).toBe('c.ts')
  expect(describeCalls([call('Bash', {}), call('Bash', {}), call('Write', {}), call('Edit', {}), call('Read', {}), call('WebFetch', {})])).toBe(
    'Ran 2 commands, created a file, edited a file, and 2 more actions',
  )
  expect(describeCalls([call('Bash', {}), call('mcp__x__y', {})])).toBe('Ran a command, used a tool')
  expect(diffStat(call('Edit', { old_string: 'a\nb', new_string: 'c' }))).toEqual({ added: 1, removed: 2 })
  // Write 로 있던 파일을 덮어쓰면 결과의 헌크로 센다(내용 전체가 + 가 아니라)
  const overwrite = { structuredPatch: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [' a', '-b', '+c', '+d', ' e'] }] }
  expect(diffStat(call('Write', { content: 'a\nc\nd\ne\n' }, { output: overwrite }))).toEqual({ added: 2, removed: 1 })
  // 새 파일은 헌크가 비어 내용 줄 수
  expect(diffStat(call('Write', { content: 'a\nb\n' }, { output: { type: 'create', structuredPatch: [] } }))).toEqual({ added: 2, removed: 0 })
  // 문맥 줄은 빼고 센다: 한 줄 추가는 +1 −0
  expect(lineChange('x\ny', 'x\ny\nz')).toEqual({ added: 1, removed: 0 })
  expect(lineChange('a\nhello\nb', 'a\nhi\nb')).toEqual({ added: 1, removed: 1 })
  expect(lineChange('', 'new')).toEqual({ added: 1, removed: 0 })
  expect(editHunk('a', 'b')).toBe('@@ -1,1 +1,1 @@\n-a\n+b')
  // 편집 결과에 헌크가 있으면 파일 기준 줄 번호를 쓴다
  expect(patchOf({ structuredPatch: [{ oldStart: 2, oldLines: 2, newStart: 2, newLines: 2, lines: [' a', '-b', '+c'] }] })).toBe('@@ -2,2 +2,2 @@\n a\n-b\n+c')
  expect(patchOf('ok')).toBeNull()
  // 문맥 줄은 −/+ 가 아니라 공백으로, 두 줄까지만
  expect(editHunk('1\n2\n3\nold\n4', '1\n2\n3\nnew\n4')).toBe('@@ -2,4 +2,4 @@\n 2\n 3\n-old\n+new\n 4')

  const blocks = parseBlocks(REPLY)
  expect(blocks.map(block => block.kind)).toEqual(['heading', 'paragraph', 'table', 'list', 'quote', 'code'])
  const table = blocks[2]
  expect(table?.kind === 'table' && table.align).toEqual(['left', 'center'])
  expect(table?.kind === 'table' && table.rows[1]).toEqual(['표 `md`', '통과'])
  const list = blocks[3]
  expect(list?.kind === 'list' && list.items.map(item => [item.level, item.marker])).toEqual([[0, '•'], [1, '◦'], [0, '1.']])
  expect(plainText(parseInline('**굵게** `코드` [링크](https://x.y) 끝'))).toBe('굵게 코드 링크 끝')
  expect(columnWidths([5, 5], 40)).toEqual([5, 5])
  // fill: 남는 폭을 비율대로 나눠 꽉 채운다
  expect(columnWidths([4, 12], 40, true).reduce((sum, width) => sum + width + 2, 0)).toBe(40)
  const squeezed = columnWidths([4, 60], 40)
  expect(squeezed[0]).toBe(4)
  expect((squeezed[0] ?? 0) + (squeezed[1] ?? 0) + 4).toBeLessThanOrEqual(40)

  const files = parseDiff('diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1 +1,2 @@\n-old\n+new\n+more\n')
  expect(files[0]).toEqual({ path: 'src/x.ts', added: 2, removed: 1, patch: '@@ -1 +1,2 @@\n-old\n+new\n+more', isNew: false })
})

import { computeRuns, placeCall, withPredicted } from '../hooks/runs'
import type { PredictedCall, RunCursor } from '../hooks/runs'
import { gray256, mix, parseSurface } from '../hooks/theme'

describe('v3: 테마 면과 도구 묶음', () => {
  test('omarchy colors.toml 에서 말풍선 색을 계산한다', KO, async () => {
    const light = parseSurface('mode = "light"\nbackground = "#fafafa"\nforeground = "#212121"\n')
    expect(light?.mode).toBe('light')
    expect(light?.bubble).toBe(mix('#fafafa', '#000000', 0.055))
    expect(light?.bubble).not.toBe('#fafafa')
    const dark = parseSurface('background = "#1a1b26"\n')
    expect(dark?.mode).toBe('dark')
    expect(parseSurface('nothing here')).toBeNull()
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })

  test('텍스트가 끼기 전까지의 도구 호출을 한 묶음으로 계산한다', KO, async () => {
    const use = (id: string, tool: string) => ({ tool_use_id: id, tool, input: {} })
    const result = (id: string, isError = false) => ({ tool_use_id: id, text: isError ? 'boom' : 'ok', isError })
    const result_ = computeRuns([
      { role: 'user', text: '해 줘', toolUses: [] },
      { role: 'assistant', text: '볼게요.', toolUses: [use('a', 'Bash')] },
      { role: 'user', text: '', toolUses: [], toolResults: [result('a')] },
      { role: 'assistant', text: '', toolUses: [use('b', 'Edit'), use('c', 'Read')] },
      { role: 'user', text: '', toolUses: [], toolResults: [result('b', true)] },
      { role: 'assistant', text: '고쳤어요.', toolUses: [] },
      { role: 'assistant', text: '', toolUses: [use('d', 'Bash')] },
    ])
    expect(result_.firstOf).toEqual({ a: 'a', b: 'a', c: 'a', d: 'd' })
    expect(result_.calls.a?.map(call => [call.tool_use_id, call.isErrored, call.isRunning])).toEqual([
      ['a', false, false],
      ['b', true, false],
      ['c', false, true],
    ])
  })

  test('스트림에서 미리 넣은 호출은 기록으로 계산한 묶음과 같은 자리에 든다', KO, async () => {
    const use = (id: string, tool: string) => ({ tool_use_id: id, tool, input: {} })
    const messages = [
      { role: 'user' as const, text: '해 줘', toolUses: [] },
      { role: 'assistant' as const, text: '볼게요.', toolUses: [] },
      { role: 'assistant' as const, text: '', toolUses: [use('a', 'Bash')] },
      { role: 'assistant' as const, text: '', toolUses: [use('b', 'Read'), use('c', 'Agent'), use('e', 'Agent')] },
      { role: 'assistant' as const, text: '', toolUses: [use('p', 'ExitPlanMode'), use('q', 'Bash')] },
      { role: 'assistant' as const, text: '고쳤어요.', toolUses: [] },
      { role: 'assistant' as const, text: '', toolUses: [use('d', 'Bash')] },
    ]
    // 스트림 순서대로: 글이 오면 열린 묶음을 닫고, 도구가 오면 자리를 정한다
    let cursor: RunCursor = null
    const predicted: PredictedCall[] = []
    for (const message of messages.slice(1)) {
      if (message.text.trim() !== '') cursor = null
      for (const tool of message.toolUses) {
        const placed = placeCall(cursor, tool.tool_use_id, tool.tool)
        cursor = placed.cursor
        predicted.push({ first: placed.first, call: { tool_use_id: tool.tool_use_id, tool: tool.tool, input: {}, isRunning: true, isErrored: false, isInterrupted: false } })
      }
    }
    const recorded = computeRuns(messages)
    expect(withPredicted(computeRuns(messages.slice(0, 1)), predicted).firstOf).toEqual(recorded.firstOf)
    // 기록 읽기가 마지막 호출보다 늦으면 그 호출은 예측 자리로 남고, 기록에 나온 호출은 기록을 따른다
    const partial = withPredicted(computeRuns(messages.slice(0, 3)), predicted)
    expect(partial.firstOf).toEqual(recorded.firstOf)
    expect(partial.calls.a?.map(call => call.tool_use_id)).toEqual(['a', 'b'])
    expect(withPredicted(recorded, predicted)).toBe(recorded)
  })

  test('묶음의 첫 행은 묶음 한 줄, 나머지 행은 비운다', KO, async () => {
    const runCall = (id: string) => ({ tool_use_id: id, tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false })
    const state = { firstOf: { a: 'a', b: 'a', c: 'a', z: 'z' }, calls: { a: [runCall('a'), runCall('b'), runCall('c')], z: [runCall('z')] } }
    expect(planRow(['a'], state).kind).toBe('run')
    expect(planRow(['b'], state).kind).toBe('hide')
    expect(planRow(['z'], state).kind).toBe('own')
    expect(planRow(['unknown'], state).kind).toBe('own')
    // 엔진이 접은 그룹이 묶음을 통째로 담으면 그룹 스스로, 묶음 일부를 담으면 첫 호출 쪽이 그린다
    expect(planRow(['a', 'b', 'c'], state).kind).toBe('own')
    expect(planRow(['a', 'b'], state).kind).toBe('run')
    expect(planRow(['b', 'c'], state).kind).toBe('hide')
  })
})

import { CORNER_SIZE, cornerPixels, graphicsOf, herdrGraphicsOn, imageNumber, pngSize, thumbnailSize, tmuxGraphicsOf } from '../hooks/images'
import { renderDiagram } from '../hooks/diagram'

test('붙여 넣은 이미지 목록과 썸네일 크기', KO, async () => {
  // PNG 머리 24바이트(490×298)
  const header = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 1, 234, 0, 0, 1, 42]
  expect(pngSize(header)).toEqual({ width: 490, height: 298 })
  expect(pngSize([1, 2])).toBe(null)
  expect([imageNumber('8.png'), imageNumber('notes.txt'), imageNumber('8.png.tmp')]).toEqual(['8', null, null])
  expect(herdrGraphicsOn('[experimental]\n  kitty_graphics = true\n')).toBe(true)
  expect(herdrGraphicsOn('# kitty_graphics = true\nkitty_graphics = false\n')).toBe(false)
  expect(thumbnailSize({ path: '', width: 490, height: 298 }, 36)).toEqual({ columns: 36, rows: 11 })
  // 세로로 긴 그림은 행 상한에 맞춰 폭을 줄인다
  expect(thumbnailSize({ path: '', width: 300, height: 1200 }, 36)).toEqual({ columns: 6, rows: 12 })
})

test('말풍선 줄바꿈과 다이어그램 색 나누기', KO, async () => {
  expect(wrapText('가나다 라마바 사아', 8)).toEqual(['가나다', '라마바', '사아'])
  expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  expect(wrapText('첫 줄\n둘째 줄', 20)).toEqual(['첫 줄', '둘째 줄'])
  const kinds = new Set((renderDiagram('flowchart LR\n  A[시작] -->|예| B[끝]')?.rows ?? []).flat().map(seg => seg.kind))
  expect([...kinds].sort()).toEqual(['arrow', 'border', 'label', 'line', 'text'])
})

test('그래픽 지원 판정과 그림 못 그릴 때 [Image #N] 지우기', KO, async $ => {
  expect(graphicsOf({ TERM: 'xterm-ghostty' })).toBe('kitty')
  expect(graphicsOf({ TERM: 'xterm-256color', TERM_PROGRAM: 'ghostty' })).toBe('kitty')
  // herdr 는 kitty_graphics 설정과 엔진 강제(CLAUDE_CODE_FORCE_TERMINAL_IMAGES)가 모두 있어야 그린다
  const herdr = { TERM: 'xterm-256color', TERM_PROGRAM: 'herdr', HERDR_ENV: '1' }
  expect(graphicsOf({ ...herdr, TERM: 'xterm-ghostty' })).toBe(null)
  expect(graphicsOf(herdr, true)).toBe(null)
  expect(graphicsOf({ ...herdr, CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' })).toBe(null)
  expect(graphicsOf({ ...herdr, CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' }, true)).toBe('kitty')
  expect(graphicsOf({ TERM: 'xterm-kitty', TMUX: '/tmp/tmux' })).toBe(null)
  expect(graphicsOf({ TERM: 'xterm-256color' })).toBe(null)
  // iTerm2 는 3.5 부터(2.1.305), tmux 안이나 매 화면 다시 그리기에서는 아니다
  const iterm = { TERM: 'xterm-256color', TERM_PROGRAM: 'iTerm.app' }
  expect(graphicsOf({ ...iterm, TERM_PROGRAM_VERSION: '3.5.10' })).toBe('iterm')
  expect(graphicsOf({ ...iterm, TERM_PROGRAM_VERSION: '3.6.6' })).toBe('iterm')
  expect(graphicsOf({ ...iterm, TERM_PROGRAM_VERSION: '3.4.23' })).toBe(null)
  expect(graphicsOf(iterm)).toBe(null)
  expect(graphicsOf({ ...iterm, TERM_PROGRAM_VERSION: '3.5.10', TMUX: '/tmp/tmux' })).toBe(null)
  expect(graphicsOf({ ...iterm, TERM_PROGRAM_VERSION: '3.5.10', CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT: '1' })).toBe(null)

  const bubble = await $.ui.mount({
    plugin: 'desk-look',
    surface: 'terminal',
    component: 'UserMessage',
    viewport: VIEWPORT,
    props: { text: '[Image #13] 이건 여전히 어색', origin: { kind: 'composer' }, isExpanded: false },
  })
  const drawn = JSON.stringify(await bubble.drawn())
  expect(drawn).not.toContain('[Image #13]')
  expect(drawn).toContain('이건 여전히 어색')
  await bubble.unmount()
})

test('iTerm2 3.5 전체 화면: 모서리는 rgba, 썸네일은 PNG 바이트로 그리고 기본 화면에서는 글자로 둔다', KO, async ($, on) => {
  const env: Record<string, string> = { HOME: '/home/t', COLORTERM: 'truecolor', TERM: 'xterm-256color', TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.5.10' }
  const header = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 1, 234, 0, 0, 1, 42]
  const dir = '/tmp/claude-501/-repo/s1/images'
  // 1×1 PNG 한 장(엔진이 PNG 머리를 확인한다)
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='
  on('env.get', ($, e) => ({ value: env[String((e as { name?: string }).name)] as never }))
  on('fs.read', ($, e) => {
    const path = String((e as { path?: string }).path ?? e)
    if (path.endsWith('colors.toml')) return { value: 'mode = "light"\nbackground = "#fafafa"\n' } as never
    if (path === `${dir}/3.png`) return { value: { base64: png } } as never
    throw new Error('ENOENT')
  })
  on('fs.list', ($, e) => {
    const path = (e as { path?: string }).path
    if (path === '/tmp/claude-501') return { value: [{ name: '-repo', kind: 'dir', size: 0, mtimeMs: 1 }] } as never
    if (path === dir) return { value: [{ name: '3.png', kind: 'file', size: 9, mtimeMs: 1 }] } as never
    throw new Error('ENOENT')
  })
  on('fs.exists', ($, e) => ({ value: (e as { path?: string }).path === dir }) as never)
  on('session.id', () => ({ value: 's1' }))
  on('process.run', ($, e) => {
    const stdout = e.argv[0] === 'id' ? '501\n' : e.argv[0] === 'od' ? header.join(' ') : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', () => ({ value: undefined as never }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', ($, e) => e as never)
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal' } as never)
  const props = { text: '[Image #3] 첫 줄\n둘째 줄', origin: { kind: 'composer' }, isExpanded: false }
  const mount = (isFullscreen: boolean) =>
    $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'UserMessage', viewport: { ...VIEWPORT, isFullscreen }, props } as never)
  const full = await mount(true)
  let drawn = ''
  for (let tries = 0; tries < 50 && !drawn.includes(png); tries++) {
    await wait(10)
    drawn = JSON.stringify(await full.drawn())
  }
  expect(drawn).toContain(`"png":"${png}"`)
  expect(drawn).not.toContain('"file"')
  expect(drawn).toContain('"rgba"')
  // [Image #N] 은 말풍선 글에서 빠지고 썸네일의 alt 로만 남는다
  expect(drawn.split('[Image #3]').length).toBe(2)
  expect(drawn).toContain('"alt":"[Image #3]"')
  await full.unmount()
  // 기본(main screen) 화면에서는 엔진이 iTerm2 그림을 그리지 않는다: 글리프 모서리, 썸네일 없음
  const main = await mount(false)
  const plain = JSON.stringify(await main.drawn())
  expect(plain).not.toContain('"rgba"')
  expect(plain).not.toContain('"png"')
  expect(plain).toContain('둘째 줄')
  await main.unmount()
})

// herdr 서버의 /proc/net/unix: herdr-client.sock 듣는 소켓, 받아 준 클라이언트 연결들, API 소켓
function unixTable(clients: string[]) {
  const row = (flags: string, st: string, inode: string, path: string) => `0000000000000000: 00000002 00000000 ${flags} 0001 ${st} ${inode} ${path}`
  return [
    'Num       RefCount Protocol Flags    Type St Inode Path',
    row('00010000', '01', '63497', '/home/t/.config/herdr/herdr-client.sock'),
    ...clients.map(inode => row('00000000', '03', inode, '/home/t/.config/herdr/herdr-client.sock')),
    row('00010000', '01', '46072', '/home/t/.config/herdr/herdr.sock'),
    '',
  ].join('\n')
}

test('herdr 원격 클라이언트가 붙은 동안만 말풍선을 그림 없이(글리프 모서리, 썸네일은 엔진 └ [Image #N] 줄) 그린다', KO, async ($, on) => {
  const env: Record<string, string> = { HOME: '/home/t', COLORTERM: 'truecolor', TERM: 'xterm-256color', TERM_PROGRAM: 'herdr', HERDR_ENV: '1', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' }
  const header = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 1, 234, 0, 0, 1, 42]
  const dir = '/tmp/claude-501/-repo/s1/images'
  let bridge = true
  const asked: string[][] = []
  on('env.get', ($, e) => ({ value: env[String((e as { name?: string }).name)] as never }))
  on('fs.read', ($, e) => {
    const path = String((e as { path?: string }).path ?? e)
    if (path.endsWith('colors.toml')) return { value: 'mode = "dark"\nbackground = "#1a1a1a"\n' } as never
    if (path === '/home/t/.config/herdr/config.toml') return { value: '[experimental]\nkitty_graphics = true\n' } as never
    if (path === '/proc/net/unix') return { value: unixTable(bridge ? ['62751', '70001'] : ['62751']) } as never
    throw new Error('ENOENT')
  })
  on('fs.list', ($, e) => {
    const path = (e as { path?: string }).path
    if (path === '/tmp/claude-501') return { value: [{ name: '-repo', kind: 'dir', size: 0, mtimeMs: 1 }] } as never
    if (path === dir) return { value: [{ name: '3.png', kind: 'file', size: 9, mtimeMs: 1 }] } as never
    throw new Error('ENOENT')
  })
  on('fs.exists', ($, e) => ({ value: (e as { path?: string }).path === dir }) as never)
  on('session.id', () => ({ value: 's1' }))
  on('process.run', ($, e) => {
    if (e.argv[0] === 'pgrep') asked.push([...e.argv])
    const exitCode = e.argv[0] === 'pgrep' && !bridge ? 1 : 0
    const stdout = e.argv[0] === 'id' ? '501\n' : e.argv[0] === 'od' ? header.join(' ') : e.argv[0] === 'pgrep' && bridge ? '4242\n' : ''
    return { value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', () => ({ value: undefined as never }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', ($, e) => e as never)
  on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal' } as never)
  const bubble = await $.ui.mount({
    plugin: 'desk-look',
    surface: 'terminal',
    component: 'UserMessage',
    viewport: { ...VIEWPORT, isFullscreen: true },
    props: { text: '[Image #3] 1\n2\n3', origin: { kind: 'composer' }, isExpanded: false },
  } as never)
  let drawn = ''
  for (let tries = 0; tries < 50 && !drawn.includes('\u{1FB41}'); tries++) {
    await wait(10)
    drawn = JSON.stringify(await bubble.drawn())
  }
  expect(asked[0]).toEqual(['pgrep', '-f', '^\\S*herdr( --session \\S+)? remote-client-bridge'])
  expect(drawn).not.toContain('"rgba"')
  expect(drawn).toContain('\u{1FB41}')
  expect(drawn).toContain('\u{1FB5D}')
  // 썸네일 없이 말풍선 글에서 [Image #3] 만 빠진다
  expect(drawn).not.toContain('"source"')
  expect(drawn).not.toContain('Image #3')
  // herdr-client.sock 연결이 그대로면 다음 프롬프트에서 pgrep 을 다시 돌리지 않는다
  await $.turn.start({ text: '다음', turnId: 't2' } as never)
  await wait(50)
  expect(asked).toHaveLength(1)
  // 원격이 떨어져 연결이 바뀐 뒤 다음 프롬프트에서 다시 보고, 그려 둔 말풍선도 둥근 그림 모서리와 썸네일로 다시 그린다
  bridge = false
  await $.turn.start({ text: '그다음', turnId: 't3' } as never)
  for (let tries = 0; tries < 50 && !drawn.includes('"rgba"'); tries++) {
    await wait(10)
    drawn = JSON.stringify(await bubble.drawn())
  }
  expect(asked).toHaveLength(2)
  expect(drawn).toContain('"rgba"')
  expect(drawn).toContain('"file"')
  expect(drawn).not.toContain('\u{1FB41}')
  await bubble.unmount()
})

test('herdr-client.sock 연결을 못 읽으면(/proc 없음, 소켓 줄 없음) 프롬프트마다 pgrep 으로 원격 접속을 본다', KO, async ($, on) => {
  const env: Record<string, string> = { HOME: '/home/t', TERM: 'xterm-256color', TERM_PROGRAM: 'herdr', HERDR_ENV: '1', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' }
  let table: string | null = null
  const asked: string[][] = []
  on('env.get', ($, e) => ({ value: env[String((e as { name?: string }).name)] as never }))
  on('fs.read', ($, e) => {
    const path = String((e as { path?: string }).path ?? e)
    if (path === '/home/t/.config/herdr/config.toml') return { value: '[experimental]\nkitty_graphics = true\n' } as never
    if (path === '/proc/net/unix' && table !== null) return { value: table } as never
    throw new Error('ENOENT')
  })
  on('fs.list', () => {
    throw new Error('ENOENT')
  })
  on('fs.exists', () => ({ value: false }) as never)
  on('session.id', () => ({ value: 's1' }))
  on('process.run', ($, e) => {
    if (e.argv[0] === 'pgrep') asked.push([...e.argv])
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', () => ({ value: undefined as never }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', ($, e) => e as never)
  on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal' } as never)
  await wait(50)
  await $.turn.start({ text: '안녕', turnId: 't1' } as never)
  await wait(50)
  // 읽기는 되지만(빈 /proc 읽기 같은) herdr-client.sock 줄이 없으면 같은 목록이라고 넘기지 않는다
  table = unixTable([]).split('\n').filter(line => !line.includes('herdr-client.sock')).join('\n')
  await $.turn.start({ text: '다음', turnId: 't2' } as never)
  await wait(50)
  await $.turn.start({ text: '그다음', turnId: 't3' } as never)
  await wait(50)
  expect(asked).toHaveLength(4)
})

test('herdr 안이라도 그림이 꺼져 있으면(kitty_graphics 없음) 원격 접속을 보지 않는다', KO, async ($, on) => {
  const env: Record<string, string> = { HOME: '/home/t', TERM: 'xterm-256color', TERM_PROGRAM: 'herdr', HERDR_ENV: '1', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' }
  const asked: string[][] = []
  on('env.get', ($, e) => ({ value: env[String((e as { name?: string }).name)] as never }))
  on('fs.read', ($, e) => {
    asked.push(['read', String((e as { path?: string }).path ?? e)])
    throw new Error('ENOENT')
  })
  on('fs.list', () => {
    throw new Error('ENOENT')
  })
  on('fs.exists', () => ({ value: false }) as never)
  on('session.id', () => ({ value: 's1' }))
  on('process.run', ($, e) => {
    asked.push([...e.argv])
    return { value: { exitCode: e.argv[0] === 'pgrep' ? 0 : 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', () => ({ value: undefined as never }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', ($, e) => e as never)
  on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal' } as never)
  await $.turn.start({ text: '안녕', turnId: 't1' } as never)
  await wait(50)
  expect(asked.filter(argv => argv[0] === 'pgrep' || argv[1] === '/proc/net/unix')).toEqual([])
})

test('tmux 안 그림: 통과 설정과 바깥 터미널을 tmux 에 물어 엔진과 같은 때 그린다(2.1.310)', KO, async () => {
  const reply = (termtype: string, passthrough = 'on', focus = '1', bigger = '0') => [termtype, passthrough, focus, bigger].join('\t') + '\n'
  expect(tmuxGraphicsOf(reply('kitty(0.35.1)'))).toBe('kitty-bytes')
  expect(tmuxGraphicsOf(reply('kitty(0.27.0)'))).toBe(null)
  expect(tmuxGraphicsOf(reply('ghostty 1.2.0'))).toBe('kitty-bytes')
  expect(tmuxGraphicsOf(reply('kitty(0.35.1)', 'all'))).toBe('kitty-bytes')
  expect(tmuxGraphicsOf(reply('kitty(0.35.1)', 'off'))).toBe(null)
  expect(tmuxGraphicsOf(reply('kitty(0.35.1)', ''))).toBe(null)
  expect(tmuxGraphicsOf(reply('kitty(0.35.1)', 'on', '0'))).toBe(null)
  expect(tmuxGraphicsOf(reply('iTerm2 3.5.10'))).toBe('iterm')
  expect(tmuxGraphicsOf(reply('iTerm2 3.4.23'))).toBe(null)
  // iTerm2 는 all 이 아니라 on, 창이 터미널보다 크면 그리지 않는다
  expect(tmuxGraphicsOf(reply('iTerm2 3.5.10', 'all'))).toBe(null)
  expect(tmuxGraphicsOf(reply('iTerm2 3.5.10', 'on', '1', '1'))).toBe(null)
  expect(tmuxGraphicsOf(reply('xterm-256color'))).toBe(null)
  expect(tmuxGraphicsOf(reply(''))).toBe(null)
  const tmux = { TERM: 'tmux-256color', TERM_PROGRAM: 'tmux', TMUX: '/tmp/tmux-0/default,1,0' }
  expect(graphicsOf(tmux, false, reply('kitty(0.35.1)'))).toBe('kitty-bytes')
  expect(graphicsOf(tmux, false, null)).toBe(null)
  expect(graphicsOf({ ...tmux, CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT: '1' }, false, reply('iTerm2 3.5.10'))).toBe(null)
})

test('tmux 안 kitty: 썸네일과 모서리를 파일 이름 대신 바이트로 그린다', KO, async ($, on) => {
  const env: Record<string, string> = { HOME: '/home/t', TERM: 'tmux-256color', TERM_PROGRAM: 'tmux', TMUX: '/tmp/tmux-501/default,1,0', TMUX_PANE: '%3' }
  const header = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 1, 234, 0, 0, 1, 42]
  const dir = '/tmp/claude-501/-repo/s1/images'
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='
  const asked: string[][] = []
  on('env.get', ($, e) => ({ value: env[String((e as { name?: string }).name)] as never }))
  on('fs.read', ($, e) => {
    const path = String((e as { path?: string }).path ?? e)
    if (path.endsWith('colors.toml')) return { value: 'mode = "light"\nbackground = "#fafafa"\n' } as never
    if (path === `${dir}/3.png`) return { value: { base64: png } } as never
    throw new Error('ENOENT')
  })
  on('fs.list', ($, e) => {
    const path = (e as { path?: string }).path
    if (path === '/tmp/claude-501') return { value: [{ name: '-repo', kind: 'dir', size: 0, mtimeMs: 1 }] } as never
    if (path === dir) return { value: [{ name: '3.png', kind: 'file', size: 9, mtimeMs: 1 }] } as never
    throw new Error('ENOENT')
  })
  on('fs.exists', ($, e) => ({ value: (e as { path?: string }).path === dir }) as never)
  on('session.id', () => ({ value: 's1' }))
  on('process.run', ($, e) => {
    if (e.argv[0] === 'tmux') asked.push([...e.argv])
    const stdout = e.argv[0] === 'id' ? '501\n' : e.argv[0] === 'od' ? header.join(' ') : e.argv[0] === 'tmux' ? 'kitty(0.35.1)\ton\t1\t0\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', () => ({ value: undefined as never }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', ($, e) => e as never)
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal' } as never)
  const props = { text: '[Image #3] 첫 줄\n둘째 줄', origin: { kind: 'composer' }, isExpanded: false }
  // tmux 기본은 main screen 이다
  const bubble = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'UserMessage', viewport: { ...VIEWPORT, isFullscreen: false }, props } as never)
  let drawn = ''
  for (let tries = 0; tries < 50 && !drawn.includes(png); tries++) {
    await wait(10)
    drawn = JSON.stringify(await bubble.drawn())
  }
  expect(asked[0]?.slice(0, 5)).toEqual(['tmux', 'display-message', '-p', '-t', '%3'])
  expect(drawn).toContain(`"png":"${png}"`)
  expect(drawn).not.toContain('"file"')
  expect(drawn).toContain('"rgba"')
  expect(drawn).toContain('"alt":"[Image #3]"')
  await bubble.unmount()
})

test('말풍선 모서리 그림: 바깥 모서리는 비우고 안쪽은 말풍선 색으로 채운다', KO, async () => {
  const { width, height } = CORNER_SIZE
  const alpha = (pixels: Uint8Array, x: number, y: number) => pixels[(y * width + x) * 4 + 3]
  const topLeft = cornerPixels('top-left', '#e2e2e2')
  expect(topLeft.length).toBe(width * height * 4)
  expect([...topLeft.slice(0, 3)]).toEqual([0xe2, 0xe2, 0xe2])
  expect(alpha(topLeft, 0, 0)).toBe(0)
  expect(alpha(topLeft, width - 1, 0)).toBe(255)
  expect(alpha(topLeft, 0, height - 1)).toBe(255)
  const bottomRight = cornerPixels('bottom-right', '#e2e2e2')
  expect(alpha(bottomRight, width - 1, height - 1)).toBe(0)
  expect(alpha(bottomRight, 0, height - 1)).toBe(255)
  expect(alpha(bottomRight, width - 1, 0)).toBe(255)
})

test('말풍선 모서리 그림: 비율을 지켜 칸에 맞춰도 칸을 꽉 채운다', KO, async () => {
  const { width, height } = CORNER_SIZE
  // Ghostty 처럼 긴 쪽을 칸에 맞추고 짧은 쪽을 가운데에 둔 뒤 픽셀로 반올림한다. 11x24 는 1.5배, 14x32 는 2배 화면의 칸.
  for (const [cellWidth, cellHeight] of [[11, 24], [14, 32]] as const) {
    const wider = width * cellHeight > height * cellWidth
    const drawn = wider ? (height * cellWidth) / width : (width * cellHeight) / height
    const cell = wider ? cellHeight : cellWidth
    expect(Math.round(drawn)).toBe(cell)
    expect(Math.round((cell - drawn) / 2)).toBe(0)
  }
})

test('분기 노드는 이중선 상자, 일반 노드는 둥근 상자', KO, async () => {
  const text = (renderDiagram('flowchart LR\n  A[답변] --> B{종류} --> C[그림]')?.rows ?? [])
    .map(row => row.map(seg => seg.text).join(''))
    .join('\n')
  expect(text).toContain('╔')
  expect(text).toContain('╭')
  expect(text).not.toContain('┌')
})

test('말풍선 줄은 칸 수를 맞춰 같은 폭으로 채운다', KO, async () => {
  const rows = bubbleRows(['첫 줄', 'second line'])
  expect(rows.map(cellWidth)).toEqual([15, 15])
  expect(rows[0]).toBe('  첫 줄      ' + '  ')
})

test('말풍선 끝 칸은 줄 위치로 고른다', KO, async () => {
  expect(bubbleEdges(1)).toEqual([['\ue0b6', '\ue0b4']])
  const three = bubbleEdges(3)
  expect(three[0]).toEqual(['\u{1FB41}', '\u{1FB4C}'])
  expect(three[1]).toEqual([null, null])
  expect(three[2]).toEqual(['\u{1FB52}', '\u{1FB5D}'])
  expect(bubbleEdges(2).map(pair => pair[0])).toEqual(['\u{1FB41}', '\u{1FB52}'])
  // 모서리 글리프는 한 칸이라 줄 폭이 어긋나지 않는다
  expect(cellWidth('\u{1FB41}')).toBe(1)
})

test('화살촉은 상자 테두리에 꽂고 그 앞 칸은 선으로 잇는다', KO, async () => {
  const rows = (renderDiagram('flowchart TD\n  A[답변] --> B[그림]')?.rows ?? []).map(row => row.map(seg => seg.text).join(''))
  const text = rows.join('\n')
  expect(text).not.toContain('▼')
  expect(text).toContain('\u{1FB6D}')
  // 화살촉 칸 바로 위는 세로선
  const y = rows.findIndex(line => line.includes('\u{1FB6D}'))
  const x = [...(rows[y] ?? '')].indexOf('\u{1FB6D}')
  expect([...(rows[y - 1] ?? '')][x]).toBe('│')
  const lr = (renderDiagram('flowchart LR\n  A[a] --> B[b]')?.rows ?? []).map(row => row.map(seg => seg.text).join('')).join('\n')
  expect(lr).toContain('\u{1FB6C}')
  expect(lr).not.toContain('▶')
})

test('턴 끝 카드: 파일 합치기와 소요 시간 짝짓기', KO, async () => {
  let list = mergeEdit([], { path: '/r/a.ts', added: 2, removed: 1 })
  list = mergeEdit(list, { path: '/r/b.ts', added: 1, removed: 0 })
  list = mergeEdit(list, { path: '/r/a.ts', added: 3, removed: 2 })
  expect(list).toEqual([
    { path: '/r/a.ts', added: 5, removed: 3 },
    { path: '/r/b.ts', added: 1, removed: 0 },
  ])
  const cards = [
    { durationMs: 12_000, files: list },
    { durationMs: 12_700, files: [] },
    { durationMs: 90_000, files: list },
  ]
  expect(cardFor(cards, 12_650)?.durationMs).toBe(12_700)
  expect(cardFor(cards, 89_400)?.durationMs).toBe(90_000)
  expect(cardFor(cards, 50_000)).toBeUndefined()
})

test('턴 끝 줄은 기록이 없으면 엔진 그림 그대로', KO, async ($, on) => {
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Baked for 3s</Text>
  })
  const row = await $.ui.mount({
    plugin: 'desk-look',
    surface: 'terminal',
    component: 'TurnDuration',
    viewport: VIEWPORT,
    props: { word: 'Baked', durationMs: 3000 },
  })
  expect(await row.find({ type: 'Text', text: 'Baked for 3s' })).toBeDefined()
  expect(await row.find({ type: 'Text', text: /Edited/ })).toBeUndefined()
  await row.unmount()
})

import { ago, clip, filterSessions, groupSessions, herdrPaneOf, isGroupFolded, liveSessionsOf, numbered, sessionOf } from '../hooks/sessions'

test('세션 목록 읽기·묶기·표시', KO, async () => {
  setLang('ko')
  // 기록 파일 줄: 작업 폴더는 앞의 첫 값, 제목은 끝의 마지막 값
  const line = (fields: Record<string, string>) => JSON.stringify(fields)
  const file = (cwd: string, ...tail: Record<string, string>[]) => [line({ type: 'user', cwd }), ...tail.map(line)].join('\n')
  const read = (id: string, at: number, text: string) => sessionOf(id, at * 1000, text, text)
  const list = [
    read('ab12bc38-9375-438b-b199-90724fcb83cd', 1791456080, file('/home/u/repo', { type: 'ai-title', aiTitle: '옛 제목' }, { type: 'ai-title', aiTitle: 'Claude Code 모드 아이디어' })),
    read('83c92571-f2bb-4513-8111-da82e042ba8f', 1791455457, file('/home/u/other', { type: 'custom-title', customTitle: '직접 붙인 이름' }, { type: 'ai-title', aiTitle: '자동 제목' })),
    read('554bfb0b-ba79-4f30-bf0b-03fb9fcd7140', 1791455005, file('/home/u/repo', { type: 'last-prompt', lastPrompt: '마지막 프롬프트' })),
    read('65688aaf-c25e-4243-975e-4e7a106d7071', 1791455000, file('/home/u/repo')),
    read('not-a-session', 1, file('/x', { type: 'ai-title', aiTitle: 'x' })),
  ].filter(entry => entry !== null)
  expect(list[0]).toEqual({ id: 'ab12bc38-9375-438b-b199-90724fcb83cd', updatedAt: 1791456080000, cwd: '/home/u/repo', title: 'Claude Code 모드 아이디어' })
  expect(list.map(entry => entry.title)).toEqual(['Claude Code 모드 아이디어', '직접 붙인 이름', '마지막 프롬프트'])
  // 번호는 패널에 그리는 순서(현재 폴더 묶음이 먼저)
  expect(numbered(list, '/home/u/other', 8).map(entry => entry.title)).toEqual(['직접 붙인 이름', 'Claude Code 모드 아이디어', '마지막 프롬프트'])
  // 현재 세션은 번호에서 뺀다
  expect(numbered(list, '/home/u/other', 8, '83c92571-f2bb-4513-8111-da82e042ba8f').map(entry => entry.title)).toEqual(['Claude Code 모드 아이디어', '마지막 프롬프트'])
  const groups = groupSessions(list, '/home/u/other')
  expect(groups.map(group => [group.cwd, group.sessions.length])).toEqual([
    ['/home/u/other', 1],
    ['/home/u/repo', 2],
  ])
  expect(ago(0, 30_000)).toBe('방금')
  expect(ago(0, 5 * 60_000)).toBe('5분')
  expect(ago(0, 3 * 3_600_000)).toBe('3시간')
  expect(clip('가나다라마바', 7)).toBe('가나다…')
  expect(clip('짧음', 10)).toBe('짧음')
})

test('세션 목록: 기록 폴더를 훑어 최근 것부터, 큰 기록은 앞뒤만 읽는다', KO, async ($, on) => {
  const root = '/home/u/.claude/projects'
  const entry = (name: string, kind: 'file' | 'dir', size = 0, mtimeMs = 0) => ({ name, kind, size, mtimeMs, isLink: false })
  const small = [JSON.stringify({ cwd: '/home/u/repo' }), JSON.stringify({ aiTitle: '작은 기록' })].join('\n')
  const ran: string[][] = []
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.list', ($, e) => {
    const path = (e as { path?: string }).path
    if (path === root) return { value: [entry('-home-u-repo', 'dir'), entry('stray.jsonl', 'file')] } as never
    if (path === `${root}/-home-u-repo`)
      return {
        value: [
          entry('ab12bc38-9375-438b-b199-90724fcb83cd.jsonl', 'file', small.length, 2_000),
          entry('83c92571-f2bb-4513-8111-da82e042ba8f.jsonl', 'file', 50_000_000, 3_000),
          entry('memory', 'dir'),
        ],
      } as never
    throw new Error('ENOENT')
  })
  on('fs.read', () => ({ value: small }) as never)
  on('process.run', ($, e) => {
    ran.push([...e.argv])
    const stdout = e.argv[0] === 'head' ? JSON.stringify({ cwd: '/home/u/repo' }) : e.argv[0] === 'tail' ? `x"}\n${JSON.stringify({ customTitle: '큰 기록' })}\n` : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.cwd', () => ({ value: '/home/u/repo' }))
  on('session.id', () => ({ value: 'other' }))
  on('clock.now', () => ({ value: 4_000 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'desk-sessions', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-sessions', viewport: VIEWPORT, props: { title: '세션', isFocused: true, bodyColumns: 70 } as never })
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn.indexOf('큰 기록')).toBeGreaterThan(-1)
  expect(drawn.indexOf('큰 기록')).toBeLessThan(drawn.indexOf('작은 기록'))
  // 큰 기록만 head·tail 로, 셸 없이. 떠 있는 세션은 엔진 목록(claude agents --json)에서
  expect(ran.filter(argv => argv[0] !== 'claude').map(argv => argv[0]).sort()).toEqual(['head', 'tail'])
  expect(ran.find(argv => argv[0] === 'claude')).toEqual(['claude', 'agents', '--json'])
  await pane.unmount()
})

test('입력창 아래턱 글자', KO, () => {
  expect(chinLabel('cc-desktop-mod', 'main')).toBe(' \uf07b  cc-desktop-mod   \ue0a0 main')
  expect(chinLabel('scratch', null)).toBe(' \uf07b  scratch')
})

test('진행 표시 글자', KO, () => {
  expect(spinnerWord('tool-use', null)).toBe('Running')
  expect(spinnerWord('thinking', 'Compacting conversation')).toBe('Compacting conversation')
  expect(formatElapsed(12_400)).toBe('12s')
  expect(formatElapsed(149_000)).toBe('2m 29s')
  expect(formatElapsed(3_720_000)).toBe('1h 2m')
  expect([0, 500, 1000, 1500].map(spinnerDots)).toEqual(['●··', '·●·', '··●', '●··'])
})

import { computeTasks } from '../hooks/tasks'
import { callProcesses, childPids, clockOf, etimesOf, firstSentence, flowRows, ioBytes, isCallRoot, kindOf, laneCells, laneSegments, procView, sayStrip, statPid, statRow, statTicks, stepStrip, turnNarration, uptimeTicks } from '../hooks/activity'

test('할 일 목록 다시 세우기와 보일 줄', KO, () => {
  const ok = (id: string, result: unknown) => ({ tool_use_id: id, text: 'ok', isError: false, result })
  const list = computeTasks([
    {
      role: 'assistant',
      text: '',
      toolUses: [
        { tool_use_id: 'a', tool: 'TaskCreate', input: { subject: '아래턱', activeForm: '아래턱 그리는 중' } },
        { tool_use_id: 'b', tool: 'TaskCreate', input: { subject: '스피너' } },
        { tool_use_id: 'c', tool: 'TaskCreate', input: { subject: '버릴 일' } },
      ],
    },
    { role: 'user', text: '', toolUses: [], toolResults: [ok('a', { task: { id: '1', subject: '아래턱' } }), ok('b', { task: { id: '2', subject: '스피너' } }), ok('c', { task: { id: '3', subject: '버릴 일' } })] },
    {
      role: 'assistant',
      text: '',
      toolUses: [
        { tool_use_id: 'd', tool: 'TaskUpdate', input: { taskId: '1', status: 'completed' } },
        { tool_use_id: 'e', tool: 'TaskUpdate', input: { taskId: '2', status: 'in_progress' } },
        { tool_use_id: 'f', tool: 'TaskUpdate', input: { taskId: '3', status: 'deleted' } },
        { tool_use_id: 'g', tool: 'TaskUpdate', input: { taskId: '2', status: 'completed' } },
      ],
    },
    { role: 'user', text: '', toolUses: [], toolResults: [ok('d', {}), ok('e', {}), ok('f', {}), { tool_use_id: 'g', text: 'boom', isError: true }] },
  ])
  expect(list.map(item => [item.id, item.status])).toEqual([
    ['1', 'completed'],
    ['2', 'in_progress'],
  ])
  const todos = computeTasks([
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 't', tool: 'TodoWrite', input: { todos: [{ content: '가', status: 'completed', activeForm: '가 중' }, { content: '나', status: 'pending', activeForm: '나 중' }] } }] },
  ])
  expect(todos.map(item => item.subject)).toEqual(['가', '나'])
})

describe('진행 띠', () => {
  test('도구 호출 뒤에 claude 아래 생긴 셸만 뿌리로, 말단을 이름으로', () => {
    const rows = [
      { pid: 200, ppid: 100, etimes: 8000, name: 'node' }, // 먼저 떠 있던 MCP 서버
      { pid: 300, ppid: 100, etimes: 5, name: 'bash' },
      { pid: 301, ppid: 300, etimes: 4, name: 'ssh' },
      { pid: 302, ppid: 300, etimes: 2, name: 'tee' },
      { pid: 410, ppid: 100, etimes: 1, name: 'git' }, // desk-look 이 같은 때 띄운 git
    ]
    const tree = callProcesses(rows, 100, 6)
    expect(tree.pids).toEqual([300, 301, 302])
    expect(tree.leaves.map(row => row.name)).toEqual(['tee', 'ssh'])
    expect(callProcesses(rows, 100, 0).pids).toEqual([])
    expect(isCallRoot({ etimes: 1, name: 'git' }, 6)).toBe(false)
  })

  test('/proc 의 stat·io 를 읽는다(이름에 괄호·공백이 있어도)', () => {
    const stat = '4242 (my (odd) name) S 1 4242 4242 0 -1 4194304 10 0 0 0 750 71 0 0 20 0 1 0 100'
    expect(statTicks(stat)).toBe(821)
    expect(statPid(stat)).toBe(4242)
    expect(statRow(stat)).toEqual({ pid: 4242, name: 'my (odd) name', ppid: 1, startTicks: 100, ticks: 821 })
    expect(statRow('')).toBeNull()
    expect(uptimeTicks('12345.67 9999.00\n')).toBe(1234567)
    expect(uptimeTicks('')).toBeNull()
    expect(etimesOf(1234567, 1234067)).toBe(5)
    expect(childPids('300 301 \n')).toEqual([300, 301])
    expect(childPids('')).toEqual([])
    expect(statTicks('')).toBeNull()
    expect(statPid('')).toBeNull()
    expect(ioBytes('rchar: 100\nwchar: 23\nsyscr: 5\n')).toBe(123)
    expect(ioBytes('')).toBeNull()
  })

  test('CPU 는 두 번째 표본부터, 움직임이 없으면 조용해진 시각을 이어 간다', () => {
    const first = procView('java', null, { at: 0, ticks: 0, io: 0 }, null)
    expect(first).toEqual({ name: 'java', cpu: null, quietSince: null, isNetwork: false })
    const busy = procView('java', { at: 0, ticks: 0, io: 0 }, { at: 3000, ticks: 291, io: 0 }, first)
    expect(busy.cpu).toBe(97)
    expect(busy.quietSince).toBeNull()
    const still = procView('java', { at: 3000, ticks: 291, io: 0 }, { at: 6000, ticks: 291, io: 0 }, busy)
    expect(still.quietSince).toBe(3000)
    const stillMore = procView('java', { at: 6000, ticks: 291, io: 0 }, { at: 9000, ticks: 291, io: 0 }, still)
    expect(stillMore.quietSince).toBe(3000)
    // ssh 는 CPU 가 없어도 입출력이 있으면 움직이는 것이고, 네트워크 명령이라 경고 대상이 아니다
    const remote = procView('ssh', { at: 0, ticks: 5, io: 10 }, { at: 3000, ticks: 5, io: 80 }, null)
    expect(remote).toEqual({ name: 'ssh', cpu: 0, quietSince: null, isNetwork: true })
  })

  test('단계 칸: 넘치면 끝난 일·남은 일을 접고 하는 중인 일을 줄인다', () => {
    const item = (id: string, subject: string, status: 'completed' | 'in_progress' | 'pending') => ({ id, subject, status })
    const list = [item('1', '준비', 'completed'), item('2', '적재', 'completed'), item('3', '커서 재조회 검증', 'in_progress'), item('4', '정리', 'pending'), item('5', '보고', 'pending')]
    const label = () => '커서 재조회 검증 8m 2s'
    expect(stepStrip(list, 200, label).map(part => part.text)).toEqual(['✓ 준비', '✓ 적재', '◉ 커서 재조회 검증 8m 2s', '○ 정리', '○ 보고'])
    // 다 펴면 58칸, 끝난 일을 접으면 47칸, 남은 일까지 접으면 43칸
    expect(stepStrip(list, 50, label).map(part => part.text)).toEqual(['✓ 2', '◉ 커서 재조회 검증 8m 2s', '○ 정리', '○ 보고'])
    expect(stepStrip(list, 45, label).map(part => part.text)).toEqual(['✓ 2', '◉ 커서 재조회 검증 8m 2s', '○ 정리', '+1'])
    const narrow = stepStrip(list, 30, label)
    expect(narrow.map(part => part.kind)).toEqual(['completed', 'in_progress', 'pending', 'more'])
    expect(narrow[1]?.text.endsWith('…')).toBe(true)
    expect(narrow.reduce((sum, part) => sum + cellWidth(part.text) + 2, 0)).toBeLessThanOrEqual(30)
  })

  test('할 일 도구가 없으면 이번 턴의 가장 늦은 설명 글 첫 문장을 단계로', () => {
    const said = (text: string) => ({ role: 'assistant' as const, text, toolUses: [] })
    const prompt = (text: string) => ({ role: 'user' as const, text, toolUses: [] })
    const result = { role: 'user' as const, text: '', toolUses: [], toolResults: [{ tool_use_id: 'x', text: 'ok', isError: false, result: null }] }
    expect(turnNarration([prompt('지난 턴'), said('지난 설명.'), prompt('돌려 줘'), said('먼저 스키마를 볼게요.'), result, said(''), said('이제 **.12** 에서 돌릴게요. 1부는 스크래치에 넣어요.\n- 다음'), { ...said(''), toolUses: [{ tool_use_id: 'b1', tool: 'Bash', input: {} }] }])).toEqual({
      text: '이제 .12 에서 돌릴게요.',
      count: 2,
      ids: ['b1'],
    })
    expect(turnNarration([prompt('돌려 줘'), result])).toBeNull()
    expect(firstSentence('## 결과\n본문')).toBe('결과')
    expect(firstSentence('v1.2 버전을 올려요')).toBe('v1.2 버전을 올려요')
    expect(sayStrip('이제 돌릴게요.', 2, 80).map(part => part.text)).toEqual(['✓ 2', '◉ 이제 돌릴게요.'])
    expect(sayStrip('이제 .12 에서 돌릴게요. 아주 긴 설명이 이어집니다', 0, 20)[0]?.text.endsWith('…')).toBe(true)
  })

  test('하는 중인 할 일의 시간은 이번 턴부터 잰다(턴 사이에 쉰 시간은 빼고)', KO, async ($, on) => {
    let now = 0
    on('process.run', gitStub as never)
    on('fs.read', () => {
      throw new Error('ENOENT')
    })
    on('clock.now', () => ({ value: now }))
    on('clock.every', () => ({ value: { cancel: () => undefined } }) as never)
    on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
    on('session.start', ($, e) => e as never)
    on('command.register', () => ({ value: undefined as never }))
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine-band</Text>
    })
    on('session.messages', () => ({
      value: [
        { role: 'assistant', text: '', toolUses: [{ tool_use_id: 't', tool: 'TodoWrite', input: { todos: [{ content: '준비', status: 'completed' }, { content: '검증', status: 'in_progress', activeForm: '검증 중' }] } }] },
      ] as never,
    }))
    await $.session.start({ source: 'resume', cwd: '/repo', surface: 'terminal' } as never)
    await wait(30)
    now = 2 * 3600_000
    await $.turn.start({ text: '이어서', turnId: 't2' } as never)
    now += 5000
    // 턴 동안의 진행 띠는 스피너 아래에 그린다
    const band = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Spinner', viewport: VIEWPORT, props: { word: 'Running', message: null, suffix: '…', mode: 'tool-use' } as never })
    const drawn = JSON.stringify(await band.drawn())
    expect(drawn).toContain('검증 중 5s')
    expect(drawn).toContain('1/2')
    await band.unmount()
  })

  test('턴이 끝나면 윗줄은 끝난 단계로 bandAfterTurn 동안 남고 ✕ 로 닫는다', { options: { language: 'ko', bandAfterTurn: '60' } }, async ($, on) => {
    const timers: Array<{ ms: number; fire: () => void }> = []
    on('process.run', gitStub as never)
    on('fs.read', () => {
      throw new Error('ENOENT')
    })
    on('clock.now', () => ({ value: 1_000_000 }))
    on('clock.every', () => ({ value: { cancel: () => undefined } }) as never)
    on('clock.after', ($, e) => new Promise(resolve => timers.push({ ms: e.ms, fire: () => resolve({ value: undefined }) })) as never)
    on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
    on('turn.complete', () => ({ text: '끝' }) as never)
    on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }) as never)
    on('session.messages', () => ({
      value: [
        { role: 'user', text: '돌려 줘', toolUses: [] },
        { role: 'assistant', text: '스키마를 볼게요.', toolUses: [] },
        { role: 'assistant', text: '이제 돌릴게요. 길어요.', toolUses: [{ tool_use_id: 'b1', tool: 'Bash', input: {} }] },
      ] as never,
    }))
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine-band</Text>
    })
    const props = { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 96 } as never
    const above = async () => {
      const mounted = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'AbovePrompt', viewport: VIEWPORT, props })
      const drawn = JSON.stringify(await mounted.drawn())
      return { mounted, drawn }
    }
    await $.turn.start({ text: '돌려 줘', turnId: 't1' } as never)
    await $.session.append({ message: { type: 'assistant', role: 'assistant', content: [] } } as never)
    await wait(30)
    await $.turn.complete({ durationMs: 20_000, reason: 'answer', answer: '끝', turnId: 't1' } as never)
    let { mounted, drawn } = await above()
    expect(drawn).toContain('" 이제 돌릴게요."')
    expect(drawn).not.toContain('◉')
    expect(drawn).toContain('단계 2')
    expect(timers.some(timer => timer.ms === 60_000)).toBe(true)
    await mounted.press({ key: 'band-close' })
    await mounted.unmount()
    ;({ mounted, drawn } = await above())
    expect(drawn).not.toContain('이제 돌릴게요.')
    await mounted.unmount()
    // 시간이 다 되어도 닫힌다
    await $.turn.start({ text: '또', turnId: 't2' } as never)
    await $.session.append({ message: { type: 'assistant', role: 'assistant', content: [] } } as never)
    await wait(30)
    await $.turn.complete({ durationMs: 20_000, reason: 'answer', answer: '끝', turnId: 't2' } as never)
    ;({ mounted, drawn } = await above())
    expect(drawn).toContain('" 이제 돌릴게요."')
    await mounted.unmount()
    timers.filter(timer => timer.ms === 60_000).forEach(timer => timer.fire())
    await wait(30)
    ;({ mounted, drawn } = await above())
    expect(drawn).not.toContain('이제 돌릴게요.')
    await mounted.unmount()
  })

  test('bandAfterTurn: off 는 바로, keep 은 닫을 때까지, 기본 30초', () => {
    expect(bandStayMs({ bandAfterTurn: 'off' })).toBe(0)
    expect(bandStayMs({ bandAfterTurn: 'keep' })).toBe(Infinity)
    expect(bandStayMs({ bandAfterTurn: '10' })).toBe(10_000)
    expect(bandStayMs({})).toBe(30_000)
  })

  test('활동 패널 계산: 종류, 시간 막대, 흐름 묶기, 시각', () => {
    expect(kindOf('Grep')).toBe('explore')
    expect(kindOf('Write')).toBe('edit')
    expect(kindOf('Agent')).toBe('agent')
    expect(kindOf('Bash', 'cd x && bun test foo')).toBe('test')
    expect(kindOf('Bash', 'claude plugin test desk-look')).toBe('test')
    expect(kindOf('Bash', 'ssh .12 ./verify.sh')).toBe('command')
    expect(kindOf('mcp__x__y')).toBe('other')
    // 10칸: 0~2 탐색, 2~3 쉼(응답), 3~ 명령(아직 도는 중)
    const segments = laneSegments(
      [
        { kind: 'explore', start: 0, end: 1900 },
        { kind: 'command', start: 3000 },
      ],
      { start: 0, end: 10_000 },
      0,
      10_000,
      10,
    )
    expect(segments.map(segment => [segment.kind, segment.text])).toEqual([
      ['explore', '░░'],
      ['idle', '─'],
      ['command', '━━━━━━━'],
    ])
    // 긴 명령 도중의 짧은 편집은 명령에 묻히지 않는다
    expect(
      laneSegments(
        [
          { kind: 'command', start: 0, end: 10_000 },
          { kind: 'edit', start: 5000, end: 5100 },
        ],
        { start: 0, end: 10_000 },
        0,
        10_000,
        10,
      ).map(segment => [segment.kind, segment.text]),
    ).toEqual([
      ['command', '━━━━━'],
      ['edit', '▓'],
      ['command', '━━━━'],
    ])
    // 위임과 명령은 테마가 두 색을 같게 잡아도 모양으로 갈린다
    expect(
      laneSegments(
        [
          { kind: 'agent', start: 0, end: 4000 },
          { kind: 'command', start: 6000, end: 10_000 },
        ],
        { start: 0, end: 10_000 },
        0,
        10_000,
        10,
      ).map(segment => [segment.kind, segment.text]),
    ).toEqual([
      ['agent', '═════'],
      ['idle', '─'],
      ['command', '━━━━'],
    ])
    // 아무 줄도 살아 있지 않던 긴 시간은 한 칸으로 접고, 남은 칸을 일한 시간에 비례해 나눈다
    const cells = laneCells([{ start: 0, end: 10_000 }, { start: 250_000, end: 260_000 }], 0, 260_000, 21)
    expect(cells).toHaveLength(21)
    expect(cells.filter(cell => cell.gap !== undefined)).toEqual([{ from: 10_000, to: 250_000, gap: 240_000 }])
    expect(cells.findIndex(cell => cell.gap !== undefined)).toBe(10)
    expect(
      laneSegments([{ kind: 'explore', start: 0, end: 10_000 }], { start: 0, end: 10_000 }, 0, 260_000, 21, cells).map(segment => [segment.kind, segment.text]),
    ).toEqual([
      ['explore', '░'.repeat(10)],
      ['gap', '┆'],
      ['none', ' '.repeat(10)],
    ])
    // 짧은 쉼(1분 미만)이나 줄끼리 겹친 시간은 접지 않는다
    expect(laneCells([{ start: 0, end: 10_000 }, { start: 40_000, end: 50_000 }], 0, 50_000, 10).some(cell => cell.gap !== undefined)).toBe(false)
    expect(laneCells([{ start: 0, end: 10_000 }, { start: 5000, end: 600_000 }], 0, 600_000, 10).some(cell => cell.gap !== undefined)).toBe(false)
    // 살아 있던 구간 밖은 빈칸
    expect(laneSegments([], { start: 5000, end: 6000 }, 0, 10_000, 10).map(segment => [segment.kind, segment.text])).toEqual([
      ['none', '     '],
      ['idle', '──'],
      ['none', '   '],
    ])
    const log = {
      startedAt: 0,
      endedAt: null,
      says: [{ at: 100, text: '먼저 볼게요.' }, { at: 5000, text: '이제 돌릴게요.' }],
      events: [
        { id: '1', tool: 'Read', label: 'Read a.ts', kind: 'explore' as const, start: 100, end: 200 },
        { id: '2', tool: 'Grep', label: 'Grep x', kind: 'explore' as const, start: 300, end: 400 },
        { id: '3', tool: 'Read', label: 'Read b.ts', kind: 'explore' as const, start: 500, end: 600 },
        { id: '4', tool: 'Edit', label: 'a.ts', kind: 'edit' as const, start: 1000, end: 1100, added: 3, removed: 1 },
        { id: '5', tool: 'Edit', label: 'a.ts', kind: 'edit' as const, start: 1200, end: 1300, added: 2, removed: 0 },
        { id: '6', tool: 'Read', label: 'Read sub', kind: 'explore' as const, start: 1250, loop: 'agent-1' },
        { id: '7', tool: 'Bash', label: 'bun test', kind: 'test' as const, start: 2000, end: 4000, isError: true },
        { id: '8', tool: 'Bash', label: 'verify', kind: 'command' as const, start: 6000 },
      ],
    }
    expect(flowRows(log).map(row => [row.kind, row.text])).toEqual([
      ['say', '먼저 볼게요.'],
      ['explore', 'Read 2 · Grep'],
      ['edit', 'a.ts'],
      ['test', 'bun test'],
      ['say', '이제 돌릴게요.'],
      ['command', 'verify'],
    ])
    const rows = flowRows(log)
    expect(rows[2]).toMatchObject({ added: 5, removed: 1 })
    expect(rows[3]).toMatchObject({ ms: 2000, isError: true })
    expect(rows[5]).toMatchObject({ ms: null })
    expect(flowRows(log, 'agent-1').map(row => [row.kind, row.text])).toEqual([['explore', 'Read']])
    expect(outputFileOf('Command running in background with ID: b1. Output is being written to: /tmp/claude-1000/p/s/tasks/b1.output')).toBe('/tmp/claude-1000/p/s/tasks/b1.output')
    expect(outputFileOf('done')).toBeUndefined()
    expect(clockOf(125_000)).toBe('02:05')
    expect(clockOf(3_725_000)).toBe('1:02:05')
  })

  test('/desk-activity 패널: 턴의 막대·흐름·명령, 끝나면 지난 턴, 띠를 누르면 열림', KO, async ($, on) => {
    let now = 1_000_000
    let finish: () => void = () => undefined
    const gate = new Promise<void>(resolve => (finish = resolve))
    const opened: string[] = []
    on('process.run', gitStub as never)
    on('fs.read', () => {
      throw new Error('ENOENT')
    })
    on('clock.now', () => ({ value: now }))
    on('clock.every', () => ({ value: { cancel: () => undefined } }) as never)
    on('ui.open', ($, e) => {
      opened.push((e as { id: string }).id)
      return { value: { isPlaced: true } } as never
    })
    on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
    on('turn.complete', () => ({ text: '끝' }) as never)
    on('tool.call', async ($, e) => {
      if ((e as { tool: string }).tool === 'Bash') await gate
      return { result: { stdout: 'ok', stderr: '', interrupted: false } } as never
    })
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine-band</Text>
    })
    const paneProps = { title: '활동', isFocused: true, bodyColumns: 70 } as never
    let pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-activity', viewport: VIEWPORT, props: paneProps })
    expect(JSON.stringify(await pane.drawn())).toContain('아직')
    await pane.unmount()
    await $.turn.start({ text: '돌려 줘', turnId: 't1' } as never)
    await $.tool.call({ tool: 'Grep', pattern: 'cursor' } as never)
    now += 2000
    const ran = $.tool.call({ tool: 'Bash', command: 'bun test', description: '테스트 돌리기' } as never)
    await wait(20)
    now += 20_000
    pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-activity', viewport: VIEWPORT, props: paneProps })
    const running = JSON.stringify(await pane.drawn())
    expect(running).toContain('이번 턴 · 22s')
    expect(running).toContain('메인')
    expect(running).toContain('━')
    expect(running).toContain('테스트 돌리기')
    expect(running).toContain('▶ ')
    expect(running).toContain('Grep')
    // 범례의 기타(▪)는 그 턴에 기타 도구가 있을 때만
    expect(running).not.toContain('기타')
    await pane.unmount()
    // 띠의 "지금" 줄(턴 동안 스피너 아래)을 누르면 패널이 열린다
    const band = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Spinner', viewport: VIEWPORT, props: { word: 'Running', message: null, suffix: '…', mode: 'tool-use' } as never })
    await band.press({ key: 'band-now' })
    await wait(20)
    expect(opened).toContain('desk-activity')
    await band.unmount()
    finish()
    await ran
    await wait(20)
    await $.turn.complete({ durationMs: 25_000, reason: 'answer', answer: '끝', turnId: 't1' } as never)
    // 시계가 도는 동안 바뀐 기록은 다음 시계(2초)에 들어온다
    now += 2000
    pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-activity', viewport: VIEWPORT, props: paneProps })
    const ended = JSON.stringify(await pane.drawn())
    expect(ended).toContain('지난 턴 · 25s')
    expect(ended).toContain('✓ ')
    await pane.unmount()
    // 도구 없이 글로만 답한 턴(백그라운드 끝남 알림 등)은 앞 턴 기록을 덮지 않고, 그 사이 에이전트 호출은 앞 턴에 합친다
    await $.turn.start({ text: '알림', turnId: 't2' } as never)
    await $.tool.call({ tool: 'Grep', pattern: 'late', agentId: 'a9' } as never)
    // 턴이 도는 동안에도 메인 작업이 오기 전에는 지난 턴이 그대로 보인다(프롬프트를 치자마자 비지 않는다)
    pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-activity', viewport: VIEWPORT, props: paneProps })
    expect(JSON.stringify(await pane.drawn())).toContain('지난 턴 · 25s')
    await pane.unmount()
    now += 2000
    await $.turn.complete({ durationMs: 2000, reason: 'answer', answer: '알겠어요', turnId: 't2' } as never)
    pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-activity', viewport: VIEWPORT, props: paneProps })
    expect(JSON.stringify(await pane.drawn())).toContain('지난 턴 · 25s')
    await pane.unmount()
    // 다음 턴이 도구를 부르면 그 턴으로 바뀌고, 시간은 턴 시작부터 잰다
    await $.turn.start({ text: '또', turnId: 't3' } as never)
    now += 3000
    await $.tool.call({ tool: 'Glob', pattern: '*.ts' } as never)
    await $.tool.call({ tool: 'mcp__slack__read', channel: 'C1' } as never)
    pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-activity', viewport: VIEWPORT, props: paneProps })
    const third = JSON.stringify(await pane.drawn())
    expect(third).toContain('이번 턴 · 3s')
    expect(third).toContain('Glob')
    expect(third).not.toContain('테스트 돌리기')
    expect(third).toContain('▪')
    expect(third).toContain(' 기타 ')
    await pane.unmount()
  })

  test('/desk-activity 패널: 앞 턴에 띄워 아직 도는 에이전트도 그리고, 글로만 답한 턴 뒤에는 기록 턴이 끝난 지 얼마인지 붙인다', KO, async ($, on) => {
    let now = 1_000_000
    on('process.run', gitStub as never)
    on('fs.read', () => {
      throw new Error('ENOENT')
    })
    on('clock.now', () => ({ value: now }))
    on('clock.every', () => ({ value: { cancel: () => undefined } }) as never)
    const opened: string[] = []
    on('ui.open', ($, e) => {
      opened.push((e as { id: string }).id)
      return { value: { isPlaced: true } } as never
    })
    on('agent.list', () => ({
      value: [
        { id: 'a7', description: '경로 진행', type: 'general-purpose', name: 'route-agent', status: 'running' },
        { id: 'a8', description: '자원 누락', type: 'general-purpose', status: 'running' },
      ] as never,
    }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
    on('turn.complete', () => ({ text: '끝' }) as never)
    on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }) as never)
    // 에이전트는 턴보다 먼저 떠 있다
    await $.command.run({ command: 'desk-tasks', args: '' } as never)
    now += 60_000
    await $.turn.start({ text: '진행중이야?', turnId: 't1' } as never)
    await $.tool.call({ tool: 'Grep', pattern: 'x' } as never)
    await $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: 'a', new_string: 'b', agentId: 'a7' } as never)
    now += 7000
    await $.turn.complete({ durationMs: 7000, reason: 'answer', answer: '돌고 있어요', turnId: 't1' } as never)
    const paneProps = { title: '활동', isFocused: true, bodyColumns: 70 } as never
    let pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-activity', viewport: VIEWPORT, props: paneProps })
    let drawn = JSON.stringify(await pane.drawn())
    // 줄머리는 엔진 하단 목록처럼 이름, 이름이 없으면 설명뿐이다. 종류(general-purpose)는 에이전트마다 같아 구별이 안 된다
    expect(drawn).toContain('route-agent')
    expect(drawn).not.toContain('general-purpose')
    expect(drawn).toContain('경로 진행')
    expect(drawn).toContain('자원 누락')
    expect(drawn).not.toContain(' 전')
    // 에이전트의 호출은 그 줄을 눌러야 펼친다. 다시 누르면 접고, 행 끝 칩은 에이전트 패널을 연다
    expect(drawn).not.toContain('a.ts')
    await pane.press({ key: 'activity-agent-a7' })
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('a.ts')
    expect(drawn).toContain('▾')
    await pane.press({ key: 'activity-agent-a7' })
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).not.toContain('a.ts')
    await pane.press({ key: 'activity-agent-open-a7' })
    expect(opened).toContain('desk-tasks')
    await pane.unmount()
    // 글로만 답한 턴이 지나가도 기록은 t1 에 머물고, 끝난 지 얼마인지 붙는다
    now += 12 * 60_000
    await $.turn.start({ text: '남은 건?', turnId: 't2' } as never)
    await $.turn.complete({ durationMs: 3000, reason: 'answer', answer: '두 개', turnId: 't2' } as never)
    pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-activity', viewport: VIEWPORT, props: paneProps })
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('지난 턴 · 7s')
    expect(drawn).toContain(' · 12분 전')
    expect(drawn).toContain('route-agent')
    await pane.unmount()
  })

  test('/desk-activity 패널: 턴이 끝난 뒤 사람이 띄운 백그라운드 에이전트(/code-review)도 지난 턴 기록에 그린다', KO, async ($, on) => {
    let now = 1_000_000
    on('process.run', gitStub as never)
    on('fs.read', () => {
      throw new Error('ENOENT')
    })
    on('clock.now', () => ({ value: now }))
    on('clock.every', () => ({ value: { cancel: () => undefined } }) as never)
    on('ui.open', () => ({ value: { isPlaced: true } }) as never)
    let list: unknown[] = [{ id: 'old', description: '앞 턴 일', type: 'general-purpose', status: 'completed' }]
    on('agent.list', () => ({ value: list as never }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
    on('turn.complete', () => ({ text: '끝' }) as never)
    on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }) as never)
    // 앞 턴 전에 끝난 에이전트는 이 기록에 붙지 않는다
    await $.command.run({ command: 'desk-tasks', args: '' } as never)
    now += 60_000
    await $.turn.start({ text: '고쳐줘', turnId: 't1' } as never)
    await $.tool.call({ tool: 'Grep', pattern: 'x' } as never)
    now += 7000
    await $.turn.complete({ durationMs: 7000, reason: 'answer', answer: '고쳤어요', turnId: 't1' } as never)
    // 몇 분 뒤 사람이 /code-review 를 띄운다: 턴은 열리지 않고 에이전트만 돈다
    now += 4 * 60_000
    list = [...list, { id: 'cr', description: '/code-review medium', type: 'code-review', name: 'code-review', status: 'running' }]
    await $.tool.call({ tool: 'Read', file_path: '/r/b.ts', agentId: 'cr' } as never)
    // 모르는 에이전트의 첫 호출은 엔진 목록을 다시 읽어 기록에 넣는다(기다리지 않는 읽기)
    await wait(20)
    const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-activity', viewport: VIEWPORT, props: { title: '활동', isFocused: true, bodyColumns: 70 } as never })
    const drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('code-review')
    expect(drawn).not.toContain('앞 턴 일')
    // 턴과 에이전트 사이 4분은 한 칸으로 접혀 메인 막대가 눌리지 않는다
    expect(drawn).toContain('┆')
    expect(drawn).toContain('빈 시간 4m 0s')
    expect(drawn).toMatch(/─{20,}/)
    // 펼치면 그 호출이 턴 시작에서 잰 시각에 붙는다
    expect(drawn).not.toContain('04:07')
    await pane.press({ key: 'activity-agent-cr' })
    expect(JSON.stringify(await pane.drawn())).toContain('04:07')
    await pane.unmount()
  })

  test('/desk-activity 패널: 시계가 도는 동안 에이전트·호출 기록이 바뀌어도 다음 시계(2초)까지 그림이 그대로다', KO, async ($, on) => {
    let now = 1_000_000
    // 패널 시계(2초)는 fire() 할 때 한 번씩만 간다.
    let fire: () => void = () => undefined
    on('clock.every', async ($, e) => {
      if ((e as { ms: number }).ms === 2000) await new Promise<void>(resolve => (fire = resolve))
      return { value: undefined }
    })
    on('ui.open', () => ({ value: { isPlaced: true } }) as never)
    on('process.run', gitStub as never)
    on('fs.read', () => {
      throw new Error('ENOENT')
    })
    on('clock.now', () => ({ value: now }))
    on('agent.list', () => ({ value: [{ id: 'a7', description: '경로 진행', type: 'general-purpose', name: 'route-agent', status: 'running' }] as never }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
    on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }) as never)
    await $.command.run({ command: 'desk-tasks', args: '' } as never)
    await $.turn.start({ text: '돌려 줘', turnId: 't1' } as never)
    await $.tool.call({ tool: 'Grep', pattern: 'x' } as never)
    const paneProps = { title: '활동', isFocused: true, bodyColumns: 70 } as never
    const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-activity', viewport: VIEWPORT, props: paneProps })
    const first = JSON.stringify(await pane.drawn())
    expect(first).toContain('route-agent')
    // 에이전트가 걸음마다 쓰는 기록은 시계 사이에 그림을 바꾸지 않는다(막대와 시간이 1초에 몇 번씩 가지 않게)
    for (const file of ['a', 'b', 'c']) {
      now += 500
      await $.tool.call({ tool: 'Edit', file_path: `/r/${file}.ts`, old_string: 'a', new_string: 'b', agentId: 'a7' } as never)
      await wait(20)
      expect(JSON.stringify(await pane.drawn())).toBe(first)
    }
    // 펼침은 시계를 기다리지 않는다(시계 사이에는 지난 기록으로)
    await pane.press({ key: 'activity-agent-a7' })
    await wait(20)
    expect(JSON.stringify(await pane.drawn())).toContain('▾')
    // 시계가 가면 그동안의 호출과 시간이 한 번에 들어온다
    now += 500
    fire()
    await wait(20)
    const ticked = JSON.stringify(await pane.drawn())
    expect(ticked).not.toBe(first)
    expect(ticked).toContain('c.ts')
    await pane.unmount()
  })

  test('/desk-activity 패널: 사람이 패널을 잡고 있어 focus 가 거절돼도 에이전트 칩은 그 대화를 앞에 띄운다', KO, async ($, on) => {
    on('process.run', gitStub as never)
    on('fs.read', () => {
      throw new Error('ENOENT')
    })
    on('clock.now', () => ({ value: 1_000_000 }))
    on('clock.every', () => ({ value: { cancel: () => undefined } }) as never)
    on('agent.list', () => ({ value: [{ id: 'a7', description: '경로 진행', type: 'general-purpose', name: 'route-agent', status: 'running' }] as never }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
    on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }) as never)
    // 엔진처럼: 패널은 연 순서의 탭, 앞에 오는 것은 focus 가 받아들여질 때뿐이고 사람이 패널을 잡고 있으면 거절된다.
    // 잡고 있던 패널이 닫히면 키는 입력창으로 돌아간다.
    const up: string[] = []
    let front: string | null = null
    let held = false
    on('ui.open', ($, e) => {
      const pane = e as { id: string; focus?: true }
      if (!up.includes(pane.id)) up.push(pane.id)
      if (front === null || (pane.focus && !held)) front = pane.id
      return { value: undefined } as never
    })
    on('ui.close', ($, e) => {
      const id = (e as { id: string }).id
      up.splice(up.indexOf(id), 1)
      if (front === id) [front, held] = [up[up.length - 1] ?? null, false]
      return { value: undefined } as never
    })
    on('ui.panes', () => ({ value: up.map(id => ({ id, title: id, isShown: id === front, isFocused: id === front && held, isPlaced: true })) }) as never)
    await $.command.run({ command: 'desk-tasks', args: '' } as never)
    await $.turn.start({ text: '진행중이야?', turnId: 't1' } as never)
    await $.tool.call({ tool: 'Grep', pattern: 'x' } as never)
    await $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: 'a', new_string: 'b', agentId: 'a7' } as never)
    await $.command.run({ command: 'desk-activity', args: '' } as never)
    expect(front).toBe('desk-activity')
    const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-activity', viewport: VIEWPORT, props: { title: '활동', isFocused: true, bodyColumns: 70 } as never })
    held = true
    await pane.press({ key: 'activity-agent-open-a7' })
    expect(front).toBe('desk-tasks')
    // 활동 패널은 닫히지 않고 뒤 탭으로 남는다
    expect(up).toEqual(['desk-tasks', 'desk-activity'])
    await pane.unmount()
  })

  test('/desk-activity 패널: 창이 몸통보다 작으면 머리(막대·범례)는 고정하고 아래 줄만 스크롤한다', KO, async ($, on) => {
    let now = 1_000_000
    on('process.run', gitStub as never)
    on('clock.now', () => ({ value: now }))
    on('clock.every', () => ({ value: { cancel: () => undefined } }) as never)
    on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
    on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }) as never)
    await $.turn.start({ text: '돌려 줘', turnId: 't1' } as never)
    for (let index = 1; index <= 30; index++) {
      now += 1000
      await $.tool.call({ tool: 'Bash', command: `step ${index}`, description: `명령 ${String(index).padStart(2, '0')}` } as never)
    }
    // 머리 6줄(제목·빈 줄·메인 막대·축·범례·빈 줄), 몸통 9줄: 흐름 제목과 명령 01~08
    const props = { title: '활동', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 15 } } as never
    let pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-activity', viewport: VIEWPORT, props })
    let drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('이번 턴')
    expect(drawn).toContain('메인')
    expect(drawn).toContain('흐름')
    expect(drawn).toContain('명령 08')
    expect(drawn).not.toContain('명령 09')
    await pane.unmount()
    const scroll = (by: number) => $.ui.scroll({ component: 'Pane', requestId: 'desk-activity', offset: 0, by, bodyRows: 15, contentRows: 15, origin: { kind: 'person' } } as never)
    // 휠 세 칸: 머리는 그대로, 몸통은 명령 03~11
    for (let tick = 0; tick < 3; tick++) await scroll(1)
    pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-activity', viewport: VIEWPORT, props })
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('메인')
    expect(drawn).not.toContain('흐름')
    expect(drawn).not.toContain('명령 02')
    expect(drawn).toContain('명령 03')
    expect(drawn).toContain('명령 11')
    expect(drawn).not.toContain('명령 12')
    await pane.unmount()
    // 끝까지 내리면 늘어나는 줄을 따라간다
    await scroll(100)
    await scroll(100)
    await scroll(100)
    // 시계가 도는 동안 새 호출은 다음 시계(2초)에 들어온다
    now += 2000
    await $.tool.call({ tool: 'Bash', command: 'step 31', description: '명령 31' } as never)
    pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-activity', viewport: VIEWPORT, props })
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('메인')
    expect(drawn).toContain('명령 31')
    expect(drawn).not.toContain('명령 22')
    await pane.unmount()
  })

  test('긴 턴에는 도는 명령을 띄우고, 끝나면 접고 턴 끝 줄에 셈을 남긴다', KO, async ($, on) => {
    let now = 1_000_000
    let finish: () => void = () => undefined
    const gate = new Promise<void>(resolve => (finish = resolve))
    on('process.run', gitStub as never)
    on('fs.read', () => {
      throw new Error('ENOENT')
    })
    on('clock.now', () => ({ value: now }))
    on('clock.every', () => ({ value: { cancel: () => undefined } }) as never)
    on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
    on('turn.complete', () => ({ text: '돌렸어요' }) as never)
    on('tool.call', async () => {
      await gate
      return { result: { stdout: 'ok', stderr: '', interrupted: false } } as never
    })
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine-band</Text>
    })
    on('ui.render', { component: 'TurnDuration' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>Baked for 30s</Text>
    })
    const props = { hasSurvey: false, isWorking: true, maxRows: 30, bodyColumns: 96 } as never
    await $.turn.start({ text: '돌려 줘', turnId: 't1' } as never)
    const ran = $.tool.call({ tool: 'Bash', command: 'ssh .12 ./verify.sh', description: '커서 재조회 검증' } as never)
    await wait(20)
    // 10초 전에는 "지금" 줄이 없다
    now += 5000
    const spinnerProps = { word: 'Running', message: null, suffix: '…', mode: 'tool-use' } as never
    let band = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Spinner', viewport: VIEWPORT, props: spinnerProps })
    expect(JSON.stringify(await band.drawn())).not.toContain('커서 재조회 검증')
    await band.unmount()
    now += 15000
    band = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Spinner', viewport: VIEWPORT, props: spinnerProps })
    const running = JSON.stringify(await band.drawn())
    expect(running).toContain('커서 재조회 검증')
    expect(running).toContain(' · 20s')
    await band.unmount()
    finish()
    await ran
    await wait(20)
    band = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Spinner', viewport: VIEWPORT, props: spinnerProps })
    expect(JSON.stringify(await band.drawn())).toContain('응답 중')
    await band.unmount()
    await $.turn.complete({ durationMs: 30000, reason: 'answer', answer: '돌렸어요', turnId: 't1' } as never)
    // 턴이 끝나면 띠는 접힌다(입력창 위에도 남지 않는다)
    const after = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'AbovePrompt', viewport: VIEWPORT, props })
    expect(JSON.stringify(await after.drawn())).not.toContain('응답 중')
    await after.unmount()
    const row = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'TurnDuration', viewport: VIEWPORT, props: { word: 'Baked', durationMs: 30000 } })
    expect(JSON.stringify(await row.drawn())).toContain('명령 1')
    await row.unmount()
  })
})

import { answerOf, askNotice, numberProblem, parseQuestions } from '../hooks/ask'

test('질문 카드: 그릴 수 있는 질문과 답 모양', KO, () => {
  setLang('ko')
  const questions = parseQuestions([
    { question: '어디에?', header: '위치', multiSelect: false, options: [{ label: '왼쪽' }, { label: '오른쪽', description: '넓음' }] },
    { question: '무엇을?', header: '기능', multiSelect: true, options: [{ label: '가' }, { label: '나' }] },
    { question: '몇 개?', header: '개수', kind: 'number', multiSelect: false, options: [], min: 1, max: 5 },
  ])
  expect(questions?.map(item => item.kind)).toEqual(['choice', 'choice', 'number'])
  // 미리보기는 선택지에 담아 둔다(마우스를 올리면 보임)
  expect(parseQuestions([{ question: '?', header: '', multiSelect: false, options: [{ label: 'a', preview: 'x' }, { label: 'b' }] }])?.[0]?.options[0]?.preview).toBe('x')
  expect(parseQuestions([])).toBeNull()
  const [where, what, count] = questions ?? []
  if (!where || !what || !count) throw new Error('parse')
  expect(answerOf(where, ['왼쪽'], '')).toBe('왼쪽')
  expect(answerOf(where, ['왼쪽'], ' 가운데 ')).toBe('가운데')
  expect(answerOf(what, ['가', '나'], '다')).toBe('가, 나, 다')
  expect(numberProblem(count, '7')).toBe('5 이하여야 해요')
  expect(numberProblem(count, 'x')).toBe('숫자를 입력해 주세요')
  expect(numberProblem(count, '3')).toBeNull()
  expect(answerOf(count, [], '3')).toBe('3')
})

test('질문 도구 줄: 질문과 답', KO, () => {
  expect(summarize('AskUserQuestion', { questions: [{ question: 'Which color?' }] })).toBe('Which color?')
  expect(describeCalls([{ tool: 'AskUserQuestion', input: {}, isRunning: false, isErrored: false, isInterrupted: false }])).toBe('Asked a question')
  expect(askAnswer({ answers: { 'Which color?': 'Blue', 'Pet?': 'Dogs' } })).toBe('Blue · Dogs')
  expect(askAnswer('{"answers":{"q":"a"}}')).toBe('a')
  expect(askAnswer('oops')).toBeNull()
})

import { agentOf } from '../hooks/runs'
import { askHint, askRows, askTextRows, formatTokens, looksLikeMarkdown, textKey } from '../hooks/register'

test('서브에이전트 카드 요약과 묶음', KO, () => {
  const raw = {
    agentId: 'a1',
    status: 'completed',
    agentType: 'Explore',
    content: [{ type: 'text', text: '찾았어요' }],
    totalToolUseCount: 12,
    totalDurationMs: 62_000,
    totalTokens: 34_512,
    toolStats: { linesAdded: 3, linesRemoved: 1 },
  }
  const summary = agentOf(raw)
  expect(summary).toEqual({ status: 'completed', type: 'Explore', model: undefined, toolUses: 12, durationMs: 62_000, tokens: 34_512, added: 3, removed: 1, text: '찾았어요' })
  expect(agentOf({ agent: summary })).toEqual(summary)
  expect(agentOf('not json')).toBeNull()
  expect(formatTokens(34_512)).toBe('34.5k')
  expect(textKey('a')).toBe(textKey('a'))
  expect(textKey('a')).not.toBe(textKey('b'))
  // 에이전트는 다른 도구와 같은 묶음에 넣지 않고, 연달아 띄운 에이전트끼리 묶는다
  const use = (id: string, tool: string) => ({ tool_use_id: id, tool, input: {} })
  const runsOf = computeRuns([
    { role: 'assistant', text: '', toolUses: [use('r', 'Read'), use('a', 'Agent'), use('b', 'Agent'), use('g', 'Grep')] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'a', text: 'x', isError: false, result: raw }] },
  ])
  expect(runsOf.firstOf).toEqual({ r: 'r', a: 'a', b: 'a', g: 'g' })
  expect(runsOf.calls.a?.[0]?.output).toEqual({ agent: summary })
})

test('명령 출력 마크다운 판별과 질문 힌트', KO, async $ => {
  setLang('ko')
  expect(looksLikeMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')).toBe(true)
  expect(looksLikeMarkdown('# 제목\n본문')).toBe(true)
  expect(looksLikeMarkdown('Total cost: $0.12\nTotal duration: 3m')).toBe(false)
  expect(askHint({ kind: 'choice', multiSelect: true })).toContain('0 제출')
  const row = await $.ui.mount({
    plugin: 'desk-look',
    surface: 'terminal',
    component: 'CommandOutput',
    viewport: VIEWPORT,
    props: { command: 'mine', args: '', text: '| a | b |\n|---|---|\n| 1 | 2 |', isErrored: false },
  })
  expect(JSON.stringify(await row.drawn())).toContain('"borderStyle":"round"')
  await row.unmount()
})

test('모드 칩: 테마를 모르면 엔진 그림 그대로', KO, async ($, on) => {
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.modes.join(' & ')}</Text>
  })
  const row = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'SessionMode', viewport: VIEWPORT, props: { modes: ['focus'] } })
  expect(await row.find({ type: 'Text', text: 'focus' })).toBeDefined()
  await row.unmount()
})

test('diff 패널 되돌리기는 두 번 눌러야 git restore', KO, async ($, on) => {
  const ran: string[][] = []
  const PATCH = 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n'
  on('process.run', ($, e) => {
    ran.push([...e.argv])
    const stdout = e.argv.includes('--show-toplevel') ? '/repo\n' : e.argv[1] === 'diff' && e.argv[2] === 'HEAD' ? PATCH : e.argv.includes('--abbrev-ref') ? 'main\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'desk-diff', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-diff', viewport: VIEWPORT, props: { title: '변경 사항', isFocused: true } as never })
  expect(await pane.find({ type: 'Button', key: 'revert-a.txt' })).toBeDefined()
  await pane.press({ key: 'revert-a.txt' })
  expect(ran.some(argv => argv.includes('restore'))).toBe(false)
  expect(JSON.stringify(await pane.drawn())).toContain('다시 누르면 되돌려요')
  await pane.press({ key: 'revert-a.txt' })
  expect(ran.find(argv => argv.includes('restore'))).toEqual(['git', 'restore', '--source=HEAD', '--staged', '--worktree', '--', 'a.txt'])
  await pane.unmount()
})

test('떠 있는 세션 읽기와 묶음 기본 접힘', KO, () => {
  const live = liveSessionsOf(
    JSON.stringify([
      { id: '29a7e71e', kind: 'background', sessionId: 'done-1', state: 'done' },
      { pid: 1, kind: 'interactive', sessionId: 'win-1', status: 'idle' },
      { pid: 2, id: '183ecfa3', kind: 'background', sessionId: 'bg-1', status: 'busy', state: 'running' },
      { pid: 3, id: 'aa', kind: 'background', sessionId: 'bg-2', status: 'waiting' },
    ]),
  )
  expect(live).toEqual({
    'win-1': { kind: 'interactive', job: null, status: 'idle' },
    'bg-1': { kind: 'background', job: '183ecfa3', status: 'busy' },
    'bg-2': { kind: 'background', job: 'aa', status: 'waiting' },
  })
  expect(liveSessionsOf('')).toEqual({})
  const panes = JSON.stringify({ result: { panes: [{ pane_id: 'w1:p1', tab_id: 'w1:t1', workspace_id: 'w1', agent_session: { value: 'win-1' } }, { pane_id: 'w2:p1', tab_id: 'w2:t1', workspace_id: 'w2' }] } })
  expect(herdrPaneOf(panes, 'win-1')).toEqual({ workspace: 'w1', tab: 'w1:t1' })
  expect(herdrPaneOf(panes, 'none')).toBeNull()
  expect(herdrPaneOf('not json', 'win-1')).toBeNull()
  expect(isGroupFolded({}, '/a', '/a')).toBe(false)
  expect(isGroupFolded({}, '/b', '/a')).toBe(true)
  expect(isGroupFolded({ 'sessions:fold:/b': false }, '/b', '/a')).toBe(false)
})

test('세션 패널: 다른 폴더는 접힘, z 로 모두 펴기, 칩, 떠 있는 세션 누르기', KO, async ($, on) => {
  const root = '/home/u/.claude/projects'
  const id = (n: number) => `0000000${n}-0000-0000-0000-000000000000`
  const record = (cwd: string, title: string) => [JSON.stringify({ cwd }), JSON.stringify({ aiTitle: title })].join('\n')
  const files: Record<string, string> = {
    [id(1)]: record('/home/u/repo', '쉬는 백그라운드'),
    [id(2)]: record('/home/u/repo', '일하는 백그라운드'),
    [id(3)]: record('/home/u/repo', '다른 창 세션'),
    [id(4)]: record('/home/u/other', '다른 폴더 세션'),
  }
  const agents = [
    { pid: 1, id: 'job1', kind: 'background', sessionId: id(1), status: 'idle' },
    { pid: 2, id: 'job2', kind: 'background', sessionId: id(2), status: 'busy' },
    { pid: 3, kind: 'interactive', sessionId: id(3), status: 'busy' },
  ]
  const ran: string[][] = []
  const resumed: string[] = []
  const toasts: string[] = []
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.list', ($, e) => {
    const path = (e as { path?: string }).path
    if (path === root) return { value: [{ name: 'p', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] } as never
    return { value: Object.keys(files).map((name, index) => ({ name: `${name}.jsonl`, kind: 'file', size: 10, mtimeMs: 9 - index, isLink: false })) } as never
  })
  on('fs.read', ($, e) => ({ value: files[(e as { path: string }).path.split('/').pop()!.replace('.jsonl', '')] }) as never)
  on('process.run', ($, e) => {
    ran.push([...e.argv])
    const stdout = e.argv[1] === 'agents' ? JSON.stringify(agents) : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.run', { command: 'resume' }, ($, e) => {
    resumed.push(e.args)
    return { text: '' }
  })
  on('command.run', { command: 'cd' }, ($, e) => {
    resumed.push(`cd ${e.args}`)
    return { text: '' }
  })
  on('ui.toast', ($, e) => {
    toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('session.cwd', () => ({ value: '/home/u/repo' }))
  on('session.id', () => ({ value: 'current' }))
  // 넘어가기(50ms)는 바로 돌리고, 확인 문구가 사라지는 5초는 붙잡아 둔다
  on('clock.after', ($, e) => new Promise(resolve => {
    if (e.ms < 1000) resolve({ value: undefined })
  }) as never)
  on('clock.now', () => ({ value: 10_000 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'desk-sessions', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-sessions', viewport: VIEWPORT, props: { title: '세션', isFocused: true, bodyColumns: 70 } as never })
  let drawn = JSON.stringify(await pane.drawn())
  // 지금 폴더는 펴 있고 다른 폴더는 접혀 있다
  expect(drawn).toContain('쉬는 백그라운드')
  expect(drawn).not.toContain('다른 폴더 세션')
  expect(drawn).toContain('백그라운드')
  expect(drawn).toContain('작업 중')
  expect(drawn).toContain('다른 창')
  await pane.press({ key: 'sessions-fold-all' })
  drawn = JSON.stringify(await pane.drawn())
  expect(drawn).not.toContain('쉬는 백그라운드')
  await pane.press({ key: 'sessions-fold-all' })
  expect(JSON.stringify(await pane.drawn())).toContain('다른 폴더 세션')

  // 다른 창에서 열린 세션: 멈추지도 넘어가지도 않고 안내만
  await pane.press({ key: `open-${id(3)}` })
  expect(toasts.at(-1)).toContain('다른 창에서 열려')
  // 쉬는 백그라운드 세션: claude stop 뒤 /resume
  await pane.press({ key: `open-${id(1)}` })
  expect(ran).toContainEqual(['claude', 'stop', 'job1'])
  for (let tries = 0; tries < 50 && resumed.length === 0; tries++) await wait(10)
  expect(resumed).toEqual([id(1)])
  // 일하는 백그라운드 세션: 한 번은 확인만, 두 번째에 멈추고 가져온다
  await pane.press({ key: `open-${id(2)}` })
  expect(ran).not.toContainEqual(['claude', 'stop', 'job2'])
  expect(JSON.stringify(await pane.drawn())).toContain('다시 누르면 멈추고 가져와요')
  await pane.press({ key: `open-${id(2)}` })
  expect(ran).toContainEqual(['claude', 'stop', 'job2'])
  // 다른 폴더의 세션: /cd 로 옮긴 뒤 /resume
  resumed.length = 0
  await pane.press({ key: `open-${id(4)}` })
  for (let tries = 0; tries < 50 && resumed.length < 2; tries++) await wait(10)
  expect(resumed).toEqual(['cd /home/u/other', id(4)])
  await pane.unmount()
})

test('창 안의 /resume 으로 넘어와도 열려 있던 세션 패널을 다시 채운다', KO, async ($, on) => {
  const record = [JSON.stringify({ cwd: '/home/u/repo' }), JSON.stringify({ aiTitle: '넘어온 뒤에도 보임' })].join('\n')
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.list', ($, e) => {
    if ((e as { path?: string }).path === '/home/u/.claude/projects') return { value: [{ name: 'p', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] } as never
    return { value: [{ name: '00000001-0000-0000-0000-000000000000.jsonl', kind: 'file', size: 10, mtimeMs: 1, isLink: false }] } as never
  })
  on('fs.read', () => ({ value: record }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.cwd', () => ({ value: '/home/u/repo' }))
  on('session.id', () => ({ value: 'current' }))
  on('clock.now', () => ({ value: 10_000 }))
  on('ui.panes', () => ({ value: [{ id: 'desk-sessions', title: '세션', isShown: true, isFocused: false, isPlaced: true }] }) as never)
  on('clock.every', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined as never }))
  on('session.start', ($, e) => e as never)
  on('clock.after', ($, e) => new Promise(resolve => {
    if (e.ms < 1000) resolve({ value: undefined })
  }) as never)
  on('session.end', ($, e) => ({ sessionId: (e as { sessionId: string }).sessionId }) as never)
  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-sessions', viewport: VIEWPORT, props: { title: '세션', isFocused: true, bodyColumns: 70 } as never })
  const shows = async () => {
    for (let tries = 0; tries < 50; tries++) {
      if (JSON.stringify(await pane.drawn()).includes('넘어온 뒤에도 보임')) return true
      await wait(10)
    }
    return false
  }
  // 창 안의 /resume: 이 세션이 끝나고 session.start 없이 새 세션으로 이어진다
  await $.session.end({ reason: 'resume', sessionId: 'old', resume: { id: 'old' } } as never)
  expect(await shows()).toBe(true)
  await pane.unmount()
})

test('다른 창에서 열린 세션: herdr 안이면 그 작업공간·탭으로 옮긴다', KO, async ($, on) => {
  const id = '00000003-0000-0000-0000-000000000000'
  const ran: string[][] = []
  const toasts: string[] = []
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/u' : e.name === 'HERDR_ENV' ? '1' : undefined }))
  on('fs.list', ($, e) => {
    if ((e as { path?: string }).path === '/home/u/.claude/projects') return { value: [{ name: 'p', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] } as never
    return { value: [{ name: `${id}.jsonl`, kind: 'file', size: 10, mtimeMs: 1, isLink: false }] } as never
  })
  on('fs.read', () => ({ value: [JSON.stringify({ cwd: '/home/u/repo' }), JSON.stringify({ aiTitle: '옆 탭 세션' })].join('\n') }) as never)
  on('process.run', ($, e) => {
    ran.push([...e.argv])
    const stdout =
      e.argv[1] === 'agents'
        ? JSON.stringify([{ pid: 3, kind: 'interactive', sessionId: id, status: 'idle' }])
        : e.argv.join(' ') === 'herdr pane list'
          ? JSON.stringify({ result: { panes: [{ pane_id: 'w9:p1', tab_id: 'w9:t1', workspace_id: 'w9', agent_session: { value: id } }] } })
          : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', ($, e) => {
    toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('session.cwd', () => ({ value: '/home/u/repo' }))
  on('session.id', () => ({ value: 'current' }))
  on('clock.now', () => ({ value: 10_000 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'desk-sessions', args: '' } as never)
  await $.command.run({ command: 'desk-sessions', args: '1' } as never)
  expect(ran).toContainEqual(['herdr', 'workspace', 'focus', 'w9'])
  expect(ran).toContainEqual(['herdr', 'tab', 'focus', 'w9:t1'])
  expect(ran.some(argv => argv[1] === 'stop')).toBe(false)
  expect(toasts.at(-1)).toContain('herdr 탭으로 옮겼어요')
})

test('세션 검색', KO, () => {
  const entry = (id: string, title: string, cwd: string) => ({ id, title, cwd, updatedAt: 0 })
  const list = [entry('1', 'desk-look 아래턱', '/home/u/cc-desktop-mod'), entry('2', 'Fix login bug', '/home/u/app')]
  expect(filterSessions(list, '').length).toBe(2)
  expect(filterSessions(list, 'LOGIN').map(item => item.id)).toEqual(['2'])
  expect(filterSessions(list, 'desktop 아래턱').map(item => item.id)).toEqual(['1'])
  expect(filterSessions(list, 'nothing')).toEqual([])
})

// 테스트 환경의 실제 시간 대기(타입 정의에 setTimeout 이 없어 globalThis 로).
const wait = (ms: number) =>
  new Promise<void>(resolve => (globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => void }).setTimeout(resolve, ms))

// diff 패널은 접힌 목록으로 열린다: 내용을 보려는 테스트는 z(모두 펴기)나 그 파일 머리 띠를 눌러 편다.
type Pressable = { find: (query: never) => Promise<unknown>; press: (target: { key: string }) => Promise<unknown> }
const openAll = async (pane: Pressable, key = 'fold-all') => {
  for (let tries = 0; tries < 50 && !(await pane.find({ type: 'Button', key } as never)); tries++) await wait(10)
  await pane.press({ key })
}

test('질문 카드: 도구 호출 → 입력창 위 카드 → 버튼 → 결과', KO, async ($, on) => {
  let answer: (stdout: string) => void = () => undefined
  const waiting = new Promise<string>(resolve => (answer = resolve))
  const notified: unknown[] = []
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('clock.now', () => ({ value: Date.now() }))
  on('ui.notify', ($, e) => {
    notified.push(e)
    return { value: { isSent: true, channel: 'ghostty' } }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine-band</Text>
  })
  on('process.run', async ($, e) => {
    const done = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'mktemp') return done('/tmp/ask-test\n')
    // 훅은 파이프를 cat 으로 읽으며 기다리고, 카드는 tee 로 답을 넣는다
    if (e.argv[0] === 'cat') return done(await waiting)
    // 카드를 건드리면(입력·지우기) touched 를 쓴다
    if (e.argv[0] === 'tee' && e.argv[1] !== '/tmp/ask-test/touched') {
      expect(e.argv[1]).toBe('/tmp/ask-test/answer')
      answer(e.init?.stdin ?? '')
      return done('')
    }
    return done('')
  })
  const call = $.tool.call({
    tool: 'AskUserQuestion',
    questions: [{ question: '어느 쪽?', header: '방향', multiSelect: false, options: [{ label: '왼쪽' }, { label: '오른쪽', description: '넓음' }] }],
  } as never)
  const band = await $.ui.mount({
    plugin: 'desk-look',
    surface: 'terminal',
    component: 'AbovePrompt',
    viewport: VIEWPORT,
    props: { hasSurvey: false, isWorking: true, maxRows: 30, bodyColumns: 96 } as never,
  })
  // 카드가 그려질 때까지(도구 훅이 상태를 쓰면 다시 그린다)
  for (let tries = 0; tries < 50 && !(await band.find({ type: 'Text', text: '어느 쪽?' })); tries++) await wait(10)
  const drawn = JSON.stringify(await band.drawn())
  expect(await band.find({ type: 'Text', text: '어느 쪽?' })).toBeDefined()
  const key = /"key":"(ask-[^"]+-1)"/.exec(drawn)?.[1]
  expect(key).toBeDefined()
  // 지우기: 직접 입력칸을 비운 칸을 새 키로 그린다
  const text = /"key":"(ask-text-[^"]+)"/.exec(drawn)?.[1] ?? ''
  await band.input({ key: text, text: '붙여 넣은\n긴 글', kind: 'change' })
  const clear = /"key":"(ask-clear-[^"]+)"/.exec(drawn)?.[1] ?? ''
  await band.press({ key: clear })
  const cleared = JSON.stringify(await band.find({ type: 'Input' }))
  expect(cleared).toContain('"value":""')
  expect(cleared).not.toContain(`"key":"${text}"`)
  // 질문이 막 떠서 0.35초 동안은 숫자 키를 버리므로 기다렸다 누른다
  await wait(400)
  await band.press({ key: key ?? '' })
  const result = (await call) as { result?: { answers?: Record<string, string> } }
  expect(result.result?.answers).toEqual({ '어느 쪽?': '오른쪽' })
  // 엔진 창이 보내던 알림을 카드가 대신 보낸다
  expect(notified).toEqual([{ text: '어느 쪽?', title: 'Claude 질문' }])
  // 선택지 설명은 버튼 안에 들어가 줄 전체가 눌린다
  expect(drawn).toContain('넓음')
  await band.unmount()
})

test('질문 카드: Remote Control 이 붙은 세션은 엔진 창에 맡긴다', KO, async ($, on) => {
  const scripts: (readonly string[])[] = []
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('clock.now', () => ({ value: 0 }))
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)
  on('tool.call', () => ({ result: 'engine' }) as never)
  const readPaths: string[] = []
  bridgedSession(on, readPaths)
  on('process.run', ($, e) => {
    scripts.push(e.argv)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const result = await $.tool.call({
    tool: 'AskUserQuestion',
    questions: [{ question: '어느 쪽?', header: '방향', multiSelect: false, options: [{ label: '왼쪽' }, { label: '오른쪽' }] }],
  } as never)
  expect(result).toEqual({ result: 'engine' })
  // 세션 상태 파일을 읽었고, 카드용 임시 폴더는 만들지 않았다
  expect(readPaths).toEqual(['/home/u/.claude/sessions/4242.json'])
  expect(scripts.some(argv => argv[0] === 'mktemp')).toBe(false)

  // 마지막 입력이 앱(bridge)에서 왔어도 엔진 창
  await $.prompt.submit({ text: '폰에서', origin: { kind: 'bridge' }, wait: false } as never)
  expect(await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: '또?', header: '', options: [{ label: 'a' }] }] } as never)).toEqual({ result: 'engine' })
  expect(scripts.some(argv => argv[0] === 'mktemp')).toBe(false)
})

test('질문 카드: 세션 상태 파일이 없어도 앱(bridge)에서 입력했으면 엔진 창', KO, async ($, on) => {
  const scripts: (readonly string[])[] = []
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('clock.now', () => ({ value: 0 }))
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)
  on('tool.call', () => ({ result: 'engine' }) as never)
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.list', () => ({ value: [] }) as never)
  on('process.run', ($, e) => {
    scripts.push(e.argv)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.prompt.submit({ text: '폰에서', origin: { kind: 'bridge' }, wait: false } as never)
  expect(await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: '어느 쪽?', header: '', options: [{ label: 'a' }] }] } as never)).toEqual({ result: 'engine' })
  expect(scripts.some(argv => argv[0] === 'mktemp')).toBe(false)
})

// Remote Control 이 붙은 세션: 세션 상태 파일(~/.claude/sessions/*.json)에 이 세션 id 와 bridgeSessionId 가 있다.
// other 는 그 밖의 파일 읽기(없으면 undefined 로 실패).
function bridgedSession(on: On, readPaths: string[] = [], other: (path: string) => string | undefined = () => undefined) {
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.list', ($, e) =>
    (e as { path?: string }).path === '/home/u/.claude/sessions'
      ? ({ value: [{ name: '4242.json', kind: 'file', size: 1, mtimeMs: 0, isLink: false }, { name: 'other.json', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] } as never)
      : ({ value: [] } as never),
  )
  on('fs.read', ($, e) => {
    const path = (e as { path: string }).path
    if (!path.startsWith('/home/u/.claude/sessions/')) {
      const text = other(path)
      if (text === undefined) throw new Error('ENOENT')
      return { value: text } as never
    }
    readPaths.push(path)
    return { value: JSON.stringify({ pid: 4242, sessionId: 'sess-1', bridgeSessionId: 'cse_1' }) } as never
  })
}

// Remote Control 세션에서 마지막 입력이 터미널이면 카드를 띄운다. 기다림은 5초씩 돌아오고(시계를 5초씩 민다),
// 카드를 1분 동안 건드리지 않으면 엔진 창으로 넘긴다. pressAt 번째 기다림에서 카드를 누른다.
async function remoteAsk($: Parameters<TestBody>[0], on: On, pressAt: number | null) {
  let now = 1_000_000
  let rounds = 0
  let touched = false
  // pressAt 번째 기다림은 테스트가 카드를 누를 때까지 붙잡아 둔다
  let reached: () => void = () => undefined
  let release: () => void = () => undefined
  const atPress = new Promise<void>(resolve => (reached = resolve))
  const pressed = new Promise<void>(resolve => (release = resolve))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('clock.now', () => ({ value: now }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'ghostty' } }))
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)
  on('tool.call', () => ({ result: 'engine' }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine-band</Text>
  })
  // 카드가 건드림 파일(touched)에 매번 다른 글을 쓴다. 없을 때 읽으면 실패.
  let touches = 0
  bridgedSession(on, [], path => (path === '/tmp/ask-remote/touched' && touches > 0 ? String(touches) : undefined))
  on('process.run', async ($, e) => {
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'mktemp') return out('/tmp/ask-remote\n')
    if (e.argv[0] === 'tee' && e.argv[1] === '/tmp/ask-remote/touched') {
      touched = true
      touches++
      return out('')
    }
    if (e.argv[0] !== 'cat') return out('')
    // 5초씩 기다리고, 시간이 다 되면 cat 이 죽어 호출이 거절된다
    expect(e.init?.timeoutMs).toBe(5000)
    rounds++
    if (rounds === pressAt) {
      reached()
      await pressed
    }
    now += 5000
    throw new Error('timed out')
  })
  await $.prompt.submit({ text: '터미널에서', origin: { kind: 'composer' }, wait: false } as never)
  const band = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'AbovePrompt', viewport: VIEWPORT, props: { hasSurvey: false, isWorking: true, maxRows: 30, bodyColumns: 96 } as never })
  const call = $.tool.call({
    tool: 'AskUserQuestion',
    questions: [{ question: '어느 쪽?', header: '방향', multiSelect: true, options: [{ label: '왼쪽' }, { label: '오른쪽' }] }],
  } as never)
  if (pressAt !== null) {
    await atPress
    const key = /"key":"(ask-[^"]+-1)"/.exec(JSON.stringify(await band.drawn()))?.[1]
    await band.press({ key: key ?? '' })
    // 고른 것이 카드에 반영될 때까지
    for (let tries = 0; tries < 50 && !touched; tries++) await wait(10)
    expect(JSON.stringify(await band.drawn())).toContain('☑')
    release()
  }
  const result = await call
  expect(await band.find({ type: 'Text', text: '어느 쪽?' })).toBeUndefined()
  await band.unmount()
  return { result, rounds }
}

test('질문 카드: Remote Control 세션이라도 터미널에서 입력했으면 카드, 1분 손대지 않으면 엔진 창으로', KO, async ($, on) => {
  expect(await remoteAsk($, on, null)).toEqual({ result: { result: 'engine' }, rounds: 12 })
})

test('질문 카드: 넘기기 전에 카드를 건드리면 1분을 다시 센다', KO, async ($, on) => {
  // 6번째 기다림(30초)에 누르면 그 뒤로 1분: 6 + 12 = 18번
  expect(await remoteAsk($, on, 6)).toEqual({ result: { result: 'engine' }, rounds: 18 })
})

test('아래턱: 저장소·브랜치·diff 칩을 다른 밴드 아래에', KO, async ($, on) => {
  const PATCH = 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n-a\n+b\n+c\n'
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', ($, e) => {
    const stdout = e.argv.includes('--show-toplevel') ? '/src/myrepo\n' : e.argv[1] === 'diff' && e.argv[2] === 'HEAD' ? PATCH : e.argv.includes('--abbrev-ref') ? 'feature/x\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine-band</Text>
  })
  await $.command.run({ command: 'desk-diff', args: '' } as never)
  const band = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'AbovePrompt', viewport: VIEWPORT, props: { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 96 } as never })
  const drawn = JSON.stringify(await band.drawn())
  expect(drawn.indexOf('engine-band')).toBeLessThan(drawn.indexOf('myrepo'))
  expect(drawn).toContain('feature/x')
  expect(drawn).toContain(' +2 ')
  expect(drawn).toContain(' −1 ')
  await band.unmount()
})

test('질문 카드 줄 수: 모자라면 간단한 모양', KO, () => {
  const two = { kind: 'choice', multiSelect: false, options: [{}, {}] }
  expect(askRows(two, false)).toBe(2 + 2 + 1 + 2 + 3)
  expect(askRows(two, true)).toBe(2 + 1 + 2)
  expect(askRows({ ...two, multiSelect: true }, true)).toBe(6)
  expect(askRows({ ...two, options: [{ preview: 'x' }, {}] }, false)).toBe(11)
  // 직접 입력칸은 두 줄에서 쓴 줄 수만큼 자라고(4줄까지), 숫자는 한 줄
  expect(askRows(two, false, 3)).toBe(askRows(two, false) + 2)
  expect(askTextRows(two, '')).toBe(2)
  expect(askTextRows(two, 'a\nb\nc')).toBe(3)
  expect(askTextRows(two, 'a\nb\nc\nd\ne\nf')).toBe(4)
  expect(askTextRows({ kind: 'number' }, 'a\nb')).toBe(1)
})

test('에이전트 메시지 줄: 누르면 그 자리에서 마크다운으로 펼침', KO, async $ => {
  const text = 'Two lines mention it:\n\n- L19 table row\n- L59 note'
  const row = await $.ui.mount({
    plugin: 'desk-look',
    surface: 'terminal',
    component: 'UserMessage',
    viewport: VIEWPORT,
    props: { text, origin: { kind: 'unclassified' }, isExpanded: false, from: { name: '@Explore' } } as never,
  })
  expect(await row.find({ type: 'Text', text: /Two lines mention it/ })).toBeDefined()
  expect(await row.find({ type: 'Text', text: /L19 table row/ })).toBeUndefined()
  const key = /"key":"(peer-[^"]+)"/.exec(JSON.stringify(await row.drawn()))?.[1]
  expect(key).toBeDefined()
  await row.press({ key: key ?? '' })
  expect(await row.find({ type: 'Text', text: /L19 table row/ })).toBeDefined()
  await row.unmount()
})

import { bubbleSide } from '../hooks/register'

test('말풍선 위치 설정: 기본 왼쪽', KO, () => {
  expect(bubbleSide({})).toBe('left')
  expect(bubbleSide({ bubbleSide: 'right' })).toBe('right')
  expect(bubbleSide({ bubbleSide: 'weird' })).toBe('left')
})

const PROMPT = { text: '안녕', origin: { kind: 'composer' }, isExpanded: false } as never

test('말풍선 왼쪽(기본)', KO, async $ => {
  const row = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'UserMessage', viewport: VIEWPORT, props: PROMPT })
  expect(JSON.stringify(await row.drawn())).toContain('"alignItems":"flex-start"')
  await row.unmount()
})

test('말풍선 오른쪽 설정', { options: { bubbleSide: 'right', language: 'ko' } }, async $ => {
  const row = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'UserMessage', viewport: VIEWPORT, props: PROMPT })
  expect(JSON.stringify(await row.drawn())).toContain('"alignItems":"flex-end"')
  await row.unmount()
})

import { barRuns, cacheShares, chartColumns, chartRows, chartTop, columnOf, compactionPoints, contextChipMode, hhmm, meterBar, meterLevel, resetIn, ring, showsChip, sparkline, toBreakdown, turnCosts } from '../hooks/usage'

const USAGE = (percent: number) => ({
  startedAt: 0,
  context: {
    tokens: percent * 2000,
    window: 200000,
    percent,
    breakdown: {
      categories: [
        { name: 'System prompt', tokens: 3100, color: 'promptBorder', isDeferred: false, kind: 'used' },
        { name: 'Messages', tokens: 80000, color: 'claude', isDeferred: false, kind: 'used' },
        { name: 'MCP tools', tokens: 9000, color: 'subtle', isDeferred: true, kind: 'deferred' },
        { name: 'Free space', tokens: 100000, color: 'inactive', isDeferred: false, kind: 'free' },
      ],
      totalTokens: percent * 2000,
      maxTokens: 200000,
      rawMaxTokens: 200000,
      autocompactSource: 'model-default',
      percentage: percent,
      gridRows: [],
      model: 'opus-5-5',
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      autoCompactThreshold: 167000,
    },
  },
  rateLimits: [{ kind: 'five_hour', percentUsed: 2, resetsAt: new Date(4 * 3600_000 + 7 * 60_000).toISOString() }],
  cost: { usd: 1.5 },
})

test('컨텍스트 칩 판정과 글자', KO, () => {
  setLang('ko')
  expect(contextChipMode({})).toBe('auto')
  expect(contextChipMode({ contextChip: 'off' })).toBe('off')
  expect(contextChipMode({ contextChip: 'weird' })).toBe('auto')
  expect(showsChip('auto', 49)).toBe(false)
  expect(showsChip('auto', 50)).toBe(true)
  expect(showsChip('always', 3)).toBe(true)
  expect(showsChip('off', 99)).toBe(false)
  expect(showsChip('always', null)).toBe(false)
  expect([0, 25, 50, 75, 100].map(ring).join('')).toBe('○◔◑◕●')
  expect([10, 75, 90].map(meterLevel)).toEqual(['muted', 'warning', 'danger'])
  expect(meterBar(50, 4)).toBe('▰▰▱▱')
  expect(resetIn(new Date(4 * 3600_000 + 7 * 60_000).toISOString(), 0)).toBe('4시간 7분')
  expect(resetIn(new Date(29 * 3600_000).toISOString(), 0)).toBe('1일 5시간')
  expect(resetIn(new Date(0).toISOString(), 60_000)).toBe(null)
  expect(resetIn(null, 0)).toBe(null)
  expect([950, 62100, 1_000_000, 1_250_000].map(formatTokens)).toEqual(['950', '62.1k', '1M', '1.3M'])
})

test('컨텍스트 칩: 반을 넘기면 아래턱 옆에, 누르면 패널', KO, async ($, on) => {
  const opened: string[] = []
  const asked: unknown[] = []
  on('session.usage', ($, e) => {
    asked.push(e)
    return { value: USAGE(62) as never }
  })
  on('clock.now', () => ({ value: 0 }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine-band</Text>
  })
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  await $.command.run({ command: 'desk-context', args: '' } as never)
  expect(asked).toEqual([{ breakdown: 'summary' }])
  const band = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'AbovePrompt', viewport: VIEWPORT, props: { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 96 } as never })
  expect(await band.find({ type: 'Button', key: 'context-chip' })).toBeDefined()
  expect(JSON.stringify(await band.drawn())).toContain('◑')
  await band.press({ key: 'context-chip' })
  expect(opened).toEqual(['desk-context', 'desk-context'])
  await band.unmount()

  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-context', viewport: VIEWPORT, props: { title: '컨텍스트', isFocused: true } as never })
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('124.0k / 200.0k 토큰')
  expect(drawn).toContain('자동 압축 167.0k')
  expect(drawn).toContain('System prompt')
  expect(drawn).toContain('Free space')
  expect(drawn).not.toContain('MCP tools')
  expect(drawn).toContain('5시간')
  expect(drawn).toContain('4시간 7분 뒤 초기화')
  expect(drawn).toContain('$1.50')
  await pane.unmount()
})

test('컨텍스트 칩: 반이 안 되면 auto 는 숨김, always 는 보임', KO, async ($, on) => {
  on('session.usage', () => ({ value: USAGE(30) as never }))
  on('clock.now', () => ({ value: 0 }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine-band</Text>
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'desk-context', args: '' } as never)
  const band = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'AbovePrompt', viewport: VIEWPORT, props: { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 96 } as never })
  expect(await band.find({ type: 'Button', key: 'context-chip' })).toBeUndefined()
  await band.unmount()
})

test('컨텍스트 칩 always 설정', { options: { contextChip: 'always', language: 'ko' } }, async ($, on) => {
  on('session.usage', () => ({ value: USAGE(30) as never }))
  on('clock.now', () => ({ value: 0 }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine-band</Text>
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'desk-context', args: '' } as never)
  const band = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'AbovePrompt', viewport: VIEWPORT, props: { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 96 } as never })
  expect(await band.find({ type: 'Button', key: 'context-chip' })).toBeDefined()
  await band.unmount()
})

test('컨텍스트 막대·그래프 순수 함수', () => {
  // 칸 안에서 조각이 바뀌면 왼쪽 조각 색 글자를 오른쪽 조각 바탕에(1/8 칸)
  expect(barRuns([{ value: 3, color: 'a' }, { value: 5, color: 'b' }], 8, 1)).toEqual([{ text: '▍', color: 'a', background: 'b' }])
  // 같은 색이 이어지면 한 덩어리, 남은 자리는 빈칸
  expect(barRuns([{ value: 50, color: 'a' }], 100, 4)).toEqual([
    { text: '██', color: 'a', background: null },
    { text: '  ', color: null, background: null },
  ])
  // 선 조각(─)이 오른쪽이면 바탕 없이 1/8 칸, 선 조각에서 시작하는 칸은 더 많이 덮은 쪽으로
  expect(barRuns([{ value: 3, color: 'a' }, { value: 5, color: 'b', glyph: '─' }], 8, 1)).toEqual([{ text: '▍', color: 'a', background: null }])
  expect(barRuns([{ value: 1, color: 'a', glyph: '─' }, { value: 3, color: 'b', glyph: '┄' }], 4, 1)).toEqual([{ text: '┄', color: 'b', background: null }])
  // 0 이 아닌 조각은 적어도 1/8 칸
  expect(barRuns([{ value: 1, color: 'a' }], 1000, 2)[0]).toEqual({ text: '▏', color: 'a', background: null })
  // 조각 합이 total 보다 크면 합에 맞춘다
  expect(barRuns([{ value: 6, color: 'a' }, { value: 6, color: 'b' }], 10, 2).map(run => run.text).join('')).toBe('██')

  // 턴이 칸보다 적으면 폭을 나눠 채우고, 많으면 칸마다 가장 높은 값
  expect(chartColumns([10, 20, 30], 5)).toEqual([10, 10, 20, 20, 30])
  expect(chartColumns([10, 50, 20, 40], 2)).toEqual([50, 40])
  expect(chartColumns([], 4)).toEqual([])
  expect(columnOf(3, 4, 2)).toBe(1)
  expect(columnOf(2, 3, 10)).toBe(6)
  // 위 끝은 가장 높은 점이 드는 가장 낮은 눈금
  expect([chartTop([3, 6]), chartTop([20]), chartTop([45, null]), chartTop([80]), chartTop([])]).toEqual([10, 25, 50, 100, 10])
  expect(chartRows([100, 50, 0, null], 2, 100, null)).toEqual([
    [{ text: '█', level: 'danger' }, { text: '   ', level: 'empty' }],
    [{ text: '█', level: 'fill' }, { text: '█', level: 'muted' }, { text: '  ', level: 'empty' }],
  ])
  // 자동 압축 높이의 빈칸은 ┈
  expect(chartRows([50], 2, 100, 80)[0]).toEqual([{ text: '┈', level: 'guide' }])
  expect(sparkline([0, 1, 2])).toBe('▁▄█')

  const point = (at: number, costUsd: number | null) => ({ at, tokens: null, percent: null, costUsd, turn: null })
  const costs = turnCosts([point(1, 0.1), point(2, 0.25), point(3, null), point(4, 0.5)])
  expect(costs.length).toBe(1)
  expect(Math.round((costs[0] ?? 0) * 100)).toBe(15)
  expect(compactionPoints([point(10, 0), point(20, 0), point(30, 0)], [{ at: 15, trigger: 'auto', before: null, after: null }, { at: 40, trigger: 'manual', before: null, after: null }])).toEqual([1])
  expect(cacheShares({ input: 10, cacheRead: 900, cacheWrite: 90, output: 5 })).toEqual({ read: 90, write: 9, fresh: 1 })
  expect(cacheShares({ input: 0, cacheRead: 0, cacheWrite: 0, output: 5 })).toBe(null)

  // MCP 도구는 서버별로, 필요할 때 싣는 도구는 토큰 없이 수만
  const raw = RICH(40, 1)
  const detail = toBreakdown(raw as never, 0)
  expect(detail?.mcpServers).toEqual([
    { name: 'linear', tools: 2, onDemand: 0, tokens: 6200 },
    { name: 'figma', tools: 1, onDemand: 1, tokens: 0 },
  ])
  expect(detail?.memoryFiles?.map(file => file.type)).toEqual(['User', 'Project'])
})

const RICH = (percent: number, usd: number) => {
  const base = USAGE(percent)
  return {
    ...base,
    cost: { usd },
    context: {
      ...base.context,
      breakdown: {
        ...base.context.breakdown,
        memoryFiles: [
          { path: '/home/me/proj/CLAUDE.md', type: 'Project', tokens: 1200 },
          { path: '/home/me/.claude/CLAUDE.md', type: 'User', tokens: 1400 },
        ],
        mcpTools: [
          { name: 'mcp__linear__a', serverName: 'linear', tokens: 4000, isLoaded: true },
          { name: 'mcp__linear__b', serverName: 'linear', tokens: 2200, isLoaded: true },
          { name: 'mcp__figma__c', serverName: 'figma', tokens: 900, isLoaded: false },
        ],
        skills: { totalSkills: 56, includedSkills: 41, tokens: 2400, skillFrontmatter: [{ name: 'deploy', source: 'plugin', tokens: 300 }] },
        agents: [{ agentType: 'reviewer', source: 'projectSettings', tokens: 250 }],
        apiUsage: { input_tokens: 20, output_tokens: 300, cache_read_input_tokens: 920, cache_creation_input_tokens: 60 },
      },
    },
  }
}

test('컨텍스트 패널: 실린 것 묶음, 턴마다 흐름과 압축, 캐시와 턴마다 비용', KO, async ($, on) => {
  let now = 1_000_000
  let percent = 20
  let cost = 0.1
  const asked: string[] = []
  on('clock.now', () => ({ value: now }))
  on('session.usage', ($, e) => {
    asked.push(e?.breakdown ?? 'plain')
    return { value: RICH(percent, cost) as never }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.complete', () => ({ text: '끝' }) as never)
  on('session.compact', () => ({ messages: [{ role: 'user', text: '요약', toolUses: [] }], tokensBefore: 140000, tokensAfter: 20000 }) as never)
  await $.command.run({ command: 'desk-context', args: '' } as never)
  expect(asked).toEqual(['summary'])

  const turn = async (id: string, nextPercent: number, usd: number, at: number) => {
    percent = nextPercent
    cost = usd
    now = at
    const usage = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 90, model: 'm' }
    await $.turn.complete({ durationMs: 1000, reason: 'answer', answer: '끝', turnId: id, usage } as never)
    await wait(30)
  }
  await turn('t1', 20, 0.1, 1_000_000)
  await turn('t2', 45, 0.25, 1_060_000)
  now = 1_090_000
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: '요약해 줘', toolUses: [] }] } as never)
  await turn('t3', 15, 0.4, 1_120_000)
  // 패널이 그려지지 않는 동안은 턴마다 칩이 읽던 값 하나만 묻는다(내역은 계산하지 않는다)
  expect(asked).toEqual(['summary', 'plain', 'plain', 'plain'])

  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-context', viewport: VIEWPORT, props: { title: '컨텍스트', isFocused: true, bodyColumns: 60 } as never })
  await wait(30)
  // 그려도 내역은 다시 계산하지 않는다(열 때와 ↻ 때만)
  expect(asked).toEqual(['summary', 'plain', 'plain', 'plain'])
  let drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('컨텍스트에 실린 것')
  expect(drawn).toContain('MCP 도구 3개 · 서버 2개 · 1개는 필요할 때')
  expect(drawn).toContain('메모리 파일 2개')
  expect(drawn).toContain('스킬 56개 중 41개 목록에')
  expect(drawn).toContain('커스텀 에이전트 1개')
  expect(drawn).not.toContain('linear')
  expect(drawn).toContain(`이 세션 · ${hhmm(1_000_000)} 부터 · 턴 3번 · ▲ 압축 1번`)
  expect(drawn).toContain(' 50%│')
  expect(drawn).toContain('  0%│')
  expect(drawn).toContain('▲')
  expect(drawn).toContain('읽음 90% · 씀 9% · 새로 1% · 지난 턴')
  expect(drawn).toContain('턴 3번 동안 입력의 90% 를 캐시에서 읽음')
  expect(drawn).toContain('$0.40')
  expect(drawn).toContain('턴마다')
  expect(drawn).toContain('지난 턴 $0.15')

  // ↻ 한 번에 내역도 한 번
  await pane.press({ key: 'context-refresh' })
  await wait(30)
  expect(asked.filter(kind => kind === 'summary').length).toBe(2)

  await pane.press({ key: 'context-group-mcp' })
  drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('linear')
  expect(drawn).toContain('도구 2개')
  expect(drawn).toContain('도구 1개 · 1개는 필요할 때')
  await pane.unmount()
})

test('질문 알림 본문: 첫 질문, 여러 개면 외 N개', KO, () => {
  setLang('ko')
  const q = (question: string) => ({ question, header: '', kind: 'choice' as const, options: [{ label: 'a' }], multiSelect: false })
  expect(askNotice([q('어느 쪽?')])).toBe('어느 쪽?')
  expect(askNotice([q('어느 쪽?'), q('몇 개?'), q('언제?')])).toBe('어느 쪽? (외 2개)')
})

test('에이전트 메시지는 줄 전체가 버튼', KO, async ($, on) => {
  on('command.register', () => ({ value: undefined as never }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', ($, e) => e as never)
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal' } as never)
  const row = await $.ui.mount({
    plugin: 'desk-look',
    surface: 'terminal',
    component: 'UserMessage',
    viewport: VIEWPORT,
    props: { text: '첫 줄 미리보기\n\n본문', origin: { kind: 'unclassified' }, isExpanded: false, from: { name: '@Explore' } } as never,
  })
  const drawn = JSON.stringify(await row.drawn())
  const key = /"key":"(peer-[^"]+)"/.exec(drawn)?.[1] ?? ''
  const button = await row.find({ type: 'Button', key })
  // 미리보기까지 버튼 안에 있어서 설명을 눌러도 펼쳐진다
  expect(JSON.stringify(button)).toContain('첫 줄 미리보기')
  await row.press({ key })
  expect(await row.find({ type: 'Text', text: /본문/ })).toBeDefined()
  await row.unmount()
})

import { clipStart, fitDiffs, fitView, isUpdated, matchDiffFile, movedStep, splitCommitDiffs, updateMessage } from '../hooks/register'

test('턴 끝 카드 파일 → diff 패널 파일 짝짓기, 앞 줄이기', KO, () => {
  const files = [{ path: 'a.txt' }, { path: 'src/a.txt' }, { path: 'b.txt' }]
  expect(matchDiffFile(files, '/repo/src/a.txt')).toBe('src/a.txt')
  expect(matchDiffFile(files, '/repo/a.txt')).toBe('a.txt')
  expect(matchDiffFile(files, 'b.txt')).toBe('b.txt')
  expect(matchDiffFile(files, '/repo/c.txt')).toBe(null)
  expect(matchDiffFile([{ path: 'desk-look/hooks/register.tsx' }], 'register.tsx')).toBe('desk-look/hooks/register.tsx')
  expect(matchDiffFile([{ path: 'desk-look/hooks/register.tsx' }], 'hooks/register.tsx')).toBe('desk-look/hooks/register.tsx')
  expect(clipStart('desk-look/hooks/register.tsx', 14)).toBe('…/register.tsx')
  expect(clipStart('a.txt', 14)).toBe('a.txt')
})

const DIFF_PATCH = 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n-a\n+b\n+c\n'
const gitStub = ($: unknown, e: { argv: string[] }) => {
  const stdout = e.argv.includes('--show-toplevel') ? '/repo\n' : e.argv[1] === 'diff' && e.argv[2] === 'HEAD' ? DIFF_PATCH : e.argv.includes('--abbrev-ref') ? 'main\n' : ''
  return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
}

test('턴 끝 카드의 파일 줄을 누르면 diff 패널이 그 파일에서 열린다', KO, async ($, on) => {
  const opened: string[] = []
  on('process.run', gitStub as never)
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('clock.now', () => ({ value: 0 }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('turn.complete', () => ({ text: '고쳤어요' }) as never)
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Baked for 3s</Text>
  })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.txt', old_string: 'a', new_string: 'b\nc' } as never)
  await $.turn.complete({ durationMs: 3000, reason: 'answer', answer: '고쳤어요', turnId: 't1' } as never)
  const row = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'TurnDuration', viewport: VIEWPORT, props: { word: 'Baked', durationMs: 3000 } })
  expect(await row.find({ type: 'Text', text: /Edited 1 file/ })).toBeDefined()
  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-diff', viewport: VIEWPORT, props: { title: '변경 사항', isFocused: true } as never })
  // 패널은 접힌 목록으로 열리고, 카드에서 누르면 그 파일을 펼쳐서 연다(그 파일로 스크롤은 실화면에서 확인: 테스트 도구는 key 스크롤을 풀지 못한다)
  expect(await pane.find({ type: 'Code' })).toBeUndefined()
  await row.press({ key: 'diffat-3000-/repo/a.txt' })
  expect(opened).toEqual(['desk-diff'])
  expect(await pane.find({ type: 'Code' })).toBeDefined()
  await pane.unmount()
  await row.unmount()
})

test('백그라운드 에이전트를 기다리는 턴 끝 줄: 에이전트마다 한 줄, 누르면 그 작업, 끝나면 상태', KO, async ($, on) => {
  const opened: string[] = []
  let status = 'running'
  on('process.run', gitStub as never)
  on('clock.now', () => ({ value: 0 }))
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('agent.list', () => ({ value: [{ id: 'a1', description: '서울 날씨 조사', type: 'Explore', status }] as never }))
  on('session.messages', () => ({ value: [] as never }))
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Waiting for 1 background agent to finish</Text>
  })
  const waitingFor = { agents: [{ id: 'a1', agentType: 'Explore', tool_use_id: 't1' }], workflows: 0 }
  const row = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'TurnDuration', viewport: VIEWPORT, props: { word: 'Baked', durationMs: 7000, waitingFor } })
  const before = JSON.stringify(await row.drawn())
  expect(before).toContain('Waiting for 1 background agent to finish')
  expect(before).toContain('Explore')
  await row.press({ key: 'waiting-row-a1' })
  expect(opened).toEqual(['desk-tasks'])
  expect(JSON.stringify(await row.drawn())).toContain('서울 날씨 조사')
  status = 'completed'
  await $.command.run({ command: 'desk-tasks', args: '' } as never)
  expect(JSON.stringify(await row.drawn())).toContain('완료')
  await row.unmount()
  // ctrl+o 화면에서는 엔진 줄만
  const expanded = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'TurnDuration', viewport: VIEWPORT, props: { word: 'Baked', durationMs: 7000, waitingFor, isExpanded: true } })
  expect(await expanded.find({ type: 'Button', key: 'waiting-row-a1' })).toBeUndefined()
  await expanded.unmount()
})

test('턴 끝 줄의 ❝ 칩은 그 턴의 답(답 안에서 고른 글이면 그 글)을, /desk-quote 는 고른 글을 인용으로 넣는다', KO, async ($, on) => {
  let selected: { text: string; requestId?: string } | undefined = { text: '첫 줄\n\n둘째 줄  ', requestId: 'r1' }
  let box = ''
  let caret = 0
  const filled: Array<{ text: string; mode?: string; cursor?: number }> = []
  const toasts: string[] = []
  on('process.run', gitStub as never)
  on('clock.now', () => ({ value: 0 }))
  on('turn.complete', () => ({ text: '**첫 줄**\n\n- 둘째 줄\n\n셋째 줄' }) as never)
  on('ui.selection', () => ({ value: selected }) as never)
  on('prompt.read', () => ({ value: { text: box, cursor: caret } }))
  on('prompt.fill', ($, e) => {
    filled.push({ text: e.text, mode: e.mode, cursor: e.cursor })
    return { isFilled: true } as never
  })
  const painted: string[] = []
  on('prompt.paint', ($, e) => {
    painted.push(String(e.text))
    return { value: { isPainted: true } } as never
  })
  on('ui.toast', ($, e) => {
    toasts.push(String((e as { text?: string }).text ?? e))
    return { value: undefined as never }
  })
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Baked for 3s</Text>
  })
  await $.turn.complete({ durationMs: 3000, reason: 'answer', answer: '**첫 줄**\n\n- 둘째 줄\n\n셋째 줄', turnId: 't1' } as never)
  const row = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'TurnDuration', viewport: VIEWPORT, props: { word: 'Baked', durationMs: 3000 } })
  expect(JSON.stringify(await row.drawn())).toContain('❝ quote')
  // 칩: 그 답 안에서 고른 글(그려진 글이라 마크다운 기호가 없다)이면 그 글만, 빈 입력창이면 인용 아래 질문 칸을 비워 둔다
  await row.press({ key: 'quote-turn-3000' })
  expect(filled).toEqual([{ text: '> 첫 줄\n>\n> 둘째 줄\n\n', mode: 'replace', cursor: 16 }])
  // 채우기는 prompt.edit 를 거치지 않으니 넣은 인용을 직접 칠한다
  await wait(10)
  expect(painted).toEqual(['> 첫 줄\n>\n> 둘째 줄\n\n'])
  // 칩: 고른 글이 다른 턴의 것이면 그 턴의 답 전체
  selected = { text: '다른 턴에서 고른 글' }
  await row.press({ key: 'quote-turn-3000' })
  expect(filled[1]?.text).toBe('> **첫 줄**\n>\n> - 둘째 줄\n>\n> 셋째 줄\n\n')
  // /desk-quote 는 고른 글만. 쓰던 글이 있으면 인용을 그 위에 넣고 커서는 쓰던 자리(‘이거’ 뒤)에 둔다
  selected = { text: '첫 줄\n\n둘째 줄  ', requestId: 'r1' }
  box = '이거 왜?'
  caret = 2
  await $.command.run({ command: 'desk-quote', args: '' } as never)
  expect(filled[2]).toEqual({ text: '> 첫 줄\n>\n> 둘째 줄\n\n이거 왜?', mode: 'replace', cursor: 18 })
  // 고른 글이 없으면 칩은 답 전체, /desk-quote 는 채우지 않고 알린다
  selected = undefined
  box = ''
  caret = 0
  await row.press({ key: 'quote-turn-3000' })
  expect(filled[3]?.text).toBe('> **첫 줄**\n>\n> - 둘째 줄\n>\n> 셋째 줄\n\n')
  await $.command.run({ command: 'desk-quote', args: '' } as never)
  expect(filled.length).toBe(4)
  expect(toasts.at(-1)).toContain('선택')
  await row.unmount()
})

test('고른 글이 답 안의 것인지: 그려진 글은 마크다운 기호·줄바꿈·표 선이 빠져 있어 글자와 숫자로 비교', () => {
  const answer = '## 결과\n\n| 이름 | 값 |\n|---|---|\n| `foo` | **12** |\n\n- [링크](https://x.y) 뒤 글'
  expect(selectionIn(answer, '결과')).toBe(true)
  expect(selectionIn(answer, '│ foo  │ 12 │')).toBe(true)
  expect(selectionIn(answer, '• 링크 뒤 글')).toBe(true)
  expect(selectionIn(answer, '다른 글')).toBe(false)
  expect(selectionIn(answer, ' │ ')).toBe(false)
})

test('인용은 앞서 넣은 인용들 다음, 쓰던 글 위에 들어가고 커서는 쓰던 자리를 따라간다', KO, async () => {
  const quote = '> 새\n\n'
  expect(quoteInto('  \n', 1, quote)).toEqual({ text: quote, cursor: quote.length })
  expect(quoteInto('\n\n질문', 4, quote)).toEqual({ text: '> 새\n\n질문', cursor: 7 })
  expect(quoteInto('> 앞\n\n질문', 7, quote)).toEqual({ text: '> 앞\n\n> 새\n\n질문', cursor: 12 })
  expect(quoteInto('> 앞', 2, quote)).toEqual({ text: '> 앞\n\n> 새\n\n', cursor: 10 })
  expect(quoteInto('> 앞\n\n질문', 1, quote)).toEqual({ text: '> 앞\n\n> 새\n\n질문', cursor: 10 })
})

test('입력창 인용 줄 꾸밈: > 는 흐리게, 글은 기울여 흐린 색, 다른 줄은 그대로', () => {
  expect(quoteDecorations('질문')).toEqual([])
  expect(quoteDecorations('> 앞\n>\n>뒤\n\n질문 > 아님')).toEqual([
    { start: 0, end: 2, color: 'subtle' },
    { start: 2, end: 3, italic: true, color: 'inactive' },
    { start: 4, end: 5, color: 'subtle' },
    { start: 6, end: 7, color: 'subtle' },
    { start: 7, end: 8, italic: true, color: 'inactive' },
  ])
})

test('메인 턴 중 서브에이전트 턴이 시작해도 턴 끝 카드의 파일은 남고, 끝났던 에이전트는 다시 실행 중', KO, async ($, on) => {
  let status = 'completed'
  let now = 0
  on('process.run', gitStub as never)
  on('clock.now', () => ({ value: now }))
  on('agent.list', () => ({ value: [{ id: 'a1', description: '조사', type: 'Explore', status }] as never }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', () => ({ text: '고쳤어요' }) as never)
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Baked for 3s</Text>
  })
  await $.turn.start({ text: '고쳐 줘', turnId: 't1' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.txt', old_string: 'a', new_string: 'b' } as never)
  // 에이전트는 첫 턴에 엔진 목록으로 올라온다(목록 다시 읽기는 뒤에서)
  await $.turn.start({ text: '조사해 줘', turnId: 's0', agentId: 'a1' } as never)
  await wait(50)
  await $.tool.call({ tool: 'WebFetch', url: 'https://example.com', prompt: 'x', agentId: 'a1' } as never)
  // 서브에이전트가 끝났다가(SendMessage 로) 다시 돈다
  await $.turn.complete({ durationMs: 1000, reason: 'answer', answer: '', turnId: 's1', agentId: 'a1' } as never)
  // 끝난 뒤 목록 다시 읽기가 끝나고 나서 다시 깨어난다(실제로는 그 사이에 SendMessage 가 온다)
  await wait(50)
  status = 'running'
  now = 60_000
  // 다시 이어 해도 처음 시작한 때와 도구 수는 그대로
  await $.turn.start({ text: '이어서', turnId: 's2', agentId: 'a1' } as never)
  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-tasks', viewport: VIEWPORT, props: { title: '백그라운드 작업', isFocused: true, bodyColumns: 60 } as never })
  const resumed = JSON.stringify(await pane.drawn())
  expect(resumed).toContain('실행 중')
  expect(resumed).toContain('도구 1회')
  expect(resumed).toContain('1m')
  await pane.unmount()
  await $.turn.complete({ durationMs: 3000, reason: 'answer', answer: '고쳤어요', turnId: 't1' } as never)
  const row = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'TurnDuration', viewport: VIEWPORT, props: { word: 'Baked', durationMs: 3000 } })
  expect(await row.find({ type: 'Text', text: /Edited 1 file/ })).toBeDefined()
  await row.unmount()
})

test('있던 파일을 Write 로 덮어쓰면 턴 끝 카드는 결과의 헌크로 센다', KO, async ($, on) => {
  on('process.run', gitStub as never)
  on('clock.now', () => ({ value: 0 }))
  const overwrite = { type: 'update', structuredPatch: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 4, lines: [' a', '-b', '+c', '+d', ' e'] }] }
  on('tool.call', () => ({ result: overwrite }) as never)
  on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', () => ({ text: '고쳤어요' }) as never)
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Baked for 3s</Text>
  })
  await $.turn.start({ text: '고쳐 줘', turnId: 't1' } as never)
  await $.tool.call({ tool: 'Write', file_path: '/repo/a.txt', content: 'a\nc\nd\ne\n' } as never)
  await $.turn.complete({ durationMs: 3000, reason: 'answer', answer: '고쳤어요', turnId: 't1' } as never)
  const row = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'TurnDuration', viewport: VIEWPORT, props: { word: 'Baked', durationMs: 3000 } })
  const drawn = JSON.stringify(await row.drawn())
  expect(drawn).toContain('+2')
  expect(drawn).toContain('−1')
  expect(drawn).not.toContain('+4')
  await row.unmount()
})

test('저장소 밖에서 고친 파일도 카드에서 누르면 diff 패널에 대화 기록의 편집이 보인다', KO, async ($, on) => {
  const notRepo = () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', notRepo as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.cwd', () => ({ value: '/tmp/x' }))
  on('clock.now', () => ({ value: 0 }))
  on('clock.every', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined as never }))
  on('session.start', ($, e) => e as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('turn.complete', () => ({ text: '썼어요' }) as never)
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Baked for 4s</Text>
  })
  // 플러그인을 올리기 전(또는 resume 전)에 한 편집: 대화 기록에만 있다
  const write = { file_path: '/tmp/x/note.md', content: 'a\nb\n' }
  const edit = { file_path: '/tmp/x/note.md', old_string: 'b', new_string: 'c' }
  const hunk = { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' a', '-b', '+c'] }
  on('session.messages', () => ({
    value: [
      { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'w1', tool: 'Write', input: write }, { tool_use_id: 'e1', tool: 'Edit', input: edit }] },
      {
        role: 'user',
        text: '',
        toolUses: [],
        toolResults: [
          { tool_use_id: 'w1', text: 'created', isError: false, result: { type: 'create', filePath: write.file_path, content: write.content, structuredPatch: [] } },
          { tool_use_id: 'e1', text: 'edited', isError: false, result: { filePath: edit.file_path, structuredPatch: [hunk] } },
        ],
      },
    ] as never,
  }))
  await $.session.start({ source: 'resume', cwd: '/tmp/x', surface: 'terminal' } as never)
  await $.tool.call({ tool: 'Edit', ...edit } as never)
  await $.turn.complete({ durationMs: 4000, reason: 'answer', answer: '썼어요', turnId: 't1' } as never)
  const row = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'TurnDuration', viewport: VIEWPORT, props: { word: 'Baked', durationMs: 4000 } })
  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-diff', viewport: VIEWPORT, props: { title: '변경 사항', isFocused: true } as never })
  for (let tries = 0; tries < 50 && !(await pane.find({ type: 'Button', key: 'fold-s:/tmp/x/note.md' })); tries++) await wait(10)
  expect(await pane.find({ type: 'Code' })).toBeUndefined()
  // git 밖 묶음을 통째로 접으면 머리 줄(개수 포함)만 남는다
  await pane.press({ key: 'fold-outside' })
  expect(await pane.find({ type: 'Button', key: 'fold-s:/tmp/x/note.md' })).toBeUndefined()
  expect(JSON.stringify(await pane.drawn())).toContain(' · 1')
  // 접어 둔 묶음·파일도 카드에서 누르면 펼친다
  await row.press({ key: 'diffat-4000-/tmp/x/note.md' })
  for (let tries = 0; tries < 50 && !(await pane.find({ type: 'Code' })); tries++) await wait(10)
  expect(await pane.find({ type: 'Text', text: /git 저장소가 아니라서/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /git 밖 파일/ })).toBeDefined()
  expect(await pane.find({ type: 'Code', source: '@@ -0,0 +1,2 @@\n+a\n+b' } as never)).toBeDefined()
  expect(await pane.find({ type: 'Code', source: '@@ -1,2 +1,2 @@\n a\n-b\n+c' } as never)).toBeDefined()
  // 새 파일 2줄 + 고친 1줄. 끝 줄바꿈을 줄로 세지 않는다
  expect(await pane.find({ type: 'Text', text: ' +3 ' })).toBeDefined()
  await pane.unmount()
  await row.unmount()
})

test('저장소 안이지만 git 이 무시하는 파일도 카드에서 누르면 diff 패널에 대화 기록의 편집이 보인다', KO, async ($, on) => {
  const path = '/repo/.claude/handoff/CURRENT.md'
  const asked: string[][] = []
  on('process.run', (($: unknown, e: { argv: string[]; init?: { stdin?: string } }) => {
    if (e.argv[1] !== 'check-ignore') return gitStub($, e)
    // 경로는 stdin 으로 한 줄에 하나
    const paths = (e.init?.stdin ?? '').split('\n').filter(Boolean)
    asked.push(paths)
    const stdout = paths.includes(path) ? `${path}\n` : ''
    return { value: { exitCode: stdout ? 0 : 1, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('clock.now', () => ({ value: 0 }))
  on('clock.every', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined as never }))
  on('session.start', ($, e) => e as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('turn.complete', () => ({ text: '적었어요' }) as never)
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Baked for 5s</Text>
  })
  const edit = { file_path: path, old_string: 'b', new_string: 'c' }
  const hunk = { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' a', '-b', '+c'] }
  on('session.messages', () => ({
    value: [
      { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'e1', tool: 'Edit', input: edit }] },
      { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'e1', text: 'edited', isError: false, result: { filePath: path, structuredPatch: [hunk] } }] },
    ] as never,
  }))
  await $.session.start({ source: 'resume', cwd: '/repo', surface: 'terminal' } as never)
  await $.tool.call({ tool: 'Edit', ...edit } as never)
  await $.turn.complete({ durationMs: 5000, reason: 'answer', answer: '적었어요', turnId: 't1' } as never)
  const row = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'TurnDuration', viewport: VIEWPORT, props: { word: 'Baked', durationMs: 5000 } })
  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-diff', viewport: VIEWPORT, props: { title: '변경 사항', isFocused: true } as never })
  await row.press({ key: `diffat-5000-${path}` })
  for (let tries = 0; tries < 50 && !(await pane.find({ type: 'Code', source: '@@ -1,2 +1,2 @@\n a\n-b\n+c' } as never)); tries++) await wait(10)
  expect(asked.some(paths => paths.includes(path))).toBe(true)
  // git diff 의 a.txt 와 함께 무시 파일이 세션 기록으로 보인다
  expect(await pane.find({ type: 'Code', source: '@@ -1,2 +1,2 @@\n a\n-b\n+c' } as never)).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /git 밖 파일/ })).toBeDefined()
  await pane.unmount()
  await row.unmount()
})

test('아래턱의 +/− 칩을 누르면 diff 패널이 열린다', KO, async ($, on) => {
  const opened: string[] = []
  on('process.run', gitStub as never)
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('clock.now', () => ({ value: 0 }))
  on('clock.every', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined as never }))
  on('session.start', ($, e) => e as never)
  on('session.messages', () => ({ value: [] as never }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine-band</Text>
  })
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal' } as never)
  await $.command.run({ command: 'desk-diff', args: '' } as never)
  const band = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'AbovePrompt', viewport: VIEWPORT, props: { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 96 } as never })
  for (let tries = 0; tries < 50 && !(await band.find({ type: 'Button', key: 'chin-diff' })); tries++) await wait(10)
  expect(JSON.stringify(await band.find({ type: 'Button', key: 'chin-diff' }))).toContain(' +2 ')
  await band.press({ key: 'chin-diff' })
  expect(opened).toEqual(['desk-diff', 'desk-diff'])
  await band.unmount()
})

test('/desk-update: 마켓 목록을 새로 받고 desk-look 과 설치한 desk-asana·desk-slack 을 올린다', KO, async ($, on) => {
  const ran: string[] = []
  const result = (exitCode: number, stdout: string) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', ($, e: { argv: readonly string[] }) => {
    ran.push(e.argv.join(' '))
    if (e.argv[2] !== 'update') return result(0, '✔ Successfully updated marketplace: cc-desktop-mod\n') as never
    // desk-asana 는 설치하지 않았다: 실패해도 알리지 않는다
    if (e.argv[3] === 'desk-asana@cc-desktop-mod') return result(1, '{"command":"update","outcome":"error","message":"Plugin not found"}\n') as never
    if (e.argv[3] === 'desk-slack@cc-desktop-mod') return result(0, '{"command":"update","outcome":"ok","updateOutcome":"updated","oldVersion":"0.55.0","newVersion":"0.55.1"}\n') as never
    return result(0, '{"command":"update","outcome":"ok","updateOutcome":"updated","oldVersion":"0.15.4","newVersion":"0.15.5"}\n') as never
  })
  // 올라갔으면 답한 뒤 /reload-plugins 를 대신 실행한다
  let fire = () => {}
  on('clock.after', () => new Promise(resolve => (fire = () => resolve({ value: undefined }))) as never)
  const commands: string[] = []
  on('command.run', ($, e: { command: string }) => (commands.push(e.command), { text: '' }) as never)
  const done = await $.command.run({ command: 'desk-update', args: '' } as never)
  expect(ran).toEqual([
    'claude plugin marketplace update cc-desktop-mod',
    'claude plugin update desk-look@cc-desktop-mod --json',
    'claude plugin update desk-asana@cc-desktop-mod --json',
    'claude plugin update desk-slack@cc-desktop-mod --json',
  ])
  expect((done as { text: string }).text).toBe('desk-look 을 0.15.4 → 0.15.5 로 올렸어요. 플러그인을 다시 불러와 적용해요.\ndesk-slack 도 0.55.0 → 0.55.1 로 올렸어요.')
  expect(commands).toEqual([])
  fire()
  await wait(20)
  expect(commands).toEqual(['reload-plugins'])
})

test('/desk-update 결과 문장: 최신, 실패(이때는 다시 불러오지 않는다)', KO, () => {
  setLang('ko')
  expect(isUpdated(0, '{"outcome":"ok","updateOutcome":"updated","oldVersion":"0.15.4","newVersion":"0.15.5"}')).toBe(true)
  expect(isUpdated(0, '{"outcome":"ok","updateOutcome":"up_to_date","oldVersion":"0.15.5","newVersion":"0.15.5"}')).toBe(false)
  expect(isUpdated(1, '{"outcome":"error","message":"Plugin not found"}')).toBe(false)
  expect(updateMessage(0, '{"outcome":"ok","updateOutcome":"up_to_date","oldVersion":"0.15.5","newVersion":"0.15.5"}', '')).toBe('desk-look 은 이미 최신(0.15.5)이에요.')
  expect(updateMessage(1, '{"outcome":"error","message":"Plugin not found"}', '')).toBe('desk-look 을 올리지 못했어요: Plugin not found')
  expect(updateMessage(1, '', 'network down\n')).toBe('desk-look 을 올리지 못했어요: network down')
})

test('옮김 안내: Asana·Slack MCP 서버를 쓰는데 그 플러그인이 이 세션에 없을 때만', () => {
  const tools = [
    { name: 'Read', mcp: false },
    { name: 'mcp__claude_ai_asana__asana_get_task', mcp: true },
    { name: 'mcp__claude_ai_Slack__slack_send_message', mcp: true },
  ]
  expect(movedStep(tools, { asana: false, slack: false }, [])).toEqual({ decided: ['desk-asana', 'desk-slack'], notice: ['desk-asana', 'desk-slack'] })
  expect(movedStep(tools, { asana: true, slack: false }, [])).toEqual({ decided: ['desk-asana', 'desk-slack'], notice: ['desk-slack'] })
  expect(movedStep(tools, { asana: true, slack: true }, [])).toEqual({ decided: ['desk-asana', 'desk-slack'], notice: [] })
  // 이미 판단한 것은 다시 알리지 않는다
  expect(movedStep(tools, { asana: false, slack: false }, ['desk-slack'])).toEqual({ decided: ['desk-slack', 'desk-asana'], notice: ['desk-asana'] })
  // 이름에 asana 가 들어 있어도 MCP 도구가 아니면 보지 않는다
  expect(movedStep([{ name: 'asana-notes', mcp: false }], { asana: false, slack: false }, [])).toEqual({ decided: [], notice: [] })
})

test('옮김 안내: 커넥터가 서버마다 늦게 붙어도 보일 때 알리고, 둘 다 판단하면 그만 본다', KO, async ($, on) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
  on('clock.now', () => ({ value: 0 }))
  const store: Record<string, unknown> = {}
  on('store.get', ($, e) => ({ value: store[e.key] }) as never)
  on('store.set', ($, e) => ((store[e.key] = e.value), { value: undefined }) as never)
  let listed = 0
  const local = { name: 'mcp__local__search', description: '', mcp: true }
  const slack = { name: 'mcp__claude_ai_Slack__slack_send_message', description: '', mcp: true }
  const asana = { name: 'mcp__claude_ai_asana__asana_get_task', description: '', mcp: true }
  let tools = [local]
  on('tool.list', () => (listed++, { value: tools }) as never)
  const toasts: string[] = []
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }) as never)
  const turn = async (id: string) => {
    await $.turn.start({ text: 'hi', turnId: id } as never)
    await wait(10)
  }
  // 로컬 MCP 서버만 먼저 붙었다: 아직 판단하지 않는다
  await turn('t1')
  expect(toasts).toEqual([])
  // Slack 커넥터가 붙었다: desk-slack 만 알린다
  tools = [local, slack]
  await turn('t2')
  expect(toasts).toEqual(['Asana·Slack 패널은 옮겨 갔어요: /plugin install desk-slack@cc-desktop-mod'])
  expect(store.movedNotice).toEqual(['desk-slack'])
  // Asana 커넥터는 더 늦게: desk-asana 를 알리고, 둘 다 판단했으니 더는 보지 않는다
  tools = [local, slack, asana]
  await turn('t3')
  expect(toasts.at(-1)).toBe('Asana·Slack 패널은 옮겨 갔어요: /plugin install desk-asana@cc-desktop-mod')
  expect(toasts).toHaveLength(2)
  const seen = listed
  await turn('t4')
  expect(listed).toBe(seen)
})

test('옮김 안내: 턴이 시작될 때 한 번, MCP 서버가 없으면 몇 턴 뒤 그만 본다', KO, async ($, on) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
  on('clock.now', () => ({ value: 0 }))
  const store: Record<string, unknown> = {}
  on('store.get', ($, e) => ({ value: store[e.key] }) as never)
  on('store.set', ($, e) => ((store[e.key] = e.value), { value: undefined }) as never)
  let listed = 0
  let tools: Array<{ name: string; description: string; mcp: boolean }> = []
  on('tool.list', () => (listed++, { value: tools }) as never)
  const toasts: string[] = []
  on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }) as never)
  // MCP 서버가 아직(또는 아예) 없으면 몇 턴만 본다
  for (let turn = 0; turn < 8; turn++) {
    await $.turn.start({ text: 'hi', turnId: `t${turn}` } as never)
    await wait(10)
  }
  expect(listed).toBe(5)
  expect(toasts).toEqual([])
  expect(store.movedNotice).toBeUndefined()
})

test('/desk-fold: desk-asana 패널만 열려 있어도 접고, 접은 뒤 다시 열어도 또 접는다', KO, async ($, on) => {
  on('ui.panes', () => ({ value: [] }) as never)
  // desk-asana 흉내: 패널이 열려 있는지(shown)·접어 둔 것(folded)을 내놓고, desk-look 의 folded 쓰기를 따라 접고 편다
  let shown = true
  let asanaFolded: unknown[] | null = null
  on('state.get', { plugin: 'desk-asana', key: 'shown' }, () => ({ value: { value: shown, version: 1 } }) as never)
  on('state.get', { plugin: 'desk-asana', key: 'folded' }, () => ({ value: { value: asanaFolded, version: 1 } }) as never)
  on('state.set', { plugin: 'desk-look', key: 'folded' }, ($, e, next) => {
    if (e.value !== null && shown) {
      asanaFolded = [{ id: 'desk-asana', title: 'Asana', isShown: true, offset: 0 }]
      shown = false
    }
    if (e.value === null && asanaFolded !== null) {
      asanaFolded = null
      shown = true
    }
    return next(e)
  })
  const fold = async () => ((await $.command.run({ command: 'desk-fold', args: '' } as never)) as { text: string }).text
  expect(await fold()).toBe('패널 1개를 접었어요. /desk-fold 로 다시 펴세요.')
  expect(shown).toBe(false)
  // 사람이 /desk-asana 로 다시 열었다: 펴지 않고 또 접는다(0.55.0 에서는 "폈어요" 로 거꾸로 갔다)
  shown = true
  expect(await fold()).toBe('패널 1개를 접었어요. /desk-fold 로 다시 펴세요.')
  expect(shown).toBe(false)
  // 이제 열린 게 없으니 편다
  expect(await fold()).toBe('접어 둔 패널 1개를 폈어요.')
  expect(shown).toBe(true)
})

test('아래턱 ✉ 칩: desk-slack 의 안 읽은 수를 읽고, 누르면 slackOpen 을 올려 desk-slack 이 턴 중에도 바로 연다', KO, async ($, on) => {
  on('process.run', gitStub as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine-band</Text>
  })
  let count = 0
  on('state.get', { plugin: 'desk-slack', key: 'unread' }, () => ({ value: { value: count, version: count } }) as never)
  const commands: string[] = []
  on('command.run', ($, e: { command: string }) => (commands.push(e.command), { text: '' }) as never)
  // $.command.run 은 턴이 끝날 때까지 줄을 서서 쓰지 않는다
  const pressed: unknown[] = []
  on('state.set', { plugin: 'desk-look', key: 'slackOpen' }, ($, e, next) => (pressed.push(e.value), next(e)))
  const mountBand = () =>
    $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'AbovePrompt', viewport: VIEWPORT, props: { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 96 } as never })
  let band = await mountBand()
  expect(JSON.stringify(await band.drawn())).not.toContain('✉')
  await band.unmount()
  count = 3
  band = await mountBand()
  expect(JSON.stringify(await band.drawn())).toContain('✉')
  await band.press({ key: 'slack-chip' })
  await wait(20)
  expect(pressed).toEqual([1])
  expect(commands).not.toContain('desk-slack')
  await band.unmount()
})

test('diff 패널: 접힌 목록으로 열리고, 파일 머리 줄을 누르면 그 파일 diff 를 펴고 접는다', KO, async ($, on) => {
  on('process.run', gitStub as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'desk-diff', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-diff', viewport: VIEWPORT, props: { title: '변경 사항', isFocused: true } as never })
  expect(await pane.find({ type: 'Code' })).toBeUndefined()
  expect(await pane.find({ type: 'Button', key: 'revert-a.txt' })).toBeDefined()
  await pane.press({ key: 'fold-a.txt' })
  expect(await pane.find({ type: 'Code' })).toBeDefined()
  await pane.press({ key: 'fold-a.txt' })
  expect(await pane.find({ type: 'Code' })).toBeUndefined()
  await pane.unmount()
})

test('diff 패널: 파일은 하나만 펴진다, 다른 파일을 펴면 펴 있던 것은 접힌다', KO, async ($, on) => {
  on('process.run', (($: unknown, e: { argv: string[] }) =>
    e.argv[1] === 'diff' && e.argv[2] === 'HEAD'
      ? { value: { exitCode: 0, stdout: DIFF_PATCH + BRANCH_PATCH, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      : gitStub($, e)) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'desk-diff', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-diff', viewport: VIEWPORT, props: { title: '변경 사항', isFocused: true } as never })
  const shown = async () => (await pane.findAll({ type: 'Code' })).map(code => (code as { props?: { path?: string } }).props?.path)
  expect(await shown()).toEqual([])
  await pane.press({ key: 'fold-a.txt' })
  expect(await shown()).toEqual(['a.txt'])
  // 편 파일의 머리 띠로 스크롤하는 것은 실화면에서 확인(테스트 도구는 key 스크롤을 풀지 못한다)
  await pane.press({ key: 'fold-b.txt' })
  expect(await shown()).toEqual(['b.txt'])
  await pane.press({ key: 'fold-b.txt' })
  expect(await shown()).toEqual([])
  // z 로 모두 편 뒤에 하나를 누르면 그것만 남는다
  await pane.press({ key: 'fold-all' })
  expect(await shown()).toEqual(['a.txt', 'b.txt'])
  await pane.press({ key: 'fold-a.txt' })
  expect(await shown()).toEqual(['b.txt'])
  await pane.press({ key: 'fold-a.txt' })
  expect(await shown()).toEqual(['a.txt'])
  await pane.unmount()
})

test('diff 패널: 모두 접기·펴기 (z)', KO, async ($, on) => {
  const twoFiles = `${DIFF_PATCH}diff --git a/b.txt b/b.txt\n--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-x\n+y\n`
  on('process.run', (($: unknown, e: { argv: string[] }) =>
    e.argv[1] === 'diff' && e.argv[2] === 'HEAD'
      ? { value: { exitCode: 0, stdout: twoFiles, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      : gitStub($, e)) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'desk-diff', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-diff', viewport: VIEWPORT, props: { title: '변경 사항', isFocused: true } as never })
  const codes = async () => (await pane.findAll({ type: 'Code' })).length
  expect(await codes()).toBe(0)
  expect(JSON.stringify(await pane.find({ type: 'Button', key: 'fold-all' }))).toContain('"hotkey":"z"')
  expect(JSON.stringify(await pane.find({ type: 'Button', key: 'fold-all' }))).toContain('모두 펴기')
  await pane.press({ key: 'fold-all' })
  expect(await codes()).toBe(2)
  // 하나라도 펴져 있으면 모두 접는다
  await pane.press({ key: 'fold-a.txt' })
  expect(await codes()).toBe(1)
  expect(JSON.stringify(await pane.find({ type: 'Button', key: 'fold-all' }))).toContain('모두 접기')
  await pane.press({ key: 'fold-all' })
  expect(await codes()).toBe(0)
  await pane.unmount()
})

import { planOf } from '../hooks/runs'
import { splitPlan } from '../hooks/register'

const PLAN = ['# 빼기 추가', '', '- math.ts 에 subtract', '- 테스트 추가', '', '| 파일 | 변경 |', '|---|---|', '| math.ts | subtract |'].join('\n')

test('계획 읽기: 엔진 결과, 저장한 요약, 결과 글', KO, () => {
  expect(planOf({ plan: PLAN, isAgent: false, filePath: '/h/.claude/plans/p.md' })).toEqual({ plan: PLAN, filePath: '/h/.claude/plans/p.md' })
  expect(planOf({ plan: null, isAgent: false })).toEqual({ plan: null })
  expect(planOf(JSON.stringify({ plan: PLAN, isAgent: false }))?.plan).toBe(PLAN)
  expect(planOf(`User has approved your plan. You can now start coding.\n\n## Approved Plan:\n${PLAN}`)?.plan).toBe(PLAN)
  expect(planOf('그냥 글')).toBe(null)
  expect(planOf({ stdout: 'x' })).toBe(null)
})

test('계획 접기: 줄 수를 넘긴 뒤 첫 빈 줄에서, 코드 울타리 안은 자르지 않는다', KO, () => {
  const long = Array.from({ length: 6 }, (_, index) => `문단 ${index}\n줄`).join('\n\n')
  expect(splitPlan(long, 4)).toEqual({ head: '문단 0\n줄\n\n문단 1\n줄', hidden: 8 })
  expect(splitPlan('짧음', 4)).toEqual({ head: '짧음', hidden: 0 })
  const fenced = ['a', 'b', 'c', '```', 'x', '', 'y', '```', '', 'z'].join('\n')
  expect(splitPlan(fenced, 4).head).toBe(['a', 'b', 'c', '```', 'x', '', 'y', '```'].join('\n'))
})

test('계획은 묶음에 섞지 않고 혼자 카드 하나', KO, () => {
  const use = (id: string, tool: string) => ({ tool_use_id: id, tool, input: {} })
  const runsOf = computeRuns([
    { role: 'assistant', text: '', toolUses: [use('r', 'Read'), use('w', 'Write'), use('p', 'ExitPlanMode'), use('b', 'Bash')] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'p', text: 'ok', isError: false, result: { plan: PLAN, isAgent: false } }] },
  ] as never)
  expect(runsOf.firstOf).toEqual({ r: 'r', w: 'r', p: 'p', b: 'b' })
  expect(planOf(runsOf.calls.p?.[0]?.output)?.plan).toBe(PLAN)
})

test('계획 카드: 상태와 마크다운 본문, 길면 Show all', KO, async $ => {
  const long = `${PLAN}\n\n${Array.from({ length: 12 }, (_, index) => `- 단계 ${index}`).join('\n')}\n\n마지막 문단`
  const row = await $.ui.mount({
    plugin: 'desk-look',
    surface: 'terminal',
    component: 'ToolUse',
    viewport: VIEWPORT,
    props: { tool_use_id: 'p1', tool: 'ExitPlanMode', input: {}, isRunning: false, isErrored: false, isInterrupted: false, output: { plan: long, isAgent: false } } as never,
  })
  let drawn = JSON.stringify(await row.drawn())
  expect(drawn).toContain('Plan')
  expect(drawn).toContain('승인됨')
  expect(drawn).toContain('빼기 추가')
  expect(drawn).not.toContain('마지막 문단')
  expect(drawn).toContain('Show all · 1 more lines')
  await row.press({ key: 'plan-p1' })
  drawn = JSON.stringify(await row.drawn())
  expect(drawn).toContain('마지막 문단')
  expect(drawn).toContain('Show less')
  await row.unmount()

  const waiting = await $.ui.mount({
    plugin: 'desk-look',
    surface: 'terminal',
    component: 'ToolUse',
    viewport: VIEWPORT,
    props: { tool_use_id: 'p2', tool: 'ExitPlanMode', input: {}, isRunning: true, isErrored: false, isInterrupted: false } as never,
  })
  expect(JSON.stringify(await waiting.drawn())).toContain('승인 대기')
  await waiting.unmount()

  // 실제 승인 창이 떠 있는 동안의 모양: 시작 전이라 isRunning 도 false, 결과도 없다
  const asking = await $.ui.mount({
    plugin: 'desk-look',
    surface: 'terminal',
    component: 'ToolUse',
    viewport: VIEWPORT,
    props: { tool_use_id: 'p3', tool: 'ExitPlanMode', input: {}, isRunning: false, isErrored: false, isInterrupted: false } as never,
  })
  const shown = JSON.stringify(await asking.drawn())
  expect(shown).toContain('승인 대기')
  expect(shown).toContain('승인 창에서 계획을 보여 주고 있어요')
  await asking.unmount()
})

test('계획 카드: 승인 직후 props 가 아직 실행 중이어도 저장한 결과로 승인됨', KO, async ($, on) => {
  on('command.register', () => ({ value: undefined as never }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', ($, e) => e as never)
  on('session.messages', () => ({
    value: [
      { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'p9', tool: 'ExitPlanMode', input: {} }] },
      { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'p9', text: 'approved', isError: false, result: { plan: PLAN, isAgent: false } }] },
    ] as never,
  }))
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal' } as never)
  const row = await $.ui.mount({
    plugin: 'desk-look',
    surface: 'terminal',
    component: 'ToolUse',
    viewport: VIEWPORT,
    // 실제 2.1.295: 결과(plan)를 넘기면서도 isRunning 이 true 로 남아 있었다
    props: { tool_use_id: 'p9', tool: 'ExitPlanMode', input: {}, isRunning: true, isErrored: false, isInterrupted: false, output: { plan: PLAN, isAgent: false } } as never,
  })
  let drawn = JSON.stringify(await row.drawn())
  for (let tries = 0; tries < 50 && !drawn.includes('승인됨'); tries++) {
    await wait(10)
    drawn = JSON.stringify(await row.drawn())
  }
  expect(drawn).toContain('승인됨')
  expect(drawn).not.toContain('승인 대기')
  await row.unmount()
})

import { checkState, checkSummary, jobState, mergeAction, prChipParts, prRepo, shortStat, toChecks, toDiscussions, toJobs, toMr, toPr, toThreads } from '../hooks/pr'
import { fetchReview, mergePr } from '../hooks/register'
import { baseCandidates, parseCommits, scopeOf } from '../hooks/gitview'

const GH_PR = {
  number: 12,
  title: 'Add done command',
  url: 'https://github.com/owner/repo/pull/12',
  state: 'OPEN',
  isDraft: false,
  reviewDecision: 'REVIEW_REQUIRED',
  mergeStateStatus: 'BLOCKED',
  headRefName: 'feat/done',
  baseRefName: 'main',
  additions: 25,
  deletions: 4,
  statusCheckRollup: [
    { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://github.com/owner/repo/actions/runs/1' },
    { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/owner/repo/actions/runs/2' },
    { __typename: 'CheckRun', name: 'deploy', status: 'IN_PROGRESS', conclusion: null },
    { __typename: 'StatusContext', context: 'ci/legacy', state: 'SUCCESS', targetUrl: null },
    { __typename: 'CheckRun', name: 'label', status: 'COMPLETED', conclusion: 'SKIPPED' },
  ],
}
const GH_THREADS = {
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes: [
            { isResolved: false, isOutdated: false, path: 'todo.py', line: 30, comments: { nodes: [{ author: { login: 'alice' }, body: 'Check the range\nplease', url: 'https://github.com/owner/repo/pull/12#r1' }] } },
            { isResolved: true, isOutdated: false, path: 'README.md', line: 3, comments: { nodes: [{ author: { login: 'bob' }, body: 'ok' }] } },
          ],
        },
      },
    },
  },
}

test('PR: 체크 상태·요약·칩·리뷰 스레드', KO, () => {
  expect(checkState({ status: 'COMPLETED', conclusion: 'TIMED_OUT' })).toBe('fail')
  expect(checkState({ status: 'QUEUED' })).toBe('pending')
  expect(checkState({ __typename: 'StatusContext', state: 'PENDING' })).toBe('pending')
  const checks = toChecks(GH_PR.statusCheckRollup)
  expect(checks.map(check => `${check.state}:${check.name}`)).toEqual(['fail:test', 'pending:deploy', 'pass:ci/legacy', 'pass:lint', 'skip:label'])
  expect(checkSummary(checks)).toEqual({ passed: 2, failed: 1, pending: 1, total: 4 })
  const threads = toThreads(GH_THREADS)
  expect(threads).toEqual([{ path: 'todo.py', line: 30, author: 'alice', body: 'Check the range\nplease', url: 'https://github.com/owner/repo/pull/12#r1', isOutdated: false }])
  const info = toPr(GH_PR, threads)
  expect(prChipParts(info).map(part => part.text)).toEqual([' #12', '✗ 1', '◆ 1'])
  expect(prChipParts({ ...info, checks: checks.filter(check => check.state !== 'fail') }).map(part => part.text)).toEqual([' #12', '● 2/3', '◆ 1'])
  expect(prChipParts({ ...info, state: 'MERGED' }).map(part => part.text)).toEqual([' #12', 'merged'])
  expect(prRepo('https://github.example.com/team/app/pull/3')).toEqual({ host: 'github.example.com', owner: 'team', name: 'app' })
})

const MR = {
  iid: 7,
  title: 'Fix sheet',
  web_url: 'https://gitlab.example.com/group/app/-/merge_requests/7',
  state: 'opened',
  draft: false,
  detailed_merge_status: 'not_approved',
  has_conflicts: false,
  source_branch: 'fix/sheet',
  target_branch: 'develop',
  project_id: 42,
  head_pipeline: { id: 900, status: 'failed', web_url: 'https://gitlab.example.com/group/app/-/pipelines/900' },
  diff_refs: { base_sha: 'aaa', head_sha: 'bbb' },
}
const MR_JOBS = [
  { name: 'unit', stage: 'test', status: 'failed', allow_failure: false, web_url: 'https://gitlab.example.com/j/1' },
  { name: 'lint', stage: 'test', status: 'success', allow_failure: false },
  { name: 'deploy', stage: 'deploy', status: 'manual', allow_failure: true },
  { name: 'flaky', stage: 'test', status: 'failed', allow_failure: true },
]
const MR_DISCUSSIONS = [
  { id: 'd1', notes: [{ id: 5, body: 'rename this', system: false, resolvable: true, resolved: false, author: { username: 'carol' }, position: { new_path: 'src/a.ts', new_line: 8 } }] },
  { id: 'd2', notes: [{ id: 6, body: 'done', system: false, resolvable: true, resolved: true, author: { username: 'dan' } }] },
  { id: 'd3', notes: [{ id: 7, body: 'changed the description', system: true, resolvable: false }] },
]

test('MR(GitLab): job·토론·줄 수를 PR 모양으로', KO, () => {
  expect(jobState({ status: 'running' })).toBe('pending')
  expect(jobState({ status: 'failed', allow_failure: true })).toBe('skip')
  const checks = toJobs(MR_JOBS)
  expect(checks.map(check => `${check.state}:${check.name}`)).toEqual(['fail:test / unit', 'pass:test / lint', 'skip:deploy / deploy', 'skip:test / flaky'])
  const threads = toDiscussions(MR_DISCUSSIONS, MR.web_url)
  expect(threads).toEqual([{ path: 'src/a.ts', line: 8, author: 'carol', body: 'rename this', url: `${MR.web_url}#note_5`, isOutdated: false }])
  expect(shortStat(' 3 files changed, 25 insertions(+), 4 deletions(-)\n')).toEqual({ added: 25, removed: 4 })
  expect(shortStat(' 1 file changed, 2 deletions(-)')).toEqual({ added: 0, removed: 2 })
  const info = toMr(MR, checks, threads, { added: 25, removed: 4 })
  expect(info.reviewDecision).toBe('REVIEW_REQUIRED')
  expect(prChipParts(info).map(part => part.text)).toEqual([' !7', '✗ 1', '◆ 1'])
})

// fetchReview·mergePr 는 $.process.run 을 직접 부른다: $ 대신 그 자리에 표를 넣는다.
type Runner = (argv: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>
const proc = (runner: Runner) => ({ process: { run: runner } }) as never
const runner = (table: Array<[(argv: string[]) => boolean, { exitCode: number; stdout?: string; stderr?: string }]>): Runner => async (argv: string[]) => {
  const hit = table.find(([match]) => match(argv))?.[1] ?? { exitCode: 1, stderr: 'unexpected' }
  return { exitCode: hit.exitCode, stdout: hit.stdout ?? '', stderr: hit.stderr ?? '' }
}
const run = (table: Parameters<typeof runner>[0]) => proc(runner(table))

test('PR·MR 읽기: GitHub 이면 gh, 아니면 glab, 없으면 none', KO, async () => {
  const github = await fetchReview(
    run([
      [argv => argv[0] === 'gh' && argv[1] === 'pr', { exitCode: 0, stdout: JSON.stringify(GH_PR) }],
      [argv => argv[0] === 'gh' && argv[1] === 'api', { exitCode: 0, stdout: JSON.stringify(GH_THREADS) }],
    ]),
    'feat/done',
    1,
  )
  expect(github.status).toBe('ok')
  expect(github.pr?.provider).toBe('github')
  expect(github.pr?.threads?.length).toBe(1)

  const gitlab = await fetchReview(
    run([
      [argv => argv[0] === 'gh', { exitCode: 1, stderr: 'none of the git remotes configured for this repository point to a known GitHub host' }],
      [argv => argv.join(' ') === 'glab mr list --source-branch fix/sheet --output json', { exitCode: 0, stdout: JSON.stringify([{ iid: 7, state: 'opened' }]) }],
      [argv => argv.join(' ') === 'glab mr view 7 --output json', { exitCode: 0, stdout: JSON.stringify(MR) }],
      [argv => argv.at(-1)?.includes('/jobs') === true, { exitCode: 0, stdout: JSON.stringify(MR_JOBS) }],
      [argv => argv.at(-1)?.includes('/discussions') === true, { exitCode: 0, stdout: JSON.stringify(MR_DISCUSSIONS) }],
      [argv => argv[0] === 'git', { exitCode: 0, stdout: ' 2 files changed, 9 insertions(+), 1 deletion(-)\n' }],
    ]),
    'fix/sheet',
    1,
  )
  expect(gitlab.status).toBe('ok')
  expect(gitlab.pr?.provider).toBe('gitlab')
  expect([gitlab.pr?.added, gitlab.pr?.removed]).toEqual([9, 1])
  expect(gitlab.pr?.checks[0]?.name).toBe('test / unit')

  const none = await fetchReview(
    run([
      [argv => argv[0] === 'gh', { exitCode: 1, stderr: 'none of the git remotes configured for this repository point to a known GitHub host' }],
      [argv => argv[0] === 'glab', { exitCode: 0, stdout: '[]' }],
    ]),
    'develop',
    1,
  )
  expect(none.status).toBe('none')

  // 도구가 없으면(실행 실패) 다시 묻지 않고, 네트워크 오류는 다음에 다시 읽는다
  const missing = await fetchReview(proc(async () => Promise.reject(new Error('spawn gh ENOENT'))), 'develop', 1)
  expect([missing.status, missing.isSticky]).toEqual(['off', true])
  const flaky = await fetchReview(
    run([
      [argv => argv[0] === 'gh', { exitCode: 1, stderr: 'error connecting to api.github.com' }],
      [argv => argv[0] === 'glab', { exitCode: 1, stderr: 'dial tcp: i/o timeout' }],
    ]),
    'develop',
    1,
  )
  expect([flaky.status, flaky.isSticky]).toEqual(['off', false])
})

const prStub = ($: unknown, e: { argv: string[] }) => {
  const argv = e.argv
  const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  if (argv[0] === 'git' && argv.includes('--abbrev-ref')) return out('feat/done\n')
  if (argv[0] === 'gh' && argv[1] === 'pr') return out(JSON.stringify(GH_PR))
  if (argv[0] === 'gh' && argv[1] === 'api') return out(JSON.stringify(GH_THREADS))
  return out('', 1)
}

test('PR 칩과 /desk-pr 패널: 실패한 체크를 Claude에게 맡기면 입력창에 채운다', KO, async ($, on) => {
  const opened: string[] = []
  const filled: Array<{ text: string; mode?: string }> = []
  on('process.run', prStub as never)
  on('clock.now', () => ({ value: 1000 }))
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('ui.toast', () => ({ value: undefined as never }))
  on('prompt.fill', ($, e) => {
    filled.push(e as never)
    return { isFilled: true } as never
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine-band</Text>
  })
  await $.command.run({ command: 'desk-pr', args: '' } as never)
  expect(opened).toEqual(['desk-pr'])
  const band = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'AbovePrompt', viewport: VIEWPORT, props: { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 96 } as never })
  expect(await band.find({ type: 'Button', key: 'pr-chip' })).toBeDefined()
  expect(JSON.stringify(await band.drawn())).toContain('✗ 1')
  await band.unmount()

  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-pr', viewport: VIEWPORT, props: { title: 'PR', isFocused: true } as never })
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('Add done command')
  expect(drawn).toContain('리뷰 리뷰 필요')
  expect(drawn).toContain('막힘')
  expect(drawn).toContain('2/4 통과')
  expect(drawn).toContain('todo.py:30')
  // 통과한 체크는 접혀 있다가 펼친다
  expect(drawn).not.toContain('ci/legacy')
  await pane.press({ key: 'pr-passes' })
  expect(JSON.stringify(await pane.drawn())).toContain('ci/legacy')
  await pane.press({ key: 'fix-check-test' })
  expect(filled[0]?.text).toContain('PR #12 의 CI 체크 "test"')
  expect(filled[0]?.mode).toBe('replace')
  await pane.press({ key: 'fix-thread-0' })
  expect(filled[1]?.text).toContain('> Check the range')
  await pane.unmount()
})

test('PR 체크가 도는 동안은 턴 밖에서도 다시 읽고, 그대로면 간격을 늘리고, 다 끝나면 멈춘다', KO, async ($, on) => {
  let now = 1000
  let deploy: Record<string, unknown> = { __typename: 'CheckRun', name: 'deploy', status: 'IN_PROGRESS', conclusion: null }
  // clock.after 는 걸 때 한 번 묻는다. PR 주기(15초 이상)는 붙잡아 두었다가 테스트가 풀어 준다(풀리면 fn 이 돈다).
  const ticks: Array<{ ms: number; fire: () => void }> = []
  on('clock.now', () => ({ value: now }))
  on('clock.after', ($, e) => new Promise(resolve => {
    if (e.ms >= 15_000) ticks.push({ ms: e.ms, fire: () => resolve({ value: undefined }) })
  }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let hold: Promise<void> | null = null
  let reads = 0
  let head = 'abc123'
  on('process.run', async ($, e) => {
    if (e.argv[0] === 'gh' && e.argv[1] === 'pr') {
      reads++
      await hold
      const checks = GH_PR.statusCheckRollup.map(check => (check.name === 'deploy' ? deploy : check))
      return { value: { exitCode: 0, stdout: JSON.stringify({ ...GH_PR, headRefOid: head, statusCheckRollup: checks }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return prStub($, e as never)
  })
  // 붙잡아 둔 마지막 주기를 풀고 다음 주기가 걸릴 때까지 기다린다.
  const tick = async () => {
    now += ticks.at(-1)?.ms ?? 0
    ticks.at(-1)?.fire()
    await wait(50)
  }
  await $.command.run({ command: 'desk-pr', args: '' } as never)
  expect(ticks.map(t => t.ms)).toEqual([15_000])
  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-pr', viewport: VIEWPORT, props: { title: 'PR', isFocused: true } as never })
  expect(JSON.stringify(await pane.drawn())).toContain('2/4 통과')

  // 체크가 그대로면(끝나지 않는 체크) 두 배씩 늘려 2분에서 멈춘다
  for (let i = 0; i < 5; i++) await tick()
  expect(ticks.map(t => t.ms)).toEqual([15_000, 30_000, 60_000, 120_000, 120_000, 120_000])
  expect(reads).toBe(6)

  // 새로 푸시하면 다시 15초부터
  head = 'def456'
  await tick()
  expect(ticks.at(-1)?.ms).toBe(15_000)
  await tick()
  expect(ticks.at(-1)?.ms).toBe(30_000)

  // 턴 없이 deploy 가 끝났다
  deploy = { __typename: 'CheckRun', name: 'deploy', status: 'COMPLETED', conclusion: 'SUCCESS' }
  const armed = ticks.length
  await tick()
  expect(JSON.stringify(await pane.drawn())).toContain('3/4 통과')
  // 도는 체크가 없으니 다음 주기는 걸지 않는다(멈춤)
  await wait(50)
  expect(ticks).toHaveLength(armed)

  // ↻ 는 기다리지 않고 바로 다시 읽고, 읽는 동안은 … 를 보인다
  deploy = { __typename: 'CheckRun', name: 'deploy', status: 'COMPLETED', conclusion: 'FAILURE' }
  now += 1_000
  let release = () => {}
  hold = new Promise<void>(resolve => (release = resolve))
  await pane.press({ key: 'pr-refresh' })
  await wait(50)
  const refreshLabel = async () => (JSON.stringify(await pane.drawn()).match(/"key":"pr-refresh","label":"([^"]*)"/) ?? [])[1]
  expect(await refreshLabel()).toBe('…')
  release()
  await wait(50)
  expect(await refreshLabel()).toBe('↻')
  expect(JSON.stringify(await pane.drawn())).toContain('2/4 통과 · 2 실패')
  await pane.unmount()
})

test('머지·닫힌 PR 은 도는 체크가 남아 있어도 다시 읽지 않는다', KO, async ($, on) => {
  const ticks: number[] = []
  on('clock.now', () => ({ value: 1000 }))
  on('clock.after', ($, e) => new Promise(() => {
    if (e.ms >= 15_000) ticks.push(e.ms)
  }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', async ($, e) => {
    if (e.argv[0] === 'gh' && e.argv[1] === 'pr') {
      return { value: { exitCode: 0, stdout: JSON.stringify({ ...GH_PR, state: 'MERGED' }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return prStub($, e as never)
  })
  await $.command.run({ command: 'desk-pr', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-pr', viewport: VIEWPORT, props: { title: 'PR', isFocused: true } as never })
  expect(JSON.stringify(await pane.drawn())).toContain('2/4 통과')
  await wait(50)
  expect(ticks).toEqual([])
  await pane.unmount()
})

const READY_MR = { ...MR, detailed_merge_status: 'mergeable', sha: 'abc123' }
const PASS_JOB = [{ name: 'unit', stage: 'test', status: 'success' }]
const RUNNING_JOB = [{ name: 'unit', stage: 'test', status: 'running' }]
const READY_PR = { ...GH_PR, reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN', headRefOid: 'abc123', statusCheckRollup: [{ __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' }] }

test('머지 버튼을 낼지: 바로·자동·없음', KO, () => {
  expect(mergeAction(toMr(READY_MR, toJobs(PASS_JOB), [], null))).toBe('now')
  // GitLab 은 파이프라인이 도는 중에도 mergeable 이라 한다 → 성공하면 머지
  expect(mergeAction(toMr(READY_MR, toJobs(RUNNING_JOB), [], null))).toBe('auto')
  expect(mergeAction(toMr({ ...READY_MR, detailed_merge_status: 'ci_still_running' }, [], [], null))).toBe('auto')
  expect(mergeAction(toMr(READY_MR, toJobs(MR_JOBS), [], null))).toBe(null)
  expect(mergeAction(toMr({ ...READY_MR, merge_when_pipeline_succeeds: true }, toJobs(RUNNING_JOB), [], null))).toBe(null)
  expect(mergeAction(toMr({ ...READY_MR, detailed_merge_status: 'not_approved' }, toJobs(PASS_JOB), [], null))).toBe(null)
  expect(mergeAction(toMr({ ...READY_MR, draft: true }, toJobs(PASS_JOB), [], null))).toBe(null)
  expect(mergeAction(toPr(READY_PR, []))).toBe('now')
  expect(mergeAction(toPr({ ...READY_PR, headRefOid: undefined }, []))).toBe(null)
  const running = [{ __typename: 'CheckRun', name: 'test', status: 'IN_PROGRESS', conclusion: null }]
  expect(mergeAction(toPr({ ...READY_PR, mergeStateStatus: 'BLOCKED', statusCheckRollup: running }, []))).toBe('auto')
  expect(mergeAction(toPr({ ...READY_PR, mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED', statusCheckRollup: running }, []))).toBe(null)
  expect(mergeAction(toPr({ ...READY_PR, autoMergeRequest: { enabledAt: 'x' } }, []))).toBe(null)
})

test('머지 실행: GitLab 은 REST 로 본 커밋만, GitHub 은 허용된 방식으로 하고 원격 브랜치를 지운다', KO, async () => {
  const calls: string[][] = []
  const record = (table: Parameters<typeof run>[0]) => {
    const inner = runner(table)
    return proc(async (argv: string[]) => {
      calls.push(argv)
      return inner(argv)
    })
  }
  const auto = await mergePr(record([[argv => argv[0] === 'glab', { exitCode: 0, stdout: JSON.stringify({ state: 'opened', merge_when_pipeline_succeeds: true }) }]]), toMr(READY_MR, toJobs(RUNNING_JOB), [], null), 'auto')
  expect(auto).toEqual({ ok: true, merged: false })
  expect(calls[0]).toEqual(['glab', 'api', '--hostname', 'gitlab.example.com', '-X', 'PUT', 'projects/42/merge_requests/7/merge', '-f', 'sha=abc123', '-F', 'should_remove_source_branch=true', '-F', 'merge_when_pipeline_succeeds=true', '-F', 'auto_merge=true'])
  const refused = await mergePr(run([[argv => argv[0] === 'glab', { exitCode: 1, stdout: '{"message":"SHA does not match HEAD of source branch"}', stderr: 'ERROR\nglab: 409' }]]), toMr(READY_MR, toJobs(PASS_JOB), [], null), 'now')
  expect(refused).toEqual({ ok: false, error: 'SHA does not match HEAD of source branch' })

  calls.length = 0
  const github = record([
    [argv => argv[1] === 'repo', { exitCode: 0, stdout: JSON.stringify({ mergeCommitAllowed: false, squashMergeAllowed: true, rebaseMergeAllowed: true, deleteBranchOnMerge: false }) }],
    [argv => argv[1] === 'pr', { exitCode: 0 }],
    [argv => argv[1] === 'api', { exitCode: 0 }],
  ])
  expect(await mergePr(github, toPr(READY_PR, []), 'now')).toEqual({ ok: true, merged: true })
  expect(calls[1]).toEqual(['gh', 'pr', 'merge', '12', '-R', 'github.com/owner/repo', '--squash', '--match-head-commit', 'abc123'])
  expect(calls[2]).toEqual(['gh', 'api', '--hostname', 'github.com', '-X', 'DELETE', 'repos/owner/repo/git/refs/heads/feat/done'])
  calls.length = 0
  expect(await mergePr(github, toPr(READY_PR, []), 'auto')).toEqual({ ok: true, merged: false })
  expect(calls.map(argv => argv[1])).toEqual(['repo', 'pr'])
  expect(calls[1]).toContain('--auto')
})

test('/desk-pr 패널의 머지: 두 번 눌러야 하고, 머지한 뒤 다시 읽는다', KO, async ($, on) => {
  const toasts: string[] = []
  let merged = 0
  let state = 'opened'
  on('process.run', (($: unknown, e: { argv: string[] }) => {
    const argv = e.argv
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'git' && argv.includes('--abbrev-ref')) return out('fix/sheet\n')
    if (argv[0] === 'gh') return out('', 1)
    if (argv.join(' ').startsWith('glab mr list')) return out(JSON.stringify(state === 'opened' ? [{ iid: 7 }] : []))
    if (argv.join(' ').startsWith('glab mr view')) return out(JSON.stringify({ ...READY_MR, state }))
    if (argv.includes('PUT')) {
      merged++
      state = 'merged'
      return out(JSON.stringify({ state: 'merged' }))
    }
    if (argv.at(-1)?.includes('/jobs')) return out(JSON.stringify(PASS_JOB))
    if (argv.at(-1)?.includes('/discussions')) return out('[]')
    return out('', 1)
  }) as never)
  on('clock.now', () => ({ value: 1000 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', ($, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined as never }
  })
  await $.command.run({ command: 'desk-pr', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-pr', viewport: VIEWPORT, props: { title: 'PR', isFocused: true } as never })
  expect(JSON.stringify(await pane.find({ type: 'Button', key: 'pr-merge' }))).toContain('머지')
  await pane.press({ key: 'pr-merge' })
  expect(merged).toBe(0)
  expect(JSON.stringify(await pane.drawn())).toContain('다시 누르면 머지해요')
  await pane.press({ key: 'pr-merge' })
  expect(merged).toBe(1)
  expect(toasts.join('\n')).toContain('MR !7 을 머지했어요')
  expect(await pane.find({ type: 'Button', key: 'pr-merge' })).toBeUndefined()
  await pane.unmount()
})

test('diff 범위: 기준 브랜치 후보, 커밋 목록, 범위 이름', KO, () => {
  expect(baseCandidates('develop', 'origin/main').slice(0, 3)).toEqual(['origin/develop', 'develop', 'origin/main'])
  expect(baseCandidates(null, null)[0]).toBe('origin/main')
  expect(parseCommits('abc123\x1fabc\x1fAdd done\x1falice\x1f2 hours ago\n')).toEqual([{ sha: 'abc123', short: 'abc', subject: 'Add done', author: 'alice', ago: '2 hours ago' }])
  expect(scopeOf('branch')).toBe('branch')
  expect(scopeOf('커밋별')).toBe('commits')
  expect(scopeOf('a.txt')).toBe(null)
})

const BRANCH_PATCH = 'diff --git a/b.txt b/b.txt\n--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-x\n+y\n'
// git show 은 커밋을 stdin 으로 받는다
const shasOf = (e: { init?: { stdin?: string } }) => (e.init?.stdin ?? '').split('\n').filter(Boolean)
const scopeStub = ($: unknown, e: { argv: string[]; init?: { stdin?: string } }) => {
  const argv = e.argv
  const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  if (argv[0] !== 'git') return out('', 1)
  if (argv.includes('--show-toplevel')) return out('/repo\n')
  if (argv.includes('--abbrev-ref')) return out('feat/done\n')
  if (argv[1] === 'symbolic-ref') return out('origin/main\n')
  if (argv[1] === 'rev-parse' && argv.includes('--verify')) return out(argv.at(-1) === 'origin/main^{commit}' ? 'base\n' : '', argv.at(-1) === 'origin/main^{commit}' ? 0 : 1)
  if (argv[1] === 'merge-base') return out('base000\n')
  if (argv[1] === 'diff' && argv[2] === 'HEAD') return out(DIFF_PATCH)
  if (argv[1] === 'diff' && argv[2] === 'base000') return out(DIFF_PATCH + BRANCH_PATCH)
  if (argv[1] === 'log') return out('c1sha\x1fc1\x1fAdd b\x1falice\x1f1 hour ago\nc2sha\x1fc2\x1fFix a\x1fbob\x1f2 hours ago\n')
  if (argv[1] === 'show') return out(shasOf(e).map(sha => `\x1e${sha}\n\n${sha === 'c1sha' ? BRANCH_PATCH : DIFF_PATCH}`).join('\n'))
  return out('')
}

test('diff 패널 범위: 브랜치 전체와 커밋별', KO, async ($, on) => {
  on('process.run', scopeStub as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'desk-diff', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-diff', viewport: VIEWPORT, props: { title: '변경 사항', isFocused: true } as never })
  expect(JSON.stringify(await pane.drawn())).toContain('Edited 1 file')
  expect(await pane.find({ type: 'Button', key: 'revert-a.txt' })).toBeDefined()

  await pane.press({ key: 'scope-branch' })
  let drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('Edited 2 files')
  expect(drawn).toContain('vs origin/main')
  // 브랜치 전체에서는 되돌리기가 없다
  expect(await pane.find({ type: 'Button', key: 'revert-a.txt' })).toBeUndefined()

  await pane.press({ key: 'scope-commits' })
  drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('2 commits')
  expect(drawn).toContain('Add b')
  expect(await pane.find({ type: 'Code' })).toBeUndefined()
  // 커밋을 펴면 그 파일들이 접힌 머리 줄로, 머리 줄을 누르면 diff
  await pane.press({ key: 'commit-c1sha' })
  expect(await pane.find({ type: 'Code' })).toBeUndefined()
  await pane.press({ key: 'fold-c:c1:b.txt' })
  expect(await pane.find({ type: 'Code' })).toBeDefined()
  await pane.press({ key: 'commit-c1sha' })
  expect(await pane.find({ type: 'Code' })).toBeUndefined()

  // /desk-diff 파일 이름으로 열면 커밋 안 한 변경으로 돌아온다
  await $.command.run({ command: 'desk-diff', args: 'a.txt' } as never)
  expect(await pane.find({ type: 'Button', key: 'revert-a.txt' })).toBeDefined()
  await pane.unmount()
})

test('diff 패널 범위: 브랜치 전체와 커밋별에도 모두 접기·펴기 (z)', KO, async ($, on) => {
  const shown: string[][] = []
  on('process.run', (($: unknown, e: { argv: string[]; init?: { stdin?: string } }) => {
    if (e.argv[1] === 'show') shown.push(shasOf(e))
    return scopeStub($, e)
  }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'desk-diff', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-diff', viewport: VIEWPORT, props: { title: '변경 사항', isFocused: true } as never })
  const codes = async () => (await pane.findAll({ type: 'Code' })).length
  const label = async () => JSON.stringify(await pane.find({ type: 'Button', key: 'fold-all' }))

  await pane.press({ key: 'scope-branch' })
  expect(await codes()).toBe(0)
  expect(await label()).toContain('모두 펴기')
  await pane.press({ key: 'fold-all' })
  expect(await codes()).toBe(2)
  await pane.press({ key: 'fold-all' })
  expect(await codes()).toBe(0)

  // 커밋별: 펼친 커밋이 없어도 버튼이 있고, 커밋 줄 전체를 git show 한 번으로 편다
  await pane.press({ key: 'scope-commits' })
  expect(await codes()).toBe(0)
  expect(await label()).toContain('모두 펴기')
  await pane.press({ key: 'fold-all' })
  expect(shown.at(-1)).toEqual(['c1sha', 'c2sha'])
  expect(await codes()).toBe(2)
  expect(await label()).toContain('모두 접기')
  // 커밋은 따로 접고 펼 수 있고, 하나라도 펴져 있으면 z 는 모두 접는다
  await pane.press({ key: 'commit-c1sha' })
  expect(await codes()).toBe(1)
  await pane.press({ key: 'fold-all' })
  expect(await codes()).toBe(0)
  await pane.press({ key: 'commit-c2sha' })
  await pane.press({ key: 'commit-c1sha' })
  expect(await codes()).toBe(2)
  await pane.unmount()
})

test('커밋 여러 개의 git show 출력을 커밋별로 나눈다', () => {
  expect(splitCommitDiffs('')).toEqual({})
  const split = splitCommitDiffs(`\x1ec1sha\n\n${BRANCH_PATCH}\n\x1ec2sha\n\x1ec3sha\n\n${DIFF_PATCH}`)
  expect(Object.keys(split)).toEqual(['c1sha', 'c2sha', 'c3sha'])
  expect(split.c1sha?.map(file => file.path)).toEqual(['b.txt'])
  expect(split.c2sha).toEqual([])
  expect(split.c3sha?.length).toBe(1)
})

test('아주 긴 줄·아주 큰 diff 는 내용을 비우고 +/− 수만 남긴다', () => {
  const head = (path: string) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n`
  const [bundle, small] = parseDiff(`${head('dist/app.js')}@@ -1 +1 @@\n-${'a'.repeat(3000)}\n+${'b'.repeat(3000)}\n${head('src/x.ts')}@@ -1 +1 @@\n-old\n+new\n`)
  expect(bundle).toEqual({ path: 'dist/app.js', added: 1, removed: 1, patch: '', isNew: false, large: true })
  expect(small?.patch).toBe('@@ -1 +1 @@\n-old\n+new')
  const lines = Array.from({ length: 5000 }, (_, index) => `+line ${index} ${'x'.repeat(40)}`).join('\n')
  expect(parseDiff(`${head('big.txt')}@@ -0,0 +1,5000 @@\n${lines}\n`)[0]?.large).toBe(true)
})

test('한 atom 에 함께 드는 diff 는 합계 안으로 큰 파일부터 비운다', () => {
  const file = (path: string, size: number) => ({ path, added: 1, removed: 0, patch: 'x'.repeat(size), isNew: false })
  const [branch, commit] = fitDiffs([[file('a', 50), file('b', 10)], [file('a', 50), file('c', 5)]], 80)
  expect(branch?.map(f => f.patch.length)).toEqual([0, 10])
  expect(branch?.[0]?.large).toBe(true)
  expect(commit?.map(f => f.patch.length)).toEqual([50, 5])
  const under = [[file('a', 10)]]
  expect(fitDiffs(under, 80)).toBe(under)
  // 브랜치 diff 와 펼친 커밋이 같은 3 MB 넘는 파일을 함께 들고 있으면 하나만 남는다(atom 은 4 MiB 상한)
  const view = fitView({ scope: 'commits', base: null, baseRef: null, bases: null, files: [file('a', 2_000_000)], commits: [], commitFiles: { c1: [file('a', 2_000_000)] } })
  expect(JSON.stringify(view).length).toBeLessThan(4_194_304)
  expect([view.files[0]?.large, view.commitFiles.c1?.[0]?.large].filter(Boolean).length).toBe(1)
})

import { T, langFromConfig, langSetting } from '../hooks/i18n'

test('언어: 설정 읽기와 Claude Code language 값 판정', () => {
  expect(langSetting({})).toBe('auto')
  expect(langSetting({ language: 'ko' })).toBe('ko')
  expect(langSetting({ language: 'fr' })).toBe('auto')
  expect(langFromConfig('Default (English)')).toBe('en')
  expect(langFromConfig('Korean')).toBe('ko')
  expect(langFromConfig('한국어')).toBe('ko')
  expect(langFromConfig('ko-KR')).toBe('ko')
  expect(langFromConfig('Japanese')).toBe('en')
  expect(langFromConfig(undefined)).toBe('en')
})

test('영어 문구: 시간·한도·질문 검사', () => {
  setLang('en')
  expect(ago(0, 5 * 60_000)).toBe('5m')
  expect(ago(0, 30_000)).toBe('now')
  expect(resetIn(new Date(4 * 3600_000 + 7 * 60_000 + 30_000).toISOString(), 0)).toBe('4h 7m')
  expect(T.limitNames.five_hour).toBe('5-hour')
  setLang('ko')
  expect(ago(0, 5 * 60_000)).toBe('5분')
})

test('기본(auto, Claude Code 언어 미설정)은 영어: diff 탭·PR 패널', async ($, on) => {
  on('process.run', (($: unknown, e: { argv: string[] }) => (e.argv[0] === 'gh' ? prStub($, e) : gitStub($, e))) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.now', () => ({ value: 1000 }))
  await $.command.run({ command: 'desk-diff', args: '' } as never)
  const diffPane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-diff', viewport: VIEWPORT, props: { title: 'Changes', isFocused: true } as never })
  const drawnDiff = JSON.stringify(await diffPane.drawn())
  expect(drawnDiff).toContain('○ Branch')
  expect(drawnDiff).not.toContain('브랜치 전체')
  await diffPane.unmount()
  await $.command.run({ command: 'desk-pr', args: '' } as never)
  const prPane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-pr', viewport: VIEWPORT, props: { title: 'PR', isFocused: true } as never })
  const drawn = JSON.stringify(await prPane.drawn())
  expect(drawn).toContain('Hand to Claude')
  expect(drawn).toContain('Review: review required')
  expect(drawn).toContain('2/4 passed')
  expect(drawn).toContain('Unresolved reviews')
  await prPane.unmount()
})

test('auto 는 Claude Code /config 의 language 를 따른다 (Korean → 한국어)', async ($, on) => {
  const descriptions: string[] = []
  on('config.list', () => ({ value: [{ key: 'language', label: 'Language', kind: 'text', value: 'Korean', provider: { kind: 'user' }, isLocked: false }] as never }))
  on('command.register', ($, e) => {
    descriptions.push(String((e as { description?: string }).description))
    return { value: undefined as never }
  })
  on('clock.every', () => ({ value: undefined }))
  on('session.start', ($, e) => e as never)
  on('process.run', gitStub as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal' } as never)
  expect(descriptions.some(text => text.includes('최근 세션'))).toBe(true)
  await $.command.run({ command: 'desk-diff', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-diff', viewport: VIEWPORT, props: { title: '변경 사항', isFocused: true } as never })
  expect(JSON.stringify(await pane.drawn())).toContain('● 커밋 안 한 변경')
  await pane.unmount()
})

test('에이전트 순수 함수: 모델 이름, 목록 합치기, 상세 차례', KO, async () => {
  expect(['claude-haiku-5-5', 'claude-opus-5-5[1m]', 'claude-sonnet-4-20250514', 'gpt-x', undefined].map(modelLabel)).toEqual(['Haiku 5.5', 'Opus 5.5', 'Sonnet 4', 'gpt-x', undefined])
  expect(stepTokens({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 })).toBe(135)
  const merged = mergeAgents(
    { a1: { id: 'a1', description: '날씨', type: 'Explore', status: 'running', toolUses: 4, tokens: 900, startedAt: 1000 } },
    [
      { id: 'a1', description: '날씨', type: 'Explore', status: 'completed' },
      { id: 'a2', description: '', type: 'general-purpose', status: 'running' },
      { id: 'a3', description: '기다림', type: 'Explore', status: 'waiting' },
    ],
    5000,
  )
  expect(merged.a1).toMatchObject({ status: 'completed', toolUses: 4, tokens: 900, startedAt: 1000, endedAt: 5000 })
  expect(merged.a2).toMatchObject({ description: 'general-purpose', status: 'running', toolUses: 0, startedAt: 5000 })
  expect(orderAgents(merged).live.map(agent => agent.id).sort()).toEqual(['a2', 'a3'])
  // 한 번의 실행이 끝났어도 엔진이 살아 있다고 하면 끝난 시각을 지운다.
  // 목록에 있다가 도는 채로 사라지면 끝을 놓친 것: 끝남으로. 목록에 없던 기록은 그대로.
  const missed = mergeAgents({ ...merged, a4: { id: 'a4', description: 'x', type: 'workflow', status: 'running', toolUses: 0 } }, [], 9000)
  expect(missed.a2).toMatchObject({ status: 'completed', endedAt: 9000 })
  expect(missed.a1).toMatchObject({ status: 'completed', endedAt: 5000 })
  expect(missed.a4?.status).toBe('running')
  expect(mergeAgents({ a3: { id: 'a3', description: '기다림', type: 'Explore', status: 'completed', toolUses: 1, endedAt: 3000 } }, [{ id: 'a3', description: '기다림', type: 'Explore', status: 'waiting' }], 6000).a3?.endedAt).toBeUndefined()
  // 목록에서 빼기: 끝난 것만, 엔진 목록을 다시 합쳐도 그대로 빠져 있고, 다시 돌면 돌아온다.
  const ended = { a3: { id: 'a3', description: 'x', type: 'Explore', status: 'completed', toolUses: 0, listed: true }, a5: { id: 'a5', description: 'y', type: 'Explore', status: 'running', toolUses: 0 } }
  const cleared = dismissAgents(ended)
  expect(orderAgents(cleared).done).toEqual([])
  expect(orderAgents(cleared).live.map(agent => agent.id)).toEqual(['a5'])
  expect(orderAgents(mergeAgents(cleared, [{ id: 'a3', description: 'x', type: 'Explore', status: 'completed' }], 7000)).done).toEqual([])
  expect(orderAgents(mergeAgents(cleared, [{ id: 'a3', description: 'x', type: 'Explore', status: 'running' }], 7000)).live.map(agent => agent.id)).toContain('a3')
  const detail = agentDetailOf('a1', [
    { role: 'user', text: '서울 날씨를 찾아라', toolUses: [] },
    { role: 'assistant', text: '도구를 불러옵니다.', toolUses: [{ tool_use_id: 't1', tool: 'Bash', input: { command: 'date' } }, { tool_use_id: 't2', tool: 'ToolSearch', input: { query: 'select:WebSearch' } }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't1', text: 'Mon', isError: false, result: undefined }, { tool_use_id: 't2', text: 'ok', isError: false, result: undefined }] },
    { role: 'assistant', text: '결론: 맑음', toolUses: [{ tool_use_id: 'h1', tool: 'SubagentHandback', input: { message: '## 서울 날씨\n맑음' } }] },
  ] as never)
  expect(detail.prompt).toBe('서울 날씨를 찾아라')
  // 보고 도구(SubagentHandback)는 도구 줄이 아니라 글로.
  expect(detail.items.map(item => item.kind)).toEqual(['text', 'run', 'text', 'text'])
  expect(detail.items[3]).toEqual({ kind: 'text', text: '## 서울 날씨\n맑음' })
  expect(detail.items[1]).toMatchObject({ kind: 'run', id: 't1' })
  expect(detail.items[1]?.kind === 'run' && detail.items[1].calls.map(call => call.tool)).toEqual(['Bash', 'ToolSearch'])
})

test('에이전트 패널: 띄우면 칩과 목록 카드, 누르면 대화', KO, async ($, on) => {
  let now = 1_000
  const opened: string[] = []
  let status = 'running'
  on('clock.now', () => ({ value: now }))
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('agent.list', () => ({ value: [{ id: 'a1', description: '오늘 서울 날씨 조사', type: 'Explore', status }] as never }))
  const views: unknown[] = []
  let viewDeny: string | undefined
  on('ui.view', ($, e) => {
    views.push(e)
    return { value: viewDeny === undefined ? {} : { deny: viewDeny } }
  })
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined as never }
  })
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('session.messages', ($, e) => ({
    value: (e.agentId === 'a1'
      ? [
          { role: 'user', text: 'Research **today** weather', toolUses: [] },
          { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'w1', tool: 'WebFetch', input: { url: 'https://example.com' } }] },
          { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'w1', text: 'page', isError: false, result: undefined }] },
          { role: 'assistant', text: '결론: 맑음', toolUses: [] },
        ]
      : []) as never,
  }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine-band</Text>
  })

  on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
  on('turn.step', async function* ($, e) {
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-5-5' } } as never
  })
  await $.turn.start({ text: 'Research today weather', turnId: 's1', agentId: 'a1' } as never)
  await wait(50)
  // 모델은 단계가 시작할 때 엔진이 준 값
  const stream = $.turn.step({ turnId: 's1', index: 0, model: 'claude-haiku-5-5', messageCount: 1, agentId: 'a1' } as never)
  let step = await stream.next()
  while (step.done !== true) step = await stream.next()
  await wait(20)
  await $.tool.call({ tool: 'WebFetch', url: 'https://example.com', prompt: 'x', agentId: 'a1' } as never)
  now = 19_000

  const band = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'AbovePrompt', viewport: VIEWPORT, props: { hasSurvey: false, isWorking: true, maxRows: 30, bodyColumns: 96 } as never })
  expect(await band.find({ type: 'Button', key: 'agents-chip' })).toBeDefined()
  // PR 칩의 ◆(안 풀린 리뷰)와 겹치지 않는 기호
  expect(JSON.stringify(await band.find({ type: 'Button', key: 'agents-chip' }))).toContain('⋯')
  await band.press({ key: 'agents-chip' })
  expect(opened).toEqual(['desk-tasks'])
  await band.unmount()

  const paneProps = { title: '백그라운드 작업', isFocused: true, bodyColumns: 60 }
  let pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-tasks', viewport: VIEWPORT, props: paneProps as never })
  const list = JSON.stringify(await pane.drawn())
  expect(list).toContain('실행 중')
  expect(list).toContain('오늘 서울 날씨 조사')
  expect(list).toContain('Haiku 5.5')
  expect(list).toContain('도구 1회')
  expect(list).toContain('18s')
  await pane.press({ key: 'agent-view-a1' })
  const detail = JSON.stringify(await pane.drawn())
  expect(detail).toContain('‹ 목록')
  expect(detail).toContain('today')
  expect(detail).toContain('Fetched a page')
  expect(detail).toContain('결론: 맑음')
  // 메인 화면에서 보기: 엔진에 그 에이전트를 띄워 달라고 하고, 거절되면 이유를 알린다.
  expect(detail).toContain('메인 화면에서 보기')
  await pane.press({ key: 'agent-main-a1' })
  expect(views).toEqual([{ agentId: 'a1' }])
  viewDeny = 'no agent'
  await pane.press({ key: 'agent-main-a1' })
  expect(toasts.join('\n')).toContain('no agent')
  viewDeny = undefined
  // 메인 화면에 그 에이전트가 떠 있으면: 같은 대화를 또 그리지 않고, 버튼은 메인 대화로 돌아가기.
  await pane.unmount()
  const viewed = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-tasks', viewport: VIEWPORT, props: { ...paneProps, view: { agentId: 'a1' } } as never })
  const viewedDetail = JSON.stringify(await viewed.drawn())
  expect(viewedDetail).toContain('메인 화면에 이 에이전트의 대화가 떠 있어요.')
  expect(viewedDetail).not.toContain('결론: 맑음')
  await viewed.press({ key: 'agent-main-back' })
  expect(views.at(-1)).toEqual({})
  // 맨 아래 뒤로가기도 같은 동작
  await viewed.press({ key: 'agent-back-end' })
  expect(JSON.stringify(await viewed.drawn())).toContain('◉ 보는 중')
  await viewed.unmount()
  pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-tasks', viewport: VIEWPORT, props: paneProps as never })
  expect(JSON.stringify(await pane.drawn())).toContain('대화 보기')
  // 번호로 바로 상세, 없는 번호는 알린다.
  expect(await $.command.run({ command: 'desk-tasks', args: '1' } as never)).toMatchObject({ text: '1번 작업: 오늘 서울 날씨 조사' })
  expect(JSON.stringify(await pane.drawn())).toContain('결론: 맑음')
  expect(await $.command.run({ command: 'desk-tasks', args: '7' } as never)).toMatchObject({ text: '7번 작업이 없어요. /desk-tasks 로 목록을 보세요.' })
  await $.command.run({ command: 'desk-tasks', args: '' } as never)

  // 끝나면 '끝남' 아래로 가고 칩이 사라진다.
  status = 'completed'
  await $.turn.complete({ durationMs: 18000, reason: 'answer', answer: '맑음', turnId: 't1', agentId: 'a1' } as never)
  const done = JSON.stringify(await pane.drawn())
  expect(done).toContain('끝남')
  expect(done).toContain('완료')
  await pane.unmount()
  const after = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'AbovePrompt', viewport: VIEWPORT, props: { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 96 } as never })
  expect(await after.find({ type: 'Button', key: 'agents-chip' })).toBeUndefined()
  await after.unmount()
})

const NOTICE = (id: string, status: string) =>
  `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<output-file>/tmp/t/${id}.output</output-file>\n<status>${status}</status>\n<summary>Background command "빌드 기다리기" ${status} (exit code 0)</summary>\n</task-notification>`

test('백그라운드 셸·모니터 순수 함수: 결과에서 작업, 알림 읽기·반영, 출력 끝부분', KO, async () => {
  expect(backgroundTaskOf('Bash', { command: 'sleep 9', description: '빌드 기다리기' }, { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' }, 100)).toMatchObject({ id: 'b1', kind: 'shell', description: '빌드 기다리기', command: 'sleep 9', status: 'running', startedAt: 100 })
  expect(backgroundTaskOf('Bash', { command: 'ls' }, { stdout: 'a', stderr: '', interrupted: false }, 100)).toBe(null)
  expect(backgroundTaskOf('Monitor', { description: '로그 감시', command: 'tail -f x', timeout_ms: 1000 }, { taskId: 'm1', timeoutMs: 1000 }, 5)).toMatchObject({ id: 'm1', kind: 'monitor', description: '로그 감시' })
  const notices = parseNotices(`앞 글\n${NOTICE('b1', 'completed')}\n${NOTICE('zz', 'failed')}`)
  expect(notices).toEqual([
    { id: 'b1', status: 'completed', outputFile: '/tmp/t/b1.output', summary: 'Background command "빌드 기다리기" completed (exit code 0)' },
    { id: 'zz', status: 'failed', outputFile: '/tmp/t/zz.output', summary: 'Background command "빌드 기다리기" failed (exit code 0)' },
  ])
  const applied = applyNotices({ b1: { id: 'b1', kind: 'shell', description: 'x', type: 'shell', status: 'running', toolUses: 0, startedAt: 0 } }, notices, 900)
  expect(applied.b1).toMatchObject({ status: 'completed', endedAt: 900, outputFile: '/tmp/t/b1.output' })
  expect(applied.zz).toBeUndefined()
  // 모니터 만료는 <status> 없이 event 로만 온다 → 끝남. 일반 모니터 이벤트는 상태를 바꾸지 않는다.
  const expired = parseNotices('<task-notification>\n<task-id>m1</task-id>\n<summary>Monitor event: "로그 감시"</summary>\n<event>[Monitor expired after 30m with 12 events delivered. Re-arm it if you still need the watch.]</event>\n</task-notification>')
  expect(expired).toEqual([{ id: 'm1', status: 'completed', summary: 'Monitor event: "로그 감시"' }])
  expect(parseNotices('<task-notification>\n<task-id>m1</task-id>\n<summary>Monitor event: "로그 감시"</summary>\n<event>== base 1</event>\n</task-notification>')[0]?.status).toBeUndefined()
  const monitor = { m1: { id: 'm1', kind: 'monitor', description: '로그 감시', type: 'monitor', status: 'running', toolUses: 0, startedAt: 0 } } as const
  expect(applyNotices(monitor, expired, 1800)).toMatchObject({ m1: { status: 'completed', endedAt: 1800 } })
  // 지난 세션에서 끝나지 못한 작업 묶음: id 마다 멈춤, 표지 id 는 빼고
  const orphans = parseNotices('<task-notification>\n<task-id>b8</task-id>\n<task-id>b9</task-id>\n<task-id>__orphan_summary__:shell</task-id>\n<status>stopped</status>\n<summary>2 background shell command tasks didn\'t finish</summary>\n</task-notification>')
  expect(orphans.map(notice => [notice.id, notice.status])).toEqual([['b8', 'stopped'], ['b9', 'stopped']])
  expect(tailOf('a\nb\nc\n', 2)).toBe('… 1줄 더\nb\nc')
  expect(exitStatusOf('out\n\n[exited with code 0]\n')).toBe('completed')
  expect(exitStatusOf('out\n[exited with code 144]')).toBe('failed')
  expect(exitStatusOf('[exited with code 0]\nstill running\n')).toBeUndefined()
})

test('백그라운드 작업 패널: 셸이 뜨고, 멈춤은 두 번, 끝남 알림 뒤 출력', KO, async ($, on) => {
  let now = 1_000
  const stopped: string[] = []
  on('clock.now', () => ({ value: now }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined as never }))
  on('agent.list', () => ({ value: [] as never }))
  on('fs.read', ($, e) => ({ value: (String((e as { path?: string }).path ?? e) === '/tmp/t/b2.output' ? 'line1\nline2\n' : '') as never }))
  on('tool.call', ($, e) => {
    if (e.tool === 'TaskStop') {
      stopped.push(String((e as { task_id?: string }).task_id))
      return { result: { message: 'stopped', task_id: (e as { task_id?: string }).task_id, task_type: 'local_bash' } } as never
    }
    const id = (e as { command?: string }).command === 'make watch' ? 'b1' : 'b2'
    return { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: id } } as never
  })
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)

  await $.tool.call({ tool: 'Bash', command: 'make watch', description: '감시 빌드', run_in_background: true } as never)
  now = 2_000
  await $.tool.call({ tool: 'Bash', command: 'sleep 20; echo done', run_in_background: true } as never)
  now = 64_000
  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-tasks', viewport: VIEWPORT, props: { title: '백그라운드 작업', isFocused: true, bodyColumns: 70 } as never })
  const list = JSON.stringify(await pane.drawn())
  expect(list).toContain('감시 빌드')
  expect(list).toContain('make watch')
  expect(list).toContain('1m 3s')
  expect(list).toContain('자세히')

  // 멈춤: 한 번은 묻기만, 두 번째에 TaskStop
  await pane.press({ key: 'stop-b1' })
  expect(stopped).toEqual([])
  expect(JSON.stringify(await pane.drawn())).toContain('멈출까요?')
  await pane.press({ key: 'stop-b1' })
  expect(stopped).toEqual(['b1'])

  // 끝남 알림 → 끝남, 상세에 출력 끝부분
  await $.prompt.submit({ text: NOTICE('b2', 'completed'), origin: { kind: 'task-notification' }, wait: false } as never)
  expect(await $.command.run({ command: 'desk-tasks', args: '1' } as never)).toMatchObject({ text: '1번 작업: sleep 20; echo done' })
  const detail = JSON.stringify(await pane.drawn())
  expect(detail).toContain('완료')
  expect(detail).toContain('빌드 기다리기')
  expect(detail).toContain('line2')
  await $.command.run({ command: 'desk-tasks', args: '' } as never)
  const done = JSON.stringify(await pane.drawn())
  expect(done).toContain('중지됨')
  expect(done).toContain('끝남 2')
  // 끝남 접기(z) → 카드가 안 보이고, 다시 펴면 보인다
  await pane.press({ key: 'tasks-done-fold' })
  expect(JSON.stringify(await pane.drawn())).not.toContain('감시 빌드')
  await pane.press({ key: 'tasks-done-fold' })
  // 한 장 지우기 → 나머지는 남는다, 끝난 것 모두 지우기(c) → 빈 목록
  await pane.press({ key: 'dismiss-b1' })
  const one = JSON.stringify(await pane.drawn())
  expect(one).not.toContain('감시 빌드')
  expect(one).toContain('끝남 1')
  await pane.press({ key: 'tasks-clear-done' })
  expect(JSON.stringify(await pane.drawn())).toContain('끝난 작업을 목록에서 모두 지웠어요')
  await pane.unmount()
})

test('끝남 알림을 못 받은 셸(서브에이전트가 띄운 것)은 출력 파일 끝의 종료 줄로 끝남이 된다', KO, async ($, on) => {
  let output = 'line1\n'
  let reads = 0
  on('clock.now', () => ({ value: 1_000 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.list', () => ({ value: [] as never }))
  on('fs.stat', () => ({ value: { kind: 'file', size: output.length, mtimeMs: 0, isLink: false } as never }))
  on('fs.read', () => {
    reads++
    return { value: output as never }
  })
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b5' }, text: 'Command running in background with ID: b5. Output is being written to: /tmp/t/b5.output. You will be notified' }) as never)
  await $.tool.call({ tool: 'Bash', command: 'python3 v.py', description: '검증기 돌리기', run_in_background: true, agentId: 'a1' } as never)
  await $.command.run({ command: 'desk-tasks', args: '1' } as never)
  await $.command.run({ command: 'desk-tasks', args: '1' } as never)
  // 크기가 그대로면 다시 읽지 않는다(상세 화면이 읽는 몫 하나씩 + 처음 한 번)
  const before = reads
  output += 'KeyError: x\n\n[exited with code 1]\n'
  await $.command.run({ command: 'desk-tasks', args: '1' } as never)
  expect(reads).toBe(before + 2)
  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-tasks', viewport: VIEWPORT, props: { title: '백그라운드 작업', isFocused: true, bodyColumns: 70 } as never })
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('실패')
  expect(drawn).not.toContain('실행 중')
  await pane.unmount()
})

test('끝을 놓친 작업: 멈춤이 No task found 로 실패하면 끝남으로 옮긴다', KO, async ($, on) => {
  const toasts: string[] = []
  on('clock.now', () => ({ value: 1_000 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', ($, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined as never }
  })
  on('agent.list', () => ({ value: [] as never }))
  on('tool.call', ($, e) => {
    if (e.tool === 'TaskStop') return { result: '<tool_use_error>No task found with ID: m9</tool_use_error>', isError: true, text: '<tool_use_error>No task found with ID: m9</tool_use_error>' } as never
    return { result: { taskId: 'm9', timeoutMs: 1800000, persistent: false } } as never
  })
  await $.tool.call({ tool: 'Monitor', command: 'tail -f x', description: '로그 감시' } as never)
  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-tasks', viewport: VIEWPORT, props: { title: '백그라운드 작업', isFocused: true, bodyColumns: 70 } as never })
  await pane.press({ key: 'stop-m9' })
  await pane.press({ key: 'stop-m9' })
  expect(toasts.join('\n')).toContain('이미 끝난 작업이에요: 로그 감시')
  expect(JSON.stringify(await pane.drawn())).toContain('끝남 1')
  await pane.unmount()
})

test('agent.spawn 없이 시작한 에이전트(포크된 스킬)도 활동이 보이면 패널에 올라온다', KO, async ($, on) => {
  let listed = 0
  on('clock.now', () => ({ value: 5_000 }))
  on('agent.list', () => {
    listed++
    return { value: [{ id: 'f1', description: '/code-review low', type: 'code-review', status: 'running' }] as never }
  })
  on('tool.call', () => ({ result: 'ok' }) as never)
  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-tasks', viewport: VIEWPORT, props: { title: '백그라운드 작업', isFocused: true, bodyColumns: 70 } as never })
  expect(JSON.stringify(await pane.drawn())).not.toContain('/code-review low')
  await $.tool.call({ tool: 'Read', file_path: 'a.md', agentId: 'f1' } as never)
  let drawn = JSON.stringify(await pane.drawn())
  for (let tries = 0; tries < 50 && !drawn.includes('/code-review low'); tries++) {
    await wait(10)
    drawn = JSON.stringify(await pane.drawn())
  }
  expect(drawn).toContain('/code-review low')
  // 같은 id 로 또 와도 목록을 다시 묻지 않는다
  const before = listed
  await $.tool.call({ tool: 'Read', file_path: 'b.md', agentId: 'f1' } as never)
  expect(listed).toBe(before)
  await pane.unmount()
})

// 미리보기 패널: 파일은 /repo 아래에 두고, 쓰기·편집은 files 에 남긴다.
const docWorld = (on: On, files: Record<string, string>, run: typeof gitStub = gitStub) => {
  const opened: { id: string; title?: string }[] = []
  on('process.run', run as never)
  on('clock.now', () => ({ value: 0 }))
  on('fs.read', ($, e) => {
    const text = files[(e as { path: string }).path]
    if (text === undefined) throw new Error('ENOENT')
    return { value: text } as never
  })
  on('fs.stat', ($, e) => ({ value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false, realPath: (e as { path: string }).path } }) as never)
  on('ui.open', ($, e) => {
    opened.push({ id: e.id, title: (e as { title?: string }).title })
    return { value: { isPlaced: true } }
  })
  on('tool.call', ($, e) => {
    const call = e as { tool: string; file_path?: string; content?: string; old_string?: string; new_string?: string }
    if (call.tool === 'Write' && call.file_path) files[call.file_path] = call.content ?? ''
    if (call.tool === 'Edit' && call.file_path) files[call.file_path] = (files[call.file_path] ?? '').replace(call.old_string ?? '', call.new_string ?? '')
    return { result: 'ok' } as never
  })
  on('turn.complete', () => ({ text: '썼어요' }) as never)
  return opened
}
const DOC = ['---', 'title: "릴리즈 노트"', 'status: draft', '---', '# 0.23.0', '', '## 바뀐 점', '', '| 항목 | 상태 |', '|---|---|', '| 미리보기 | 완료 |'].join('\n')

describe('미리보기 패널', () => {
  test('순수 함수: front matter 떼기, 행이 다룬 문서', KO, async () => {
    expect(splitFrontMatter(DOC).fields).toEqual([
      ['title', '릴리즈 노트'],
      ['status', 'draft'],
    ])
    expect(splitFrontMatter(DOC).body.startsWith('# 0.23.0')).toBe(true)
    expect(splitFrontMatter('---\n열리고 안 닫힘').fields).toEqual([])
    expect(previewOf({ tool: 'Write', input: { file_path: '/r/a.md' }, isErrored: false, isRunning: false })).toBe('/r/a.md')
    expect(previewOf({ tool: 'Edit', input: { file_path: '/r/a.ts' }, isErrored: false, isRunning: false })).toBeNull()
    expect(previewOf({ tool: 'Write', input: { file_path: '/r/a.md' }, isErrored: true, isRunning: false })).toBeNull()
    expect(previewOf({ tool: 'mcp__desk-look__preview', input: { path: 'docs/x.mdx' }, isErrored: false, isRunning: false })).toBe('docs/x.mdx')
  })

  test('쓴 문서는 턴이 끝날 때 열리고, 열린 문서는 편집을 따라간다', KO, async ($, on) => {
    const files: Record<string, string> = {}
    const opened = docWorld(on, files)
    await $.tool.call({ tool: 'Write', file_path: '/repo/NOTES.md', content: DOC } as never)
    expect(opened).toEqual([])
    await $.turn.complete({ durationMs: 1000, reason: 'answer', answer: '썼어요', turnId: 't1' } as never)
    expect(opened).toEqual([{ id: 'desk-preview', title: 'NOTES.md' }])

    const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-preview', viewport: VIEWPORT, props: { title: 'NOTES.md', isFocused: false, bodyColumns: 70 } as never })
    // 머리: 이름은 따로(좁아도 잘리지 않게), 폴더는 흐리게
    expect(await pane.find({ type: 'Text', text: 'NOTES.md' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '/repo' })).toBeDefined()
    const drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('릴리즈 노트')
    expect(drawn).toContain('0.23.0')
    expect(drawn).toContain('미리보기')
    expect(drawn).not.toContain('status: draft')

    await $.tool.call({ tool: 'Edit', file_path: '/repo/NOTES.md', old_string: '완료', new_string: '검토 중' } as never)
    expect(JSON.stringify(await pane.drawn())).toContain('검토 중')
    // d: 같은 문서를 diff 패널에서
    await pane.press({ key: 'preview-changes' })
    expect(opened.map(item => item.id)).toEqual(['desk-preview', 'desk-diff'])

    // .claude/ 아래(메모리·플랜)는 저절로 열지 않는다
    await $.tool.call({ tool: 'Write', file_path: '/home/me/.claude/plans/p.md', content: '# plan' } as never)
    await $.turn.complete({ durationMs: 2000, reason: 'answer', answer: '썼어요', turnId: 't2' } as never)
    expect(opened).toHaveLength(2)
    await pane.unmount()
  })

  test('브라우저용 HTML: 패널과 같은 구조, 글은 이스케이프, 위험한 링크는 글자만', KO, async () => {
    const html = previewHtml(
      [DOC, '', '> [!WARNING]', '> 조심', '', '```mermaid', 'graph TD; A-->B', '```', '', '[나쁜](javascript:void0) [좋은](docs/a.md) <b>태그</b>', '', '와! ![패널 사진](docs/p.png)', '', '|왼|오|', '|:-|-:|', '|1|2|'].join('\n'),
      '/repo/my docs/NOTES.md',
    )
    expect(html).toContain('<base href="file:///repo/my%20docs/">')
    expect(html).toContain('<title>NOTES.md</title>')
    expect(html).toContain('<dt>status</dt><dd>draft</dd>')
    expect(html).toContain('<h1>0.23.0</h1>')
    expect(html).toContain('<div class="alert warning"><p class="alert-title">⚠ Warning</p><p>조심</p></div>')
    expect(html).toContain('<pre class="mermaid">graph TD; A--&gt;B</pre>')
    expect(html).toContain('mermaid@11.4.1')
    expect(html).toContain('나쁜 <a href="docs/a.md">좋은</a> &lt;b&gt;태그&lt;/b&gt;')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('<p>와! <img src="docs/p.png" alt="패널 사진"></p>')
    expect(html).toContain('<td style="text-align:right">2</td>')
    expect(previewHtml('# 그림 없음', '/r/a.md')).not.toContain('<script')
  })

  test('o: 문서를 엔진 임시 폴더에 HTML 로 쓰고 xdg-open 으로, 없으면 open 으로 연다', KO, async ($, on) => {
    const runs: string[][] = []
    const toasts: string[] = []
    const files: Record<string, string> = { '/repo/NOTES.md': DOC }
    const hasXdg = { value: true }
    docWorld(on, files, ($, e) => {
      const argv = (e as { argv: string[] }).argv
      if (argv[0] === 'id') return { value: { exitCode: 0, stdout: '1000\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      if (argv[0] !== 'xdg-open' && argv[0] !== 'open') return gitStub($, e)
      runs.push(argv)
      if (argv[0] === 'xdg-open' && !hasXdg.value) throw new Error('ENOENT: xdg-open')
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('fs.write', ($, e) => {
      const call = e as { path: string; text: string }
      files[call.path] = call.text
      return { value: undefined } as never
    })
    on('ui.toast', ($, e) => {
      toasts.push((e as { text: string }).text)
      return { value: undefined } as never
    })
    await $.tool.call({ tool: 'Write', file_path: '/repo/NOTES.md', content: DOC } as never)
    await $.turn.complete({ durationMs: 1000, reason: 'answer', answer: '썼어요', turnId: 't1' } as never)
    const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-preview', viewport: VIEWPORT, props: { title: 'NOTES.md', isFocused: false, bodyColumns: 70 } as never })
    const page = '/tmp/claude-1000/desk-look/NOTES.html'
    await pane.press({ key: 'preview-browser' })
    expect(files[page]).toContain('<h1>0.23.0</h1>')
    expect(runs).toEqual([['xdg-open', page]])
    expect(toasts).toEqual([`브라우저로 열었어요: ${page}`])
    hasXdg.value = false
    await pane.press({ key: 'preview-browser' })
    expect(runs.slice(1)).toEqual([['xdg-open', page], ['open', page]])
    await pane.unmount()
  })

  test('편집 행과 묶음 줄의 ◫ 칩이 문서를 연다', KO, async ($, on) => {
    const opened = docWorld(on, { '/repo/README.md': '# 읽어 보기' })
    const row = await $.ui.mount({
      plugin: 'desk-look',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: 'w1',
      viewport: VIEWPORT,
      props: { tool_use_id: 'w1', tool: 'Edit', input: { file_path: '/repo/README.md', old_string: 'a', new_string: 'b' }, isRunning: false, isErrored: false, isInterrupted: false },
    })
    await row.press({ key: 'preview-w1' })
    expect(opened).toEqual([{ id: 'desk-preview', title: 'README.md' }])
    await row.unmount()

    const code = await $.ui.mount({
      plugin: 'desk-look',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: 'w2',
      viewport: VIEWPORT,
      props: { tool_use_id: 'w2', tool: 'Edit', input: { file_path: '/repo/app.ts', old_string: 'a', new_string: 'b' }, isRunning: false, isErrored: false, isInterrupted: false },
    })
    expect(JSON.stringify(await code.drawn())).not.toContain('◫')
    await code.unmount()

    const group = await $.ui.mount({
      plugin: 'desk-look',
      surface: 'terminal',
      component: 'ToolGroup',
      requestId: 'g1',
      viewport: VIEWPORT,
      props: {
        calls: [
          { tool_use_id: 'g-r', ...call('Read', { file_path: '/repo/a.ts' }) },
          { tool_use_id: 'g-w', ...call('Write', { file_path: '/repo/README.md', content: '# 읽어 보기' }) },
        ],
      } as never,
    })
    expect(JSON.stringify(await group.drawn())).toContain('◫ README.md')
    await group.unmount()
  })

  test('저절로 열기를 끄면 턴 끝에 열지 않고, /desk-preview 와 preview 도구로 연다', { options: { language: 'ko', previewAutoOpen: 'off' } }, async ($, on) => {
    const files: Record<string, string> = { '/repo/docs/guide.md': '# 안내' }
    const opened = docWorld(on, files)
    await $.tool.call({ tool: 'Write', file_path: '/repo/NOTES.md', content: '# 메모' } as never)
    await $.turn.complete({ durationMs: 1000, reason: 'answer', answer: '썼어요', turnId: 't1' } as never)
    expect(opened).toEqual([])

    expect(await $.command.run({ command: 'desk-preview', args: '' } as never)).toMatchObject({ text: '아직 미리본 문서가 없어요. /desk-preview <파일> 로 여세요.' })
    expect(await $.command.run({ command: 'desk-preview', args: '/repo/NOTES.md' } as never)).toMatchObject({ text: 'NOTES.md 을(를) 미리보기 패널에 펼쳤어요.' })
    const ran = await $.tool.call({ tool: 'mcp__desk-look__preview', path: '/repo/docs/guide.md' } as never)
    expect(ran.result).toBe('Showing /repo/docs/guide.md in the preview pane.')
    expect((await $.tool.call({ tool: 'mcp__desk-look__preview', path: '/repo/none.md' } as never)).deny).toMatch(/Couldn't open \/repo\/none\.md for preview/)
    expect(opened.map(item => item.title)).toEqual(['NOTES.md', 'guide.md', 'none.md'])
  })
})

describe('데스크톱 모양 diff', () => {
  // 시험 테마(밝음, 바탕 #fafafa)의 diff 색
  const TINT = diffPalette('light', '#fafafa', 'inactive')
  test('순수 함수: hunk 읽기, 행 만들기(안 바뀐 구간·단어 강조), 창 계획', KO, async () => {
    const hunks = parseHunks('@@ -10,3 +10,3 @@\n keep\n-const total = price * qty\n+const total = price * quantity\n end\n@@ -40 +40,2 @@\n-x\n+y\n+z')
    expect(hunks.map(hunk => [hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines])).toEqual([
      [10, 3, 10, 3],
      [40, 1, 40, 2],
    ])
    expect(hunks[0]?.lines.map(l => `${l.kind}${l.oldNo}:${l.newNo}`)).toEqual([' 10:10', '-11:0', '+0:11', ' 12:12'])
    const rows = diffRows(hunks)
    // 첫 hunk 앞 9줄, 두 hunk 사이 27줄(13~39)
    expect(rows.filter(row => row.kind === 'gap').map(row => (row.kind === 'gap' ? row.count : 0))).toEqual([9, 27])
    expect(diffRows(hunks, false).some(row => row.kind === 'gap')).toBe(false)
    // qty → quantity 만 강조
    const changed = rows.filter(row => row.kind === 'line' && row.span)
    expect(changed.map(row => (row.kind === 'line' && row.span ? row.line.text.slice(row.span[0], row.span[1]) : ''))).toEqual(['qty', 'quantity'])
    // 줄 대부분이 바뀌면 강조하지 않는다
    expect(wordSpan('x', 'y')).toBeNull()
    expect(gutterWidth(rows)).toBe(5)
    expect(rows.reduce((sum, row) => sum + rowHeight(row), 0)).toBe(2 * 3 + 7)
    // 창: 첫 행 100, 화면 10행 → 앞뒤 한 화면(90~119)과 always 만. 맨 위는 그리지 않는다
    const items = Array.from({ length: 200 }, (_, i) => ({ height: 1, always: i === 150 }))
    const steps = windowPlan(items, 100, 10)
    const drawn = steps.flatMap(step => ('draw' in step ? [step.draw] : []))
    expect(drawn[0]).toBe(90)
    expect(drawn).not.toContain(0)
    expect(drawn).not.toContain(89)
    expect(drawn).toContain(90)
    expect(drawn).toContain(119)
    expect(drawn).not.toContain(120)
    expect(drawn).toContain(150)
    // 그린 행과 건너뛴 칸의 높이 합은 늘 전체와 같다
    expect(steps.reduce((sum, step) => sum + ('skip' in step ? step.skip : 1), 0)).toBe(200)
  })

  test('같은 종류로 이어진 줄은 덩어리 하나로, 단어 강조 줄은 홀로, 덩어리는 16줄까지', KO, async () => {
    const patch = ['@@ -1,3 +1,23 @@', ' a', ' b', '-const total = price * qty', '+const total = price * quantity', ...Array.from({ length: 20 }, (_, i) => `+line ${i}`), ' c'].join('\n')
    const blocks = diffBlocks(diffRows(parseHunks(patch)))
    expect(blocks.map(b => (b.kind === 'gap' ? `gap${b.count}` : `${b.lines[0]?.kind}${b.lines.length}${b.span ? '*' : ''}`))).toEqual([' 2', '-1*', '+1*', '+16', '+4', ' 1'])
    // 높이 합은 행 수와 같다(가상 스크롤이 행 번호로 셈한다)
    expect(blocks.reduce((sum, b) => sum + blockHeight(b), 0)).toBe(diffRows(parseHunks(patch)).length)
  })

  test('256색으로 그려질 때는 팔레트에 있는 색을 그대로 쓴다', KO, async () => {
    expect(isTruecolor({ COLORTERM: 'truecolor' })).toBe(true)
    expect(isTruecolor({ COLORTERM: '24bit' })).toBe(true)
    // tmux 안에서는 엔진이 256색으로 줄인다
    expect(isTruecolor({ COLORTERM: 'truecolor', TMUX: '/tmp/tmux-1000/default,1,0' })).toBe(false)
    expect(isTruecolor({})).toBe(false)
    const cube = new Set([0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff])
    const onCube = (hex: string) => [1, 3, 5].every(i => cube.has(parseInt(hex.slice(i, i + 2), 16)))
    for (const mode of ['light', 'dark'] as const) {
      const p = diffPalette(mode, mode === 'light' ? '#fafafa' : '#1a1b26', 'inactive', false)
      const tints = [p.addBg, p.delBg, p.addStrong, p.delStrong, p.addBar, p.delBar]
      // 모두 팔레트 칸이라 줄여도 제자리이고, 바탕과 진한 강조가 서로 다르다
      expect(tints.every(onCube)).toBe(true)
      expect(new Set(tints).size).toBe(tints.length)
    }
  })

  test('어두운 테마: 패널 바탕은 말풍선 색, tmux 안(256색)에서는 팔레트 회색', KO, async ($, on) => {
    let tmux: string | undefined
    const opened: { backgroundColor?: string }[] = []
    on('env.get', ($, e) => {
      const name = String((e as { name?: string }).name ?? e)
      return { value: (name === 'HOME' ? '/home/t' : name === 'COLORTERM' ? 'truecolor' : name === 'TMUX' ? tmux : undefined) as never }
    })
    on('fs.read', ($, e) => {
      const path = String((e as { path?: string }).path ?? e)
      if (path.endsWith('colors.toml')) return { value: 'mode = "dark"\nbackground = "#1a1b26"\n' } as never
      throw new Error('ENOENT')
    })
    on('prompt.submit', ($, e) => ({ text: e.text }) as never)
    on('ui.open', ($, e) => {
      opened.push(e as { backgroundColor?: string })
      return { value: { isPlaced: true } }
    })
    for (const where of [undefined, '/tmp/tmux-1000/default,1,0']) {
      tmux = where
      await $.prompt.submit({ text: '테마', origin: { kind: 'composer' }, wait: false } as never)
      const want = where ? '#303030' : '#2c2d37'
      for (let tries = 0; tries < 50; tries++) {
        opened.length = 0
        await $.command.run({ command: 'desk-context', args: '' } as never)
        if (opened.at(-1)?.backgroundColor === want) break
        await wait(10)
      }
      expect(opened.at(-1)?.backgroundColor).toBe(want)
    }
  })

  // Omarchy 밝은 테마 파일을 읽게 하고 프롬프트 하나로 테마를 읽힌다. 터미널은 truecolor(tmux 밖).
  // sent 를 주면 엔진까지 간 프롬프트(글·context)를 모은다.
  const lightTheme = (on: On, sent?: { text: string; context?: readonly string[] }[]) => {
    on('env.get', ($, e) => {
      const name = String((e as { name?: string }).name ?? e)
      return { value: (name === 'HOME' ? '/home/t' : name === 'COLORTERM' ? 'truecolor' : undefined) as never }
    })
    on('fs.read', ($, e) => {
      const path = String((e as { path?: string }).path ?? e)
      if (path.endsWith('colors.toml')) return { value: 'mode = "light"\nbackground = "#fafafa"\n' } as never
      throw new Error('ENOENT')
    })
    on('prompt.submit', ($, e) => {
      sent?.push({ text: e.text, context: e.context })
      return { text: e.text } as never
    })
  }
  const BIG = Array.from({ length: 600 }, (_, i) => `+line ${i}`).join('\n')
  const THEMED_PATCH = [
    'diff --git a/src/cart.ts b/src/cart.ts\n--- a/src/cart.ts\n+++ b/src/cart.ts\n@@ -10,3 +10,3 @@\n keep\n-const total = price * qty\n+const total = price * quantity\n end',
    `diff --git a/big.ts b/big.ts\n--- a/big.ts\n+++ b/big.ts\n@@ -0,0 +1,600 @@\n${BIG}`,
  ].join('\n')

  test('테마를 알면 diff 패널을 데스크톱처럼, 큰 파일은 보이는 곳만 그린다', KO, async ($, on) => {
    lightTheme(on)
    on('process.run', (($: unknown, e: { argv: string[] }) => {
      const stdout = e.argv.includes('--show-toplevel') ? '/repo\n' : e.argv[1] === 'diff' && e.argv[2] === 'HEAD' ? THEMED_PATCH : e.argv.includes('--abbrev-ref') ? 'main\n' : ''
      return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }) as never)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('clock.now', () => ({ value: 0 }))
    on('tool.call', () => ({ result: 'ok' }) as never)
    await $.prompt.submit({ text: '테마', origin: { kind: 'composer' }, wait: false } as never)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/src/cart.ts', old_string: 'qty', new_string: 'quantity' } as never)
    await $.command.run({ command: 'desk-diff', args: '' } as never)
    const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-diff', viewport: VIEWPORT, props: { title: '변경 사항', isFocused: true, bodyRows: 30 } as never })
    await openAll(pane)
    for (let tries = 0; tries < 50 && !(await pane.find({ type: 'Text', text: /안 바뀐 줄/ })); tries++) await wait(10)
    const drawn = JSON.stringify(await pane.drawn())
    // 줄 전체 폭 틴트, 진한 단어 강조, 파일 머리 띠(이름 굵게, 폴더 흐리게), 안 바뀐 구간
    expect(drawn).toContain(`"backgroundColor":"${TINT.addBg}"`)
    expect(drawn).toContain(`"backgroundColor":"${TINT.delBg}"`)
    expect(drawn).toContain(`"backgroundColor":"${TINT.addStrong}"`)
    expect(await pane.find({ type: 'Text', text: 'cart.ts' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: ' src' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '안 바뀐 줄 9개' })).toBeDefined()
    // 엔진 diff 는 쓰지 않는다
    expect(drawn).not.toContain('"format":"diff"')
    // 600줄 파일: 처음 창(위 두 화면)만 Code 로, 나머지는 높이만 있는 빈 칸
    const codes = (await pane.findAll({ type: 'Code' })).length
    expect(codes).toBeLessThan(200)
    expect(drawn).toMatch(/"height":(4\d\d|5\d\d)/)
    // 줄 댓글용 번호 버튼은 보이는 덩어리에만(앞뒤로 미리 그리는 화면에는 달지 않는다)
    expect(await pane.find({ type: 'Button', key: 'd-big.ts.0.p0' })).toBeDefined()
    // 아래로 미리 그린 덩어리(100행쯤)는 그리되 버튼은 없다
    expect(JSON.stringify(await pane.drawn())).toContain('"d-big.ts.6"')
    expect(await pane.find({ type: 'Button', key: 'd-big.ts.6.p0' })).toBeUndefined()
    // 머리 띠 접기는 그대로
    await pane.press({ key: 'fold-big.ts' })
    expect((await pane.findAll({ type: 'Code' })).length).toBeLessThan(codes)
    // 접은 파일도 이름으로 열면(openDiffAt) 다시 펼치고, 그 머리 띠(file-…)는 보이는 곳만 그려도 늘 있다
    await pane.press({ key: 'fold-src/cart.ts' })
    expect(await pane.find({ type: 'Text', text: '안 바뀐 줄 9개' })).toBeUndefined()
    await $.command.run({ command: 'desk-diff', args: 'cart.ts' } as never)
    expect(await pane.find({ type: 'Text', text: '안 바뀐 줄 9개' })).toBeDefined()
    expect(await pane.find({ key: 'file-src/cart.ts' } as never)).toBeDefined()
    expect(await pane.find({ key: 'file-big.ts' } as never)).toBeDefined()
    await pane.unmount()
  })

  test('스크롤 없이 창이 바뀌어도(터미널 크기·원격 접속) 엔진이 알려 준 창 자리를 그린다', KO, async ($, on) => {
    lightTheme(on)
    on('process.run', (($: unknown, e: { argv: string[] }) => {
      const stdout = e.argv.includes('--show-toplevel') ? '/repo\n' : e.argv[1] === 'diff' && e.argv[2] === 'HEAD' ? THEMED_PATCH : e.argv.includes('--abbrev-ref') ? 'main\n' : ''
      return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }) as never)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('clock.now', () => ({ value: 0 }))
    on('tool.call', () => ({ result: 'ok' }) as never)
    await $.prompt.submit({ text: '테마', origin: { kind: 'composer' }, wait: false } as never)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/src/cart.ts', old_string: 'qty', new_string: 'quantity' } as never)
    await $.command.run({ command: 'desk-diff', args: '' } as never)
    // ui.scroll 은 한 번도 오지 않았고, 엔진의 창은 600줄 파일의 400행 근처에 있다
    const pane = await $.ui.mount({
      plugin: 'desk-look',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'desk-diff',
      viewport: VIEWPORT,
      props: { title: '변경 사항', isFocused: true, bodyColumns: 96, scroll: { offset: 400, bodyRows: 30 } } as never,
    })
    await openAll(pane)
    for (let tries = 0; tries < 50 && (await pane.findAll({ type: 'Code' })).length < 10; tries++) await wait(10)
    const pressable = (await pane.findAll({ type: 'Button' }))
      .map(button => /^d-big\.ts\.(\d+)\.p0$/.exec(String((button as { key?: unknown }).key))?.[1])
      .filter((index): index is string => index !== undefined)
      .map(Number)
    // 번호 버튼은 보이는 덩어리에만 달리므로, 단 덩어리가 창 자리(맨 위가 아니라)를 말해 준다
    expect(pressable.length).toBeGreaterThan(0)
    expect(Math.min(...pressable)).toBeGreaterThan(10)
    expect(JSON.stringify(await pane.drawn())).not.toContain('"d-big.ts.0"')
    await pane.unmount()
  })

  test('diff 줄 번호를 눌러 범위에 댓글을 달면 다음 프롬프트에 context 로 붙는다', KO, async ($, on) => {
    const sent: { text: string; context?: readonly string[] }[] = []
    lightTheme(on, sent)
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine-band</Text>
    })
    on('process.run', (($: unknown, e: { argv: string[] }) => {
      const stdout = e.argv.includes('--show-toplevel') ? '/repo\n' : e.argv[1] === 'diff' && e.argv[2] === 'HEAD' ? THEMED_PATCH : e.argv.includes('--abbrev-ref') ? 'main\n' : ''
      return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }) as never)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('clock.now', () => ({ value: 0 }))
    on('tool.call', () => ({ result: 'ok' }) as never)
    await $.prompt.submit({ text: '테마', origin: { kind: 'composer' }, wait: false } as never)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/src/cart.ts', old_string: 'qty', new_string: 'quantity' } as never)
    await $.command.run({ command: 'desk-diff', args: '' } as never)
    const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-diff', viewport: VIEWPORT, props: { title: '변경 사항', isFocused: true, bodyRows: 30 } as never })
    await openAll(pane)
    for (let tries = 0; tries < 50 && !(await pane.find({ type: 'Text', text: /안 바뀐 줄/ })); tries++) await wait(10)
    // cart.ts 행: 안 바뀐 구간, keep(10), −(11), +(11), end(12). 번호 칸이 줄마다 버튼이다.
    const line = (row: number) => `d-src/cart.ts.${row}.p0`
    expect(await pane.find({ type: 'Button', key: line(3) })).toBeDefined()
    await pane.press({ key: line(3) })
    const input = async () => JSON.stringify(await pane.find({ type: 'Input' }))
    expect(await input()).toContain('11번 줄')
    // 여러 줄 칸(2.1.301 Input rows)
    expect(await input()).toContain('"rows":3')
    // 다른 줄을 누르면 범위, 고른 줄은 뒤집어 그린다
    await pane.press({ key: line(4) })
    expect(await input()).toContain('11–12번 줄')
    expect(JSON.stringify(await pane.drawn())).toContain('"inverse":true')
    // 지우기: 범위는 두고 쓴 글만 비운 칸을 새 키로 그린다(엔진 칸의 ^U 는 한 줄씩만 지운다)
    const pasted = (await pane.find({ type: 'Input' })) as { key?: string } | undefined
    await pane.input({ key: pasted?.key ?? '', text: '붙여 넣은\n긴 글', kind: 'change' })
    await pane.press({ key: 'comment-clear' })
    expect(await input()).toContain('11–12번 줄')
    expect(await input()).toContain('"value":""')
    const typed = (await pane.find({ type: 'Input' })) as { key?: string } | undefined
    expect(typed?.key).not.toBe(pasted?.key)
    await pane.input({ key: typed?.key ?? '', text: '  이름을 quantity 로 통일\n가격도  ' })
    expect(await pane.find({ type: 'Input' })).toBeUndefined()
    expect(JSON.stringify(await pane.drawn())).toContain('✎ 11–12')
    // 저장된 댓글은 한 행: 줄바꿈은 ↵ 로
    expect(JSON.stringify(await pane.drawn())).toContain('이름을 quantity 로 통일 ↵ 가격도')
    // 아래턱에 쌓인 댓글 수
    const band = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'AbovePrompt', viewport: VIEWPORT, props: { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 96 } as never })
    expect(await band.find({ type: 'Button', key: 'comments-chip' })).toBeDefined()
    // 다음 프롬프트에 파일:줄, 그 줄들, 댓글이 context 로 붙고 비워진다. 슬래시 명령에는 붙지 않는다.
    await $.prompt.submit({ text: '고쳐줘', origin: { kind: 'composer' }, wait: false } as never)
    const context = sent.at(-1)?.context?.join('\n') ?? ''
    expect(context).toContain('src/cart.ts:11–12 (uncommitted changes)')
    expect(context).toContain('11 + const total = price * quantity')
    expect(context).toContain('12   end')
    expect(context).toContain('\n이름을 quantity 로 통일\n가격도')
    expect(JSON.stringify(await pane.drawn())).not.toContain('✎ 11–12')
    expect(await band.find({ type: 'Button', key: 'comments-chip' })).toBeUndefined()
    await $.prompt.submit({ text: '또', origin: { kind: 'composer' }, wait: false } as never)
    expect(sent.at(-1)?.context ?? []).toEqual([])
    // 한 줄만 고른 상태에서 그 줄을 다시 누르면 닫힌다
    await pane.press({ key: line(2) })
    expect(await input()).toContain('11번 줄')
    await pane.press({ key: line(2) })
    expect(await pane.find({ type: 'Input' })).toBeUndefined()
    await band.unmount()
    await pane.unmount()
  })

  test('저장소 밖 세션 편집은 편집마다 따로, 사이에 구분 줄', KO, async ($, on) => {
    lightTheme(on)
    const notRepo = () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } })
    on('process.run', notRepo as never)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('clock.now', () => ({ value: 0 }))
    on('clock.every', () => ({ value: undefined }))
    on('session.cwd', () => ({ value: '/tmp/x' }))
    on('command.register', () => ({ value: undefined as never }))
    on('session.start', ($, e) => e as never)
    // 세션 편집은 대화 기록에서 모은다: 같은 파일을 두 번 고친 기록
    const a = { file_path: '/tmp/x/n.ts', old_string: 'b', new_string: 'c' }
    const b = { file_path: '/tmp/x/n.ts', old_string: 'x', new_string: 'y' }
    const hunkA = { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' a', '-b', '+c'] }
    const hunkB = { oldStart: 5, oldLines: 1, newStart: 5, newLines: 1, lines: ['-x', '+y'] }
    on('session.messages', () => ({
      value: [
        { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a1', tool: 'Edit', input: a }, { tool_use_id: 'b1', tool: 'Edit', input: b }] },
        {
          role: 'user',
          text: '',
          toolUses: [],
          toolResults: [
            { tool_use_id: 'a1', text: 'edited', isError: false, result: { filePath: a.file_path, structuredPatch: [hunkA] } },
            { tool_use_id: 'b1', text: 'edited', isError: false, result: { filePath: b.file_path, structuredPatch: [hunkB] } },
          ],
        },
      ] as never,
    }))
    await $.session.start({ source: 'resume', cwd: '/tmp/x', surface: 'terminal' } as never)
    await $.command.run({ command: 'desk-diff', args: '' } as never)
    const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-diff', viewport: VIEWPORT, props: { title: '변경 사항', isFocused: true } as never })
    await openAll(pane, 'fold-s:/tmp/x/n.ts')
    for (let tries = 0; tries < 50 && !(await pane.find({ type: 'Text', text: '· 다음 편집' })); tries++) await wait(10)
    expect(await pane.find({ type: 'Text', text: '· 다음 편집' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'n.ts' })).toBeDefined()
    const drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain(`"backgroundColor":"${TINT.addBg}"`)
    expect(drawn).not.toContain('"format":"diff"')
    // 묶음을 접으면 머리 줄만, 다시 누르면 편다
    await pane.press({ key: 'fold-outside' })
    expect(await pane.find({ type: 'Text', text: 'n.ts' })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: '· 다음 편집' })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /git 밖 파일/ })).toBeDefined()
    await pane.press({ key: 'fold-outside' })
    expect(await pane.find({ type: 'Text', text: 'n.ts' })).toBeDefined()
    await pane.unmount()
  })

  test('테마를 알면 펼친 편집 행도 데스크톱 모양, 모르면 엔진 diff', KO, async ($, on) => {
    // 테마 파일은 처음부터 있지만 프롬프트가 오기 전에는 읽지 않았다
    lightTheme(on)
    const props = {
      tool_use_id: 'e9',
      tool: 'Edit',
      input: { file_path: '/repo/a.ts', old_string: 'qty', new_string: 'quantity' },
      output: { structuredPatch: [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ['-const n = qty', '+const n = quantity'] }] },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    }
    const before = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'ToolUse', requestId: 'e9', viewport: VIEWPORT, props })
    await before.press({ key: 'row-e9' })
    expect(JSON.stringify(await before.drawn())).toContain('"format":"diff"')
    await before.unmount()
    await $.prompt.submit({ text: '테마', origin: { kind: 'composer' }, wait: false } as never)
    await wait(20)
    const after = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'ToolUse', requestId: 'e9', viewport: VIEWPORT, props })
    const drawn = JSON.stringify(await after.drawn())
    expect(drawn).not.toContain('"format":"diff"')
    expect(drawn).toContain(`"backgroundColor":"${TINT.delBg}"`)
    // 대화 안에서는 안 바뀐 구간 줄을 넣지 않는다
    expect(await after.find({ type: 'Text', text: /안 바뀐 줄/ })).toBeUndefined()
    await after.unmount()
  })
})

test('/desk-fold: 열린 패널을 접고, 다시 치면 앞에 있던 패널을 마지막에 열어 편다', KO, async ($, on) => {
  on('session.usage', () => ({ value: USAGE(62) as never }))
  on('clock.now', () => ({ value: 0 }))
  const events: string[] = []
  const up = new Map<string, string>()
  on('ui.open', ($, e) => {
    events.push(`open:${e.id}:${e.title}:${e.focus === true}`)
    up.set(e.id, e.title ?? e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    events.push(`close:${e.id}`)
    up.delete(e.id)
    return { value: undefined as never }
  })
  // 나중에 연 패널이 앞에 있다.
  on('ui.panes', () => ({ value: [...up].map(([id, title], index) => ({ id, title, isShown: index === up.size - 1, isFocused: false, isPlaced: true })) }))
  on('ui.scroll', () => ({}))
  const run = async () => JSON.stringify(await $.command.run({ command: 'desk-fold', args: '' } as never))

  expect(await run()).toContain('접을 패널도, 접어 둔 패널도 없어요')
  await $.command.run({ command: 'desk-context', args: '' } as never)
  await $.command.run({ command: 'desk-tasks', args: '' } as never)
  events.length = 0

  expect(await run()).toContain('패널 2개를 접었어요')
  expect(events).toEqual(['close:desk-context', 'close:desk-tasks'])
  expect(up.size).toBe(0)

  events.length = 0
  expect(await run()).toContain('접어 둔 패널 2개를 폈어요')
  expect(events).toEqual(['open:desk-context:컨텍스트:false', 'open:desk-tasks:백그라운드 작업:true'])

  // 편 뒤에는 다시 접는다(접어 둔 기록은 비웠다).
  expect(await run()).toContain('패널 2개를 접었어요')
})

describe('diff 패널: 안 바뀐 줄 펴기·거르기·기준 고르기·파일 이동', () => {
  test('순수 함수: 구간 위치와 펴기, 경로 거르기, 기준 후보, 지금 파일', () => {
    // 첫 hunk 가 한 줄을 더해 두 번째 hunk 앞 구간은 옛 번호 3부터, 새 번호 4부터 7줄
    const rows = diffRows(parseHunks('@@ -1,2 +1,3 @@\n a\n+n\n b\n@@ -10 +11 @@\n-x\n+y'))
    const gaps = rows.flatMap(row => (row.kind === 'gap' ? [[row.count, row.oldStart, row.newStart]] : []))
    expect(gaps).toEqual([[7, 3, 4]])
    const opened = openGaps(rows, new Map([[4, Array.from({ length: 7 }, (_, i) => `l${i + 4}`)]]))
    expect(opened.some(row => row.kind === 'gap')).toBe(false)
    const context = opened.filter(row => row.kind === 'line' && row.line.text.startsWith('l'))
    expect(context.map(row => (row.kind === 'line' ? `${row.line.kind}${row.line.oldNo}:${row.line.newNo}` : ''))).toEqual([' 3:4', ' 4:5', ' 5:6', ' 6:7', ' 7:8', ' 8:9', ' 9:10'])
    // 고르지 않은 구간은 그대로
    expect(openGaps(rows, new Map([[99, ['x']]]))).toEqual(rows)

    expect(matchesPath('backend/src/GenAiStore.kt', 'genai store')).toBe(true)
    expect(matchesPath('backend/src/GenAiStore.kt', 'GENAI kt')).toBe(true)
    expect(matchesPath('backend/src/GenAiStore.kt', 'genai ts')).toBe(false)
    expect(matchesPath('a.txt', '  ')).toBe(true)

    const refs = ['refs/heads/main', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main', 'refs/heads/feat/x', 'refs/heads/main', ''].join('\n')
    expect(branchChoices(refs, 'feat/x')).toEqual(['main', 'origin/main'])

    const heads = [{ top: 3 }, { top: 10 }]
    expect([0, 3, 9, 10, 50].map(offset => headAt(heads, offset))).toEqual([-1, 0, 0, 1, 1])
    // 지금 파일: 하나만 펴졌으면 그것, 아니면 마지막으로 간 파일, 없으면 창 위치. 뒤쪽 짧은 파일은 창이 끝에서 깎여 창 위치로는 앞 파일이 된다.
    const files = [{ id: 'a', top: 3 }, { id: 'b', top: 4 }, { id: 'c', top: 5 }]
    expect(currentHead(files, { 'fold:c': false }, null, 0)).toBe(2)
    expect(currentHead(files, { 'fold:b': false, 'fold:c': false }, 'c', 0)).toBe(2)
    expect(currentHead(files, { 'fold:b': false, 'fold:c': false }, null, 4)).toBe(1)
    expect(currentHead(files, {}, 'gone', 0)).toBe(-1)
  })

  // 밝은 테마(truecolor)와 저장소 파일 읽기. 파일은 /repo/ 아래 경로로 준다.
  const themed = (on: On, files: Record<string, string>) => {
    on('env.get', ($, e) => {
      const name = String((e as { name?: string }).name ?? e)
      return { value: (name === 'HOME' ? '/home/t' : name === 'COLORTERM' ? 'truecolor' : undefined) as never }
    })
    on('fs.read', ($, e) => {
      const path = String((e as { path?: string }).path ?? e)
      if (path.endsWith('colors.toml')) return { value: 'mode = "light"\nbackground = "#fafafa"\n' } as never
      if (files[path] !== undefined) return { value: files[path] } as never
      throw new Error('ENOENT')
    })
    on('prompt.submit', ($, e) => ({ text: e.text }) as never)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('clock.now', () => ({ value: 0 }))
  }
  const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  const lines = (count: number, changed: Record<number, string> = {}) => Array.from({ length: count }, (_, i) => changed[i + 1] ?? `l${i + 1}`).join('\n') + '\n'
  // 2번 줄과 21번 줄을 바꾼 30줄 파일: 두 hunk 사이에 16줄(4~19)
  const CART = 'diff --git a/src/cart.ts b/src/cart.ts\n--- a/src/cart.ts\n+++ b/src/cart.ts\n@@ -1,3 +1,3 @@\n l1\n-l2\n+L2\n l3\n@@ -20,3 +20,3 @@\n l20\n-l21\n+L21\n l22\n'
  const mountDiff = ($: Parameters<TestBody>[0]) =>
    $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-diff', viewport: VIEWPORT, props: { title: '변경 사항', isFocused: true, bodyRows: 30 } as never })
  const gapButton = async (pane: Awaited<ReturnType<typeof mountDiff>>) =>
    ((await pane.findAll({ type: 'Button' })) as { key?: string }[]).map(button => String(button.key)).find(key => key.endsWith('.g'))

  test('안 바뀐 줄을 누르면 작업 트리 파일에서 그 줄을 읽어 그 자리에 편다, 파일이 달라졌으면 diff 를 다시 읽는다', KO, async ($, on) => {
    const files: Record<string, string> = { '/repo/src/cart.ts': lines(30, { 2: 'L2', 21: 'L21' }) }
    themed(on, files)
    let diffs = 0
    on('process.run', (($: unknown, e: { argv: string[] }) => {
      if (e.argv[1] === 'diff' && e.argv[2] === 'HEAD') {
        diffs++
        return out(CART)
      }
      return out(e.argv.includes('--show-toplevel') ? '/repo\n' : e.argv.includes('--abbrev-ref') ? 'main\n' : '')
    }) as never)
    await $.prompt.submit({ text: '테마', origin: { kind: 'composer' }, wait: false } as never)
    await $.command.run({ command: 'desk-diff', args: '' } as never)
    const pane = await mountDiff($)
    await pane.press({ key: 'fold-src/cart.ts' })
    for (let tries = 0; tries < 50 && !(await gapButton(pane)); tries++) await wait(10)
    expect(await pane.find({ type: 'Text', text: '안 바뀐 줄 16개' })).toBeDefined()
    expect(JSON.stringify(await pane.drawn())).not.toContain('l12')
    // 파일이 diff 를 읽은 뒤 짧아졌으면 펴지 않고 diff 를 다시 읽는다
    files['/repo/src/cart.ts'] = 'l1\n'
    const before = diffs
    await pane.press({ key: (await gapButton(pane)) ?? '' })
    expect(diffs).toBeGreaterThan(before)
    expect(await gapButton(pane)).toBeDefined()
    files['/repo/src/cart.ts'] = lines(30, { 2: 'L2', 21: 'L21' })
    await pane.press({ key: (await gapButton(pane)) ?? '' })
    for (let tries = 0; tries < 50 && (await pane.find({ type: 'Text', text: '안 바뀐 줄 16개' })); tries++) await wait(10)
    const drawn = JSON.stringify(await pane.drawn())
    expect(await pane.find({ type: 'Text', text: '안 바뀐 줄 16개' })).toBeUndefined()
    expect(drawn).toContain('l4\\nl5')
    expect(drawn).toContain('l19')
    // 번호는 이어진다(4~19)
    expect(drawn).toContain('19   ')

    // ↻ 로 다시 읽어도 패치가 같으면 편 구간은 그대로다
    await pane.press({ key: 'refresh' })
    expect(await gapButton(pane)).toBeUndefined()
    expect(JSON.stringify(await pane.drawn())).toContain('l19')
    await pane.unmount()
  })

  test('커밋별 탭의 안 바뀐 줄은 그 커밋의 파일(git cat-file)에서 읽는다', KO, async ($, on) => {
    themed(on, {})
    const asked: string[] = []
    on('process.run', (($: unknown, e: { argv: string[]; init?: { stdin?: string } }) => {
      const argv = e.argv
      if (argv.includes('--show-toplevel')) return out('/repo\n')
      if (argv.includes('--abbrev-ref')) return out('feat/x\n')
      if (argv[1] === 'symbolic-ref') return out('origin/main\n')
      if (argv[1] === 'rev-parse' && argv.includes('--verify')) return out('base\n')
      if (argv[1] === 'merge-base') return out('base000\n')
      if (argv[1] === 'log') return out('c1sha\x1fc1\x1fFix cart\x1falice\x1f1 hour ago\n')
      if (argv[1] === 'show') return out(`\x1ec1sha\n\n${CART}`)
      if (argv[1] === 'cat-file') {
        asked.push(e.init?.stdin ?? '')
        const body = lines(30, { 2: 'L2', 21: 'L21' })
        return out(`blobsha blob ${body.length}\n${body}\n`)
      }
      return out('')
    }) as never)
    await $.prompt.submit({ text: '테마', origin: { kind: 'composer' }, wait: false } as never)
    await $.command.run({ command: 'desk-diff', args: 'commits' } as never)
    const pane = await mountDiff($)
    await pane.press({ key: 'commit-c1sha' })
    await pane.press({ key: 'fold-c:c1:src/cart.ts' })
    for (let tries = 0; tries < 50 && !(await gapButton(pane)); tries++) await wait(10)
    await pane.press({ key: (await gapButton(pane)) ?? '' })
    for (let tries = 0; tries < 50 && !JSON.stringify(await pane.drawn()).includes('l19'); tries++) await wait(10)
    expect(asked).toEqual(['c1sha:src/cart.ts\n'])
    expect(JSON.stringify(await pane.drawn())).toContain('l19')
    await pane.unmount()
  })

  test('파일 이름 거르기: f 로 열고, 걸러진 파일만 목록에, Enter 는 첫 파일, ✕ 는 지우고 닫는다', KO, async ($, on) => {
    on('process.run', (($: unknown, e: { argv: string[] }) =>
      e.argv[1] === 'diff' && e.argv[2] === 'HEAD' ? out(DIFF_PATCH + BRANCH_PATCH) : gitStub($, e)) as never)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    await $.command.run({ command: 'desk-diff', args: '' } as never)
    const pane = await mountDiff($)
    expect(await pane.find({ type: 'Input' })).toBeUndefined()
    expect(JSON.stringify(await pane.find({ type: 'Button', key: 'filter' }))).toContain('"hotkey":"f"')
    await pane.press({ key: 'filter' })
    expect(await pane.find({ type: 'Input' })).toBeDefined()
    // 입력칸은 도구 줄(걸러진 수에 따라 버튼이 나고 드는 줄)보다 앞에 그린다: 뒤에 두면 치는 동안 키를 잃었다(실화면)
    const order = JSON.stringify(await pane.drawn())
    expect(order.indexOf('"diff-filter"')).toBeLessThan(order.indexOf('"refresh"'))
    await pane.input({ key: 'diff-filter', text: 'B.T', kind: 'change' })
    expect(await pane.find({ type: 'Button', key: 'fold-a.txt' })).toBeUndefined()
    expect(await pane.find({ type: 'Button', key: 'fold-b.txt' })).toBeDefined()
    const drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('1/2')
    // 제목의 파일 수는 전체
    expect(drawn).toContain('Edited 2 files')
    await pane.input({ key: 'diff-filter', text: 'B.T' })
    expect((await pane.findAll({ type: 'Code' })).map(code => (code as { props?: { path?: string } }).props?.path)).toEqual(['b.txt'])
    await pane.input({ key: 'diff-filter', text: 'zzz', kind: 'change' })
    expect(JSON.stringify(await pane.drawn())).toContain('맞는 파일이 없어요')
    await pane.press({ key: 'filter-close' })
    expect(await pane.find({ type: 'Input' })).toBeUndefined()
    expect(await pane.find({ type: 'Button', key: 'fold-a.txt' })).toBeDefined()
    // 커밋별에서 펼친 커밋이 없으면 "맞는 파일이 없어요" 를 띄우지 않는다
    await pane.press({ key: 'filter' })
    await pane.input({ key: 'diff-filter', text: 'zzz', kind: 'change' })
    await pane.press({ key: 'scope-commits' })
    expect(JSON.stringify(await pane.drawn())).not.toContain('맞는 파일이 없어요')
    await pane.unmount()
  })

  test('기준 고르기: 최근 브랜치 목록에서 고르면 그 브랜치를 먼저 보고, 자동으로 돌아올 수 있다', KO, async ($, on) => {
    const verified: string[] = []
    on('process.run', (($: unknown, e: { argv: string[]; init?: { stdin?: string } }) => {
      const argv = e.argv
      if (argv[1] === 'for-each-ref') return out('refs/heads/feat/done\nrefs/heads/develop\nrefs/remotes/origin/HEAD\nrefs/remotes/origin/main\n')
      if (argv[1] === 'rev-parse' && argv.includes('--verify')) {
        verified.push(String(argv.at(-1)))
        return out('x\n', argv.at(-1) === 'origin/main^{commit}' || argv.at(-1) === 'develop^{commit}' ? 0 : 1)
      }
      if (argv[1] === 'merge-base') return out(argv.at(-1) === 'develop' ? 'dev000\n' : 'base000\n')
      if (argv[1] === 'diff' && argv[2] === 'dev000') return out(DIFF_PATCH)
      return scopeStub($, e)
    }) as never)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    await $.command.run({ command: 'desk-diff', args: 'branch' } as never)
    const pane = await mountDiff($)
    expect(JSON.stringify(await pane.find({ type: 'Button', key: 'base-pick' }))).toContain('vs origin/main')
    await pane.press({ key: 'base-pick' })
    // 자동(지금 기준), 그리고 최근 커밋 순 브랜치. 지금 브랜치(feat/done)와 origin/HEAD 는 없다
    expect(JSON.stringify(await pane.find({ type: 'Button', key: 'base-auto' }))).toContain('● 자동 (origin/main)')
    expect(await pane.find({ type: 'Button', key: 'base-develop' })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'base-origin/main' })).toBeDefined()
    expect(await pane.find({ type: 'Button', key: 'base-feat/done' })).toBeUndefined()
    verified.length = 0
    await pane.press({ key: 'base-develop' })
    expect(verified[0]).toBe('develop^{commit}')
    expect(await pane.find({ type: 'Button', key: 'base-auto' })).toBeUndefined()
    let drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('vs develop')
    expect(drawn).toContain('Edited 1 file')
    // 다시 열어 자동으로
    await pane.press({ key: 'base-pick' })
    expect(JSON.stringify(await pane.find({ type: 'Button', key: 'base-develop' }))).toContain('● develop')
    await pane.press({ key: 'base-auto' })
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('vs origin/main')
    expect(drawn).toContain('Edited 2 files')
    await pane.unmount()
  })

  test('이전·다음 파일(p·n): 모두 접힌 목록에서 n 은 첫 파일을 편다, 파일 머리 띠끼리는 빈 줄 없이', KO, async ($, on) => {
    themed(on, {})
    on('process.run', (($: unknown, e: { argv: string[] }) =>
      e.argv[1] === 'diff' && e.argv[2] === 'HEAD' ? out(DIFF_PATCH + BRANCH_PATCH) : gitStub($, e)) as never)
    await $.prompt.submit({ text: '테마', origin: { kind: 'composer' }, wait: false } as never)
    await $.command.run({ command: 'desk-diff', args: '' } as never)
    const pane = await mountDiff($)
    for (let tries = 0; tries < 50 && !(await pane.find({ type: 'Button', key: 'file-next' })); tries++) await wait(10)
    expect(JSON.stringify(await pane.find({ type: 'Button', key: 'file-next' }))).toContain('"hotkey":"n"')
    expect(JSON.stringify(await pane.find({ type: 'Button', key: 'file-prev' }))).toContain('"hotkey":"p"')
    // 머리 띠 둘이 바로 이어 그려진다(사이에 높이 1 빈 칸이 없다)
    const drawn = JSON.stringify(await pane.drawn())
    expect(drawn.indexOf('"file-a.txt"')).toBeGreaterThan(-1)
    expect(drawn.slice(drawn.indexOf('"file-a.txt"'), drawn.indexOf('"file-b.txt"'))).not.toContain('"gap-')
    // 창이 맨 위(첫 머리 띠 위)면 다음은 첫 파일. 그 머리 띠로 스크롤하는 것은 실화면에서 확인(테스트 도구는 key 스크롤을 풀지 못한다)
    await pane.press({ key: 'file-next' })
    expect((await pane.findAll({ type: 'Code' })).length).toBeGreaterThan(0)
    expect(JSON.stringify(await pane.drawn())).toContain('"d-a.txt.0"')
    await pane.unmount()
  })
})

import { splitPastes } from '../hooks/register'

test('붙여넣기 태그: 걷어 내고 본문만 따로', KO, () => {
  const text = '<pasted_content id="4d1d">\nhttps://a.b/?x=1\n둘째 줄\n</pasted_content id="4d1d">\n\n이거 봐줘'
  expect(splitPastes(text)).toEqual({ text: '\n\n이거 봐줘', pastes: ['https://a.b/?x=1\n둘째 줄'] })
  expect(splitPastes('그냥 글').pastes).toEqual([])
})

test('붙여넣은 글은 칩 한 줄, 누르면 펼침', KO, async $ => {
  const text = '<pasted_content id="4d1d">\nhttps://a.b/?x=1\nSECOND-LINE\n</pasted_content id="4d1d">\n\n이거 봐줘'
  const props = { text, origin: { kind: 'composer' }, isExpanded: false } as never
  const row = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'UserMessage', viewport: VIEWPORT, props })
  const drawn = JSON.stringify(await row.drawn())
  expect(drawn).not.toContain('pasted_content')
  expect(drawn).toContain('붙여넣은 글 · 2줄')
  expect(drawn).toContain('이거 봐줘')
  expect(drawn).not.toContain('SECOND-LINE')
  const key = /"key":"(paste-[^"]+)"/.exec(drawn)?.[1]
  expect(key).toBeDefined()
  await row.press({ key: key ?? '' })
  expect(JSON.stringify(await row.drawn())).toContain('SECOND-LINE')
  await row.unmount()
})

import { gather, gatheredLines } from '../hooks/gather'

describe('답 글 블록째 보여주기(replyInBlocks)', () => {
  const paragraphs = (count: number) => Array.from({ length: count }, (_, index) => `문단 ${index}`).join('\n\n')

  test('붙잡는 동안 모은 줄 수를 세고, 내보내면 0', async () => {
    let open = () => {}
    const gate = new Promise<void>(resolve => (open = resolve))
    async function* source() {
      yield { kind: 'text', index: 0, text: '첫 줄\n둘째' }
      yield { kind: 'text', index: 0, text: ' 줄\n셋째 줄' }
      await gate
      yield { kind: 'stop', stopReason: 'end_turn', usage: null }
      return {}
    }
    const settled: number[] = []
    const stream = gather(source() as never, async () => void settled.push(gatheredLines()))
    const first = stream.next()
    await wait(20)
    expect(gatheredLines()).toBe(3)
    open()
    expect((await first).value).toEqual({ kind: 'text', index: 0, text: '첫 줄\n둘째' })
    let step = await stream.next()
    while (step.done !== true) step = await stream.next()
    // 마지막 글을 내보낸 뒤(이미 0) 멈춤 전에 한 번 기다린다
    expect(settled).toEqual([0])
    expect(gatheredLines()).toBe(0)
  })

  // 아래(엔진)가 단계마다 내놓는 청크: 글 블록 하나, 도구 호출 하나, 멈춤.
  // 테스트 사슬은 engine 청크를 만들 수 없어(엔진이 준 ref 만 받는다) 그 순서는 실제 세션에서 본다.
  const CHUNKS = [
    { kind: 'text', index: 0, text: '파일을 ' },
    { kind: 'text', index: 0, text: '볼게요.' },
    { kind: 'tool', index: 1, id: 't1', name: 'Read' },
    { kind: 'input', index: 1, json: '{}' },
    { kind: 'stop', stopReason: 'tool_use', usage: null },
  ]
  const RESULT = { turnId: 't', index: 0, answer: '파일을 볼게요.', toolUses: [], stopReason: 'tool_use', usage: null }

  // 위에서 받은 청크마다 그때 아래가 몇 개째까지 내놓았는지 적는다
  async function readStep($: Parameters<TestBody>[0], on: On, agentId?: string) {
    let given = 0
    on('turn.step', async function* () {
      for (const chunk of CHUNKS) {
        given++
        yield chunk as never
      }
      return RESULT as never
    })
    const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-haiku-5-5', messageCount: 1, ...(agentId ? { agentId } : {}) } as never)
    const got: Array<{ chunk: unknown; given: number }> = []
    let step = await stream.next()
    while (step.done !== true) {
      got.push({ chunk: step.value, given })
      step = await stream.next()
    }
    return { got, result: step.value }
  }

  test('기본(켜짐)은 글 블록을 도구 청크가 올 때까지 붙잡았다가 순서 그대로 내보낸다', KO, async ($, on) => {
    const { got, result } = await readStep($, on)
    expect(got.map(item => item.chunk)).toEqual(CHUNKS)
    expect(result).toEqual(RESULT as never)
    // 첫 글은 도구 청크(3번째)가 나온 뒤에야 위로 올라간다
    expect(got[0]?.given).toBe(3)
  })

  test('끄면 글을 받는 대로 흘린다', { options: { language: 'ko', replyInBlocks: 'off' } }, async ($, on) => {
    const { got } = await readStep($, on)
    expect(got.map(item => item.chunk)).toEqual(CHUNKS)
    expect(got[0]?.given).toBe(1)
  })

  test('서브에이전트 단계는 붙잡지 않는다', { options: { language: 'ko', replyInBlocks: 'on' } }, async ($, on) => {
    const { got } = await readStep($, on, 'a1')
    expect(got[0]?.given).toBe(1)
  })

  test('마지막 사람 입력이 앱(Remote Control)에서 왔으면 흘리고, 터미널에서 오면 다시 모은다', { options: { language: 'ko', replyInBlocks: 'on' } }, async ($, on) => {
    on('prompt.submit', ($, e) => ({ text: e.text }) as never)
    let given = 0
    on('turn.step', async function* () {
      for (const chunk of CHUNKS) {
        given++
        yield chunk as never
      }
      return RESULT as never
    })
    // 첫 청크가 위로 올라갈 때 아래가 몇 개째까지 내놓았는지
    const firstSeenAt = async () => {
      given = 0
      const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-haiku-5-5', messageCount: 1 } as never)
      await stream.next()
      const at = given
      while ((await stream.next()).done !== true);
      return at
    }
    await $.prompt.submit({ text: '터미널에서', origin: { kind: 'composer' }, wait: false } as never)
    expect(await firstSeenAt()).toBe(3)
    await $.prompt.submit({ text: '폰에서', origin: { kind: 'bridge' }, wait: false } as never)
    expect(await firstSeenAt()).toBe(1)
    // 사람이 아닌 입력(작업 알림)은 출처를 바꾸지 않는다
    await $.prompt.submit({ text: '<task-notification></task-notification>', origin: { kind: 'task-notification' }, wait: false } as never)
    expect(await firstSeenAt()).toBe(1)
    await $.prompt.submit({ text: '다시 터미널', origin: { kind: 'composer' }, wait: false } as never)
    expect(await firstSeenAt()).toBe(3)
  })

  // 화면보다 긴 블록도 먼저 잘라 내보내지 않는다(0.51 의 화면 몫 선출력은 걷었다)
  test('긴 블록도 끝까지 붙잡았다가 한 번에 내보낸다', { options: { language: 'ko', replyInBlocks: 'on' } }, async ($, on) => {
    let open = () => {}
    const gate = new Promise<void>(resolve => (open = resolve))
    const long = `${paragraphs(40)}\n\n`
    on('clock.sleep', () => ({ value: undefined }))
    on('turn.step', async function* () {
      yield { kind: 'text', index: 0, text: long } as never
      yield { kind: 'text', index: 0, text: '이어지는\n글' } as never
      await gate
      yield { kind: 'stop', stopReason: 'end_turn', usage: null } as never
      return { ...RESULT, answer: `${long}이어지는\n글`, stopReason: 'end_turn' } as never
    })
    const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-haiku-5-5', messageCount: 1 } as never)
    let released = false
    const first = stream.next().then(step => ((released = true), step))
    await wait(20)
    expect(released).toBe(false)
    open()
    expect((await first).value).toEqual({ kind: 'text', index: 0, text: long })
    expect((await stream.next()).value).toEqual({ kind: 'text', index: 0, text: '이어지는\n글' })
    expect((await stream.next()).value).toEqual({ kind: 'stop', stopReason: 'end_turn', usage: null })
    expect((await stream.next()).done).toBe(true)
  })
})

import { effortInForce } from '../hooks/register'

// 2.1.312 turn.step 의 effort: 메시지마다 effort 를 받는 모델에서는 입력이 든 단계(턴의 첫 단계, 턴 중에 끼워 넣은 메시지)에서 정한 수준이 도구 단계 내내 선다.
// 숫자는 바로 나간다. effort 가 없는 모델이면 아무것도 붙이지 않는다.
describe('스피너의 effort', () => {
  test('입력이 든 단계(턴의 첫 단계, 턴 중에 끼워 넣은 메시지)에서 정하고, 도구 단계의 바뀐 수준은 다음 입력까지 기다린다', () => {
    expect(effortInForce(null, 0, 'high', false)).toBe('high')
    expect(effortInForce('high', 1, 'low', false)).toBe('high')
    expect(effortInForce('high', 1, 'low', true)).toBe('low')
    expect(effortInForce('high', 0, 'low', false)).toBe('low')
    expect(effortInForce('high', 2, 2048, false)).toBe(2048)
    expect(effortInForce('high', 1, undefined, false)).toBe(null)
    expect(effortInForce(null, 3, 'medium', false)).toBe('medium')
  })

  test('메인 단계의 effort 를 스피너 줄 경과 시간 뒤에 붙이고, 서브에이전트 단계는 보지 않는다', KO, async ($, on) => {
    on('clock.now', () => ({ value: 1_000_000 }))
    on('clock.every', () => ({ value: { cancel: () => undefined } }) as never)
    on('turn.step', async function* ($, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
    })
    on('prompt.submit', ($, e) => ({ text: e.text }) as never)
    const step = async (index: number, effort?: string | number, agentId?: string) => {
      const stream = $.turn.step({ turnId: 't', index, model: 'claude-sonnet-5-5', messageCount: 1, ...(effort === undefined ? {} : { effort }), ...(agentId ? { agentId } : {}) } as never)
      while ((await stream.next()).done !== true);
    }
    const spinner = async () => {
      const mounted = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Spinner', viewport: VIEWPORT, props: { word: 'Running', message: null, suffix: '…', mode: 'tool-use' } as never })
      const text = JSON.stringify(await mounted.drawn())
      await mounted.unmount()
      return text
    }
    await step(0, 'high')
    expect(await spinner()).toContain(' · high')
    // 턴 중에 /effort low: 도구 단계에서는 아직 high 가 선다
    await step(1, 'low')
    await step(1, 'max', 'a1')
    const held = await spinner()
    expect(held).toContain(' · high')
    expect(held).not.toContain('low')
    expect(held).not.toContain('max')
    // 턴 중의 슬래시 명령·기다리게 한 입력은 effort 를 세우지 않는다
    await $.prompt.submit({ text: '/effort low', command: { name: 'effort', args: 'low' }, turnId: 't', wait: false, origin: { kind: 'composer' } } as never)
    await $.prompt.submit({ text: '끝나고 해 줘', turnId: 't', wait: true, origin: { kind: 'composer' } } as never)
    await step(2, 'low')
    expect(await spinner()).toContain(' · high')
    // 턴 중에 끼워 넣은 메시지가 실린 단계: 그 단계부터 low 가 선다(다음 턴까지 기다리지 않는다)
    await $.prompt.submit({ text: '이것도 해 줘', turnId: 't', wait: false, origin: { kind: 'composer' } } as never)
    await step(3, 'low')
    expect(await spinner()).toContain(' · low')
    await step(4, 'high')
    expect(await spinner()).toContain(' · low')
    await step(0, 'low')
    expect(await spinner()).toContain(' · low')
    await step(1, 2048)
    expect(await spinner()).toContain(' · effort 2048')
    // effort 를 받지 않는 모델
    await step(0)
    expect(await spinner()).not.toContain('effort')
  })
})

test('256색 패널 바탕: 섞은 색을 밝기가 가장 가까운 팔레트 회색으로(어두운 회색이 #5f5f5f 로 밝아지지 않게)', () => {
  expect(gray256('#2c2d37')).toBe('#303030')
  expect(gray256('#ececec')).toBe('#eeeeee')
  expect(gray256('#000000')).toBe('#000000')
  expect(gray256('#5f5f5f')).toBe('#5f5f5f')
})
