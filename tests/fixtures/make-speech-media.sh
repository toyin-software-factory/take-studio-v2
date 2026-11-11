#!/usr/bin/env bash
# Fixtures for the transcript pipeline checks (spec 0007): tiny clips with synthetic speech.
# The voices come from Deepgram's own text to speech (no real person, no personal data).
# Needs ffmpeg and DEEPGRAM_API_KEY. Run from the repo root:
#   bash tests/fixtures/make-speech-media.sh
# The results are committed, so only regenerate when the script changes. Cost: a few cents.
set -euo pipefail
out=tests/fixtures/media
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
ff=(ffmpeg -hide_banner -loglevel error -y)

speak() { # voice, text, outfile
  curl -sf -X POST "https://api.deepgram.com/v1/speak?model=$1&encoding=linear16&container=wav&sample_rate=24000" \
    -H "Authorization: Token ${DEEPGRAM_API_KEY:?set DEEPGRAM_API_KEY}" -H "content-type: application/json" \
    -d "{\"text\":\"$2\"}" -o "$3"
}

# Video: 30 fps, 320x180, a flat colour. Audio: given file. Length follows the audio.
mux() { # audio, outfile
  local d
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$1")
  "${ff[@]}" -f lavfi -i "color=c=0x0b3d4f:s=320x180:r=30:d=$d" -i "$1" \
    -c:v libx264 -preset ultrafast -crf 38 -pix_fmt yuv420p -c:a aac -b:a 32k -ar 24000 -ac 1 \
    -shortest -movflags +faststart "$2"
}

# English: two sentences with a 2.5 s pause between them (the pause gets trimmed).
speak aura-2-thalia-en "Hello, this is a short test take." "$tmp/en1.wav"
speak aura-2-thalia-en "Um, I want to show how a transcript appears." "$tmp/en2.wav"
"${ff[@]}" -i "$tmp/en1.wav" -f lavfi -t 2.5 -i anullsrc=r=24000:cl=mono -i "$tmp/en2.wav" \
  -filter_complex "[0:a][1:a][2:a]concat=n=3:v=0:a=1[a]" -map "[a]" "$tmp/en.wav"
mux "$tmp/en.wav" "$out/speech-en.mp4"

# Spanish: not English, so the transcript is skipped.
speak aura-2-celeste-es "Hola, esta es una prueba corta de un video. Quiero mostrar como funciona la transcripcion." "$tmp/es.wav"
mux "$tmp/es.wav" "$out/speech-es.mp4"

# An audio track with nothing in it: Deepgram finds no words.
"${ff[@]}" -f lavfi -i anullsrc=r=24000:cl=mono -t 5 "$tmp/quiet.wav"
mux "$tmp/quiet.wav" "$out/speech-quiet.mp4"

ls -la "$out"/speech-en.mp4 "$out"/speech-es.mp4 "$out"/speech-quiet.mp4
