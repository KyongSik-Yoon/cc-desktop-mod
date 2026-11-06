import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { absPath, counts, itemsOf, parseReport } from '../hooks/review'

const KO = { options: { language: 'ko' } }
const VIEWPORT = { columns: 100, rows: 40 }
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

test('보고서 입력: 검사·경로 풀기·단계 묶기', () => {
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
})

const world = (on: On) => {
  const seen = { opened: [] as string[], diffAt: [] as unknown[], processes: 0, reads: 0 }
  on('process.run', () => {
    seen.processes++
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.cwd', () => ({ value: '/repo' }))
  on('command.register', () => ({ value: undefined as never }))
  on('tool.register', () => ({ value: { tool: 'mcp__desk-review__review_report' } }) as never)
  on('session.start', ($, e) => e as never)
  on('state.get', { plugin: 'desk-look', key: 'lang' }, () => ({ value: { value: undefined, version: 1 } }) as never)
  on('state.set', { plugin: 'desk-review', key: 'diffAt' }, ($, e, next) => (seen.diffAt.push(e.value), next(e)))
  on('fs.read', () => {
    seen.reads++
    throw new Error('ENOENT')
  })
  on('ui.open', ($, e) => {
    seen.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  return seen
}

test('review_report 도구: 보고서를 받아 패널을 열고, 항목은 머리줄과 이유만, 누르면 desk-look 변경 사항 탭으로 넘긴다', KO, async ($, on) => {
  const seen = world(on)
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
  // 경로는 폴더와 파일 이름을 나눠 그리고, 줄 번호를 붙인다
  expect(drawn).toContain('"children":["a.ts"]')
  expect(drawn).toContain('":12"')
  expect(drawn).toContain('"children":["./src/"]')
  expect(drawn).toContain('동작이 바뀐다')
  // 빈 칸은 "없음"으로 남긴다(확인 못 한 것)
  expect(drawn).toContain('없음')
  // 좁은 패널이라 코드는 싣지 않는다
  expect(await pane.find({ type: 'Code' })).toBeUndefined()

  // 항목을 누르면 desk-look 에 그 파일을 넘긴다. 같은 파일을 다시 눌러도 값이 바뀌게 n 을 올린다
  await pane.press({ key: 'item-0' })
  await pane.press({ key: 'item-2' })
  expect(seen.diffAt).toEqual([
    { path: '/repo/src/a.ts', n: 1 },
    { path: '/repo/src/a.ts', n: 2 },
  ])
  // 누를 때 파일·git 을 읽지 않는다
  expect(seen.reads).toBe(0)
  expect(seen.processes).toBe(0)
  await pane.unmount()

  expect((await $.command.run({ command: 'desk-review', args: '' } as never)).text).toBe('리뷰 결과를 옆 패널에 펼쳤어요.')
})
