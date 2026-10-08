import { describe, expect, test } from 'claude-code/testing'

import { bubbleEdges, bubbleRows, cardFor, describeCalls, lineChange, mergeEdit, diffStat, editHunk, parseDiff, planRow, summarize, wrapText } from '../hooks/register'
import { cellWidth, columnWidths, inlineWidth, parseBlocks, parseInline, plainText } from '../hooks/markdown'

const VIEWPORT = { columns: 100, rows: 40 }
const call = (tool: string, input: unknown, extra: Partial<{ isErrored: boolean }> = {}) => ({
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
  test('답변은 서명 없이 데스크톱 산문 스타일로 그린다', async $ => {
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
    expect(await reply.find({ type: 'Text', text: '•' })).toBeDefined()
    await reply.unmount()
  })

  test('mermaid 는 박스 문자 그림으로, 한글 폭을 맞춰 그린다', async $ => {
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

  test('속성 붙은 펜스, 알림 박스, 코드 바탕 폭', async $ => {
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

  test('데스크톱 화면에서는 엔진 그림을 그대로 둔다', async ($, on) => {
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

  test('사용자 프롬프트는 둥근 말풍선', async $ => {
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
  test('편집 한 줄: 동사·파일명·칩, 누르면 diff 로 펼친다', async $ => {
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

  test('결과 블록은 숨긴다', async $ => {
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

  test('묶음 한 줄 요약, 누르면 호출별 줄', async $ => {
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

  test('입력창 위 밴드는 다른 플러그인의 밴드를 지우지 않는다', async ($, on) => {
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

test('순수 함수', async () => {
  expect(cellWidth('ab한글')).toBe(6)
  expect(summarize('Edit', { file_path: '/a/b/c.ts' })).toBe('c.ts')
  expect(describeCalls([call('Bash', {}), call('Bash', {}), call('Write', {}), call('Edit', {}), call('Read', {}), call('WebFetch', {})])).toBe(
    'Ran 2 commands, created a file, edited a file, and 2 more actions',
  )
  expect(describeCalls([call('Bash', {}), call('mcp__x__y', {})])).toBe('Ran a command, used a tool')
  expect(diffStat(call('Edit', { old_string: 'a\nb', new_string: 'c' }))).toEqual({ added: 1, removed: 2 })
  // 문맥 줄은 빼고 센다: 한 줄 추가는 +1 −0
  expect(lineChange('x\ny', 'x\ny\nz')).toEqual({ added: 1, removed: 0 })
  expect(lineChange('a\nhello\nb', 'a\nhi\nb')).toEqual({ added: 1, removed: 1 })
  expect(lineChange('', 'new')).toEqual({ added: 1, removed: 0 })
  expect(editHunk('a', 'b')).toBe('@@ -1,1 +1,1 @@\n-a\n+b')

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
  test('omarchy colors.toml 에서 말풍선 색을 계산한다', async () => {
    const light = parseSurface('mode = "light"\nbackground = "#fafafa"\nforeground = "#212121"\n')
    expect(light?.mode).toBe('light')
    expect(light?.bubble).toBe(mix('#fafafa', '#000000', 0.055))
    expect(light?.bubble).not.toBe('#fafafa')
    const dark = parseSurface('background = "#1a1b26"\n')
    expect(dark?.mode).toBe('dark')
    expect(parseSurface('nothing here')).toBeNull()
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })

  test('텍스트가 끼기 전까지의 도구 호출을 한 묶음으로 계산한다', async () => {
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

  test('묶음의 첫 행은 묶음 한 줄, 나머지 행은 비운다', async () => {
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

import { parseImages, supportsGraphics, thumbnailSize } from '../hooks/images'
import { renderDiagram } from '../hooks/diagram'

test('붙여 넣은 이미지 목록과 썸네일 크기', async () => {
  const listing = '/tmp/claude-1000/p/s/images/8.png  137 80 78 71 13 10 26 10 0 0 0 13 73 72 68 82 0 0 1 234 0 0 1 42 \n/tmp/x/images/notes.txt 1 2\n'
  const images = parseImages(listing)
  expect(images).toEqual({ '8': { path: '/tmp/claude-1000/p/s/images/8.png', width: 490, height: 298 } })
  expect(thumbnailSize({ path: '', width: 490, height: 298 }, 36)).toEqual({ columns: 36, rows: 11 })
  // 세로로 긴 그림은 행 상한에 맞춰 폭을 줄인다
  expect(thumbnailSize({ path: '', width: 300, height: 1200 }, 36)).toEqual({ columns: 6, rows: 12 })
})

test('말풍선 줄바꿈과 다이어그램 색 나누기', async () => {
  expect(wrapText('가나다 라마바 사아', 8)).toEqual(['가나다', '라마바', '사아'])
  expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  expect(wrapText('첫 줄\n둘째 줄', 20)).toEqual(['첫 줄', '둘째 줄'])
  const kinds = new Set((renderDiagram('flowchart LR\n  A[시작] -->|예| B[끝]')?.rows ?? []).flat().map(seg => seg.kind))
  expect([...kinds].sort()).toEqual(['arrow', 'border', 'label', 'line', 'text'])
})

test('그래픽 지원 판정과 그림 못 그릴 때 [Image #N] 지우기', async $ => {
  expect(supportsGraphics({ TERM: 'xterm-ghostty' })).toBe(true)
  expect(supportsGraphics({ TERM: 'xterm-256color', TERM_PROGRAM: 'ghostty' })).toBe(true)
  expect(supportsGraphics({ TERM: 'xterm-ghostty', HERDR_ENV: '1' })).toBe(false)
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

test('분기 노드는 이중선 상자, 일반 노드는 둥근 상자', async () => {
  const text = (renderDiagram('flowchart LR\n  A[답변] --> B{종류} --> C[그림]')?.rows ?? [])
    .map(row => row.map(seg => seg.text).join(''))
    .join('\n')
  expect(text).toContain('╔')
  expect(text).toContain('╭')
  expect(text).not.toContain('┌')
})

test('말풍선 줄은 칸 수를 맞춰 같은 폭으로 채운다', async () => {
  const rows = bubbleRows(['첫 줄', 'second line'])
  expect(rows.map(cellWidth)).toEqual([15, 15])
  expect(rows[0]).toBe('  첫 줄      ' + '  ')
})

test('말풍선 끝 칸은 줄 위치로 고른다', async () => {
  expect(bubbleEdges(1)).toEqual([['\ue0b6', '\ue0b4']])
  const three = bubbleEdges(3)
  expect(three[0]).toEqual(['\u{1FB41}', '\u{1FB4C}'])
  expect(three[1]).toEqual([null, null])
  expect(three[2]).toEqual(['\u{1FB52}', '\u{1FB5D}'])
  expect(bubbleEdges(2).map(pair => pair[0])).toEqual(['\u{1FB41}', '\u{1FB52}'])
  // 모서리 글리프는 한 칸이라 줄 폭이 어긋나지 않는다
  expect(cellWidth('\u{1FB41}')).toBe(1)
})

test('화살촉은 상자 테두리에 꽂고 그 앞 칸은 선으로 잇는다', async () => {
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

test('턴 끝 카드: 파일 합치기와 소요 시간 짝짓기', async () => {
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

test('턴 끝 줄은 기록이 없으면 엔진 그림 그대로', async ($, on) => {
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
