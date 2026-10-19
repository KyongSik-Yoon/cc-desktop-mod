import type { On } from 'claude-code'
import { describe, expect, mock, test, type TestBody } from 'claude-code/testing'

import { setLang } from '../hooks/i18n'

import { bubbleEdges, bubbleRows, cardFor, chinLabel, describeCalls, formatElapsed, spinnerDots, spinnerWord, lineChange, mergeEdit, diffStat, editHunk, patchOf, askAnswer, parseDiff, planRow, summarize, wrapText } from '../hooks/register'
import { agentDetailOf, applyNotices, backgroundTaskOf, dismissAgents, mergeAgents, modelLabel, orderAgents, parseNotices, stepTokens, tailOf } from '../hooks/agents'
import { cellWidth, columnWidths, inlineWidth, parseBlocks, parseInline, plainText, splitFrontMatter } from '../hooks/markdown'
import { previewOf } from '../hooks/preview'
import { commentCall, doneSince, dueChip, findAsanaServer, groupTasks, listCalls, mentionHtml, nextOffset, paneTools, projectTasksCall, storyPatch, storyView, textDiff, toDetail, toProjects, toStory, toTasks, updateCall, updateProblem } from '../hooks/asana'
import { LEASE_MS, closeRoom, emptyInbox, findSlackServer, holdsLease, inboxCall, mergeInbox, notices, parseHistory, parseMe, parseSearch, readRoom, resultText, roomList, slackText, tsCompare, unreadCount } from '../hooks/slack'
import { blockHeight, diffBlocks, diffPalette, diffRows, gutterWidth, isTruecolor, parseHunks, rowHeight, windowPlan, wordSpan } from '../hooks/diffview'

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

import { computeRuns } from '../hooks/runs'
import { mix, parseSurface } from '../hooks/theme'

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

import { CORNER_SIZE, cornerPixels, herdrGraphicsOn, imageNumber, pngSize, supportsGraphics, thumbnailSize } from '../hooks/images'
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
  expect(supportsGraphics({ TERM: 'xterm-ghostty' })).toBe(true)
  expect(supportsGraphics({ TERM: 'xterm-256color', TERM_PROGRAM: 'ghostty' })).toBe(true)
  // herdr 는 kitty_graphics 설정과 엔진 강제(CLAUDE_CODE_FORCE_TERMINAL_IMAGES)가 모두 있어야 그린다
  const herdr = { TERM: 'xterm-256color', TERM_PROGRAM: 'herdr', HERDR_ENV: '1' }
  expect(supportsGraphics({ ...herdr, TERM: 'xterm-ghostty' })).toBe(false)
  expect(supportsGraphics(herdr, true)).toBe(false)
  expect(supportsGraphics({ ...herdr, CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' })).toBe(false)
  expect(supportsGraphics({ ...herdr, CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' }, true)).toBe(true)
  expect(supportsGraphics({ TERM: 'xterm-kitty', TMUX: '/tmp/tmux' })).toBe(false)
  expect(supportsGraphics({ TERM: 'xterm-256color' })).toBe(false)

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

import { ago, clip, filterSessions, groupSessions, numbered, sessionOf } from '../hooks/sessions'

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
  // 큰 기록만 head·tail 로, 셸 없이
  expect(ran.map(argv => argv[0]).sort()).toEqual(['head', 'tail'])
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

import { computeTasks, visibleTasks } from '../hooks/tasks'

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

  const many = Array.from({ length: 9 }, (_, index) => ({
    id: String(index),
    subject: `일 ${index}`,
    status: (index < 5 ? 'completed' : index === 5 ? 'in_progress' : 'pending') as 'completed' | 'in_progress' | 'pending',
  }))
  const view = visibleTasks(many, 6)
  expect(view.shown.map(item => item.id)).toEqual(['3', '4', '5', '6', '7', '8'])
  expect(view.hidden).toBe(3)
  expect(visibleTasks(many.map(item => ({ ...item, status: 'completed' as const })), 6).shown).toEqual([])
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
    if (e.argv[0] === 'tee') {
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

import { contextChipMode, meterBar, meterLevel, resetIn, ring, showsChip } from '../hooks/usage'

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

import { clipStart, matchDiffFile, splitCommitDiffs, updateMessage } from '../hooks/register'

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

test('턴 끝 줄의 ❝ 칩과 /desk-quote 는 선택한 글을 인용으로 입력창에 넣는다', KO, async ($, on) => {
  let selected: { text: string; requestId?: string } | undefined = { text: '첫 줄\n\n둘째 줄  ', requestId: 'r1' }
  let box = ''
  const filled: Array<{ text: string; mode?: string }> = []
  const toasts: string[] = []
  on('process.run', gitStub as never)
  on('clock.now', () => ({ value: 0 }))
  on('turn.complete', () => ({ text: '답' }) as never)
  on('ui.selection', () => ({ value: selected }) as never)
  on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
  on('prompt.fill', ($, e) => {
    filled.push({ text: e.text, mode: e.mode })
    return { isFilled: true } as never
  })
  on('ui.toast', ($, e) => {
    toasts.push(String((e as { text?: string }).text ?? e))
    return { value: undefined as never }
  })
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Baked for 3s</Text>
  })
  await $.turn.complete({ durationMs: 3000, reason: 'answer', answer: '답', turnId: 't1' } as never)
  const row = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'TurnDuration', viewport: VIEWPORT, props: { word: 'Baked', durationMs: 3000 } })
  expect(JSON.stringify(await row.drawn())).toContain('❝ quote')
  // 빈 입력창: 인용으로 바꾸고 아래에 질문 칸을 비워 둔다
  await row.press({ key: 'quote-turn-3000' })
  expect(filled).toEqual([{ text: '> 첫 줄\n>\n> 둘째 줄\n\n', mode: 'replace' }])
  // 쓰던 글이 있으면 그 뒤에 붙인다
  box = '이거 왜?'
  await $.command.run({ command: 'desk-quote', args: '' } as never)
  expect(filled[1]).toEqual({ text: '\n\n> 첫 줄\n>\n> 둘째 줄\n\n', mode: 'append' })
  // 고른 글이 없으면 채우지 않고 알린다
  selected = undefined
  await row.press({ key: 'quote-turn-3000' })
  expect(filled.length).toBe(2)
  expect(toasts.at(-1)).toContain('선택')
  await row.unmount()
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

test('/desk-update: 마켓 목록을 새로 받고 desk-look 을 올린다', KO, async ($, on) => {
  const ran: string[] = []
  const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', ($, e: { argv: readonly string[] }) => {
    ran.push(e.argv.join(' '))
    return (e.argv[2] === 'update'
      ? ok('{"command":"update","outcome":"ok","updateOutcome":"updated","oldVersion":"0.15.4","newVersion":"0.15.5"}\n')
      : ok('✔ Successfully updated marketplace: cc-desktop-mod\n')) as never
  })
  const done = await $.command.run({ command: 'desk-update', args: '' } as never)
  expect(ran).toEqual(['claude plugin marketplace update cc-desktop-mod', 'claude plugin update desk-look@cc-desktop-mod --json'])
  expect((done as { text: string }).text).toBe('desk-look 을 0.15.4 → 0.15.5 로 올렸어요. /reload-plugins 로 적용하세요.')
})

test('/desk-update 결과 문장: 최신, 실패', KO, () => {
  setLang('ko')
  expect(updateMessage(0, '{"outcome":"ok","updateOutcome":"up_to_date","oldVersion":"0.15.5","newVersion":"0.15.5"}', '')).toBe('desk-look 은 이미 최신(0.15.5)이에요.')
  expect(updateMessage(1, '{"outcome":"error","message":"Plugin not found"}', '')).toBe('desk-look 을 올리지 못했어요: Plugin not found')
  expect(updateMessage(1, '', 'network down\n')).toBe('desk-look 을 올리지 못했어요: network down')
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
  await viewed.press({ key: 'agent-back' })
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
const docWorld = (on: On, files: Record<string, string>) => {
  const opened: { id: string; title?: string }[] = []
  on('process.run', gitStub as never)
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
    const typed = (await pane.find({ type: 'Input' })) as { key?: string } | undefined
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

describe('Asana 패널', () => {
  const V2 = ['get_my_tasks', 'search_tasks', 'get_task', 'add_comment', 'update_tasks', 'search_objects', 'get_me', 'get_projects', 'get_tasks'].map(tool => `mcp__asana-v2__${tool}`)
  const V1 = [
    'asana_search_tasks',
    'asana_get_task',
    'asana_get_stories_for_task',
    'asana_create_task_story',
    'asana_update_task',
    'asana_typeahead_search',
    'asana_get_user',
    'asana_get_projects',
    'asana_get_tasks',
  ].map(
    tool => `mcp__claude_ai_asana__${tool}`,
  )

  test('서버는 v2(get_my_tasks)를 먼저, 없으면 claude.ai 커넥터를 쓰고, 패널이 쓰는 도구가 다 있어야 한다', () => {
    expect(findAsanaServer(['Read', ...V1, ...V2])).toEqual({ name: 'asana-v2', dialect: 'v2' })
    expect(findAsanaServer(V1)).toEqual({ name: 'claude_ai_asana', dialect: 'v1' })
    expect(findAsanaServer(V2.filter(name => !name.endsWith('add_comment')))).toBeNull()
    expect(findAsanaServer(['mcp__other__get_my_tasks'])).toBeNull()
    expect(paneTools({ name: 'asana-v2', dialect: 'v2' })).toEqual(V2)
    // v1 은 목록과 검색이 같은 도구라 한 번만
    expect(paneTools({ name: 'claude_ai_asana', dialect: 'v1' })).toEqual(V1)
  })

  test('상세는 v2 댓글과 v1 활동에서 댓글만 고르고, 드롭다운 필드만 바꿀 수 있게 둔다', () => {
    const task = {
      data: {
        gid: '1',
        name: 'JDK 25',
        notes: '본문',
        completed: false,
        assignee: { gid: 'u1', name: 'Sam' },
        memberships: [{ project: { name: 'Support' }, section: { name: '이슈' } }],
        custom_type_status_option: { name: 'Open' },
        custom_type: { status_options: [{ gid: 's1', name: 'Open' }, { gid: 's2', name: 'Done' }, { gid: 's3', name: '옛 상태', enabled: false }] },
        custom_fields: [
          { gid: 'f1', name: 'Issue Type', type: 'enum', display_value: '질문', enum_options: [{ gid: 'o1', name: '질문' }, { gid: 'o2', name: '옛것', enabled: false }] },
          { gid: 'f2', name: '고객사', type: 'text', display_value: 'NH' },
        ],
        comments: [{ gid: 'c1', text: '확인바랍니다', created_at: '2026-10-14T07:33:47Z', created_by: { name: 'Nomin' }, resource_subtype: 'comment_added' }],
      },
    }
    const v2 = toDetail(task)
    expect(v2?.status).toBe('Open')
    expect(v2?.statuses).toEqual([{ gid: 's1', name: 'Open' }, { gid: 's2', name: 'Done' }])
    expect(v2?.places).toEqual(['Support › 이슈'])
    expect(v2?.comments.map(c => c.author)).toEqual(['Nomin'])
    expect(v2?.fields[0]?.options).toEqual([{ gid: 'o1', name: '질문' }])
    expect(v2?.fields[1]?.options).toBeNull()
    const stories = {
      data: [
        { gid: 's1', text: 'X added this task', resource_subtype: 'added_to_project', created_by: { name: 'X' } },
        { gid: 's2', text: '첫 댓글', resource_subtype: 'comment_added', created_by: { name: 'Y' }, created_at: '2026-10-15T00:00:00Z' },
      ],
    }
    expect(toDetail(task, stories)?.comments.map(c => c.text)).toEqual(['첫 댓글'])
  })

  test('바꾸기 호출 모양과, v2 가 키를 버려 0건이면 실패로 본다', () => {
    const v2 = { name: 'asana-v2', dialect: 'v2' } as const
    const v1 = { name: 'claude_ai_asana', dialect: 'v1' } as const
    expect(updateCall(v2, '1', { field: 'f1', option: 'o1' })).toEqual({ tool: 'update_tasks', args: { tasks: [{ task: '1', custom_fields: { f1: 'o1' } }] } })
    expect(updateCall(v1, '1', { field: 'f1', option: 'o1' })).toEqual({ tool: 'asana_update_task', args: { task_id: '1', custom_fields: '{"f1":"o1"}' } })
    expect(updateCall(v1, '1', { assignee: 'me' }).args).toEqual({ task_id: '1', assignee: 'me' })
    expect(updateProblem(v2, { data: [], failed: [], summary: 'Updated 0 of 1 tasks.' })).toBe('Updated 0 of 1 tasks.')
    expect(updateProblem(v2, { data: [{ gid: '1' }], failed: [] })).toBeNull()
    expect(updateProblem(v2, { data: [], failed: [{ errors: ['Not a user'] }] })).toContain('Not a user')
  })

  test('마감일 칩과 프로젝트 묶음', () => {
    expect(dueChip('2026-10-15', '2026-10-16')).toEqual({ text: '10/15', level: 'danger' })
    expect(dueChip('2026-10-16', '2026-10-16')?.level).toBe('warning')
    expect(dueChip('2027-01-02', '2026-10-16')).toEqual({ text: '2027/1/2', level: 'muted' })
    expect(dueChip(null, '2026-10-16')).toBeNull()
    const task = (gid: string, project: string | null) => ({ gid, name: gid, dueOn: null, project, section: null, url: null, assignee: null, isDone: false, status: null })
    expect(groupTasks([task('a', null), task('b', 'P'), task('c', 'Q'), task('d', 'P')]).map(g => [g.name, g.tasks.map(t => t.gid)])).toEqual([
      ['P', ['b', 'd']],
      ['Q', ['c']],
      [null, ['a']],
    ])
  })

  test('목록 → 상세 → 댓글 달기·Claude 에게 맡기기·담당자 두 번 눌러 넘기기', KO, async ($, on) => {
    const calls: Array<{ server: string; tool: string; args: Record<string, unknown> }> = []
    const filled: string[] = []
    const text = (value: unknown) => ({ value: { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false } })
    on('clock.now', () => ({ value: Date.parse('2026-10-16T03:00:00Z') }))
    on('clock.after', () => new Promise(() => undefined) as never)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.toast', () => ({ value: undefined as never }))
    on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
    on('prompt.fill', ($, e) => {
      filled.push((e as { text: string }).text)
      return { isFilled: true } as never
    })
    on('tool.list', () => ({ value: [...V1, ...V2].map(name => ({ name, description: '', mcp: true })) }))
    // 댓글 달기만 allow 규칙이 없다
    on('tool.check', ($, e) => ({ decision: e.tool === 'mcp__asana-v2__add_comment' ? 'ask' : 'allow' }) as never)
    on('mcp.call', ($, e) => {
      calls.push({ server: e.server, tool: e.tool, args: e.args })
      switch (e.tool) {
        case 'get_my_tasks':
          return text({
            data: [
              { gid: '1', name: 'JDK 25 문의', due_on: '2026-10-10', memberships: [{ project: { name: 'Support' } }] },
              { gid: '2', name: '혼자 하는 일', due_on: null, memberships: [] },
            ],
          })
        case 'get_task':
          return text({
            data: {
              gid: '1',
              name: 'JDK 25 문의',
              notes: '운영 제약 확인',
              assignee: { gid: 'u1', name: 'Sam' },
              custom_type_status_option: { name: 'Open' },
              permalink_url: 'https://app.asana.com/x/1',
              comments: [{ gid: 'c1', text: '확인바랍니다', created_by: { name: 'Nomin' }, resource_subtype: 'comment_added' }],
            },
          })
        case 'search_objects':
          return text({ data: [{ gid: 'u9', name: 'Nomin', email: 'nomin@example.com' }] })
        case 'update_tasks':
          return text({ data: [{ gid: '1' }], failed: [] })
        default:
          return text({ data: { gid: 'new' } })
      }
    })

    await $.command.run({ command: 'desk-asana', args: '' } as never)
    expect(calls[0]).toMatchObject({ server: 'asana-v2', tool: 'get_my_tasks' })
    const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-asana', viewport: VIEWPORT, props: { title: 'Asana', isFocused: true, bodyColumns: 96 } as never })
    let drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('내 태스크 2')
    expect(drawn).toContain('Support')
    expect(drawn).toContain('프로젝트 없음')
    expect(drawn).toContain('10/10')
    expect(drawn).toContain('허용 규칙이 없어')
    expect(drawn).toContain('\\"mcp__asana-v2__add_comment\\",')
    expect(drawn).not.toContain('mcp__asana-v2__get_task')

    await pane.press({ key: 'asana-task-1' })
    await wait(50)
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('● Open')
    expect(drawn).toContain('운영 제약 확인')
    expect(drawn).toContain('확인바랍니다')

    await pane.press({ key: 'asana-claude' })
    expect(filled[0]).toContain('Asana 태스크 "JDK 25 문의"')
    expect(filled[0]).toContain('- Nomin: 확인바랍니다')

    await pane.input({ key: 'asana-write-1-0', text: '확인했습니다\n내일 답변' })
    await wait(50)
    expect(calls.find(call => call.tool === 'add_comment')?.args).toEqual({ task_id: '1', text: '확인했습니다\n내일 답변' })

    // 멘션: 찾은 사람을 누르면 댓글 칸에 "@이름 " 이 끼워지고, 보내면 html_text 의 <a data-asana-gid/> 가 된다
    await pane.press({ key: 'asana-mention' })
    await pane.input({ key: 'asana-mention-search', text: 'nom' })
    await wait(50)
    await pane.press({ key: 'asana-mention-u9' })
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('asana-write-1-2')
    expect(drawn).toContain('@Nomin ')
    expect(drawn).not.toContain('asana-mention-search')
    await pane.input({ key: 'asana-write-1-2', text: '@Nomin 확인 <부탁>\n내일' })
    await wait(50)
    expect(calls.filter(call => call.tool === 'add_comment').at(-1)?.args).toEqual({ task_id: '1', html_text: '<body><a data-asana-gid="u9"/> 확인 &lt;부탁&gt;\n내일</body>' })

    // 담당자: 찾고, 한 번 누르면 확인 문구, 다시 눌러야 넘긴다
    await pane.press({ key: 'asana-assign' })
    await pane.input({ key: 'asana-user-search', text: 'nom' })
    await wait(50)
    await pane.press({ key: 'asana-user-u9' })
    expect(calls.some(call => call.tool === 'update_tasks')).toBe(false)
    expect(JSON.stringify(await pane.drawn())).toContain('Nomin 에게 넘길까요?')
    await pane.press({ key: 'asana-user-u9' })
    await wait(50)
    expect(calls.find(call => call.tool === 'update_tasks')?.args).toEqual({ tasks: [{ task: '1', assignee: 'u9' }] })

    await pane.press({ key: 'asana-back' })
    expect(JSON.stringify(await pane.drawn())).toContain('내 태스크')
    await pane.unmount()
  })

  test('멘션 html: 긴 이름부터, 지운 멘션은 그냥 글, 특수 문자는 이스케이프', () => {
    const kim = { gid: '1', name: 'Kim', email: null }
    const kimLee = { gid: '2', name: 'Kim Lee', email: null }
    expect(mentionHtml('@Kim Lee 와 @Kim 확인', [kim, kimLee])).toBe('<body><a data-asana-gid="2"/> 와 <a data-asana-gid="1"/> 확인</body>')
    expect(mentionHtml('그냥 글 & 끝', [kim])).toBeNull()
    expect(mentionHtml('@A.B 와 @AxB', [{ gid: '3', name: 'A.B', email: null }])).toBe('<body><a data-asana-gid="3"/> 와 @AxB</body>')
    expect(mentionHtml('@R&D 팀', [{ gid: '4', name: 'R&D', email: null }])).toBe('<body><a data-asana-gid="4"/> 팀</body>')
    const v1 = { name: 'claude_ai_asana', dialect: 'v1' as const }
    expect(commentCall(v1, '9', '@Kim 봐 주세요', [kim])).toEqual({ tool: 'asana_create_task_story', args: { task_id: '9', html_text: '<body><a data-asana-gid="1"/> 봐 주세요</body>' } })
    expect(commentCall(v1, '9', '봐 주세요', [kim]).args).toEqual({ task_id: '9', text: '봐 주세요' })
  })

  test('글자 diff: 바뀐 덩어리만, 옛 글 자리로', () => {
    expect(textDiff('abc', 'abc')).toEqual([])
    expect(textDiff('굵게 둔 글', '굵게 고친 글')).toEqual([{ start: 3, end: 4, text: '고친' }])
    expect(textDiff('하나 둘 셋', '하나 둘째 셋 넷')).toEqual([
      { start: 4, end: 4, text: '째' },
      { start: 6, end: 6, text: ' 넷' },
    ])
    expect(textDiff('지울 글', '글')).toEqual([{ start: 0, end: 3, text: '' }])
    expect(textDiff('', '새 글')).toEqual([{ start: 0, end: 0, text: '새 글' }])
    // 거의 새로 쓴 긴 글은 가운데를 통째로 바꾸는 한 덩어리로(기억이 D² 로 불지 않게)
    const old = `머리 ${'가나다라'.repeat(800)} 꼬리`
    const rewritten = `머리 ${'마바사아'.repeat(800)} 꼬리`
    const started = Date.now()
    expect(textDiff(old, rewritten)).toEqual([{ start: 3, end: old.length - 3, text: '마바사아'.repeat(800) }])
    expect(Date.now() - started).toBeLessThan(2000)
    expect(storyPatch(`<body>${old}</body>`, rewritten)).toEqual({ html: `<body>${rewritten}</body>` })
  })

  test('댓글 고치기 원문: 서식은 그대로 두고 바뀐 글자만 html_text 에 끼운다', () => {
    // 실제 Asana 모양(2026-10-19): text 는 멘션을 프로필 URL 로 풀고 서식을 버려 html_text 에서 만든다. 줄바꿈은 \n 그대로
    const html =
      '<body><a href="https://app.asana.com/1/1/profile/2" data-asana-gid="9" data-asana-accessible="true" data-asana-type="user" data-asana-dynamic="true">@Arnold</a> 결론은 <strong>굵게 둔 글</strong> 입니다 &amp; 끝.\n<ul><li>하나</li><li>둘</li></ul>마지막</body>'
    expect(storyView(html)?.text).toBe('@Arnold 결론은 굵게 둔 글 입니다 & 끝.\n• 하나\n• 둘\n마지막')
    // 굵은 글 안·목록 안·끝을 고치면 그 자리만 바뀌고 태그·멘션은 바이트 그대로
    expect(storyPatch(html, '@Arnold 결론은 굵게 고친 글 입니다 & 끝.\n• 하나\n• 둘째\n마지막 (고침)')).toEqual({
      html: '<body><a href="https://app.asana.com/1/1/profile/2" data-asana-gid="9" data-asana-accessible="true" data-asana-type="user" data-asana-dynamic="true">@Arnold</a> 결론은 <strong>굵게 고친 글</strong> 입니다 &amp; 끝.\n<ul><li>하나</li><li>둘째</li></ul>마지막 (고침)</body>',
    })
    // 멘션은 통째로 지울 수 있다
    expect(storyPatch(html, '결론은 굵게 둔 글 입니다 & 끝.\n• 하나\n• 둘\n마지막')).toEqual({
      html: '<body>결론은 <strong>굵게 둔 글</strong> 입니다 &amp; 끝.\n<ul><li>하나</li><li>둘</li></ul>마지막</body>',
    })
    // 멘션 글자 일부, 목록 기호는 못 바꾼다
    expect(storyPatch(html, '@Arnol 결론은 굵게 둔 글 입니다 & 끝.\n• 하나\n• 둘\n마지막')).toEqual({ error: 'format' })
    expect(storyPatch(html, '@Arnold 결론은 굵게 둔 글 입니다 & 끝.\n• 하나\n둘\n마지막')).toEqual({ error: 'format' })
    expect(storyPatch(html, storyView(html)?.text ?? '')).toBeNull()
    // 멘션 바로 뒤에 붙인 글은 멘션 밖, 앞 글 조각에
    expect(storyPatch(html, '@Arnold님 결론은 굵게 둔 글 입니다 & 끝.\n• 하나\n• 둘\n마지막')).toMatchObject({ html: expect.stringContaining('</a>님 결론은') })
  })

  test('댓글 고치기 원문: 이미지·번호 목록·코드 블록·인용도 자리를 지킨다', () => {
    const image = '<body><img src="https://x/a.png" data-asana-gid="1" data-asana-type="attachment" />분석 X-View</body>'
    expect(storyView(image)?.text).toBe('[이미지]분석 X-View')
    expect(storyPatch(image, '[이미지]분석된 X-View')).toEqual({ html: '<body><img src="https://x/a.png" data-asana-gid="1" data-asana-type="attachment" />분석된 X-View</body>' })
    expect(storyPatch(image, '분석 X-View')).toEqual({ error: 'format' })

    const blocks = '<body>머리\n<ol><li>첫째</li><li>둘째</li></ol><pre>a &lt; b\nc</pre><blockquote>인용 <a href="https://e.x/">https://e.x/</a></blockquote>꼬리</body>'
    expect(storyView(blocks)?.text).toBe('머리\n1. 첫째\n2. 둘째\na < b\nc\n인용 https://e.x/\n꼬리')
    expect(storyPatch(blocks, '머리말\n1. 첫째\n2. 둘째\na <= b\nc\n인용문 https://e.x/\n꼬리')).toEqual({
      html: '<body>머리말\n<ol><li>첫째</li><li>둘째</li></ol><pre>a &lt;= b\nc</pre><blockquote>인용문 <a href="https://e.x/">https://e.x/</a></blockquote>꼬리</body>',
    })
    expect(storyPatch('<body></body>', '새 글')).toEqual({ html: '<body>새 글</body>' })

    // 고친 조각 안의 안 바꾼 글자는 원래 모양(&quot;)을 지킨다
    expect(storyPatch('<body>&quot;기획&quot; 확인</body>', '"기획" 다시 확인')).toEqual({ html: '<body>&quot;기획&quot; 다시 확인</body>' })
    // 줄 첫머리 목록 기호 바로 앞에 쓴 글은 앞 문단 끝으로 갈 수밖에 없어 거절하고, 줄로 끝나면(새 줄 넣기) 받는다
    const list = '<body>머리\n<ul><li>하나</li></ul></body>'
    expect(storyPatch(list, '머리\n앞• 하나')).toEqual({ error: 'format' })
    expect(storyPatch(list, '머리\n새 줄\n• 하나')).toEqual({ html: '<body>머리\n새 줄\n<ul><li>하나</li></ul></body>' })
  })

  const editMock = (
    on: On,
    fetched: Array<{ url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }>,
    { tokenOwner = 'u1', toasts = [] as string[], storyHtml = (): string => '<body><a data-asana-gid="u9" data-asana-type="user">@Nomin</a> 확인</body>', putStatus = (): number => 200 } = {},
  ) => {
    const text = (value: unknown) => ({ value: { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false } })
    on('clock.now', () => ({ value: Date.parse('2026-10-16T03:00:00Z') }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.toast', ($, e) => {
      toasts.push(JSON.stringify(e))
      return { value: undefined as never }
    })
    on('tool.list', () => ({ value: V2.map(name => ({ name, description: '', mcp: true })) }))
    on('mcp.call', ($, e) => {
      if (e.tool === 'get_my_tasks') return text({ data: [{ gid: '1', name: 'JDK 25 문의', memberships: [] }] })
      if (e.tool === 'get_me') return text({ data: { gid: 'u1', name: 'Sam' } })
      return text({
        data: {
          gid: '1',
          name: 'JDK 25 문의',
          custom_type_status_option: { name: '검토 중' },
          custom_type: { status_options: [{ gid: 'st1', name: '검토 중' }, { gid: 'st2', name: '진행 중' }] },
          comments: [
            { gid: 'c1', text: '@Nomin 확인', created_by: { gid: 'u1', name: 'Sam' }, resource_subtype: 'comment_added' },
            { gid: 'c2', text: '남의 댓글', created_by: { gid: 'u9', name: 'Nomin' }, resource_subtype: 'comment_added' },
          ],
        },
      })
    })
    on('http.fetch', ($, e) => {
      fetched.push({ url: e.url, init: e.init })
      const body = e.url.includes('/users/me')
        ? { data: { gid: tokenOwner } }
        : e.init?.method === 'PUT'
          ? { data: { gid: 'c1', text: '고친 글' } }
          : { data: { gid: 'c1', html_text: storyHtml(), created_by: { gid: 'u1' } } }
      if (e.init?.method === 'PUT' && putStatus() !== 200) return { value: { status: putStatus(), ok: false, headers: {}, text: JSON.stringify({ errors: [{ message: 'Forbidden' }] }) } } as never
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } } as never
    })
  }
  const openTask = async ($: Parameters<TestBody>[0]) => {
    await $.command.run({ command: 'desk-asana', args: '' } as never)
    const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-asana', viewport: VIEWPORT, props: { title: 'Asana', isFocused: true, bodyColumns: 96 } as never })
    await pane.press({ key: 'asana-task-1' })
    await wait(50)
    return pane
  }

  test('댓글 고치기: 토큰이 있으면 내 댓글만 ✎, REST 로 원문을 읽어 멘션을 지키며 고친다', { options: { language: 'ko', asanaToken: ' pat-1 ' } }, async ($, on) => {
    const fetched: Array<{ url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }> = []
    editMock(on, fetched)
    const pane = await openTask($)
    expect(await pane.find({ key: 'asana-edit-c1' })).toBeDefined()
    expect(await pane.find({ key: 'asana-edit-c2' })).toBeUndefined()

    await pane.press({ key: 'asana-edit-c1' })
    await wait(50)
    expect(fetched.map(call => call.url).sort()).toEqual([
      'https://app.asana.com/api/1.0/stories/c1?opt_fields=html_text,created_by.gid',
      'https://app.asana.com/api/1.0/users/me?opt_fields=gid',
    ])
    expect(fetched[0]?.init?.headers?.Authorization).toBe('Bearer pat-1')
    expect(JSON.stringify(await pane.drawn())).toContain('asana-editing-c1')

    await pane.input({ key: 'asana-editing-c1-0', text: '@Nomin 다시 확인' })
    await wait(50)
    const put = fetched.find(call => call.init?.method === 'PUT')
    expect(put?.url).toBe('https://app.asana.com/api/1.0/stories/c1?opt_fields=text')
    expect(JSON.parse(put?.init?.body ?? '{}')).toEqual({ data: { html_text: '<body><a data-asana-gid="u9" data-asana-type="user">@Nomin</a> 다시 확인</body>' } })
    expect(JSON.stringify(await pane.drawn())).not.toContain('asana-editing-c1')
    await pane.unmount()
  })

  test('댓글 고치기: 토큰 주인이 쓴 댓글이 아니면 열지 않는다', { options: { language: 'ko', asanaToken: 'pat-2' } }, async ($, on) => {
    const fetched: Array<{ url: string; init?: { method?: string } }> = []
    const toasts: string[] = []
    editMock(on, fetched, { tokenOwner: 'someone-else', toasts })
    const pane = await openTask($)
    await pane.press({ key: 'asana-edit-c1' })
    await wait(50)
    expect(toasts.join()).toContain('내가 쓴 댓글만')
    expect(JSON.stringify(await pane.drawn())).not.toContain('asana-editing-c1')
    expect(fetched.some(call => call.init?.method === 'PUT')).toBe(false)
    await pane.unmount()
  })

  test('댓글 고치기: 서식이 있어도 열고 바뀐 글자만 보내며, 서식 자리를 건드리거나 저장이 실패하면 고치던 글을 둔다', { options: { language: 'ko', asanaToken: 'pat-3' } }, async ($, on) => {
    const fetched: Array<{ url: string; init?: { method?: string; body?: string } }> = []
    const toasts: string[] = []
    let status = 403
    editMock(on, fetched, { toasts, storyHtml: () => '<body>목록\n<ul><li><strong>하나</strong></li></ul></body>', putStatus: () => status })
    const pane = await openTask($)
    await pane.press({ key: 'asana-edit-c1' })
    await wait(50)
    expect(JSON.stringify(await pane.drawn())).toContain('목록\\n• 하나')

    // 목록 기호를 지우면 보내지 않는다
    await pane.input({ key: 'asana-editing-c1-0', text: '목록\n하나' })
    await wait(50)
    expect(toasts.join()).toContain('목록 기호')
    expect(fetched.some(call => call.init?.method === 'PUT')).toBe(false)
    // 칸은 Enter 뒤에 비므로 고치던 글을 새 키로 다시 그린다
    expect(JSON.stringify(await pane.find({ key: 'asana-editing-c1-1' }))).toContain('목록\\n하나')

    // 저장이 거절되면 고치던 글을 둔다
    await pane.input({ key: 'asana-editing-c1-1', text: '목록\n• 하나둘' })
    await wait(50)
    expect(toasts.join()).toContain('Forbidden')
    expect(JSON.stringify(await pane.find({ key: 'asana-editing-c1-2' }))).toContain('하나둘')

    status = 200
    await pane.input({ key: 'asana-editing-c1-2', text: '목록\n• 하나둘' })
    await wait(50)
    expect(JSON.parse(fetched.filter(call => call.init?.method === 'PUT').at(-1)?.init?.body ?? '{}')).toEqual({
      data: { html_text: '<body>목록\n<ul><li><strong>하나둘</strong></li></ul></body>' },
    })
    expect(JSON.stringify(await pane.drawn())).not.toContain('asana-editing-c1')
    await pane.unmount()
  })

  test('댓글 고치기: 토큰이 없으면 REST 를 부르지 않고 넣는 법을 알린다', KO, async ($, on) => {
    const fetched: Array<{ url: string }> = []
    editMock(on, fetched)
    const pane = await openTask($)
    await pane.press({ key: 'asana-edit-c1' })
    await wait(50)
    const drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('개인 토큰(PAT)이 있어야')
    expect(drawn).toContain('/plugin configure desk-look@cc-desktop-mod')
    expect(fetched).toEqual([])
    await pane.press({ key: 'asana-edit-c1' })
    expect(JSON.stringify(await pane.drawn())).not.toContain('개인 토큰(PAT)이 있어야')
    await pane.unmount()
  })

  test('상태 바꾸기: 토큰이 있으면 고른 상태를 REST 로 바꾸고 상세를 다시 읽는다', { options: { language: 'ko', asanaToken: 'pat-4' } }, async ($, on) => {
    const fetched: Array<{ url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }> = []
    editMock(on, fetched)
    const pane = await openTask($)
    expect(await pane.find({ key: 'asana-status-st2' })).toBeUndefined()
    await pane.press({ key: 'asana-status' })
    expect(JSON.stringify(await pane.find({ key: 'asana-status-st1' }))).toContain('✓ 검토 중')
    await pane.press({ key: 'asana-status-st2' })
    await wait(50)
    expect(fetched.map(call => call.url)).toEqual(['https://app.asana.com/api/1.0/tasks/1?opt_fields=gid'])
    expect(fetched[0]?.init?.method).toBe('PUT')
    expect(fetched[0]?.init?.headers?.Authorization).toBe('Bearer pat-4')
    expect(JSON.parse(fetched[0]?.init?.body ?? '{}')).toEqual({ data: { custom_type_status_option: 'st2' } })
    expect(await pane.find({ key: 'asana-status-st2' })).toBeUndefined()
    await pane.unmount()
  })

  test('상태 바꾸기: 토큰이 없으면 REST 를 부르지 않고 넣는 법을 알린다', KO, async ($, on) => {
    const fetched: Array<{ url: string }> = []
    editMock(on, fetched)
    const pane = await openTask($)
    await pane.press({ key: 'asana-status' })
    const drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('상태 바꾸기는 Asana 개인 토큰(PAT)이 있어야')
    expect(drawn).not.toContain('asana-status-st2')
    expect(fetched).toEqual([])
    await pane.unmount()
  })

  test('내 태스크: 최근 14일 안에 완료된 것도 읽어 끝에 상태와 함께 묶는다(v1 은 완료 쪽을 따로 부른다)', KO, async ($, on) => {
    const since = doneSince(Date.parse('2026-10-17T03:00:00Z'))
    expect(since).toBe('2026-10-03T03:00:00.000Z')
    expect(listCalls({ name: 'a', dialect: 'v2' }, since).map(call => call.args.completed_since)).toEqual([since])
    expect(listCalls({ name: 'a', dialect: 'v1' }, since).map(call => [call.args.completed, call.args.completed_at_after])).toEqual([
      [false, undefined],
      [true, since],
    ])

    const text = (value: unknown) => ({ value: { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false } })
    on('clock.now', () => ({ value: Date.parse('2026-10-17T03:00:00Z') }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('tool.list', () => ({ value: V2.map(name => ({ name, description: '', mcp: true })) }))
    on('mcp.call', () =>
      text({
        data: [
          { gid: '1', name: '진행하는 일', memberships: [] },
          { gid: '2', name: '멈춘 일', completed: true, custom_type_status_option: { name: '보류' }, memberships: [] },
          { gid: '3', name: '끝낸 일', completed: true, memberships: [] },
        ],
      }),
    )
    await $.command.run({ command: 'desk-asana', args: '' } as never)
    const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-asana', viewport: VIEWPORT, props: { title: 'Asana', isFocused: true, bodyColumns: 96 } as never })
    await wait(50)
    const drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('내 태스크 1')
    expect(drawn).toContain('최근 14일 완료 · 2')
    expect(drawn).toContain('● 보류')
    expect(drawn.indexOf('진행하는 일')).toBeLessThan(drawn.indexOf('최근 14일 완료'))
    expect(JSON.stringify(await pane.find({ key: 'asana-task-2' }))).toContain('"dimColor":true')
    await pane.unmount()
  })

  test('검색창: 워크스페이스 태스크를 담당자와 함께, 상세에서 돌아오면 검색 결과, ✕ 나 빈 검색이면 내 태스크', KO, async ($, on) => {
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = []
    const text = (value: unknown) => ({ value: { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false } })
    on('clock.now', () => ({ value: Date.parse('2026-10-16T03:00:00Z') }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('tool.list', () => ({ value: V2.map(name => ({ name, description: '', mcp: true })) }))
    on('mcp.call', ($, e) => {
      calls.push({ tool: e.tool, args: e.args })
      if (e.tool === 'get_my_tasks') return text({ data: [{ gid: '1', name: '내 일', memberships: [] }] })
      if (e.tool === 'search_tasks') {
        return text({ data: [{ gid: '7', name: 'JDK 25 문의', assignee: { gid: 'u9', name: 'Nomin' }, memberships: [{ project: { name: 'JENNIFER5 Support' } }] }] })
      }
      return text({ data: { gid: '7', name: 'JDK 25 문의', assignee: { gid: 'u9', name: 'Nomin' } } })
    })

    await $.command.run({ command: 'desk-asana', args: '' } as never)
    const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-asana', viewport: VIEWPORT, props: { title: 'Asana', isFocused: true, bodyColumns: 96 } as never })
    await pane.input({ key: 'asana-search-0', text: ' JDK ' })
    await wait(50)
    expect(calls.find(call => call.tool === 'search_tasks')?.args).toMatchObject({ text: 'JDK', completed: false })
    expect(String(calls.find(call => call.tool === 'search_tasks')?.args.opt_fields)).toContain('assignee.name')
    let drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('검색 \\"JDK\\" 1')
    expect(drawn).toContain('JENNIFER5 Support')
    expect(drawn).toContain(' Nomin')
    expect(drawn).not.toContain('내 일')

    await pane.press({ key: 'asana-task-7' })
    await wait(50)
    expect(calls.filter(call => call.tool === 'get_task').at(-1)).toMatchObject({ tool: 'get_task', args: { task_id: '7' } })
    await pane.press({ key: 'asana-back' })
    expect(JSON.stringify(await pane.drawn())).toContain('JDK 25 문의')

    // ↻ 는 검색을 다시 한다
    await pane.press({ key: 'asana-refresh' })
    await wait(50)
    expect(calls.filter(call => call.tool === 'search_tasks').length).toBe(2)

    await pane.press({ key: 'asana-search-clear' })
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('내 태스크 1')
    expect(drawn).toContain('내 일')

    await pane.input({ key: 'asana-search-1', text: 'JDK' })
    await wait(50)
    await pane.input({ key: 'asana-search-1', text: '  ' })
    await wait(50)
    expect(JSON.stringify(await pane.drawn())).toContain('내 태스크 1')
    await pane.unmount()
  })

  test('프로젝트 응답: 내가 멤버인지, 최근에 바뀐 것부터, 태스크는 고른 프로젝트의 섹션으로', () => {
    const projects = toProjects(
      {
        data: [
          { gid: 'p1', name: '옛 일', members: [{ gid: 'me' }], modified_at: '2026-01-01T00:00:00Z' },
          { gid: 'p2', name: 'APM', members: [{ gid: 'u2' }, { gid: 'me' }], modified_at: '2026-10-16T00:00:00Z', task_counts: { num_incomplete_tasks: 77 } },
          { gid: 'p3', name: '남의 일', members: [{ gid: 'u2' }], modified_at: '2026-10-17T00:00:00Z' },
        ],
      },
      'me',
    )
    expect(projects.map(p => [p.gid, p.isMine, p.members, p.open])).toEqual([
      ['p3', false, 1, null],
      ['p2', true, 2, 77],
      ['p1', true, 1, null],
    ])
    // 두 프로젝트에 걸친 태스크는 고른 프로젝트의 섹션을 쓴다
    const tasks = toTasks(
      { data: [{ gid: 't1', name: 'x', memberships: [{ project: { gid: 'p9', name: 'Other' }, section: { name: '딴 섹션' } }, { project: { gid: 'p2', name: 'APM' }, section: { name: '백엔드' } }] }] },
      'p2',
    )
    expect(tasks[0]).toMatchObject({ project: 'APM', section: '백엔드' })
    expect(nextOffset({ data: [], next_page: { offset: 'abc' } })).toBe('abc')
    expect(nextOffset({ data: [], next_page: null })).toBeNull()
    const v2 = { name: 'asana-v2', dialect: 'v2' } as const
    expect(projectTasksCall(v2, 'p2', '2026-10-17T03:00:00.000Z', 'abc')).toMatchObject({ tool: 'get_tasks', args: { project: 'p2', completed_since: '2026-10-17T03:00:00.000Z', offset: 'abc' } })
    expect(projectTasksCall(v2, 'p2', '2026-10-17T03:00:00.000Z').args).not.toHaveProperty('offset')
  })

  test('프로젝트 탭: 내 프로젝트 → 섹션별 모든 사람의 열린 태스크 → 상세 → 돌아오면 그 프로젝트', KO, async ($, on) => {
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = []
    const text = (value: unknown) => ({ value: { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false } })
    on('clock.now', () => ({ value: Date.parse('2026-10-17T03:00:00Z') }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('tool.list', () => ({ value: V2.map(name => ({ name, description: '', mcp: true })) }))
    on('mcp.call', ($, e) => {
      calls.push({ tool: e.tool, args: e.args })
      const apm = (gid: string, name: string, section: string, assignee: string) => ({
        gid,
        name,
        assignee: { gid: assignee, name: assignee },
        memberships: [{ project: { gid: 'p2', name: 'APM' }, section: { name: section } }],
      })
      switch (e.tool) {
        case 'get_my_tasks':
          return text({ data: [] })
        case 'get_me':
          return text({ data: { gid: 'me', name: 'Sam' } })
        case 'get_projects':
          return e.args.offset === undefined
            ? text({ data: [{ gid: 'p2', name: 'APM', members: [{ gid: 'me' }], modified_at: '2026-10-16T00:00:00Z', task_counts: { num_incomplete_tasks: 3 } }], next_page: { offset: 'pg2' } })
            : text({ data: [{ gid: 'p3', name: '남의 프로젝트', members: [{ gid: 'u2' }], modified_at: '2026-10-17T00:00:00Z' }], next_page: null })
        case 'get_tasks':
          return e.args.offset === undefined
            ? text({ data: [apm('t1', '정리', 'Untitled section', 'Aiden'), apm('t2', '통계 api', '백엔드', 'Sam')], next_page: { offset: 'tp2' } })
            : text({ data: [apm('t3', '세션 관리', '백엔드', 'Chalse'), { ...apm('t4', '멈춘 일', '백엔드', 'Sam'), completed: true, custom_type_status_option: { name: '보류' } }], next_page: null })
        default:
          return text({ data: { gid: 't3', name: '세션 관리', assignee: { gid: 'Chalse', name: 'Chalse' } } })
      }
    })

    await $.command.run({ command: 'desk-asana', args: '' } as never)
    const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-asana', viewport: VIEWPORT, props: { title: 'Asana', isFocused: true, bodyColumns: 96 } as never })
    await pane.press({ key: 'asana-tab-projects' })
    await wait(50)
    expect(calls.filter(call => call.tool === 'get_projects').map(call => call.args.offset)).toEqual([undefined, 'pg2'])
    let drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('● 프로젝트')
    expect(drawn).toContain('내 프로젝트 1')
    expect(drawn).toContain('멤버 1 · 열린 3')
    expect(drawn).not.toContain('남의 프로젝트')

    await pane.press({ key: 'asana-project-p2' })
    await wait(50)
    const tasksCalls = calls.filter(call => call.tool === 'get_tasks')
    // 열린 태스크와 최근 14일 안에 완료된 태스크(보류처럼 완료로 치는 상태)를 함께 읽는다
    expect(tasksCalls[0]?.args).toMatchObject({ project: 'p2', completed_since: '2026-10-03T03:00:00.000Z' })
    expect(tasksCalls[0]?.args).not.toHaveProperty('assignee')
    expect(tasksCalls[1]?.args.offset).toBe('tp2')
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('열린 태스크 3')
    expect(drawn).toContain('섹션 없음')
    expect(drawn).toContain('백엔드')
    expect(drawn).toContain(' Chalse')
    expect(drawn.indexOf('섹션 없음')).toBeLessThan(drawn.indexOf('백엔드'))
    // 완료된 태스크는 섹션이 아니라 끝의 최근 완료 묶음에 상태와 함께
    expect(drawn).toContain('최근 14일 완료 · 1')
    expect(drawn).toContain('● 보류')
    expect(drawn.indexOf('세션 관리')).toBeLessThan(drawn.indexOf('멈춘 일'))

    // 섹션을 접으면 그 태스크가 빠진다
    await pane.press({ key: 'asana-section-1' })
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).not.toContain('세션 관리')
    await pane.press({ key: 'asana-section-1' })

    // 모두 접기(z): 하나라도 펴져 있으면 다 접고, 다 접혔으면 다 편다. 다시 읽기는 r
    expect(JSON.stringify(await pane.find({ type: 'Button', key: 'asana-fold-all' }))).toContain('"hotkey":"z"')
    expect(JSON.stringify(await pane.find({ type: 'Button', key: 'asana-project-refresh' }))).toContain('"hotkey":"r"')
    await pane.press({ key: 'asana-section-0' })
    await pane.press({ key: 'asana-fold-all' })
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).not.toContain('정리')
    expect(drawn).not.toContain('세션 관리')
    expect(drawn).toContain('모두 펴기')
    await pane.press({ key: 'asana-fold-all' })
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('정리')
    expect(drawn).toContain('세션 관리')
    expect(drawn).toContain('모두 접기')

    await pane.press({ key: 'asana-task-t3' })
    await wait(50)
    expect(calls.filter(call => call.tool === 'get_task').at(-1)).toMatchObject({ tool: 'get_task', args: { task_id: 't3' } })
    await pane.press({ key: 'asana-back' })
    expect(JSON.stringify(await pane.drawn())).toContain('세션 관리')

    await pane.press({ key: 'asana-project-back' })
    expect(JSON.stringify(await pane.drawn())).toContain('내 프로젝트 1')
    await pane.press({ key: 'asana-tab-mine' })
    expect(JSON.stringify(await pane.drawn())).toContain('내 태스크 0')
    await pane.unmount()
  })

  test('Asana 서버가 없으면 연결하라고 알린다', KO, async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('tool.list', () => ({ value: [{ name: 'Read', description: '', mcp: false }] }))
    const result = JSON.stringify(await $.command.run({ command: 'desk-asana', args: '' } as never))
    expect(result).toContain('Asana MCP 서버가 연결돼 있지 않아요')
  })
})

describe('Slack 패널', () => {
  // claude.ai Slack 커넥터가 주는 글 모양 그대로(이름·주소는 가짜).
  const ME = 'U0ME'
  const result = (i: number, n: number, m: { channel: string; kind: 'DM' | 'Group DM'; people: string; from: string; fromId: string; ts: string; text: string }) =>
    [
      `### Result ${i} of ${n}`,
      `Channel: ${m.kind} (ID: ${m.channel})`,
      `Participants: ${m.people}`,
      `From: ${m.from} (ID: ${m.fromId}) `,
      'Time: 2026-10-16 15:24:20 KST',
      `Message_ts: ${m.ts}`,
      `Permalink: [link](https://example.slack.com/archives/${m.channel}/p${m.ts.replace('.', '')})`,
      'Text: ',
      m.text,
      '',
      '---',
      '',
    ].join('\n')
  const KEVIN = { channel: 'D01', kind: 'DM' as const, people: 'Me Myself (ID: U0ME), kevin (ID: U0KV)', from: 'kevin <kevin@example.com>', fromId: 'U0KV' }
  const GROUP = { channel: 'C02', kind: 'Group DM' as const, people: 'alvin (ID: U0AL), Me Myself (ID: U0ME), bot-x (ID: U0BX)', from: 'alvin <alvin@example.com>', fromId: 'U0AL' }
  const search = (...items: Array<Parameters<typeof result>[2]>) =>
    `# Search Results for: \n\n## Messages (${items.length} results)\n${items.map((item, index) => result(index + 1, items.length, item)).join('\n')}`
  const HISTORY = [
    'Channel: DM (D01)',
    '',
    '=== Message from me <me@example.com> (U0ME) at 2026-10-16 15:34:52 KST === ',
    'Message TS: 1792132492.915909',
    '오오... <https://example.com/a|링크>',
    '',
    '=== Message from kevin <kevin@example.com> (U0KV) at 2026-10-16 15:24:20 KST === ',
    'Message TS: 1792131860.241069',
    '{"pid":12029}',
    'Files: a.jpg (ID: F01, image/jpeg, 1.0 KB)',
  ].join('\n')

  test('응답 읽기: 검색은 DM·그룹 DM 만, 기록은 오래된 것부터, 링크 글, ts 비교', async () => {
    const got = parseSearch(search({ ...KEVIN, ts: '1792131860.241069', text: '{"a":1}\n둘째 줄' }, { ...GROUP, ts: '1790756351.080449', text: '이거봐요' }))
    expect(got).toHaveLength(2)
    expect(got[0]).toEqual({
      channel: 'D01',
      kind: 'dm',
      participants: [
        { id: 'U0ME', name: 'Me Myself' },
        { id: 'U0KV', name: 'kevin' },
      ],
      from: { id: 'U0KV', name: 'kevin' },
      ts: '1792131860.241069',
      text: '{"a":1}\n둘째 줄',
      permalink: 'https://example.slack.com/archives/D01/p1792131860241069',
    })
    expect(got[1]?.kind).toBe('group')
    // 채널 메시지는 범위 밖이라 버린다
    expect(parseSearch(search({ ...KEVIN, kind: 'DM', ts: '1.1', text: 'x' }).replace('Channel: DM (ID: D01)', 'Channel: #general (ID: C9)'))).toEqual([])
    const posts = parseHistory(HISTORY)
    expect(posts.map(post => [post.from.name, post.ts])).toEqual([
      ['kevin', '1792131860.241069'],
      ['me', '1792132492.915909'],
    ])
    expect(posts[0]?.text).toBe('{"pid":12029}\nFiles: a.jpg (ID: F01, image/jpeg, 1.0 KB)')
    expect(slackText(posts[1]!.text)).toBe('오오... 링크')
    expect(parseMe('User ID: U0ME\nUsername: me\n')).toBe('U0ME')
    expect(resultText({ content: [{ type: 'text', text: JSON.stringify({ messages: HISTORY }) }], isError: false }, 'messages')).toEqual({ ok: true, text: HISTORY })
    expect(resultText({ content: [{ type: 'text', text: 'channel_not_found' }], isError: true }, 'messages')).toEqual({ ok: false, error: 'channel_not_found' })
    expect(tsCompare('1792131860.241069', '1792131860.24107')).toBeLessThan(0)
    expect(tsCompare('999.9', '1000.0')).toBeLessThan(0)
    expect(findSlackServer(['mcp__claude_ai_Slack__slack_read_channel', 'mcp__asana-v2__get_me'])).toBeNull()
    // deny 규칙이 걸린 도구는 목록에 없어도 서버는 찾는다(빠진 도구는 규칙 안내로)
    expect(findSlackServer(['mcp__claude_ai_Slack__slack_search_public_and_private', 'mcp__claude_ai_Slack__slack_read_channel'])).toEqual({ name: 'claude_ai_Slack' })
  })

  test('대화방: 처음 채우기는 알리지 않고, 그 뒤 새 메시지만 방에, 닫은 방은 새 메시지가 와야 다시', () => {
    const now = 1792200000
    const first = mergeInbox(emptyInbox(), parseSearch(search({ ...KEVIN, ts: '1792131860.241069', text: 'a' })), ME, now)
    expect(first.fresh).toEqual([])
    expect(first.inbox.watermark).toBe('1792131860.241069')
    expect(first.inbox.rooms.D01).toMatchObject({ title: 'kevin', unread: 0, link: 'https://example.slack.com/archives/D01' })
    // 받은 게 없어도 워터마크는 지금으로: 다음 메시지는 알린다
    expect(mergeInbox(emptyInbox(), [], ME, now).inbox.watermark).toBe(`${now}.000000`)

    const again = parseSearch(search({ ...GROUP, ts: '1792131900.000001', text: '새 글' }, { ...KEVIN, ts: '1792131860.241069', text: 'a' }))
    const second = mergeInbox(first.inbox, again, ME, now)
    expect(second.fresh.map(message => message.ts)).toEqual(['1792131900.000001'])
    expect(second.inbox.rooms.C02).toMatchObject({ title: 'alvin, bot-x', lastFrom: 'alvin', preview: '새 글', unread: 1 })
    expect(roomList(second.inbox).map(room => room.id)).toEqual(['C02', 'D01'])
    expect(unreadCount(second.inbox)).toBe(1)
    expect(notices(second.fresh, second.inbox, n => ` +${n}`)).toEqual([{ title: 'alvin, bot-x', text: 'alvin: 새 글' }])

    const closed = closeRoom(second.inbox, 'D01')
    expect(closed.rooms.D01).toBeUndefined()
    // 같은 메시지를 다시 받아도 닫은 방은 그대로 닫혀 있고, 새 메시지면 다시 생긴다
    expect(mergeInbox(closed, again, ME, now).inbox.rooms.D01).toBeUndefined()
    const reopened = mergeInbox(closed, parseSearch(search({ ...KEVIN, ts: '1792132000.5', text: '또' })), ME, now)
    expect(reopened.inbox.rooms.D01).toMatchObject({ unread: 1, preview: '또' })

    // 방을 읽으면 안 읽음 0, 기록의 마지막 글이 내 답장이면 lastFrom null
    const read = readRoom(reopened.inbox, 'D01', [{ ts: '1792132100.1', from: { id: ME, name: 'me' }, at: '', text: '답장' }], ME)
    expect(read.rooms.D01).toMatchObject({ unread: 0, lastFrom: null, preview: '답장' })
  })

  test('받은 편지를 읽을 세션(임대)과 받은 편지 호출 모양', () => {
    expect(holdsLease(null, 's1', 0)).toBe(true)
    expect(holdsLease({ session: 's1', at: 0 }, 's1', 10)).toBe(true)
    expect(holdsLease({ session: 's2', at: 0 }, 's1', LEASE_MS)).toBe(false)
    expect(holdsLease({ session: 's2', at: 0 }, 's1', LEASE_MS + 1)).toBe(true)
    expect(inboxCall(ME, 100).args).toMatchObject({ filters: 'to:<@U0ME>', channel_types: 'im,mpim', after: '100', sort: 'timestamp' })
  })

  // 엔진 흉내: 도구 목록·규칙·MCP 응답. rules 가 false 인 도구는 allow 규칙이 없다.
  // isClockMocked: 시계는 테스트가 mock.clock 으로 따로 돌린다.
  function slackEngine(on: On, inbox: () => string, options: { rules?: (tool: string) => boolean; surfaces?: () => string[]; isClockMocked?: boolean; store?: Record<string, unknown> } = {}) {
    const { rules = () => true, surfaces = () => ['terminal'] } = options
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = []
    const notified: Array<{ text: string; title?: string }> = []
    const text = (value: unknown, isError = false) => ({ value: { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], isError } })
    // 받은 편지·내 UID·임대는 $.store 에
    mock.store(on, options.store)
    if (!options.isClockMocked) {
      on('clock.now', () => ({ value: 1792200000 * 1000 }))
      on('clock.after', () => new Promise(() => undefined) as never)
    }
    on('session.id', () => ({ value: 'sess-1' }))
    on('session.surfaces', () => ({ value: surfaces() }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.toast', () => ({ value: undefined as never }))
    on('ui.notify', ($, e) => {
      notified.push(e)
      return { value: { isSent: true, channel: 'ghostty' } }
    })
    on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
    on('tool.list', () => ({
      value: ['slack_search_public_and_private', 'slack_read_channel', 'slack_send_message', 'slack_read_user_profile'].map(name => ({ name: `mcp__claude_ai_Slack__${name}`, description: '', mcp: true })),
    }))
    on('tool.check', ($, e) => ({ decision: rules(e.tool) ? 'allow' : 'ask' }) as never)
    on('mcp.call', ($, e) => {
      calls.push({ tool: e.tool, args: e.args })
      switch (e.tool) {
        case 'slack_read_user_profile':
          return text({ result: `User ID: ${ME}\nUsername: me\n` })
        case 'slack_search_public_and_private':
          return text({ results: inbox() })
        case 'slack_read_channel':
          return text({ messages: HISTORY })
        default:
          return text({ ok: true })
      }
    })
    return { calls, notified }
  }

  test('allow 규칙이 하나라도 없으면 Slack 을 부르지 않고 넣을 규칙을 보인다', KO, async ($, on) => {
    const { calls } = slackEngine(on, () => search(), { rules: tool => !tool.endsWith('slack_send_message') })
    await $.command.run({ command: 'desk-slack', args: '' } as never)
    expect(calls).toEqual([])
    const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-slack', viewport: VIEWPORT, props: { title: 'Slack', isFocused: true, bodyColumns: 96 } as never })
    const drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('허용 규칙이 없어')
    expect(drawn).toContain('\\"mcp__claude_ai_Slack__slack_send_message\\",')
    expect(drawn).not.toContain('slack_read_channel\\"')
    await pane.unmount()
  })

  test('1분 확인: 맡은 세션이 3분 넘게 소식이 없으면 넘겨받되, 터미널이 없는 세션은 맡지 않는다', KO, async ($, on) => {
    let surfaces: string[] = []
    const clock = mock.clock(on, { now: 1792200000 * 1000 })
    const { calls } = slackEngine(on, () => search(), { surfaces: () => surfaces, isClockMocked: true, store: { slackPoller: { session: 'other', at: 0 } } })
    on('command.register', () => ({ value: undefined as never }))
    on('session.start', ($, e) => e as never)
    await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal' } as never)
    await clock.advance(60_000)
    expect(calls).toEqual([])
    surfaces = ['terminal']
    await clock.advance(60_000)
    expect(calls.map(call => call.tool)).toEqual(['slack_read_user_profile', 'slack_search_public_and_private'])
  })

  test('목록 → 대화방 → 답장, 닫기는 두 번, 새 메시지는 알림과 칩', KO, async ($, on) => {
    let inbox = search({ ...KEVIN, ts: '1792131860.241069', text: '등록이 안 돼요' })
    const { calls, notified } = slackEngine(on, () => inbox)
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine-band</Text>
    })
    await $.command.run({ command: 'desk-slack', args: '' } as never)
    expect(calls.map(call => call.tool)).toEqual(['slack_read_user_profile', 'slack_search_public_and_private'])
    // 처음 채우기는 알리지 않는다
    expect(notified).toEqual([])
    const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-slack', viewport: VIEWPORT, props: { title: 'Slack', isFocused: true, bodyColumns: 96 } as never })
    let drawn = JSON.stringify(await pane.drawn())
    // 처음 채운 것은 읽은 것으로(Slack 의 읽음을 알 수 없다): 안 읽음 표시·칩 없음
    expect(drawn).toContain('대화방 1')
    expect(drawn).not.toContain('안 읽음')
    expect(drawn).toContain('  kevin')
    expect(drawn).toContain('등록이 안 돼요')
    const band = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'AbovePrompt', viewport: VIEWPORT, props: { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 96 } as never })
    expect(JSON.stringify(await band.drawn())).not.toContain('✉')

    await pane.press({ key: 'slack-room-D01' })
    await wait(50)
    drawn = JSON.stringify(await pane.drawn())
    expect(calls.at(-1)).toEqual({ tool: 'slack_read_channel', args: { channel_id: 'D01', limit: 30, response_format: 'detailed' } })
    expect(drawn).toContain('{\\"pid\\":12029}')
    expect(drawn).toContain('오오... 링크')

    await pane.input({ key: 'slack-write-D01-0', text: '확인해 볼게요\n잠시만요' })
    await wait(50)
    expect(calls.find(call => call.tool === 'slack_send_message')?.args).toEqual({ channel_id: 'D01', message: '확인해 볼게요\n잠시만요' })

    // 새 메시지: 방마다 알림 하나
    inbox = search({ ...GROUP, ts: '1792199000.000001', text: '이거봐요' }, { ...GROUP, ts: '1792199100.000001', text: '<https://example.com|여기>' })
    await pane.press({ key: 'slack-back' })
    await pane.press({ key: 'slack-refresh' })
    await wait(50)
    expect(notified).toEqual([{ text: 'alvin: 여기 (외 1개)', title: 'alvin, bot-x' }])
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('대화방 2 · 안 읽음 2')
    expect(drawn).toContain('● alvin, bot-x')
    // 아래턱 칩: 안 읽음 수, 누르면 패널
    expect(JSON.stringify(await band.drawn())).toContain('✉')
    // 같은 결과를 다시 받아도 또 알리지 않는다
    await pane.press({ key: 'slack-refresh' })
    await wait(50)
    expect(notified).toHaveLength(1)

    // 닫기: 한 번 누르면 확인 문구, 다시 눌러야 닫힌다
    await pane.press({ key: 'slack-close-C02' })
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).toContain('닫을까요?')
    await pane.press({ key: 'slack-close-C02' })
    await wait(50)
    drawn = JSON.stringify(await pane.drawn())
    expect(drawn).not.toContain('alvin')
    expect(drawn).toContain('kevin')
    await band.unmount()
    await pane.unmount()
  })
})
