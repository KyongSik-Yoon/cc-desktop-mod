import type { Chunk, HookStream, TurnStepResult } from 'claude-code'

// 답 글을 블록째 보여주기(설정 replyInBlocks). 엔진은 글 청크를 100ms 마다 흘려 그리는데, 이 훅은 한 글 블록의
// 청크를 붙잡았다가 블록이 끝날 때(다른 블록·도구·멈춤 청크, 스트림 끝) 한꺼번에 내보낸다. 엔진이 transcript 에
// 한 줄씩 적는 단위와 같다. 순서는 바꾸지 않고 늦추기만 한다.
// 긴 블록을 화면 몫만큼 먼저 내보내던 판(0.51)은 "한 덩어리 나오고 아무 표시 없이 기다리다 또 한 덩어리"가 되어 걷었다:
// 글이 보이면 엔진이 스피너를 걷어 덩어리 사이 대기를 알릴 곳이 없다. 다 찰 때까지 스피너가 줄 수를 보이고, 대신
// 화면보다 긴 답은 엔진이 끝으로 따라 내려가 앞부분은 올려서 읽는다.

type StepChunk = Chunk<'turn.step'>

let gathered = 0

// 지금 붙잡고 있는 글의 줄 수(스피너가 보여 준다). 0 이면 붙잡은 글이 없다.
export function gatheredLines(): number {
  return gathered
}

// 메인 대화 한 단계의 스트림을 받아 글 청크를 블록째 모아 내보낸다. 끝까지 읽은 결과를 그대로 돌려준다.
// settle: 마지막 블록을 내보낸 뒤 멈춤 청크 전에 기다리는 일. 엔진은 글을 100ms 마다 묶어 그려서, 블록과 멈춤이
// 한 묶음에 들어가면 진행 중 글을 한 번도 그리지 않은 채 스피너를 먼저 걷고, 확정된 글은 그 뒤에야 나와 빈 화면이 낀다.
export async function* gather(stream: HookStream<StepChunk, TurnStepResult>, settle: () => Promise<void>): AsyncGenerator<StepChunk, TurnStepResult> {
  let held: StepChunk[] = []
  let block: number | null = null
  const release = () => {
    const out = held
    held = []
    block = null
    gathered = 0
    return out
  }
  try {
    while (true) {
      const step = await stream.next()
      if (step.done === true) {
        yield* release()
        return step.value
      }
      const chunk = step.value
      if (chunk.kind === 'engine' && block !== null) {
        // 블록 시작·끝 표시는 붙잡은 글과 같은 순서로 내보낸다
        held.push(chunk)
        continue
      }
      const ended = chunk.kind === 'stop' && block !== null
      if (chunk.kind !== 'text' || (block !== null && chunk.index !== block)) yield* release()
      if (ended) await settle()
      if (chunk.kind !== 'text') {
        yield chunk
        continue
      }
      if (block === null) gathered = 1
      block = chunk.index
      held.push(chunk)
      gathered += chunk.text.split('\n').length - 1
    }
  } catch (error) {
    // 중단·오류: 붙잡은 글을 버리지 않고 내보낸 뒤 그대로 던진다
    yield* release()
    throw error
  } finally {
    gathered = 0
  }
}
