import type { Surface } from '../types'

// omarchy 현재 테마. 다른 환경이면 파일이 없고 null 을 돌려준다.
export const OMARCHY_COLORS = '$HOME/.local/state/omarchy/current/theme/colors.toml'

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
