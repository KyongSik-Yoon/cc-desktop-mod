import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { fitTextRows, isMarkdown, planAskMode, planComments, planFieldColumns, planInput, planTextRows, planTitle, reviseReason } from '../hooks/plan'

const PLAN = ['# 빼기 추가', '', '- math.ts 에 subtract', '- 테스트 추가', '', '| 파일 | 변경 |', '|---|---|', '| math.ts | subtract |'].join('\n')
const PATH = '/h/.claude/plans/p.md'

test('계획 카드: 계획 제목·입력 정리·고칠 점 사유·줄 수', () => {
  expect(planTitle(PLAN)).toBe('빼기 추가')
  expect(planTitle('\n**바로** 시작\n- 단계')).toBe('바로 시작')
  expect(planTitle('')).toBe('')
  expect(planInput({ tool: 'ExitPlanMode', tool_use_id: 't1', plan: 'p', planFilePath: '/a.md' })).toEqual({ plan: 'p', planFilePath: '/a.md' })
  expect(reviseReason('  2단계를 나눠 줘 ')).toContain('\n\n2단계를 나눠 줘\n\n')
  expect(reviseReason('x')).toContain('call ExitPlanMode again')
  expect(planAskMode(9, 2)).toBe('full')
  expect(planAskMode(8, 2)).toBe('compact')
  expect(planAskMode(3, 2)).toBe('inline')
  expect(planTextRows('', 40)).toBe(2)
  expect(planTextRows('a\nb\nc\nd\ne', 40)).toBe(5)
  // 칸 폭을 넘는 줄은 접힌 줄까지 세고, 한글은 두 칸이다
  expect(planTextRows('x'.repeat(120), 40)).toBe(3)
  expect(planTextRows('가'.repeat(40), 40)).toBe(2)
  expect(planTextRows('x'.repeat(4000), 40)).toBe(8)
  expect(fitTextRows(8, 12)).toBe(5)
  expect(fitTextRows(8, 8)).toBe(2)
  // 넓으면 긴 안내를 두고, 좁아 칸이 절반을 못 넘으면 짧은 안내로 칸을 넓힌다
  expect(planFieldColumns(120, 'Changes', 'Ask for changes')).toBe(120 - 9 - 32)
  expect(planFieldColumns(50, 'Changes', 'Ask for changes')).toBe(50 - 9 - 18)
  expect(isMarkdown(PATH)).toBe(true)
  expect(isMarkdown('/a.txt')).toBe(false)
})

// 엔진과 desk-look 흉내: 터미널 하나, 카드 버튼이 파이프에 쓸 답을 cat 이 바로 돌려준다.
// desk-look 의 값(언어·떠 있는 질문·입력이 온 곳)은 look 에서 읽는다.
const world = (on: On, look: { lang?: string; ask?: unknown; promptOrigin?: string | null; lineComments?: unknown[] } = {}) => {
  const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  const seen = { reply: '', runs: [] as string[], notified: [] as string[], previews: [] as unknown[], sent: [] as unknown[], reached: [] as Record<string, unknown>[] }
  on('state.get', { plugin: 'desk-look', key: 'lang' }, () => ({ value: { value: look.lang, version: 1 } }) as never)
  on('state.get', { plugin: 'desk-look', key: 'lineComments' }, () => ({ value: { value: look.lineComments ?? [], version: 1 } }) as never)
  on('state.set', { plugin: 'desk-plan', key: 'sent' }, ($, e, next) => (seen.sent.push(e.value), next(e)))
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

// desk-look 미리보기 패널 원문 줄 보기에서 계획 파일 4–5번 줄에 단 댓글(patch 키 p:경로)과 다른 파일 diff 댓글.
const line = (n: number, text: string) => ({ kind: ' ' as const, oldNo: n, newNo: n, text })
const PLAN_NOTE = { id: '7', patch: `p:${PATH}`, path: PATH, scope: 'document', end: { kind: ' ' as const, oldNo: 4, newNo: 4 }, lines: [line(3, '- math.ts 에 subtract'), line(4, '- 테스트 추가')], body: '테스트를 먼저' }
const DIFF_NOTE = { ...PLAN_NOTE, id: '8', patch: 'src/a.ts', path: 'src/a.ts', scope: 'uncommitted changes' }

test('계획 줄 댓글: 이 계획 파일 것만 골라 거절 사유에 파일:줄·원문·댓글로 싣는다', () => {
  expect(planComments([PLAN_NOTE, DIFF_NOTE], [PATH]).map(note => note.id)).toEqual(['7'])
  expect(planComments([PLAN_NOTE], ['/real/p.md'])).toEqual([])
  expect(planComments([PLAN_NOTE], ['/real/p.md', PATH])).toHaveLength(1)
  // 옛 상태·이상한 값은 견딘다
  expect(planComments(undefined, [PATH])).toEqual([])
  expect(planComments([{ patch: `p:${PATH}` } as never], [PATH])).toEqual([])
  const both = reviseReason(' 2단계를 나눠 줘 ', [PLAN_NOTE])
  expect(both).toContain(`${PATH}:3–4\n\`\`\`\n3 - math.ts 에 subtract\n4 - 테스트 추가\n\`\`\`\n테스트를 먼저`)
  expect(both).toContain('Also:\n\n2단계를 나눠 줘')
  expect(both).toContain('call ExitPlanMode again')
  // 댓글만이면 Also 없이
  expect(reviseReason('', [PLAN_NOTE])).not.toContain('Also:')
  // 댓글이 없으면 예전과 같다
  expect(reviseReason('x')).toBe(reviseReason('x', []))
  expect(reviseReason('x')).not.toContain('Comments on lines')
})

test('계획 카드 훅: 고쳐 달라는 답에 계획 줄 댓글을 싣고 sent 로 알린다, 승인 때는 두어 다음 프롬프트로', async ($, on) => {
  const seen = world(on, { lang: 'ko', lineComments: [PLAN_NOTE, DIFF_NOTE] })
  seen.reply = JSON.stringify({ kind: 'revise', text: '' })
  const denied = await $.tool.call({ tool: 'ExitPlanMode', ...INPUT } as never)
  expect(denied.isError).toBe(true)
  expect(denied.text).toContain(`${PATH}:3–4`)
  expect(denied.text).toContain('테스트를 먼저')
  // 다른 파일의 diff 댓글은 싣지 않는다
  expect(denied.text).not.toContain('src/a.ts')
  expect(seen.sent).toEqual([{ ids: ['7'], n: 1 }])

  seen.reply = JSON.stringify({ kind: 'approve' })
  await $.tool.call({ tool: 'ExitPlanMode', ...INPUT } as never)
  expect(seen.sent).toHaveLength(1)
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

test('언어: desk-look 이 아직 언어를 쓰지 않았으면 Claude Code /config 의 language 를 따른다', async ($, on) => {
  const seen = world(on)
  on('config.list', () => ({ value: [{ key: 'language', value: '한국어' }] }) as never)
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal' } as never)
  seen.reply = JSON.stringify({ kind: 'approve' })
  await $.tool.call({ tool: 'ExitPlanMode', ...INPUT } as never)
  expect(seen.notified).toEqual([JSON.stringify({ text: '빼기 추가', title: 'Claude 계획' })])
})
