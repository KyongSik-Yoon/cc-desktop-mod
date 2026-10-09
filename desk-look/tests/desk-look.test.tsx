import { describe, expect, test } from 'claude-code/testing'

import { bubbleEdges, bubbleRows, cardFor, chinLabel, describeCalls, formatElapsed, spinnerDots, spinnerWord, lineChange, mergeEdit, diffStat, editHunk, patchOf, askAnswer, parseDiff, planRow, summarize, wrapText } from '../hooks/register'
import { cellWidth, columnWidths, inlineWidth, parseBlocks, parseInline, plainText } from '../hooks/markdown'

const VIEWPORT = { columns: 100, rows: 40 }
const call = (tool: string, input: unknown, extra: Partial<{ isErrored: boolean; output: string }> = {}) => ({
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
  test('답변은 서명 없이 데스크톱 산문 스타일로 그린다', async ($, on) => {
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

  test('묶음을 펼치면 편집 diff 가 바로, 다시 누르면 접힌다', async $ => {
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

import { ago, clip, filterSessions, groupSessions, numbered, parseSessions } from '../hooks/sessions'

test('세션 목록 읽기·묶기·표시', async () => {
  const listing = [
    'ab12bc38-9375-438b-b199-90724fcb83cd\t1791456080\t/home/u/repo\t\tClaude Code 모드 아이디어',
    '83c92571-f2bb-4513-8111-da82e042ba8f\t1791455457\t/home/u/other\t직접 붙인 이름\t자동 제목',
    '554bfb0b-ba79-4f30-bf0b-03fb9fcd7140\t1791455005\t/home/u/repo\t\t\t마지막 프롬프트',
    '65688aaf-c25e-4243-975e-4e7a106d7071\t1791455000\t/home/u/repo\t\t\t',
    'not-a-session\t1\t/x\t\t',
  ].join('\n')
  const list = parseSessions(listing)
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

test('입력창 아래턱 글자', () => {
  expect(chinLabel('cc-desktop-mod', 'main')).toBe(' \uf07b  cc-desktop-mod   \ue0a0 main')
  expect(chinLabel('scratch', null)).toBe(' \uf07b  scratch')
})

test('진행 표시 글자', () => {
  expect(spinnerWord('tool-use', null)).toBe('Running')
  expect(spinnerWord('thinking', 'Compacting conversation')).toBe('Compacting conversation')
  expect(formatElapsed(12_400)).toBe('12s')
  expect(formatElapsed(149_000)).toBe('2m 29s')
  expect(formatElapsed(3_720_000)).toBe('1h 2m')
  expect([0, 500, 1000, 1500].map(spinnerDots)).toEqual(['●··', '·●·', '··●', '●··'])
})

import { computeTasks, visibleTasks } from '../hooks/tasks'

test('할 일 목록 다시 세우기와 보일 줄', () => {
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

test('질문 카드: 그릴 수 있는 질문과 답 모양', () => {
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

test('질문 도구 줄: 질문과 답', () => {
  expect(summarize('AskUserQuestion', { questions: [{ question: 'Which color?' }] })).toBe('Which color?')
  expect(describeCalls([{ tool: 'AskUserQuestion', input: {}, isRunning: false, isErrored: false, isInterrupted: false }])).toBe('Asked a question')
  expect(askAnswer({ answers: { 'Which color?': 'Blue', 'Pet?': 'Dogs' } })).toBe('Blue · Dogs')
  expect(askAnswer('{"answers":{"q":"a"}}')).toBe('a')
  expect(askAnswer('oops')).toBeNull()
})

import { agentOf } from '../hooks/runs'
import { askHint, askRows, formatTokens, looksLikeMarkdown, textKey } from '../hooks/register'

test('서브에이전트 카드 요약과 묶음', () => {
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

test('명령 출력 마크다운 판별과 질문 힌트', async $ => {
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

test('모드 칩: 테마를 모르면 엔진 그림 그대로', async ($, on) => {
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.modes.join(' & ')}</Text>
  })
  const row = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'SessionMode', viewport: VIEWPORT, props: { modes: ['focus'] } })
  expect(await row.find({ type: 'Text', text: 'focus' })).toBeDefined()
  await row.unmount()
})

test('diff 패널 되돌리기는 두 번 눌러야 git restore', async ($, on) => {
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

test('세션 검색', () => {
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

test('질문 카드: 도구 호출 → 입력창 위 카드 → 버튼 → 결과', async ($, on) => {
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
    const script = e.argv[2] ?? ''
    if (script.includes('while [ ! -e')) return done(await waiting)
    if (script.includes('answer.tmp')) {
      answer(e.argv[5] ?? '')
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

test('아래턱: 저장소·브랜치·diff 칩을 다른 밴드 아래에', async ($, on) => {
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

test('질문 카드 줄 수: 모자라면 간단한 모양', () => {
  const two = { kind: 'choice', multiSelect: false, options: [{}, {}] }
  expect(askRows(two, false)).toBe(2 + 2 + 1 + 2 + 3)
  expect(askRows(two, true)).toBe(2 + 1 + 2)
  expect(askRows({ ...two, multiSelect: true }, true)).toBe(6)
  expect(askRows({ ...two, options: [{ preview: 'x' }, {}] }, false)).toBe(11)
})

test('에이전트 메시지 줄: 누르면 그 자리에서 마크다운으로 펼침', async $ => {
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

test('말풍선 위치 설정: 기본 왼쪽', () => {
  expect(bubbleSide({})).toBe('left')
  expect(bubbleSide({ bubbleSide: 'right' })).toBe('right')
  expect(bubbleSide({ bubbleSide: 'weird' })).toBe('left')
})

const PROMPT = { text: '안녕', origin: { kind: 'composer' }, isExpanded: false } as never

test('말풍선 왼쪽(기본)', async $ => {
  const row = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'UserMessage', viewport: VIEWPORT, props: PROMPT })
  expect(JSON.stringify(await row.drawn())).toContain('"alignItems":"flex-start"')
  await row.unmount()
})

test('말풍선 오른쪽 설정', { options: { bubbleSide: 'right' } }, async $ => {
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

test('컨텍스트 칩 판정과 글자', () => {
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

test('컨텍스트 칩: 반을 넘기면 아래턱 옆에, 누르면 패널', async ($, on) => {
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

test('컨텍스트 칩: 반이 안 되면 auto 는 숨김, always 는 보임', async ($, on) => {
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

test('컨텍스트 칩 always 설정', { options: { contextChip: 'always' } }, async ($, on) => {
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

test('질문 알림 본문: 첫 질문, 여러 개면 외 N개', () => {
  const q = (question: string) => ({ question, header: '', kind: 'choice' as const, options: [{ label: 'a' }], multiSelect: false })
  expect(askNotice([q('어느 쪽?')])).toBe('어느 쪽?')
  expect(askNotice([q('어느 쪽?'), q('몇 개?'), q('언제?')])).toBe('어느 쪽? (외 2개)')
})

import { supportsRichButtons } from '../hooks/register'

test('줄 전체 버튼은 2.1.295 부터', () => {
  expect(supportsRichButtons('2.1.294')).toBe(false)
  expect(supportsRichButtons('2.1.295')).toBe(true)
  expect(supportsRichButtons('2.1.295-dev')).toBe(true)
  expect(supportsRichButtons('2.2.0')).toBe(true)
  expect(supportsRichButtons('3.0.0')).toBe(true)
  expect(supportsRichButtons(undefined)).toBe(false)
})

for (const version of ['2.1.295', '2.1.294']) {
  const rich = version !== '2.1.294'
  test(`에이전트 메시지 줄 버튼 모양 (${version}: ${rich ? '줄 전체' : '이름만'})`, async ($, on) => {
    on('session.version', () => ({ value: { version, base: version } }))
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
    let drawn = JSON.stringify(await row.drawn())
    for (let tries = 0; tries < 50 && rich && !/"type":"Button"[^}]*"children"/.test(drawn); tries++) {
      await wait(10)
      drawn = JSON.stringify(await row.drawn())
    }
    const key = /"key":"(peer-[^"]+)"/.exec(drawn)?.[1] ?? ''
    const button = await row.find({ type: 'Button', key })
    expect(button).toBeDefined()
    // 줄 전체 모양이면 미리보기가 버튼 안에, 옛 모양이면 이름이 라벨이고 미리보기는 옆에
    expect(JSON.stringify(button).includes('첫 줄 미리보기')).toBe(rich)
    expect(drawn).toContain('첫 줄 미리보기')
    await row.press({ key })
    expect(await row.find({ type: 'Text', text: /본문/ })).toBeDefined()
    await row.unmount()
  })
}

import { clipStart, matchDiffFile } from '../hooks/register'

test('턴 끝 카드 파일 → diff 패널 파일 짝짓기, 앞 줄이기', () => {
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

test('턴 끝 카드의 파일 줄을 누르면 diff 패널이 그 파일에서 열린다', async ($, on) => {
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
  // 접어 둔 파일이라도 카드에서 누르면 펼쳐서 연다(그 파일로 스크롤은 실화면에서 확인: 테스트 도구는 key 스크롤을 풀지 못한다)
  await pane.press({ key: 'fold-a.txt' })
  expect(await pane.find({ type: 'Code' })).toBeUndefined()
  await row.press({ key: 'diffat-3000-/repo/a.txt' })
  expect(opened).toEqual(['desk-diff'])
  expect(await pane.find({ type: 'Code' })).toBeDefined()
  await pane.unmount()
  await row.unmount()
})

test('diff 패널: 파일 머리 줄을 누르면 그 파일 diff 를 접고 편다', async ($, on) => {
  on('process.run', gitStub as never)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'desk-diff', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'desk-look', surface: 'terminal', component: 'Pane', requestId: 'desk-diff', viewport: VIEWPORT, props: { title: '변경 사항', isFocused: true } as never })
  expect(await pane.find({ type: 'Code' })).toBeDefined()
  await pane.press({ key: 'fold-a.txt' })
  expect(await pane.find({ type: 'Code' })).toBeUndefined()
  expect(await pane.find({ type: 'Button', key: 'revert-a.txt' })).toBeDefined()
  await pane.press({ key: 'fold-a.txt' })
  expect(await pane.find({ type: 'Code' })).toBeDefined()
  await pane.unmount()
})

import { planOf } from '../hooks/runs'
import { splitPlan } from '../hooks/register'

const PLAN = ['# 빼기 추가', '', '- math.ts 에 subtract', '- 테스트 추가', '', '| 파일 | 변경 |', '|---|---|', '| math.ts | subtract |'].join('\n')

test('계획 읽기: 엔진 결과, 저장한 요약, 결과 글', () => {
  expect(planOf({ plan: PLAN, isAgent: false, filePath: '/h/.claude/plans/p.md' })).toEqual({ plan: PLAN, filePath: '/h/.claude/plans/p.md' })
  expect(planOf({ plan: null, isAgent: false })).toEqual({ plan: null })
  expect(planOf(JSON.stringify({ plan: PLAN, isAgent: false }))?.plan).toBe(PLAN)
  expect(planOf(`User has approved your plan. You can now start coding.\n\n## Approved Plan:\n${PLAN}`)?.plan).toBe(PLAN)
  expect(planOf('그냥 글')).toBe(null)
  expect(planOf({ stdout: 'x' })).toBe(null)
})

test('계획 접기: 줄 수를 넘긴 뒤 첫 빈 줄에서, 코드 울타리 안은 자르지 않는다', () => {
  const long = Array.from({ length: 6 }, (_, index) => `문단 ${index}\n줄`).join('\n\n')
  expect(splitPlan(long, 4)).toEqual({ head: '문단 0\n줄\n\n문단 1\n줄', hidden: 8 })
  expect(splitPlan('짧음', 4)).toEqual({ head: '짧음', hidden: 0 })
  const fenced = ['a', 'b', 'c', '```', 'x', '', 'y', '```', '', 'z'].join('\n')
  expect(splitPlan(fenced, 4).head).toBe(['a', 'b', 'c', '```', 'x', '', 'y', '```'].join('\n'))
})

test('계획은 묶음에 섞지 않고 혼자 카드 하나', () => {
  const use = (id: string, tool: string) => ({ tool_use_id: id, tool, input: {} })
  const runsOf = computeRuns([
    { role: 'assistant', text: '', toolUses: [use('r', 'Read'), use('w', 'Write'), use('p', 'ExitPlanMode'), use('b', 'Bash')] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'p', text: 'ok', isError: false, result: { plan: PLAN, isAgent: false } }] },
  ] as never)
  expect(runsOf.firstOf).toEqual({ r: 'r', w: 'r', p: 'p', b: 'b' })
  expect(planOf(runsOf.calls.p?.[0]?.output)?.plan).toBe(PLAN)
})

test('계획 카드: 상태와 마크다운 본문, 길면 Show all', async $ => {
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
})
