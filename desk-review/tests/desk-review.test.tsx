import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { absPath, counts, hunkAt, itemsOf, parseReport, sourceWindow } from '../hooks/review'

const KO = { options: { language: 'ko' } }
const VIEWPORT = { columns: 100, rows: 40 }
const SOURCE = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'

const HUNK_12 = ['@@ -10,4 +10,3 @@', ' line 10', '-old 11', '-old 12', '+line 11', ' line 12'].join('\n')
const HUNK_40 = ['@@ -40,2 +39,3 @@', ' line 39', '+line 40', ' line 41'].join('\n')
const DIFF = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', HUNK_12, HUNK_40, ''].join('\n')

const INPUT = {
  summary: '정리 1건, 결함 1건',
  items: [
    { stage: 'simplify', status: 'fixed', file: 'src/a.ts', line: 12, reason: '중복 제거' },
    { stage: 'simplify', status: 'skipped', file: '/repo/src/b.ts', line: 3, reason: '동작이 바뀐다' },
    { stage: 'review', status: 'found', file: './src/a.ts', line: 40, reason: '빈 입력에서 깨진다' },
  ],
  unverified: '',
  next: '1. 걸러 내기 (추천) 2. 거절',
}

test('보고서 입력: 검사·경로 풀기·단계 묶기·줄 둘레 자르기', () => {
  expect(absPath('/repo', 'src/a.ts')).toBe('/repo/src/a.ts')
  expect(absPath('/repo/', './src/a.ts')).toBe('/repo/src/a.ts')
  expect(absPath('/repo', '/etc/x')).toBe('/etc/x')

  const parsed = parseReport(INPUT, '/repo', 1)
  if (!('report' in parsed)) throw new Error(parsed.error)
  expect(parsed.report.items.map(item => item.path)).toEqual(['/repo/src/a.ts', '/repo/src/b.ts', '/repo/src/a.ts'])
  expect(itemsOf(parsed.report, 'review').map(row => row.index)).toEqual([2])
  expect(counts(parsed.report)).toEqual({ fixed: 1, skipped: 1, found: 1, dismissed: 0 })

  // 단계와 맞지 않는 상태, 빈 이유, 빈 결론, 줄 번호 없음은 사유와 함께 거절
  expect(parseReport({ ...INPUT, items: [{ ...INPUT.items[0], status: 'found' }] }, '/repo', 1)).toEqual({ error: 'items[0].status must be fixed or skipped for stage simplify.' })
  expect(parseReport({ ...INPUT, items: [{ ...INPUT.items[0], reason: ' ' }] }, '/repo', 1)).toMatchObject({ error: expect.stringContaining('reason is empty') })
  expect(parseReport({ ...INPUT, summary: '' }, '/repo', 1)).toMatchObject({ error: expect.stringContaining('summary') })
  expect(parseReport({ ...INPUT, items: [{ ...INPUT.items[0], line: 0 }] }, '/repo', 1)).toMatchObject({ error: expect.stringContaining('line') })
  expect(parseReport({ summary: 'x' }, '/repo', 1)).toMatchObject({ error: expect.stringContaining('items') })

  expect(sourceWindow(SOURCE, 12)).toEqual({ kind: 'source', source: ['line 7', 'line 8', 'line 9', 'line 10', 'line 11', 'line 12', 'line 13', 'line 14', 'line 15', 'line 16', 'line 17'].join('\n'), startLine: 7, line: 12 })
  expect(sourceWindow(SOURCE, 2)).toMatchObject({ startLine: 1, line: 2 })
  // 파일보다 뒤의 줄은 마지막 줄로 붙인다
  expect(sourceWindow(SOURCE, 40)).toMatchObject({ startLine: 25, line: 30 })
  expect(sourceWindow('', 1)).toEqual({ error: 'empty' })
  // 엔진 Code 는 빈 줄을 높이 0 으로 그린다: 빈 줄은 공백 한 칸, CRLF 의 \r 은 뺀다
  expect(sourceWindow('a\r\n\r\nb\n', 2)).toMatchObject({ source: 'a\n \nb' })

  // 고친 줄을 담은 헌크만, 파일 머리 없이. 담은 헌크가 없으면 가장 가까운 헌크, 헌크가 없으면 null
  expect(hunkAt(DIFF, 12)).toBe(HUNK_12)
  expect(hunkAt(DIFF, 41)).toBe(HUNK_40)
  expect(hunkAt(DIFF, 30)).toBe(HUNK_40)
  expect(hunkAt(DIFF, 1)).toBe(HUNK_12)
  expect(hunkAt('', 12)).toBeNull()
})

const world = (on: On, files: Record<string, string>, diffs: Record<string, string>) => {
  const seen = { opened: [] as string[], diffAt: [] as unknown[] }
  // git diff [HEAD] … -- <path>: 그 파일의 diff(없으면 빈 출력)
  on('process.run', ($, e) => {
    const stdout = e.argv[0] === 'git' && e.argv[1] === 'diff' ? (diffs[e.argv[e.argv.length - 1]!] ?? '') : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.cwd', () => ({ value: '/repo' }))
  on('command.register', () => ({ value: undefined as never }))
  on('tool.register', () => ({ value: { tool: 'mcp__desk-review__review_report' } }) as never)
  on('session.start', ($, e) => e as never)
  on('state.get', { plugin: 'desk-look', key: 'lang' }, () => ({ value: { value: undefined, version: 1 } }) as never)
  on('state.set', { plugin: 'desk-review', key: 'diffAt' }, ($, e, next) => (seen.diffAt.push(e.value), next(e)))
  on('fs.read', ($, e) => {
    const text = files[(e as { path: string }).path]
    if (text === undefined) throw new Error('ENOENT')
    return { value: text } as never
  })
  on('ui.open', ($, e) => {
    seen.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  return seen
}

test('review_report 도구: 보고서를 받아 패널을 열고, 고친 항목은 그 자리 diff, 나머지는 지금 소스, diff 버튼은 desk-look 에 넘긴다', KO, async ($, on) => {
  const seen = world(on, { '/repo/src/a.ts': SOURCE }, { '/repo/src/a.ts': DIFF })
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal' } as never)

  expect((await $.command.run({ command: 'desk-review', args: '' } as never)).text).toBe('아직 리뷰 결과가 없어요. /desk-review:simplify-review 로 만드세요.')

  const bad = await $.tool.call({ tool: 'mcp__desk-review__review_report', summary: 'x', items: [{ stage: 'review', status: 'fixed', file: 'a', line: 1, reason: 'r' }] } as never)
  expect(bad.deny).toBe('items[0].status must be found or dismissed for stage review.')
  expect(seen.opened).toEqual([])

  const ran = await $.tool.call({ tool: 'mcp__desk-review__review_report', ...INPUT } as never)
  expect(ran.result).toMatch(/^Shown in the desk-review pane \(1 fixed, 1 skipped, 1 found, 0 dismissed\)/)
  expect(seen.opened).toEqual(['desk-review'])

  const pane = await $.ui.mount({ plugin: 'desk-review', surface: 'terminal', component: 'Pane', requestId: 'desk-review', viewport: VIEWPORT, props: { title: '리뷰 결과', isFocused: true, bodyColumns: 80 } as never })
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('정리 1건, 결함 1건')
  expect(drawn).toContain('src/a.ts:12')
  expect(drawn).toContain('./src/a.ts:40')
  expect(drawn).toContain('동작이 바뀐다')
  // 빈 칸은 "없음"으로 남긴다(확인 못 한 것)
  expect(drawn).toContain('없음')
  expect(await pane.find({ type: 'Code' })).toBeUndefined()

  // 고친 항목을 펴면 그 줄을 담은 diff 헌크
  await pane.press({ key: 'item-0' })
  expect(await pane.find({ type: 'Code' })).toMatchObject({ props: { format: 'diff', source: HUNK_12, path: '/repo/src/a.ts' } })
  // 찾은 항목은 지금 파일의 그 줄 둘레를 번호와 함께. 파일보다 뒤의 줄이면 알려 준다
  await pane.press({ key: 'item-2' })
  expect((await pane.findAll({ type: 'Code' }))[1]).toMatchObject({ props: { startLine: 25, path: '/repo/src/a.ts' } })
  expect(JSON.stringify(await pane.drawn())).toContain('40번째 줄이 없어서 마지막 줄 30 을 보여요')
  // 못 읽는 파일은 사유(안 고친 항목이라 git 을 묻지 않고 바로 소스)
  await pane.press({ key: 'item-1' })
  expect(JSON.stringify(await pane.drawn())).toContain('파일을 못 읽었어요 (')

  await pane.press({ key: 'diff-0' })
  await pane.press({ key: 'diff-0' })
  expect(seen.diffAt).toEqual([
    { path: '/repo/src/a.ts', n: 1 },
    { path: '/repo/src/a.ts', n: 2 },
  ])

  // 다시 접으면 소스를 감춘다
  await pane.press({ key: 'item-0' })
  await pane.press({ key: 'item-2' })
  expect(await pane.find({ type: 'Code' })).toBeUndefined()
  await pane.unmount()

  expect((await $.command.run({ command: 'desk-review', args: '' } as never)).text).toBe('리뷰 결과를 옆 패널에 펼쳤어요.')
})

test('고친 항목인데 diff 가 없으면(이미 커밋, git 밖) 지금 소스를 보인다', KO, async ($, on) => {
  world(on, { '/repo/src/a.ts': SOURCE }, {})
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal' } as never)
  await $.tool.call({ tool: 'mcp__desk-review__review_report', summary: 'x', items: [INPUT.items[0]] } as never)
  const pane = await $.ui.mount({ plugin: 'desk-review', surface: 'terminal', component: 'Pane', requestId: 'desk-review', viewport: VIEWPORT, props: { title: '리뷰 결과', isFocused: true, bodyColumns: 80 } as never })
  await pane.press({ key: 'item-0' })
  expect(await pane.find({ type: 'Code' })).toMatchObject({ props: { startLine: 7, path: '/repo/src/a.ts' } })
  expect(JSON.stringify(await pane.drawn())).toContain('◫ 변경 사항 탭에서 열기')
  await pane.unmount()
})
