import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { isMarkdown, planAskMode, planInput, planTextRows, planTitle, reviseReason } from '../hooks/plan'

const PLAN = ['# 빼기 추가', '', '- math.ts 에 subtract', '- 테스트 추가', '', '| 파일 | 변경 |', '|---|---|', '| math.ts | subtract |'].join('\n')
const PATH = '/h/.claude/plans/p.md'

test('계획 카드: 계획 제목·입력 정리·고칠 점 사유·줄 수', () => {
  expect(planTitle(PLAN)).toBe('빼기 추가')
  expect(planTitle('\n**바로** 시작\n- 단계')).toBe('바로 시작')
  expect(planTitle('')).toBe('')
  expect(planInput({ tool: 'ExitPlanMode', tool_use_id: 't1', plan: 'p', planFilePath: '/a.md' })).toEqual({ plan: 'p', planFilePath: '/a.md' })
  expect(reviseReason('  2단계를 나눠 줘 ')).toContain('\n\n2단계를 나눠 줘\n\n')
  expect(reviseReason('x')).toContain('call ExitPlanMode again')
  expect(planAskMode(10, 2)).toBe('full')
  expect(planAskMode(9, 2)).toBe('compact')
  expect(planAskMode(3, 2)).toBe('inline')
  expect(planTextRows('')).toBe(2)
  expect(planTextRows('a\nb\nc\nd\ne')).toBe(4)
  expect(isMarkdown(PATH)).toBe(true)
  expect(isMarkdown('/a.txt')).toBe(false)
})

// 엔진과 desk-look 흉내: 터미널 하나, 카드 버튼이 파이프에 쓸 답을 cat 이 바로 돌려준다.
// desk-look 의 값(언어·떠 있는 질문·입력이 온 곳)은 look 에서 읽는다.
const world = (on: On, look: { lang?: string; ask?: unknown; promptOrigin?: string | null } = {}) => {
  const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  const seen = { reply: '', runs: [] as string[], notified: [] as string[], previews: [] as unknown[], reached: [] as Record<string, unknown>[] }
  on('state.get', { plugin: 'desk-look', key: 'lang' }, () => ({ value: { value: look.lang, version: 1 } }) as never)
  on('state.get', { plugin: 'desk-look', key: 'ask' }, () => ({ value: { value: look.ask ?? null, version: 1 } }) as never)
  on('state.get', { plugin: 'desk-look', key: 'promptOrigin' }, () => ({ value: { value: look.promptOrigin ?? null, version: 1 } }) as never)
  on('state.set', { plugin: 'desk-plan', key: 'preview' }, ($, e, next) => (seen.previews.push(e.value), next(e)))
  on('clock.now', () => ({ value: 1_000 }))
  on('env.get', () => ({ value: undefined as never }))
  on('fs.list', () => {
    throw new Error('ENOENT')
  })
  on('session.id', () => ({ value: 's1' }))
  on('session.surfaces', () => ({ value: ['terminal'] }) as never)
  on('ui.notify', ($, e) => {
    seen.notified.push(JSON.stringify(e))
    return { value: undefined } as never
  })
  on('process.run', ($, e) => {
    seen.runs.push(e.argv[0] ?? '')
    if (e.argv[0] === 'mktemp') return ok('/tmp/plan-card\n')
    if (e.argv[0] === 'cat') return ok(seen.reply)
    return ok()
  })
  on('session.start', ($, e) => e as never)
  on('tool.call', ($, e) => {
    seen.reached.push(e as never)
    return { result: { plan: PLAN, isAgent: false } } as never
  })
  return seen
}
const INPUT = { plan: PLAN, planFilePath: PATH }

// 카드 화면과 버튼은 실제 Claude 에서 본다: 하네스는 기다리는 훅이 쓴 상태를 훅이 끝나기 전에는 그리지 않는다.
// 여기서는 cat 이 답을 바로 돌려주게 해서 훅이 고르는 길을 본다.
test('계획 카드 훅: 승인은 입력 그대로 allow, 고칠 점은 거절 사유, 기본 창은 엔진 흐름', async ($, on) => {
  const seen = world(on, { lang: 'ko' })
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal' } as never)

  // 승인: 입력을 그대로 돌려줘 도구 본체가 돈다(엔진에서는 그게 모드를 계획 전으로 되돌린다)
  seen.reply = JSON.stringify({ kind: 'approve' })
  const approved = await $.tool.call({ tool: 'ExitPlanMode', ...INPUT } as never)
  expect(approved.isError).toBeFalsy()
  expect(seen.reached).toHaveLength(1)
  expect(seen.reached[0]).toMatchObject(INPUT)
  // 계획 파일은 desk-look 이 미리보기 패널로 열도록 preview 에 쓴다(포커스는 주지 않는다)
  expect(seen.previews).toEqual([{ path: PATH, focus: false, n: 1 }])
  // 언어는 desk-look 을 따르고(auto), 엔진 창이 보내던 알림을 카드가 대신 보낸다
  expect(seen.notified).toEqual([JSON.stringify({ text: '빼기 추가', title: 'Claude 계획' })])
  expect(seen.runs).toEqual(expect.arrayContaining(['mktemp', 'mkfifo', 'cat', 'rm']))

  // 고칠 점: 도구는 돌지 않고, 모델은 고칠 점과 함께 다시 계획하라는 거절을 받는다
  seen.reply = JSON.stringify({ kind: 'revise', text: '테스트를 먼저 써 줘' })
  const denied = await $.tool.call({ tool: 'ExitPlanMode', ...INPUT } as never)
  expect(denied.isError).toBe(true)
  expect(denied.text).toContain('테스트를 먼저 써 줘')
  expect(denied.text).toContain('call ExitPlanMode again')
  expect(seen.reached).toHaveLength(1)

  // 기본 창: 훅이 비켜서 엔진 흐름(승인 창)으로
  seen.reply = JSON.stringify({ kind: 'engine' })
  await $.tool.call({ tool: 'ExitPlanMode', ...INPUT } as never)
  expect(seen.reached).toHaveLength(2)

  // 계획 파일이 없으면(계획을 인자로만 받는 세션) 카드 없이 엔진 흐름
  const before = seen.runs.length
  await $.tool.call({ tool: 'ExitPlanMode', plan: PLAN } as never)
  expect(seen.reached).toHaveLength(3)
  expect(seen.runs.slice(before)).not.toContain('mktemp')
})

test('계획 카드 훅: desk-look 질문 카드가 떠 있거나 폰·앱에서 입력했으면 엔진 창', async ($, on) => {
  const look: { ask?: unknown; promptOrigin?: string | null } = { ask: { id: 'q1' } }
  const seen = world(on, look)
  seen.reply = JSON.stringify({ kind: 'approve' })
  await $.tool.call({ tool: 'ExitPlanMode', ...INPUT } as never)
  look.ask = null
  look.promptOrigin = 'phone'
  await $.tool.call({ tool: 'ExitPlanMode', ...INPUT } as never)
  look.promptOrigin = 'bridge'
  await $.tool.call({ tool: 'ExitPlanMode', ...INPUT } as never)
  expect(seen.runs).not.toContain('mktemp')
  expect(seen.reached).toHaveLength(3)
  // 터미널에서 입력했으면 카드
  look.promptOrigin = 'composer'
  await $.tool.call({ tool: 'ExitPlanMode', ...INPUT } as never)
  expect(seen.runs).toContain('mktemp')
})
