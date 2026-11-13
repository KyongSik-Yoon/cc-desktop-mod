#!/usr/bin/env bash
# docs/demo.mp4(1600x872, 창 180x44칸) 에서 README 용 docs/demo.gif 를 만든다.
# 기능마다 화면 일부를 1:1 로 잘라(글자가 읽히게) 아래에 자막 띠를 붙이고 이어 붙인다.
# 잘라낸 영역이 프레임보다 좁으면 터미널 바탕색으로 채운다(어두운 여백은 장면마다 폭이 달라 거슬린다).
# 한 줄 = 시작초 | 길이 | 자를 영역 w:h:x:y | 자막
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=docs/demo.mp4 OUT=${1:-docs/demo.gif}
W=960 H=540 BAR=56
FONT=$(fc-match -f '%{file}' 'sans:bold')
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

SEGMENTS='
28.6|1.6|1600:872:0:0|desk-look: the Claude desktop look for the Claude Code terminal
4.5|3.0|1320:742:0:40|Tool calls fold into one line while Claude works
8.5|2.5|960:252:0:620|A progress band shows the step, the command and its CPU
12.1|2.2|878:523:0:190|Each turn ends with a card of the files it edited
14.0|2.4|716:523:876:0|A document Claude wrote opens in the preview pane
19.8|2.6|716:523:876:0|/desk-diff: review changes like the desktop diff panel
23.5|4.6|716:523:876:200|Click a line number to leave a comment
27.7|3.2|878:523:0:349|Comments go to Claude with your next prompt
37.5|3.0|716:523:876:150|...and the fix lands in the diff
46.5|3.5|716:523:876:0|/desk-context: what fills the context, cache, cost and limits
'
i=0; : > "$TMP/list.txt"
while IFS='|' read -r ss dur crop text; do
  [ -n "$ss" ] || continue
  printf '%s' "$text" > "$TMP/cap$i.txt"
  ffmpeg -nostdin -v error -y -ss "$ss" -t "$dur" -i "$SRC" -vf "
    crop=$crop,scale=$W:$H:force_original_aspect_ratio=decrease:flags=lanczos,
    pad=$W:$H:(ow-iw)/2:(oh-ih)/2:color=0xfafafa,
    pad=$W:$((H+BAR)):0:0:color=0xeceef1,
    drawbox=x=0:y=$H:w=$W:h=1:color=0xd1d9e0:t=fill,
    drawtext=fontfile=$FONT:textfile=$TMP/cap$i.txt:fontsize=24:fontcolor=0x1f2328:x=(w-text_w)/2:y=$H+($BAR-text_h)/2,
    fps=50" -c:v libx264 -qp 0 -preset ultrafast "$TMP/s$i.mkv"
  echo "file '$TMP/s$i.mkv'" >> "$TMP/list.txt"
  i=$((i+1))
done <<< "$SEGMENTS"

ffmpeg -v error -y -f concat -safe 0 -i "$TMP/list.txt" -filter_complex "
  split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];
  [b][p]paletteuse=dither=none:diff_mode=rectangle" "$OUT"
ls -la "$OUT"
