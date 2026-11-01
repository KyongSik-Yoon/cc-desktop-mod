// /desk-monitor 패널: 떠 있는 Claude 세션마다 CPU·메모리. 세션 목록은 ~/.claude/sessions/<pid>.json,
// 수치는 그 pid 와 자손 프로세스의 /proc/<pid>/stat 에서 센다. 여기는 계산만 두고 읽기·그리기는 register.tsx 에.

// 표본 간격과 그래프에 남기는 표본 수(2초 × 120 = 4분). 패널이 닫히면 기록을 버린다.
export const MONITOR_TICK = 2000
export const MONITOR_POINTS = 120
// 자손을 따라 내려가는 깊이(claude → 셸 → 명령 → 그 자식 …, MCP 서버 → 그 자식).
export const MONITOR_DEPTH = 6
// 그래프 칸 수 상한: 4분을 30칸에. 점자는 한 칸에 점이 가로 둘이라 점 하나가 4초(표본 둘), 면 그래프는 한 칸이 8초.
// 칸이 적을수록 2초마다 다시 배치할 글자가 준다(60칸일 때 그리기가 열린 패널 비용의 약 80%).
export const CHART_CELLS = 30
export const DOT_MS = (MONITOR_POINTS * MONITOR_TICK) / (CHART_CELLS * 2)
// /proc/<pid>/stat 의 시간 단위(리눅스 CLK_TCK)와 rss 단위(페이지).
const CLK_TCK = 100
const PAGE_BYTES = 4096

export type MonitorStatus = 'busy' | 'waiting' | 'idle'
export type MonitorSession = { pid: number; sessionId: string; name: string; cwd: string; status: MonitorStatus; startTicks: number }

// ~/.claude/sessions/<pid>.json 하나. procStart 는 /proc/<pid>/stat 의 시작 시각(부팅 뒤 틱)이라
// 같은 pid 를 다른 프로세스가 물려받았는지 가린다. 이름이 없으면 작업 폴더 이름.
export function sessionFileOf(json: string): MonitorSession | null {
  let row: Record<string, unknown>
  try {
    row = JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
  if (!row || typeof row !== 'object') return null
  const { pid, sessionId, cwd, name, status, procStart } = row
  const startTicks = Number(procStart)
  if (typeof pid !== 'number' || typeof sessionId !== 'string' || !Number.isFinite(startTicks)) return null
  const folder = typeof cwd === 'string' ? cwd : ''
  return {
    pid,
    sessionId,
    cwd: folder,
    name: typeof name === 'string' && name !== '' ? name : folder.split('/').filter(Boolean).at(-1) || sessionId.slice(0, 8),
    status: status === 'busy' || status === 'waiting' ? status : 'idle',
    startTicks,
  }
}

// /proc/<pid>/stat 에서 시작 시각, CPU 틱, rss(바이트). CPU 틱은 utime+stime 에 거둔 자식의 cutime+cstime 까지 더한다:
// 끝난 명령의 시간이 부모로 옮겨 가 트리 합이 줄지 않는다(Bash 도구의 짧은 명령도 잡힌다).
// 이름(comm)은 괄호·공백을 품을 수 있어 마지막 ')' 뒤부터 센다. ')' 뒤 첫 칸이 3번째 필드(state).
export function procStatOf(text: string): { startTicks: number; ticks: number; rss: number } | null {
  const close = text.lastIndexOf(')')
  if (close < 0) return null
  const fields = text.slice(close + 2).split(' ')
  const at = (field: number) => Number(fields[field - 3])
  const ticks = at(14) + at(15) + at(16) + at(17)
  const startTicks = at(22)
  const rss = at(24) * PAGE_BYTES
  return fields.length >= 22 && [ticks, startTicks, rss].every(Number.isFinite) ? { startTicks, ticks, rss } : null
}

// 한 세션의 프로세스 트리 합: CPU 틱, rss(트리 전체·claude 본체), 프로세스 수.
export type TreeSample = { ticks: number; rss: number; selfRss: number; procs: number }
export type MonitorPoint = { at: number; cpu: number | null; rss: number }
export type MonitorSeries = { startTicks: number; at: number; ticks: number; last: TreeSample; points: MonitorPoint[] }

// 표본 하나를 그 세션의 기록에 더한다. 첫 표본이거나 pid 를 다른 프로세스가 물려받았으면 새로 시작하고 CPU 는 모른다(null).
export function advanceSeries(prev: MonitorSeries | undefined, startTicks: number, at: number, sample: TreeSample, max = MONITOR_POINTS): MonitorSeries {
  const isSame = prev !== undefined && prev.startTicks === startTicks && at > prev.at
  const cpu = isSame ? (Math.max(0, sample.ticks - prev.ticks) / CLK_TCK / ((at - prev.at) / 1000)) * 100 : null
  const points = [...(isSame ? prev.points : []), { at, cpu, rss: sample.rss }].slice(-max)
  return { startTicks, at, ticks: sample.ticks, last: sample, points }
}

// 그래프 위 끝(%): 가장 높은 점이 들어가는 가장 낮은 눈금. 여러 코어를 쓰면 100% 를 넘는다.
export function cpuTop(values: ReadonlyArray<number | null>): number {
  const top = Math.max(0, ...values.filter((value): value is number => value !== null))
  return [10, 25, 50, 100, 200, 400, 800, 1600].find(mark => top <= mark) ?? Math.ceil(top / 100) * 100
}

// 메모리 그래프 위 끝(바이트): 가장 큰 값을 256MB 단위로 올린다.
export function memTop(values: ReadonlyArray<number>): number {
  const step = 256 * 1024 * 1024
  return Math.max(step, Math.ceil(Math.max(0, ...values) / step) * step)
}

// 표본을 시각으로 span ms 칸에 나눠 칸마다 가장 큰 값을, 마지막 표본의 칸까지 count 칸. 표본이 없는 칸은 null.
// 칸 경계를 시각에 묶어 두어, 표본이 하나 더 와도 앞 칸들의 값이 바뀌지 않는다(그래프가 칸마다 출렁이지 않게).
export function bucketMax(points: ReadonlyArray<{ at: number; value: number | null }>, span: number, count: number): Array<number | null> {
  const last = points.at(-1)
  if (!last || count <= 0) return []
  const end = Math.floor(last.at / span)
  const out = new Array<number | null>(count).fill(null)
  for (const point of points) {
    const index = count - 1 - (end - Math.floor(point.at / span))
    if (index < 0 || point.value === null) continue
    out[index] = Math.max(out[index] ?? -Infinity, point.value)
  }
  return out
}

// 점자 선 그래프: 한 칸이 가로 2점·세로 4점이라 width 칸에 표본 2*width 개, rows 줄에 높이 4*rows 단계.
// 최근 표본이 오른쪽 끝이고 모자라면 왼쪽을 비운다. 이웃 점 사이는 세로로 이어 선이 끊기지 않게 한다. 모르는 값(null)은 건너뛴다.
const DOT = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
] as const

export function brailleLine(values: ReadonlyArray<number | null>, top: number, width: number, rows: number): string[] {
  const height = rows * 4
  const cells = Array.from({ length: rows }, () => new Array<number>(width).fill(0))
  const shown = values.slice(-width * 2)
  const offset = width * 2 - shown.length
  const level = (value: number) => Math.max(0, Math.min(height - 1, Math.round((value / Math.max(top, 1e-9)) * (height - 1))))
  let before: number | null = null
  shown.forEach((value, index) => {
    if (value === null) {
      before = null
      return
    }
    const y = level(value)
    const x = offset + index
    const [from, to] = before === null ? [y, y] : [Math.min(before, y), Math.max(before, y)]
    for (let dot = from; dot <= to; dot++) {
      const row = rows - 1 - Math.floor(dot / 4)
      const cellRow = cells[row]
      if (cellRow) cellRow[Math.floor(x / 2)] = (cellRow[Math.floor(x / 2)] ?? 0) | (DOT[x % 2]?.[3 - (dot % 4)] ?? 0)
    }
    before = y
  })
  return cells.map(row => row.map(bits => String.fromCharCode(0x2800 + bits)).join(''))
}

// 한 줄 면 그래프: 칸마다 값 하나를 ▁…█ 로. 최근이 오른쪽 끝이고 모자라거나 모르는(null) 칸은 빈칸.
const BLOCKS = ' ▁▂▃▄▅▆▇█'

export function areaRow(values: ReadonlyArray<number | null>, top: number, width: number): string {
  const shown = values.slice(-width)
  const block = (value: number | null) => (value === null || value <= 0 ? ' ' : (BLOCKS[Math.max(1, Math.min(8, Math.round((value / Math.max(top, 1)) * 8)))] ?? '█'))
  return ' '.repeat(width - shown.length) + shown.map(block).join('')
}

// 바이트를 사람이 읽는 크기로: 1GB 넘으면 소수 한 자리, 그 아래는 MB 정수.
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}GB` : `${Math.round(mb)}MB`
}

// CPU% 를 칸 폭에 맞게: 10 미만은 소수 한 자리, 모르면 —.
export function formatCpu(cpu: number | null): string {
  if (cpu === null) return '—'
  return cpu < 10 ? `${cpu.toFixed(1)}%` : `${Math.round(cpu)}%`
}

// 그리는 순서: 이 세션이 맨 위, 나머지는 먼저 뜬 순(표본마다 줄이 뛰지 않게).
export function orderSessions<T extends { session: MonitorSession }>(rows: ReadonlyArray<T>, selfPid: number | null): T[] {
  return [...rows].sort((a, b) => (a.session.pid === selfPid ? -1 : b.session.pid === selfPid ? 1 : a.session.startTicks - b.session.startTicks))
}
