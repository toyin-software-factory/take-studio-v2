#!/usr/bin/env bash
# Starts the built Worker preview, waits for it, runs the Lighthouse mobile script, stops the
# preview. Needs `pnpm build:worker` first and the local or CI Postgres (see lighthouse-ci.ts).
set -uo pipefail
pnpm exec opennextjs-cloudflare preview --ip 127.0.0.1 --port 8787 --var DESIGN_GALLERY:1 >/tmp/lighthouse-preview.log 2>&1 &
preview=$!
trap 'kill "$preview" 2>/dev/null; wait "$preview" 2>/dev/null' EXIT
ready=0
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null http://127.0.0.1:8787/sign-in 2>/dev/null; then ready=1; break; fi
  kill -0 "$preview" 2>/dev/null || break
  sleep 2
done
if [ "$ready" != 1 ]; then
  echo "::error::The preview Worker did not start."
  tail -n 40 /tmp/lighthouse-preview.log
  exit 1
fi
pnpm exec tsx scripts/lighthouse-ci.ts
