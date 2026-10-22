import type { Elements, EngineInterface, TextHoverProps, UiPressArgument } from 'claude-code'
import { T } from './i18n'

// desk-look 에서 함께 쓰던 작은 도우미를 그대로 옮겨 온 것(desk-asana 에도 같은 파일이 있다).
// 플러그인은 자기 디렉터리만 설치되므로 desk-look 의 파일을 가져올 수 없다.

// 데스크톱 앱 CDS 토큰의 역할을 엔진 테마 키에 대응시킨다(desk-look 과 같은 색).
export const COLORS = {
  text: 'text',
  muted: 'inactive',
  border: 'subtle',
  clay: 'claude',
  accent: 'claude',
  link: 'suggestion',
  code: 'error',
  success: 'success',
  danger: 'error',
  warning: 'warning',
} as const

export type Els = Elements['terminal']

// 터미널 칸 수: 한글·한자·전각·이모지는 두 칸.
export function cellWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff)
    width += isWide ? 2 : 1
  }
  return width
}

// 칸 수 기준으로 자르고 말줄임표를 붙인다.
export function clip(text: string, width: number): string {
  if (cellWidth(text) <= width) return text
  let out = ''
  for (const ch of text) {
    if (cellWidth(out + ch) > width - 1) break
    out += ch
  }
  return `${out}…`
}

export function ago(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000))
  if (minutes < 1) return T.justNow
  if (minutes < 60) return T.minutesShort(minutes)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return T.hoursShort(hours)
  return T.daysShort(Math.floor(hours / 24))
}

// 줄 전체가 눌리는 버튼: 라벨 뒤에 칩·흐린 설명(Text)을 함께 넣는다.
type RowButtonProps = { key: string; dimColor?: boolean; hotkey?: string; hover?: TextHoverProps; onPress: (press: UiPressArgument) => void }

export function rowButton(els: Els, props: RowButtonProps, label: string, ...rest: unknown[]) {
  const { Button } = els
  const parts = rest.filter(part => part !== null && part !== undefined && part !== false && part !== '')
  return (
    <Button plain {...props}>
      {label}
      {parts as never}
    </Button>
  )
}

// "Claude에게 맡기기": 입력창이 비어 있으면 채우고, 쓰던 글이 있으면 뒤에 붙인다.
export async function fillPrompt($: EngineInterface, text: string, done = T.filled) {
  const box = await $.prompt.read().catch(() => ({ text: '', cursor: 0 }))
  const isEmpty = box.text.trim() === ''
  const filled = await $.prompt.fill({ text: isEmpty ? text : `\n\n${text}`, mode: isEmpty ? 'replace' : 'append' }).catch(() => null)
  $.ui.toast(filled?.isFilled ? done : T.fillFailed)
}
