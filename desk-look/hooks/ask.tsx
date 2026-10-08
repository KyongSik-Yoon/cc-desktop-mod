import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AskQuestion, AskState } from '../types'

// 질문 카드: AskUserQuestion 을 엔진 창 대신 desk-look 패널로 묻는다.
// 도구 호출 훅이 답을 기다리며 결과를 직접 돌려주고, 엔진은 그 결과를 도구의 원래 변환기로 모델에게 넘긴다.
// 못 그리는 질문(미리보기가 있는 것), 터미널 말고 다른 화면이 붙은 세션, 패널 자리가 없을 때는 엔진 창 그대로.

type On = Parameters<Register>[0]
type Colors = { text: string; muted: string; clay: string; border: string }

export const ASK_PANE = 'desk-ask'

const asking = atom({ plugin: 'desk-look', key: 'ask' } as const, null as AskState | null)

// 훅은 자기 코드 시간 10초 안에 끝나야 하지만, 엔진 호출($)을 기다리는 동안은 시계가 멈춘다.
// 그래서 답 파일이 생길 때까지 도는 셸을 띄워 두고 그 실행을 기다린다. 버튼이 그 파일을 쓴다.
// process.run 은 한 번에 10분까지라, 9분마다 빈손(종료 코드 3)으로 돌아와 다시 기다린다.
const WAIT = 'end=$(( $(date +%s) + 540 )); while [ ! -e "$1/answer" ]; do [ "$(date +%s)" -ge "$end" ] && exit 3; sleep 0.1; done; cat "$1/answer"; rm -rf "$1"'
const WRITE = 'printf %s "$2" > "$1/answer.tmp" && mv "$1/answer.tmp" "$1/answer"'
const WAIT_ROUND_MS = 570_000
const WAIT_ROUNDS = 40

export type AskReply =
  | { kind: 'answer'; answers: Record<string, string> }
  | { kind: 'engine' }
  | { kind: 'dismiss' }
  | { kind: 'cancel' }

const str = (value: unknown) => (typeof value === 'string' ? value : undefined)
const num = (value: unknown) => (typeof value === 'number' ? value : undefined)

// 도구 입력을 읽는다. 그릴 수 없는 질문이 하나라도 있으면 null(엔진 창).
export function parseQuestions(value: unknown): AskQuestion[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const out: AskQuestion[] = []
  for (const raw of value as Array<Record<string, unknown>>) {
    const question = str(raw?.question)
    if (!question) return null
    const kind = raw.kind === 'text' || raw.kind === 'number' ? raw.kind : 'choice'
    const options = Array.isArray(raw.options) ? (raw.options as Array<Record<string, unknown>>) : []
    if (options.some(option => str(option?.preview))) return null
    if (kind === 'choice' && options.length === 0) return null
    out.push({
      question,
      header: str(raw.header) ?? '',
      kind,
      description: str(raw.description),
      options: options.map(option => ({ label: str(option.label) ?? '', description: str(option.description) })),
      multiSelect: raw.multiSelect === true,
      placeholder: str(raw.placeholder),
      min: num(raw.min),
      max: num(raw.max),
      unit: str(raw.unit),
    })
  }
  return out
}

// 한 질문의 답: 직접 입력한 글이 있으면 그것(여러 개 고르기면 고른 것 뒤에), 아니면 고른 라벨.
export function answerOf(question: AskQuestion, picks: readonly string[], text: string): string {
  const typed = text.trim()
  if (question.kind !== 'choice') return typed
  if (question.multiSelect) return [...picks, ...(typed ? [typed] : [])].join(', ')
  return typed || picks[0] || ''
}

// 숫자 답 검사: 틀리면 이유, 맞으면 null.
export function numberProblem(question: AskQuestion, text: string): string | null {
  if (question.kind !== 'number') return null
  const value = Number(text.trim())
  if (text.trim() === '' || !Number.isFinite(value)) return '숫자를 입력해 주세요'
  if (question.min !== undefined && value < question.min) return `${question.min} 이상이어야 해요`
  if (question.max !== undefined && value > question.max) return `${question.max} 이하여야 해요`
  return null
}

async function reply($: EngineInterface, dir: string, payload: AskReply) {
  await $.process.run(['sh', '-c', WRITE, 'sh', dir, JSON.stringify(payload)], { timeoutMs: 3000 })
}

// 지금 질문에 답을 정하고 다음 질문으로, 마지막이면 답을 보낸다.
async function advance($: EngineInterface, state: AskState, picks: string[], text: string) {
  const question = state.questions[state.step]
  if (!question) return
  const problem = numberProblem(question, text)
  if (problem) {
    $.ui.toast(problem)
    return
  }
  const nextPicks = state.picks.map((value, index) => (index === state.step ? picks : value))
  const nextTexts = state.texts.map((value, index) => (index === state.step ? text : value))
  if (state.step + 1 < state.questions.length) {
    await update($, asking, current => (current && current.id === state.id ? { ...current, step: current.step + 1, picks: nextPicks, texts: nextTexts } : current))
    // 다음 질문의 요소는 키가 새로 생겨 포커스가 사라진다. 첫 선택지(글 답이면 입력칸)로 옮긴다.
    const following = state.questions[state.step + 1]
    const k = `${state.id}-${state.step + 1}`
    await $.ui.focus({ requestId: ASK_PANE, key: following?.kind === 'choice' ? `ask-${k}-0` : `ask-text-${k}` }).catch(() => undefined)
    return
  }
  const answers = Object.fromEntries(
    state.questions.map((item, index) => [item.question, answerOf(item, nextPicks[index] ?? [], nextTexts[index] ?? '')]),
  )
  await reply($, state.dir, { kind: 'answer', answers })
}

export function registerAsk(on: On, colors: Colors) {
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const questions = parseQuestions(e.questions)
    if (questions === null) return next(e)
    const surfaces = await $.session.surfaces()
    if (surfaces.length !== 1 || surfaces[0] !== 'terminal') return next(e)
    if ((await read($, asking)) !== null) return next(e)

    const made = await $.process.run(['mktemp', '-d'], { timeoutMs: 3000 }).catch(() => null)
    const dir = made?.exitCode === 0 ? made.stdout.trim() : ''
    if (dir === '') return next(e)
    const id = e.tool_use_id ?? dir
    await update($, asking, () => ({ id, dir, questions, step: 0, picks: questions.map(() => []), texts: questions.map(() => '') }))
    const rows = 6 + Math.max(...questions.map(item => item.options.length * 2 + (item.description ? 1 : 0)))
    const opened = await $.ui.open({ id: ASK_PANE, title: '질문', focus: true, closeOnEscape: true, holdToasts: true, rows }).catch(() => null)
    if (!opened?.isPlaced) {
      await update($, asking, () => null)
      await $.ui.close({ id: ASK_PANE }).catch(() => undefined)
      await $.process.run(['rm', '-rf', dir], { timeoutMs: 3000 }).catch(() => undefined)
      return next(e)
    }

    // 턴을 중단하면 기다리던 셸을 끝낸다.
    const onAbort = () => void reply($, dir, { kind: 'cancel' }).catch(() => undefined)
    next.signal.addEventListener('abort', onAbort)
    let ran: { exitCode: number; stdout: string } | null = null
    for (let round = 0; round < WAIT_ROUNDS && !next.signal.aborted; round++) {
      ran = await $.process.run(['sh', '-c', WAIT, 'sh', dir], { timeoutMs: WAIT_ROUND_MS }).catch(() => null)
      if (ran?.exitCode !== 3) break
    }
    next.signal.removeEventListener('abort', onAbort)
    await update($, asking, () => null)
    await $.ui.close({ id: ASK_PANE }).catch(() => undefined)

    let answer: AskReply = { kind: 'cancel' }
    try {
      answer = JSON.parse(ran?.stdout ?? '') as AskReply
    } catch {
      await $.process.run(['rm', '-rf', dir], { timeoutMs: 3000 }).catch(() => undefined)
    }
    switch (answer.kind) {
      case 'answer':
        return { result: { questions: e.questions, answers: answer.answers } }
      case 'engine':
        return next(e)
      case 'dismiss':
        return { deny: 'The user closed the question without answering.' }
      case 'cancel':
        return { deny: 'The question was cancelled before the user answered.' }
    }
  })

  // 사람이 패널을 닫으면(Esc, 닫기 표시) 답 없이 닫은 것으로.
  on('ui.close', async ($, e, next) => {
    if (e.id === ASK_PANE && e.origin.kind === 'person') {
      const state = await read($, asking)
      if (state) await reply($, state.dir, { kind: 'dismiss' }).catch(() => undefined)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: ASK_PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const state = await read($, asking)
    const question = state?.questions[state.step]
    if (!state || !question) return <Text color={colors.muted}>질문이 없어요.</Text>
    const picks = state.picks[state.step] ?? []
    const text = state.texts[state.step] ?? ''
    const total = state.questions.length
    const isLast = state.step + 1 === total
    const k = `${state.id}-${state.step}`
    const setPicks = (value: string[]) =>
      update($, asking, current =>
        current && current.id === state.id ? { ...current, picks: current.picks.map((item, index) => (index === current.step ? value : item)) } : current,
      )
    const setText = (value: string) =>
      update($, asking, current =>
        current && current.id === state.id ? { ...current, texts: current.texts.map((item, index) => (index === current.step ? value : item)) } : current,
      )
    const unit = question.unit ? ` (${question.unit})` : ''

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box columnGap={1}>
          {question.header !== '' && (
            <Text color={colors.clay} bold>
              {question.header}
            </Text>
          )}
          {total > 1 && <Text color={colors.muted}>{`${state.step + 1}/${total}`}</Text>}
        </Box>
        <Box flexDirection="column">
          <Text color={colors.text} bold>
            {question.question}
          </Text>
          {question.description && <Text color={colors.muted}>{question.description}</Text>}
        </Box>
        {question.kind === 'choice' && (
          <Box flexDirection="column">
            {question.options.map((option, index) => {
              const isPicked = picks.includes(option.label)
              const mark = question.multiSelect ? (isPicked ? '☑ ' : '☐ ') : ''
              return (
                <Box
                  key={`opt-${k}-${index}`}
                  flexDirection="column"
                  borderStyle="round"
                  borderColor={isPicked ? colors.clay : colors.border}
                  hover={{ borderColor: colors.clay }}
                  paddingX={1}
                >
                  <Button
                    key={`ask-${k}-${index}`}
                    plain
                    hotkey={index < 9 ? String(index + 1) : undefined}
                    autoFocus={index === 0 ? true : undefined}
                    label={`${mark}${option.label}`}
                    onPress={() =>
                      question.multiSelect
                        ? void setPicks(isPicked ? picks.filter(label => label !== option.label) : [...picks, option.label])
                        : void advance($, state, [option.label], '')
                    }
                  />
                  {option.description && option.description !== option.label && (
                    <Box paddingLeft={3}>
                      <Text color={colors.muted}>{option.description}</Text>
                    </Box>
                  )}
                </Box>
              )
            })}
          </Box>
        )}
        <Input
          key={`ask-text-${k}`}
          label={question.kind === 'choice' ? 'Other' : `답${unit}`}
          placeholder={question.placeholder ?? (question.kind === 'number' ? '숫자' : '직접 입력하고 Enter')}
          value={text}
          autoFocus={question.kind === 'choice' ? undefined : true}
          submitLabel={isLast ? '제출' : '다음'}
          onInput={value => void setText(value)}
          onSubmit={value => void advance($, state, question.multiSelect ? picks : [], value)}
        />
        <Box columnGap={2}>
          {question.multiSelect && (
            <Button key={`ask-next-${k}`} label={isLast ? '제출' : '다음 →'} onPress={() => void advance($, state, picks, text)} />
          )}
          <Button
            key={`ask-engine-${k}`}
            plain
            dimColor
            label="기본 창으로"
            onPress={() => void reply($, state.dir, { kind: 'engine' })}
          />
          <Text color={colors.muted}>Esc 닫기</Text>
        </Box>
      </Box>
    )
  })
}
