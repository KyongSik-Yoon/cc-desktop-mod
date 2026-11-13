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
  const accent = field('accent')
  return {
    mode,
    background: mix(background, background, 0),
    bubble: mix(background, mode === 'light' ? '#000000' : '#ffffff', mode === 'light' ? 0.055 : 0.08),
    // 패널은 화면 반쯤을 덮어 말풍선 회색이 넓게 깔리면 진해 보인다. 바탕에 더 가깝게(밝은 3%, 어두운 4.5%).
    pane: mix(background, mode === 'light' ? '#000000' : '#ffffff', mode === 'light' ? 0.03 : 0.045),
    // 내 말풍선은 회색 대신 테마 강조색을 옅게 얹는다: /명령 줄·코드 블록·아래턱이 모두 말풍선 회색이라 내 말이 묻혔다.
    // 강조색이 없는 테마는 회색 말풍선 그대로.
    ...(accent && hex(accent) !== null ? { mine: mix(background, accent, mode === 'light' ? 0.12 : 0.22) } : {}),
  }
}

// 엔진 /theme 설정이 정한 밝기: dark·light 와 그 변형(-daltonized, -ansi). auto·사용자 테마(custom:)·못 읽음은 모른다.
// 엔진은 auto 를 터미널에 OSC 11 로 물어 풀지만, 그 값은 플러그인에 오지 않는다($.config.list 는 설정 그대로).
export function engineThemeMode(setting: unknown): 'light' | 'dark' | null {
  if (typeof setting !== 'string') return null
  return /^dark(-|$)/.test(setting) ? 'dark' : /^light(-|$)/.test(setting) ? 'light' : null
}

// omarchy 파일은 이 기계 터미널의 바탕이다. 보는 터미널이 그것과 다르다고 알 수 있으면 면을 끄고 엔진 기본 그림으로 둔다.
// 엔진 테마가 밝기를 정했는데 omarchy 와 다르면, 엔진 글자색이 면에 묻힌다(어두운 터미널에 엔진 dark 면 흰 글자가 밝은 면 위에).
// 밝기를 모르면(auto) herdr 원격 클라이언트가 붙었을 때만 끈다: 그 터미널의 바탕은 알 수 없고, 로컬과 동시에 보면 맞는 색이 하나도 없다.
export function trustSurface(face: Surface | null, engine: 'light' | 'dark' | null, remote: boolean): Surface | null {
  if (!face) return null
  if (engine) return engine === face.mode ? face : null
  return remote ? null : face
}
