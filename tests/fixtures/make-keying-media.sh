#!/usr/bin/env bash
# Fixtures for green screen keying (spec 0008): synthetic clips, no real person or footage.
# A person shape (head and shoulders, soft 3 px edges) stands in front of a screen, drawn once
# as a still frame and looped into a video, so the files stay tiny. Needs ffmpeg 7.x with
# libx264 and libx265. Run from the repo root:
#   bash tests/fixtures/make-keying-media.sh
set -euo pipefail
out=tests/fixtures/media
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
ff=(ffmpeg -hide_banner -loglevel error -y)

GREEN="0 177 64"   # #00B140, the usual chroma key green

# frame <w> <h> <bg "r g b" or "none"> <shirt "r g b"> <out.png> [strip]
#   bg: the wall colour; with "strip", only the middle 30 % of the width is that colour.
#   A head (skin) and shoulders (shirt) with 3 px soft edges, centred.
frame() {
  local w=$1 h=$2 bg=($3) shirt=($4) png=$5 strip=${6:-}
  local cx=$((w / 2)) hr=$((h * 11 / 100)) hy=$((h * 33 / 100))
  local tr=$((w * 20 / 100)) ty=$((h * 90 / 100)) tx=$((h * 45 / 100))
  [ "$w" -gt "$h" ] || tr=$((w * 30 / 100))
  local wall="between(X,${w}*0.35,${w}*0.65)"
  local inwall=1
  [ -n "$strip" ] && inwall="$wall"
  # Soft masks: 1 inside the shape, 0 outside, linear over ~3 px.
  local m1="clip((1-hypot((X-$cx)/($hr*0.8),(Y-$hy)/$hr))*$hr*0.8/3,0,1)"
  local m2="clip((1-hypot((X-$cx)/$tr,(Y-$ty)/$tx))*$tx/3,0,1)"
  local c
  for c in 0 1 2; do
    local b=${bg[$c]} s=${shirt[$c]} k=$((c == 0 ? 222 : c == 1 ? 160 : 130))
    # Gentle, even light across the wall (a few percent) so the key is not perfectly flat.
    local base="if($inwall,$b*(0.97+0.03*X/$w),$((c == 0 ? 120 : c == 1 ? 120 : 125)))"
    exprs[$c]="lerp(lerp($base,$k,$m1),$s,$m2)"
  done
  "${ff[@]}" -f lavfi -i "color=c=black:s=${w}x${h}:d=1,format=rgb24,geq=r='${exprs[0]}':g='${exprs[1]}':b='${exprs[2]}'" -frames:v 1 "$png"
}
declare -a exprs

# tone <dur> <pause_start> <pause_end> -> aevalsrc expression: a 440 Hz tone with one pause
tone() { echo "(1-between(t,$2,$3))*0.4*sin(2*PI*440*t)"; }

# clip <png> <out> <dur> <fps> <audio expr or none> <hdr 0|1>
clip() {
  local png=$1 o=$2 dur=$3 fps=$4 audio=$5 hdr=$6
  local a=()
  if [ "$audio" != none ]; then
    a=(-f lavfi -i "aevalsrc='$audio':s=48000:d=$dur" -c:a aac -b:a 64k)
  fi
  if [ "$hdr" = 1 ]; then
    "${ff[@]}" -loop 1 -framerate "$fps" -t "$dur" -i "$png" "${a[@]}" -vf "format=yuv420p10le" \
      -c:v libx265 -preset ultrafast -crf 30 -pix_fmt yuv420p10le \
      -x265-params "log-level=error:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc" \
      -tag:v hvc1 -movflags +faststart "$o"
  else
    "${ff[@]}" -loop 1 -framerate "$fps" -t "$dur" -i "$png" "${a[@]}" \
      -c:v libx264 -preset ultrafast -crf 30 -g 30 -pix_fmt yuv420p -movflags +faststart "$o"
  fi
}

BLUE="60 70 160"
GRAY="120 120 125"

# With a green screen (spec 0008 AC-2).
frame 1920 1080 "$GREEN" "$BLUE" "$tmp/land.png"
clip "$tmp/land.png" "$out/keyed-landscape.mp4" 6 30 "$(tone 6 2 3.5)" 0
frame 1080 1920 "$GREEN" "$BLUE" "$tmp/port.png"
clip "$tmp/port.png" "$out/keyed-portrait.mp4" 6 30 "$(tone 6 2 3.5)" 0
frame 1280 720 "$GREEN" "$BLUE" "$tmp/hdr.png"
clip "$tmp/hdr.png" "$out/keyed-hdr.mp4" 6 30 "$(tone 6 2 3.5)" 1
frame 1280 720 "$GREEN" "$BLUE" "$tmp/mid.png"
clip "$tmp/mid.png" "$out/keyed-no-pauses.mp4" 5 30 "0.4*sin(2*PI*440*t)" 0
clip "$tmp/mid.png" "$out/keyed-no-audio.mp4" 4 30 none 0

# Other greens (S3S-T10): a lime virtual green screen (125 245 75, a grey sweater on it), a
# pale mint screen (170 230 190) and a shadowed cloth green (40 110 55). Low chroma greens sit close to grey in the U and V planes, so
# a fixed key used to erase the person; both must key cleanly.
LIME="125 245 75"
MINT="170 230 190"
SHADOW="40 110 55"   # a darker, shadowed cloth green
SWEATER="146 148 140"
frame 1280 720 "$LIME" "$SWEATER" "$tmp/lime.png"
clip "$tmp/lime.png" "$out/keyed-lime.mp4" 5 30 "$(tone 5 2 3.5)" 0
frame 1280 720 "$MINT" "$SWEATER" "$tmp/mint.png"
clip "$tmp/mint.png" "$out/keyed-mint.mp4" 5 30 "$(tone 5 2 3.5)" 0
frame 1280 720 "$SHADOW" "$SWEATER" "$tmp/shadow.png"
clip "$tmp/shadow.png" "$out/keyed-shadow.mp4" 5 30 "$(tone 5 2 3.5)" 0

# Without a usable green screen (spec 0008 AC-3).
frame 1280 720 "$GRAY" "$BLUE" "$tmp/none.png"
clip "$tmp/none.png" "$out/nogreen-none.mp4" 5 30 "$(tone 5 2 3.5)" 0
frame 1280 720 "0 45 15" "$BLUE" "$tmp/dark.png"
clip "$tmp/dark.png" "$out/nogreen-dark-patchy.mp4" 5 30 "$(tone 5 2 3.5)" 0
frame 1280 720 "$GRAY" "$GREEN" "$tmp/shirt.png"
clip "$tmp/shirt.png" "$out/nogreen-green-shirt.mp4" 5 30 "$(tone 5 2 3.5)" 0
frame 1280 720 "$GRAY" "$BLUE" "$tmp/none2.png"
clip "$tmp/none2.png" "$out/nogreen-no-pauses.mp4" 5 30 "0.4*sin(2*PI*440*t)" 0
clip "$tmp/none2.png" "$out/nogreen-no-audio.mp4" 4 30 none 0
frame 1280 720 "$GREEN" "$BLUE" "$tmp/narrow.png" strip
clip "$tmp/narrow.png" "$out/nogreen-narrow.mp4" 5 30 "$(tone 5 2 3.5)" 0

# Background images for the upload scenarios (spec 0008, AC-8): one that is accepted (1280x720,
# the smallest allowed), one that is too small, and bytes that are not an image at all.
"${ff[@]}" -f lavfi -i "gradients=s=1280x720:c0=0x6b2d1a:c1=0xd9a066:x0=0:y0=0:x1=1280:y1=720:nb_colors=2:d=1" -frames:v 1 -q:v 5 "$out/bg-ok.jpg"
"${ff[@]}" -f lavfi -i "gradients=s=640x360:c0=0x1a6b2d:c1=0x66d9a0:x0=0:y0=0:x1=640:y1=360:nb_colors=2:d=1" -frames:v 1 -q:v 5 "$out/bg-small.jpg"
printf 'this is not an image' > "$out/bg-fake.jpg"

ls -la "$out"/keyed-*.mp4 "$out"/nogreen-*.mp4 "$out"/bg-*.jpg
