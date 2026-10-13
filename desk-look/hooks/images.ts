import type { ImageInfo } from '../types'

// 붙여 넣은 이미지는 세션 임시 폴더의 images/N.png 에 [Image #N] 번호 그대로 저장된다.
// 각 파일 경로와 PNG 헤더 앞 24바이트(IHDR 의 가로·세로)를 한 줄씩 출력한다.
export const LIST_IMAGES = `d=$(ls -d /tmp/claude-$(id -u)/*/"$1"/images 2>/dev/null | head -1)
[ -n "$d" ] || exit 0
for f in "$d"/*.png; do
  [ -f "$f" ] || continue
  printf '%s ' "$f"; head -c 24 "$f" | od -An -tu1 | tr -s ' \\n' '  '; echo
done`

export function parseImages(listing: string): Record<string, ImageInfo> {
  const images: Record<string, ImageInfo> = {}
  for (const line of listing.split('\n')) {
    const [path, ...rest] = line.trim().split(/\s+/)
    const number = path ? /\/(\d+)\.png$/.exec(path)?.[1] : undefined
    const bytes = rest.map(Number)
    if (!path || number === undefined || bytes.length < 24) continue
    const word = (at: number) => bytes.slice(at, at + 4).reduce((value, byte) => value * 256 + byte, 0)
    const width = word(16)
    const height = word(20)
    if (width > 0 && height > 0) images[number] = { path, width, height }
  }
  return images
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

// herdr 는 설정의 [experimental] kitty_graphics = true 일 때만 kitty 그래픽을 바깥 터미널로 넘긴다.
// 켜져 있으면 on 을 출력한다.
export const HERDR_GRAPHICS = `grep -Eqs '^[[:space:]]*kitty_graphics[[:space:]]*=[[:space:]]*true' "\${XDG_CONFIG_HOME:-$HOME/.config}/herdr/config.toml" && echo on`

// kitty 그래픽 프로토콜을 그릴 수 있는 환경인지. tmux·zellij 는 통과시키지 않아 그림 대신 alt 글자가
// 나오므로 그리지 않는다. herdr 는 kitty_graphics 를 켰을 때만(herdrGraphics) 넘기는데, 엔진은 터미널 이름을
// 물어 kitty·ghostty 일 때만 그림을 그리고 herdr 안에서는 herdr 가 대답하므로
// CLAUDE_CODE_FORCE_TERMINAL_IMAGES 까지 켜야 그린다.
export function supportsGraphics(env: Record<string, string | undefined>, herdrGraphics = false): boolean {
  if (env.TMUX || env.ZELLIJ) return false
  if (env.HERDR_ENV === '1') return herdrGraphics && ['1', 'true'].includes((env.CLAUDE_CODE_FORCE_TERMINAL_IMAGES ?? '').toLowerCase())
  const term = (env.TERM ?? '').toLowerCase()
  const program = (env.TERM_PROGRAM ?? '').toLowerCase()
  return term.includes('kitty') || term.includes('ghostty') || ['ghostty', 'kitty', 'wezterm'].includes(program)
}

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

// 여러 줄 말풍선의 모서리 한 칸 그림(RGBA). 칸 너비를 반지름으로 바깥 모서리를 둥글게 비우고 나머지는
// 말풍선 색으로 채운다. 셀은 세로가 가로의 약 두 배라 16x32 로 그리면 터미널이 칸 크기에 맞춰 늘인다.
// 가장자리는 한 픽셀을 4x4 로 나눠 덮인 비율을 알파로 써서 부드럽게 한다.
export const CORNER_SIZE = { width: 16, height: 32 } as const

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
