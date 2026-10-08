import type { SessionMessage } from 'claude-code'

import type { TaskItem } from '../types'

type Status = TaskItem['status']

const STATUSES = new Set<Status>(['pending', 'in_progress', 'completed'])

const str = (value: unknown) => (typeof value === 'string' ? value : undefined)
const status = (value: unknown): Status | undefined => (STATUSES.has(value as Status) ? (value as Status) : undefined)

// 세션 기록에서 지금의 할 일 목록을 다시 세운다. 데스크톱의 계획 카드와 같은 내용이다.
// TodoWrite 는 목록 전체를 바꾸고, TaskCreate 는 하나를 더하고, TaskUpdate 는 고치거나(deleted 면) 지운다.
// TaskList 의 결과는 그 시점의 정답이라 상태를 거기에 맞춘다. 실패한 호출은 건너뛴다.
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
      const output = (use.result ?? settled?.result ?? {}) as Record<string, unknown>
      const input = use.input
      switch (use.tool) {
        case 'TodoWrite': {
          const todos = Array.isArray(input.todos) ? (input.todos as Array<Record<string, unknown>>) : []
          list = todos.map((todo, index) => ({
            id: `todo-${index}`,
            subject: str(todo.content) ?? '',
            status: status(todo.status) ?? 'pending',
            activeForm: str(todo.activeForm),
          }))
          break
        }
        case 'TaskCreate': {
          const task = (output.task ?? {}) as Record<string, unknown>
          const id = str(task.id) ?? String(list.length + 1)
          list = [...list, { id, subject: str(input.subject) ?? str(task.subject) ?? '', status: 'pending', activeForm: str(input.activeForm) }]
          break
        }
        case 'TaskUpdate': {
          const id = str(input.taskId)
          if (input.status === 'deleted') {
            list = list.filter(item => item.id !== id)
            break
          }
          list = list.map(item =>
            item.id === id
              ? {
                  ...item,
                  subject: str(input.subject) ?? item.subject,
                  status: status(input.status) ?? item.status,
                  activeForm: str(input.activeForm) ?? item.activeForm,
                }
              : item,
          )
          break
        }
        case 'TaskList': {
          const tasks = Array.isArray(output.tasks) ? (output.tasks as Array<Record<string, unknown>>) : null
          if (tasks === null) break
          list = tasks.map(task => {
            const id = str(task.id) ?? ''
            const known = list.find(item => item.id === id)
            return { id, subject: str(task.subject) ?? known?.subject ?? '', status: status(task.status) ?? 'pending', activeForm: known?.activeForm }
          })
          break
        }
      }
    }
  }
  return list.filter(item => item.subject !== '')
}

// 띠에 보일 줄: 다 끝났으면 아무것도. 너무 길면 끝난 일부터 빼고, 그래도 길면 뒤쪽 대기 일을 접는다.
export function visibleTasks(list: ReadonlyArray<TaskItem>, rows: number): { shown: TaskItem[]; hidden: number } {
  if (list.length === 0 || list.every(item => item.status === 'completed')) return { shown: [], hidden: 0 }
  if (list.length <= rows) return { shown: [...list], hidden: 0 }
  const open = list.filter(item => item.status !== 'completed')
  const done = list.filter(item => item.status === 'completed')
  const keepDone = Math.max(0, Math.min(done.length, rows - open.length))
  const kept = new Set([...done.slice(done.length - keepDone), ...open.slice(0, rows)])
  const shown = list.filter(item => kept.has(item)).slice(0, rows)
  return { shown, hidden: list.length - shown.length }
}
