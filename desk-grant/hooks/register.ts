import type { Register } from 'claude-code'

// desk-asana·desk-slack 패널이 부르는 MCP 도구를 사용자 allow 규칙 없이 통과시킨다.
// 플러그인의 $.mcp.call 도 권한 검사를 받는데(auto mode 분류기는 거절, 기본 모드는 창), 플러그인 자신의 tool.check 훅은
// 버튼·입력칸 클로저와 타이머에서 부른 호출에는 돌지 않는다(2.1.316 실측). 다른 플러그인의 훅은 돈다.
// 그래서 이 플러그인이 형제의 호출을 허용한다. origin 은 엔진이 채우므로 모델의 같은 도구 호출(origin engine)은 건드리지 않는다.
// $.tool.check 질의에도 같게 답해, 형제 패널이 이 플러그인이 있는지 알 수 있다(없으면 설치 안내).
//
// 도구 이름은 desk-asana/hooks/asana.ts ASANA_TOOLS, desk-slack/hooks/slack.ts SLACK_TOOLS 와 같아야 한다.
// 빠지면 형제 패널이 그 도구를 빠진 것으로 안내한다. 서버 이름은 사람마다 달라(asana-v2, claude_ai_Slack) 가리지 않는다.
export const GRANTS: Readonly<Record<string, readonly string[]>> = {
  'desk-asana': [
    // v2: Asana 공식 v2 서버
    'get_my_tasks',
    'search_tasks',
    'get_task',
    'get_task_stories',
    'add_comment',
    'update_tasks',
    'search_objects',
    'get_me',
    'get_projects',
    'get_tasks',
    // v1: claude.ai Asana 커넥터
    'asana_search_tasks',
    'asana_get_task',
    'asana_get_stories_for_task',
    'asana_create_task_story',
    'asana_update_task',
    'asana_typeahead_search',
    'asana_get_user',
    'asana_get_projects',
    'asana_get_tasks',
  ],
  'desk-slack': [
    'slack_search_public_and_private',
    'slack_read_channel',
    'slack_read_thread',
    'slack_send_message',
    'slack_read_user_profile',
  ],
}

// mcp__<서버>__<도구> 에서 도구 이름. MCP 도구가 아니면 null.
function mcpToolName(tool: string): string | null {
  if (!tool.startsWith('mcp__')) return null
  const at = tool.indexOf('__', 'mcp__'.length)
  return at > 'mcp__'.length ? tool.slice(at + 2) : null
}

export function isGranted(plugin: string, tool: string): boolean {
  const name = mcpToolName(tool)
  return name !== null && (GRANTS[plugin]?.includes(name) ?? false)
}

export const register: Register = on => {
  on('tool.check', async ($, e, next) => {
    const plugin = next.origin.plugin
    if (isGranted(plugin, e.tool)) return { decision: 'allow', reason: `desk-grant: ${plugin} pane call` }
    return next(e)
  })
}
