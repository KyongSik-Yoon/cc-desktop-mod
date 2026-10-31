import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'

import { GRANTS, isGranted } from '../hooks/register'

test('허용 목록: 형제 플러그인의 알려진 MCP 도구만, 서버 이름은 가리지 않는다', () => {
  expect(isGranted('desk-slack', 'mcp__claude_ai_Slack__slack_read_channel')).toBe(true)
  expect(isGranted('desk-slack', 'mcp__slack__slack_send_message')).toBe(true)
  expect(isGranted('desk-asana', 'mcp__asana-v2__get_my_tasks')).toBe(true)
  expect(isGranted('desk-asana', 'mcp__claude_ai_asana__asana_get_task')).toBe(true)
  // 형제라도 남의 도구, 목록 밖 도구, MCP 가 아닌 도구, 다른 플러그인·모델은 아니다
  expect(isGranted('desk-asana', 'mcp__claude_ai_Slack__slack_read_channel')).toBe(false)
  expect(isGranted('desk-slack', 'mcp__claude_ai_Slack__slack_search_channels')).toBe(false)
  expect(isGranted('desk-slack', 'Bash')).toBe(false)
  expect(isGranted('desk-slack', 'mcp____slack_read_channel')).toBe(false)
  expect(isGranted('desk-look', 'mcp__claude_ai_Slack__slack_read_channel')).toBe(false)
  expect(isGranted('engine', 'mcp__asana-v2__get_my_tasks')).toBe(false)
  expect(GRANTS['desk-asana']).toHaveLength(19)
})

// 형제 흉내: 명령 ask 가 도구 하나의 판정을 묻는다(desk-asana·desk-slack 이 패널에서 하는 $.tool.check 질의).
// 인라인 플러그인은 register 소스만 옮겨져 바깥 변수를 잡지 못한다.
const slack: Plugin = {
  name: 'desk-slack',
  register(on: On) {
    on('command.run', { command: 'ask-slack' }, async ($, e) => ({ text: (await $.tool.check({ tool: e.args.trim(), input: {} })).decision }))
  },
}
const asana: Plugin = {
  name: 'desk-asana',
  register(on: On) {
    on('command.run', { command: 'ask-asana' }, async ($, e) => ({ text: (await $.tool.check({ tool: e.args.trim(), input: {} })).decision }))
  },
}
const look: Plugin = {
  name: 'desk-look',
  register(on: On) {
    on('command.run', { command: 'ask-look' }, async ($, e) => ({ text: (await $.tool.check({ tool: e.args.trim(), input: {} })).decision }))
  },
}

test('형제의 질의는 허용, 다른 플러그인과 모델의 판정은 엔진 그대로', { plugins: [slack, asana, look] }, async ($, on) => {
  on('tool.check', () => ({ decision: 'ask' }) as never)
  const ask = async (plugin: string, tool: string) => (await $.command.run({ command: `ask-${plugin}`, args: tool } as never)).text
  expect(await ask('slack', 'mcp__claude_ai_Slack__slack_read_thread')).toBe('allow')
  expect(await ask('asana', 'mcp__asana-v2__add_comment')).toBe('allow')
  expect(await ask('slack', 'mcp__asana-v2__add_comment')).toBe('ask')
  expect(await ask('look', 'mcp__claude_ai_Slack__slack_read_thread')).toBe('ask')
  // 테스트의 $ 는 엔진(origin engine): 모델의 호출과 같다
  expect((await $.tool.check({ tool: 'mcp__claude_ai_Slack__slack_read_thread', input: {} })).decision).toBe('ask')
})
