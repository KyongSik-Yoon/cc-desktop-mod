import type { SessionMessage } from 'claude-code'

import type { TaskItem } from '../types'

type Status = TaskItem['status']

const STATUSES = new Set<Status>(['pending', 'in_progress', 'completed'])

const str = (value: unknown) => (typeof value === 'string' ? value : undefined)
const status = (value: unknown): Status | undefined => (STATUSES.has(value as Status) ? (value as Status) : undefined)

// 세션 기록에서 지금의 할 일 목록을 다시 세운다. 데스크톱의 계획 카드와 같은 내용이다.
// 실패한 호출은 건너뛴다.
export function computeTasks(messages: ReadonlyArray<SessionMessage>): TaskItem[] {
  const results = new Map<string, { isError: boolean; result: unknown }>()
  for (const message of messages) {
    for (const result of message.toolResults ?? []) {
      results.set(result.tool_use_id, { isError: result.isError, result: result.result })
    }
  }

  let list: TaskItem[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const use of message.toolUses) {
      const settled = results.get(use.tool_use_id)
      if (use.isError === true || settled?.isError === true) continue
      list = applyTask(list, use.tool, use.input, use.result ?? settled?.result)
    }
  }
  return list.filter(item => item.subject !== '')
}

export const isTaskTool = (tool: string) => tool === 'TodoWrite' || tool === 'TaskCreate' || tool === 'TaskUpdate' || tool === 'TaskList'

// 성공한 할 일 도구 호출 하나를 목록에 더한다. 턴 동안은 기록을 다시 읽지 않고 tool.call 의 결과로 이것만 한다.
// TodoWrite 는 목록 전체를 바꾸고, TaskCreate 는 하나를 더하고(같은 id 면 바꾸고), TaskUpdate 는 고치거나(deleted 면) 지운다.
// TaskList 의 결과는 그 시점의 정답이라 상태를 거기에 맞춘다.
export function applyTask(list: TaskItem[], tool: string, input: Readonly<Record<string, unknown>>, result: unknown): TaskItem[] {
  const output = (result ?? {}) as Record<string, unknown>
  switch (tool) {
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? (input.todos as Array<Record<string, unknown>>) : []
      return todos.map((todo, index) => ({
        id: `todo-${index}`,
        subject: str(todo.content) ?? '',
        status: status(todo.status) ?? 'pending',
        activeForm: str(todo.activeForm),
      }))
    }
    case 'TaskCreate': {
      const task = (output.task ?? {}) as Record<string, unknown>
      const id = str(task.id) ?? String(list.length + 1)
      const item: TaskItem = { id, subject: str(input.subject) ?? str(task.subject) ?? '', status: 'pending', activeForm: str(input.activeForm) }
      return list.some(known => known.id === id) ? list.map(known => (known.id === id ? item : known)) : [...list, item]
    }
    case 'TaskUpdate': {
      const id = str(input.taskId)
      if (input.status === 'deleted') return list.filter(item => item.id !== id)
      return list.map(item =>
        item.id === id
          ? {
              ...item,
              subject: str(input.subject) ?? item.subject,
              status: status(input.status) ?? item.status,
              activeForm: str(input.activeForm) ?? item.activeForm,
            }
          : item,
      )
    }
    case 'TaskList': {
      const tasks = Array.isArray(output.tasks) ? (output.tasks as Array<Record<string, unknown>>) : null
      if (tasks === null) return list
      return tasks.map(task => {
        const id = str(task.id) ?? ''
        const known = list.find(item => item.id === id)
        return { id, subject: str(task.subject) ?? known?.subject ?? '', status: status(task.status) ?? 'pending', activeForm: known?.activeForm }
      })
    }
  }
  return list
}
