import type { Graphics, ImageInfo } from '../types'

// 붙여 넣은 이미지는 세션 임시 폴더(/tmp/claude-<uid>/<프로젝트>/<세션>/images)의 N.png 에 [Image #N] 번호 그대로 저장된다.
// 파일 이름의 번호. N.png 가 아니면 null.
export function imageNumber(name: string): string | null {
  return /^(\d+)\.png$/.exec(name)?.[1] ?? null
}

// PNG 앞 24바이트(IHDR)의 가로·세로. 짧거나 0 이면 null.
export function pngSize(bytes: ArrayLike<number>): { width: number; height: number } | null {
  if (bytes.length < 24) return null
  const word = (at: number) => Array.from({ length: 4 }, (_, i) => bytes[at + i] ?? 0).reduce((value, byte) => value * 256 + byte, 0)
  const width = word(16)
  const height = word(20)
  return width > 0 && height > 0 ? { width, height } : null
}

// 썸네일 칸 수. 터미널 셀은 세로가 가로의 약 두 배라 행 수는 절반으로 센다.
export function thumbnailSize(image: ImageInfo, maxColumns: number, maxRows = 12) {
  let columns = Math.max(4, maxColumns)
  let rows = Math.round((columns * image.height) / image.width / 2)
  if (rows > maxRows) {
    rows = maxRows
    columns = Math.max(4, Math.round((rows * 2 * image.width) / image.height))
  }
  return { columns: Math.min(columns, 255), rows: Math.max(1, Math.min(rows, 255)) }
}

export const IMAGE_TOKEN = /\[Image #(\d+)\]/g

// herdr 는 설정(~/.config/herdr/config.toml)의 [experimental] kitty_graphics = true 일 때만 kitty 그래픽을 바깥 터미널로 넘긴다.
export function herdrGraphicsOn(config: string): boolean {
  return /^[ \t]*kitty_graphics[ \t]*=[ \t]*true/m.test(config)
}

// tmux 에 이 창의 바깥 터미널과 그림 통과 설정을 묻는 형식. 엔진도 같은 것을 물어 tmux 안에서 그릴지 정한다.
export const TMUX_GRAPHICS_FORMAT = ['#{client_termtype}', '#{allow-passthrough}', '#{focus-events}', '#{window_bigger}'].join('\t')

// '0.35.1' 이 [0, 28] 이상인지. 숫자가 아니면 false.
function versionAtLeast(text: string, least: number[]): boolean {
  const parts = /^\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(text)
  if (!parts) return false
  const have = [1, 2, 3].map(i => Number(parts[i] ?? 0))
  for (let i = 0; i < 3; i++) if (have[i] !== (least[i] ?? 0)) return (have[i] ?? 0) > (least[i] ?? 0)
  return true
}

// tmux 안에서 엔진이 그림을 그리는지(2.1.310): tmux 3.3 이상에서 allow-passthrough 와 focus-events 가 켜져 있고
// 바깥 터미널(client_termtype)이 kitty 0.28 이상·Ghostty 면 kitty 그래픽을, iTerm2 3.5 이상이면 iTerm2 그림을 그린다.
// iTerm2 는 allow-passthrough 가 all 이 아니라 on 이어야 하고 창이 터미널보다 크지 않아야 한다.
// 바이트만 넘어가므로 kitty 도 파일 이름 대신 바이트를 준다('kitty-bytes'). reply 는 TMUX_GRAPHICS_FORMAT 의 대답.
export function tmuxGraphicsOf(reply: string): Graphics {
  const [termtype = '', passthrough = '', focusEvents = '', bigger = ''] = reply.replace(/\r?\n$/, '').split('\t')
  if (!['on', '1', 'all'].includes(passthrough) || focusEvents !== '1') return null
  if (termtype.startsWith('kitty(')) return versionAtLeast(termtype.slice(6), [0, 28]) ? 'kitty-bytes' : null
  if (['kitty', 'ghostty'].some(name => termtype === name || termtype.startsWith(`${name} `))) return 'kitty-bytes'
  if (/^iTerm2\s/.test(termtype) && versionAtLeast(termtype.slice(6), [3, 5])) return passthrough === 'on' && bigger !== '1' ? 'iterm' : null
  return null
}

// 그림을 그릴 수 있는 환경인지. tmux 는 tmuxReply(tmuxGraphicsOf) 로 정하고, 못 물었으면 그리지 않는다.
// zellij 는 통과시키지 않아 그림 대신 alt 글자가 나오므로 그리지 않는다.
// herdr 는 kitty_graphics 를 켰을 때만(herdrGraphics) 넘기는데, 엔진은 터미널 이름을 물어 kitty·ghostty 일 때만
// 그림을 그리고 herdr 안에서는 herdr 가 대답하므로 CLAUDE_CODE_FORCE_TERMINAL_IMAGES 까지 켜야 그린다.
// iTerm2 는 엔진이 XTVERSION 대답의 버전을 보는데, iTerm2 가 TERM_PROGRAM_VERSION 에 같은 버전을 적는다.
// CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT 면 엔진이 매 화면 그림을 다시 보내야 해서 iTerm2 는 그리지 않는다.
export function graphicsOf(env: Record<string, string | undefined>, herdrGraphics = false, tmuxReply: string | null = null): Graphics {
  if (env.TMUX) {
    const kind = tmuxReply === null ? null : tmuxGraphicsOf(tmuxReply)
    return kind === 'iterm' && env.CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT ? null : kind
  }
  if (env.ZELLIJ) return null
  if (env.HERDR_ENV === '1') {
    return herdrGraphics && ['1', 'true'].includes((env.CLAUDE_CODE_FORCE_TERMINAL_IMAGES ?? '').toLowerCase()) ? 'kitty' : null
  }
  const term = (env.TERM ?? '').toLowerCase()
  const program = (env.TERM_PROGRAM ?? '').toLowerCase()
  if (term.includes('kitty') || term.includes('ghostty') || ['ghostty', 'kitty', 'wezterm'].includes(program)) return 'kitty'
  if (program !== 'iterm.app' || env.CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT) return null
  const [major = 0, minor = 0] = (env.TERM_PROGRAM_VERSION ?? '').split('.').map(Number)
  return major > 3 || (major === 3 && minor >= 5) ? 'iterm' : null
}

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

// 여러 줄 말풍선의 모서리 한 칸 그림(RGBA). 칸 너비를 반지름으로 바깥 모서리를 둥글게 비우고 나머지는
// 말풍선 색으로 채운다. 가장자리는 한 픽셀을 4x4 로 나눠 덮인 비율을 알파로 써서 부드럽게 한다.
// 터미널은 그림을 늘이지 않고 비율을 지켜 칸에 맞춘 뒤 픽셀로 반올림한다(Ghostty). 그림 비율이 칸과 다르면
// 모서리 칸 위아래가 비어 줄 사이에 틈이 난다 — 16x32 는 11x24 칸에서 1px, 14x32 칸에서 2px.
// 27x61 은 두 칸 모두 반올림으로 꽉 차고, 경계(x.5)까지 0.12px 여유가 있다.
export const CORNER_SIZE = { width: 27, height: 61 } as const

export function cornerPixels(corner: Corner, color: string): Uint8Array {
  const { width, height } = CORNER_SIZE
  const value = parseInt(/^#?([0-9a-f]{6})$/i.exec(color.trim())?.[1] ?? '000000', 16)
  const radius = width
  const centerX = corner.endsWith('left') ? width : 0
  const top = corner.startsWith('top')
  const centerY = top ? radius : height - radius
  const inside = (x: number, y: number) =>
    (top ? y >= centerY : y <= centerY) || (x - centerX) ** 2 + (y - centerY) ** 2 <= radius * radius
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hit = 0
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (inside(x + (i + 0.5) / 4, y + (j + 0.5) / 4)) hit++
      const at = (y * width + x) * 4
      pixels.set([(value >> 16) & 255, (value >> 8) & 255, value & 255, Math.round((255 * hit) / 16)], at)
    }
  }
  return pixels
}
