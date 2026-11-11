#!/usr/bin/env bash
# Regenerates the small probe fixtures (spec 0004 AC-4) and their ffprobe JSON.
# Needs ffmpeg 7.x with libx264 and libx265. Run from the repo root:
#   bash tests/fixtures/make-media.sh
set -euo pipefail
out=tests/fixtures/media
mkdir -p "$out"
ff=(ffmpeg -hide_banner -loglevel error -y)
tone=(-f lavfi -i "sine=frequency=440:sample_rate=48000")

# 1. Normal landscape MP4, 6 s, 640x360 with a 2 s silence in the middle.
"${ff[@]}" -f lavfi -i "testsrc2=size=640x360:rate=30:duration=6" \
  -f lavfi -i "aevalsrc='if(between(t,2,4),0,0.3*sin(2*PI*440*t))':s=48000:d=6" \
  -c:v libx264 -preset ultrafast -crf 32 -c:a aac -b:a 64k -movflags +faststart "$out/normal.mp4"

# 2. Portrait phone MOV: 1280x720 frames with a 90 degree display rotation, moov at the END.
"${ff[@]}" -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=3" "${tone[@]}" -t 3 \
  -c:v libx264 -preset ultrafast -crf 34 -c:a aac -b:a 64k -f mov "$out/.portrait-norot.mov"
"${ff[@]}" -display_rotation:v:0 90 -i "$out/.portrait-norot.mov" -c copy -f mov "$out/portrait-moov-end.mov"
rm "$out/.portrait-norot.mov"

# 3. HDR: HEVC 10 bit, PQ transfer, BT.2020, 1280x720, 3 s.
"${ff[@]}" -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=3" "${tone[@]}" -t 3 \
  -c:v libx265 -preset ultrafast -pix_fmt yuv420p10le \
  -x265-params "log-level=error:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc" \
  -tag:v hvc1 -c:a aac -b:a 64k -movflags +faststart "$out/hdr-pq.mp4"

# 4. Silent: video only, 3 s.
"${ff[@]}" -f lavfi -i "testsrc2=size=640x360:rate=30:duration=3" \
  -c:v libx264 -preset ultrafast -crf 32 -movflags +faststart "$out/silent.mp4"

# 5. Too long: 11 minutes, tiny and 1 fps so the file stays small.
"${ff[@]}" -f lavfi -i "testsrc2=size=160x90:rate=1:duration=660" \
  -f lavfi -i "anullsrc=r=8000:cl=mono" -t 660 \
  -c:v libx264 -preset ultrafast -crf 40 -c:a aac -b:a 8k -movflags +faststart "$out/too-long-11min.mp4"

# 6. 4K: 3840x2160, 1 s.
"${ff[@]}" -f lavfi -i "testsrc2=size=3840x2160:rate=30:duration=1" "${tone[@]}" -t 1 \
  -c:v libx264 -preset ultrafast -crf 40 -c:a aac -b:a 64k -movflags +faststart "$out/4k.mp4"

for f in "$out"/*.mp4 "$out"/*.mov; do
  ffprobe -v error -print_format json -show_format -show_streams "$f" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); d["format"].pop("filename",None); print(json.dumps(d, indent=1, sort_keys=True))' \
    > "${f%.*}.ffprobe.json"
done
ls -la "$out"
