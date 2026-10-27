import type { Surface } from '../types'

// omarchy 현재 테마(HOME 기준). 다른 환경이면 파일이 없고 null 을 돌려준다.
export const OMARCHY_COLORS = '.local/state/omarchy/current/theme/colors.toml'

const hex = (value: string) => {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim())
  return match?.[1] ? parseInt(match[1], 16) : null
}

// 데스크톱 CDS 의 --cds-bg-user-message: 밝은 테마는 검정 5%, 어두운 테마는 흰색 5% 를 배경에 얹는다.
export function mix(background: string, toward: string, amount: number): string {
  const from = hex(background) ?? 0
  const to = hex(toward) ?? 0
  const channel = (shift: number) => {
    const a = (from >> shift) & 0xff
    const b = (to >> shift) & 0xff
    return Math.round(a + (b - a) * amount)
  }
  return `#${[16, 8, 0].map(shift => channel(shift).toString(16).padStart(2, '0')).join('')}`
}

// xterm 256색 팔레트에서 세 채널이 같은 회색(색 큐브 6칸 + 회색 띠 24칸) 중 밝기가 가장 가까운 것.
// 엔진은 256색으로 줄일 때 채널이 다른 색을 색 큐브로 보내 어두운 회색 #2c2d37 이 #5f5f5f 로 밝아진다.
// 팔레트에 있는 회색을 주면 줄여도 제자리다(diff 의 PALETTE_256 과 같은 생각).
const GRAYS_256 = [0, 95, 135, 175, 215, 255, ...Array.from({ length: 24 }, (_, i) => 8 + i * 10)]
export function gray256(color: string): string {
  const value = hex(color) ?? 0
  const level = 0.2126 * ((value >> 16) & 0xff) + 0.7152 * ((value >> 8) & 0xff) + 0.0722 * (value & 0xff)
  const gray = GRAYS_256.reduce((best, next) => (Math.abs(next - level) < Math.abs(best - level) ? next : best))
  return `#${gray.toString(16).padStart(2, '0').repeat(3)}`
}

export function parseSurface(toml: string): Surface | null {
  const field = (key: string) => new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm').exec(toml)?.[1]
  const background = field('background')
  if (!background || hex(background) === null) return null
  const declared = field('mode')
  const luminance = (() => {
    const value = hex(background) ?? 0
    return (0.2126 * ((value >> 16) & 0xff) + 0.7152 * ((value >> 8) & 0xff) + 0.0722 * (value & 0xff)) / 255
  })()
  const mode = declared === 'light' || declared === 'dark' ? declared : luminance > 0.5 ? 'light' : 'dark'
  return {
    mode,
    background: mix(background, background, 0),
    bubble: mix(background, mode === 'light' ? '#000000' : '#ffffff', mode === 'light' ? 0.055 : 0.08),
  }
}
