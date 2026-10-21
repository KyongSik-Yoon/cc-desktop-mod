import type { Chunk, HookStream, TurnStepResult } from 'claude-code'

import { cellWidth } from './markdown'

// 답 글을 블록째 보여주기(설정 replyInBlocks). 엔진은 글 청크를 100ms 마다 흘려 그리는데, 이 훅은 한 글 블록의
// 청크를 붙잡았다가 블록이 끝날 때(다른 블록·도구·멈춤 청크, 스트림 끝) 한꺼번에 내보낸다. 엔진이 transcript 에
// 한 줄씩 적는 단위와 같다. 붙잡은 글이 화면에 다 안 들어갈 만큼 길어지면 그 몫 안의 줄 경계까지 먼저 내보내,
// 한꺼번에 나온 글의 앞머리가 화면 위로 밀려나지 않게 한다. 순서는 바꾸지 않고 늦추기만 한다.

type StepChunk = Chunk<'turn.step'>

export type Screen = { rows: number; columns: number }

// 붙잡은 글이 이만큼(화면 높이에 대한 비율)을 넘으면 먼저 내보낸다.
const SCREEN_SHARE = 0.6
// 대화 기록 글의 왼쪽 들여쓰기·오른쪽 여백(AssistantMessage 는 columns - 2 에 그린다).
const BODY_MARGIN = 4
const TABLE_ROW = /^\s*\|/

let screen: Screen = { rows: 40, columns: 100 }
let gathered = 0

// 화면 크기는 turn.step 에 없어 그리기 훅이 본 마지막 값을 쓴다.
export function noteScreen(viewport: { rows: number; columns: number } | undefined) {
  if (viewport) screen = { rows: viewport.rows, columns: viewport.columns }
}

// 지금 붙잡고 있는 글의 줄 수(스피너가 보여 준다). 0 이면 붙잡은 글이 없다.
export function gatheredLines(): number {
  return gathered
}

function lineRows(line: string, width: number): number {
  return Math.max(1, Math.ceil(cellWidth(line) / width))
}

export function textRows(text: string, columns: number): number {
  const width = Math.max(10, columns - BODY_MARGIN)
  return text.split('\n').reduce((rows, line) => rows + lineRows(line, width), 0)
}

// 먼저 내보낼 길이: 붙잡은 글이 화면 몫을 넘었으면 그 몫 안의 마지막 줄 경계, 아니면 0. 경계는 뒤 줄까지 다 받은
// 곳만 본다(마지막 줄은 아직 이어진다). 표 행 사이는 반쪽 표가 칸 폭을 바꾸므로 피하고, 몫의 뒤쪽 절반에 빈 줄
// 경계(문단 사이)가 있으면 그것을 고른다. 코드 펜스는 닫히지 않아도 끝까지 코드로 그려지니 가리지 않는다.
export function earlyCut(text: string, at: Screen): number {
  const limit = Math.max(8, Math.floor(at.rows * SCREEN_SHARE))
  const width = Math.max(10, at.columns - BODY_MARGIN)
  if (textRows(text, at.columns) <= limit) return 0
  const lines = text.split('\n')
  let rows = 0
  let offset = 0
  let first = 0
  let last = 0
  let paragraph = 0
  for (let i = 0; i < lines.length - 2; i++) {
    const line = lines[i] ?? ''
    const next = lines[i + 1] ?? ''
    rows += lineRows(line, width)
    offset += line.length + 1
    if (TABLE_ROW.test(line) && TABLE_ROW.test(next)) continue
    if (first === 0) first = offset
    if (rows > limit) break
    last = offset
    if ((line.trim() === '' || next.trim() === '') && rows * 2 >= limit) paragraph = offset
  }
  // 한 줄이 몫보다 길면 몫을 넘더라도 첫 경계에서 자른다
  return paragraph || last || first
}

// 붙잡은 청크를 글 길이 cut 에서 나눈다. 경계에 걸친 글 청크는 둘로 쪼개고, 뒤쪽은 엔진 핸들(ref) 없이 넘긴다.
export function splitHeld(held: readonly StepChunk[], cut: number): [StepChunk[], StepChunk[]] {
  const out: StepChunk[] = []
  const rest: StepChunk[] = []
  let seen = 0
  for (const chunk of held) {
    if (seen >= cut) {
      rest.push(chunk)
      continue
    }
    if (chunk.kind !== 'text') {
      out.push(chunk)
      continue
    }
    const end = seen + chunk.text.length
    if (end <= cut) out.push(chunk)
    else {
      out.push({ ...chunk, text: chunk.text.slice(0, cut - seen) })
      rest.push({ kind: 'text', index: chunk.index, text: chunk.text.slice(cut - seen) })
    }
    seen = end
  }
  return [out, rest]
}

// 메인 대화 한 단계의 스트림을 받아 글 청크를 블록째 모아 내보낸다. 끝까지 읽은 결과를 그대로 돌려준다.
// settle: 마지막 블록을 내보낸 뒤 멈춤 청크 전에 기다리는 일. 엔진은 글을 100ms 마다 묶어 그려서, 블록과 멈춤이
// 한 묶음에 들어가면 진행 중 글을 한 번도 그리지 않은 채 스피너를 먼저 걷고, 확정된 글은 그 뒤에야 나와 빈 화면이 낀다.
// mark: 블록 일부를 먼저 내보낸 뒤 나머지를 붙잡는 동안 켜 둔다. 엔진은 글이 보이면 스피너를 걷어서 띠가 대신 알린다.
// 실패해도 글은 내보내야 해서 거절하지 않는 함수를 받는다.
export async function* gather(
  stream: HookStream<StepChunk, TurnStepResult>,
  settle: () => Promise<void>,
  mark: (on: boolean) => Promise<unknown>,
): AsyncGenerator<StepChunk, TurnStepResult> {
  let held: StepChunk[] = []
  let text = ''
  let block: number | null = null
  let marked = false
  const release = () => {
    const out = held
    held = []
    text = ''
    block = null
    gathered = 0
    return out
  }
  // 글을 다 내보낸 뒤에 끈다
  const unmark = async () => {
    if (marked) await mark((marked = false))
  }
  try {
    while (true) {
      const step = await stream.next()
      if (step.done === true) {
        yield* release()
        await unmark()
        return step.value
      }
      const chunk = step.value
      if (chunk.kind === 'engine' && block !== null) {
        // 블록 시작·끝 표시는 붙잡은 글과 같은 순서로 내보낸다
        held.push(chunk)
        continue
      }
      const ended = chunk.kind === 'stop' && text !== ''
      if (chunk.kind !== 'text' || (block !== null && chunk.index !== block)) {
        yield* release()
        await unmark()
      }
      if (ended) await settle()
      if (chunk.kind !== 'text') {
        yield chunk
        continue
      }
      block = chunk.index
      held.push(chunk)
      text += chunk.text
      const cut = earlyCut(text, screen)
      const [out, rest] = cut > 0 ? splitHeld(held, cut) : [[], held]
      held = rest
      text = text.slice(cut)
      gathered = text === '' ? 0 : text.split('\n').length
      yield* out
      if (cut > 0 && !marked) await mark((marked = true))
    }
  } catch (error) {
    // 중단·오류: 붙잡은 글을 버리지 않고 내보낸 뒤 그대로 던진다
    yield* release()
    throw error
  } finally {
    gathered = 0
    // 엔진이 스트림을 그냥 닫아도(return) 띠 표시가 남지 않게
    if (marked) void mark((marked = false))
  }
}
