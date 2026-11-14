#!/usr/bin/env bash
# Fixtures for the recorded take checks (spec 0021 AC-4, AC-14): what a browser recording makes.
# Both are about 10 seconds of a synthetic tone with one 2.5 s pause (the pause gets cut), a flat
# colour video, no real person. Needs ffmpeg with libvpx, libopus, libx264. From the repo root:
#   bash tests/fixtures/make-recorded-media.sh
# The results are committed, so only regenerate when the script changes.
set -euo pipefail
out=tests/fixtures/media
ff=(ffmpeg -hide_banner -loglevel error -y)
video="color=c=0x0b3d4f:s=320x180:r=30:d=10"
# 3 s tone, 2.5 s of silence, 4.5 s tone.
audio="aevalsrc=if(between(t\,3\,5.5)\,0\,0.3*sin(2*PI*220*t)):s=48000:d=10"

# Chrome / Firefox MediaRecorder: WebM, VP8 and Opus. MediaRecorder streams the file, so nothing
# can seek back to write the duration. Writing to a pipe does the same: no duration in the header
# and no cues. This is the case the probe has to read from the last packet.
"${ff[@]}" -f lavfi -i "$video" -f lavfi -i "$audio" \
  -c:v libvpx -b:v 150k -deadline realtime -cpu-used 8 -g 30 -c:a libopus -b:a 32k \
  -f webm pipe:1 > "$out/recorded-chrome.webm"

# Safari MediaRecorder: fragmented MP4, H.264 and AAC (an empty moov, then moof/mdat pieces).
"${ff[@]}" -f lavfi -i "$video" -f lavfi -i "$audio" \
  -c:v libx264 -preset ultrafast -crf 36 -pix_fmt yuv420p -g 30 -c:a aac -b:a 32k -ar 48000 \
  -movflags frag_keyframe+empty_moov+default_base_moof "$out/recorded-safari.mp4"

ls -la "$out"/recorded-chrome.webm "$out"/recorded-safari.mp4
