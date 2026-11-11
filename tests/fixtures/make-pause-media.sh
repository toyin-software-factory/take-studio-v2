#!/usr/bin/env bash
# Fixtures for process-take (spec 0004 AC-5, AC-6): pauses to trim and an A/V sync check.
# Needs ffmpeg 7.x with libx264 and libx265. Run from the repo root:
#   bash tests/fixtures/make-pause-media.sh
set -euo pipefail
out=tests/fixtures/media
ff=(ffmpeg -hide_banner -loglevel error -y)

# Tone blocks (s): 1.5-3.0, 4.5-6.0, 6.4-8.0, 11.0-13.0, 14.0-17.5 in a 20 s take.
# Silences: 0-1.5 (start edge), 3.0-4.5 (1.5 s), 6.0-6.4 (0.4 s, too short), 8.0-11.0 (3 s),
# 13.0-14.0 (1 s), 17.5-20 (end edge). A one frame white flash marks each tone onset.
blocks="between(t,1.5,3.0)+between(t,4.5,6.0)+between(t,6.4,8.0)+between(t,11.0,13.0)+between(t,14.0,17.5)"
flashes="between(t,1.5,1.53)+between(t,4.5,4.53)+between(t,6.4,6.43)+between(t,11.0,11.03)+between(t,14.0,14.03)"
"${ff[@]}" -f lavfi -i "color=c=black:s=640x360:r=30:d=20,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='${flashes}'" \
  -f lavfi -i "aevalsrc='(${blocks})*0.4*sin(2*PI*440*t)':s=48000:d=20" \
  -c:v libx264 -preset ultrafast -crf 30 -g 30 -c:a aac -b:a 96k -movflags +faststart "$out/pauses-sync.mp4"

# Portrait phone MOV with a 1.5 s pause (2-3.5 s), 90 degree display rotation.
"${ff[@]}" -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=6" \
  -f lavfi -i "aevalsrc='(1-between(t,2,3.5))*0.4*sin(2*PI*440*t)':s=48000:d=6" \
  -c:v libx264 -preset ultrafast -crf 34 -c:a aac -b:a 64k -f mov "$out/.pp.mov"
"${ff[@]}" -display_rotation:v:0 90 -i "$out/.pp.mov" -c copy -f mov "$out/portrait-pauses.mov"
rm "$out/.pp.mov"

# HDR (PQ, BT.2020, 10 bit HEVC) with a 1.5 s pause (2-3.5 s).
"${ff[@]}" -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=6" \
  -f lavfi -i "aevalsrc='(1-between(t,2,3.5))*0.4*sin(2*PI*440*t)':s=48000:d=6" \
  -c:v libx265 -preset ultrafast -pix_fmt yuv420p10le \
  -x265-params "log-level=error:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc" \
  -tag:v hvc1 -c:a aac -b:a 64k -movflags +faststart "$out/hdr-pauses.mp4"

ls -la "$out"/pauses-sync.mp4 "$out"/portrait-pauses.mov "$out"/hdr-pauses.mp4
