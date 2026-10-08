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

// kitty 그래픽 프로토콜을 그릴 수 있는 환경인지. tmux·zellij·herdr 같은 멀티플렉서는 통과시키지 않아
// 그림 대신 alt 글자가 나오므로, 그 안에서는 썸네일을 그리지 않는다.
export function supportsGraphics(env: Record<string, string | undefined>): boolean {
  if (env.TMUX || env.ZELLIJ || env.HERDR_ENV === '1') return false
  const term = (env.TERM ?? '').toLowerCase()
  const program = (env.TERM_PROGRAM ?? '').toLowerCase()
  return term.includes('kitty') || term.includes('ghostty') || ['ghostty', 'kitty', 'wezterm'].includes(program)
}
