#!/usr/bin/env bash
# B2-T140: build the Worker for a local `pnpm test:e2e` (CI writes a placeholder .env instead).
# A dev `.env` has BETTER_AUTH_URL=http://localhost:3000, which a build bakes in, so the app then
# refuses every write from the tests (Origin is 127.0.0.1:8787). The build starts from a clean
# environment so the sandbox shell's own BETTER_AUTH_* never leaks in, and sets the values the
# tests need. A build bakes in only names that an env file or the process lists, and the Worker
# reads nothing else, so the made up INSIGHTS_VIEWER_USER_ID (tests/support/session.ts, never the
# real viewer) and the USAGE_HASH_SECRET the tests read from .env or the shell go in a throwaway
# .env.production.local, which wins over .env and is removed afterwards. .env is not changed.
set -euo pipefail
cd "$(dirname "$0")/.."/..
local_file=.env.production.local
[ ! -e "$local_file" ] || { echo "$local_file exists; remove it first." >&2; exit 1; }
trap 'rm -f "$local_file"' EXIT
{
  echo "INSIGHTS_VIEWER_USER_ID=00000000-0000-4000-8000-00000000e2e1"
  if ! grep -q '^USAGE_HASH_SECRET=.' .env 2>/dev/null && [ -n "${USAGE_HASH_SECRET:-}" ]; then
    echo "USAGE_HASH_SECRET=$USAGE_HASH_SECRET"
  fi
} > "$local_file"
env -i PATH="$PATH" HOME="$HOME" BETTER_AUTH_URL="http://127.0.0.1:8787" pnpm build:worker
