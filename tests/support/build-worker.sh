#!/usr/bin/env bash
# B2-T140: build the Worker for a local `pnpm test:e2e` (CI writes a placeholder .env instead).
# A dev `.env` has BETTER_AUTH_URL=http://localhost:3000, which a build bakes in, so the app then
# refuses every write from the tests (Origin is 127.0.0.1:8787). The build starts from a clean
# environment so the sandbox shell's own BETTER_AUTH_* never leaks in, and sets the values the
# tests need. A build bakes in only names that an env file or the process lists, and the Worker
# reads nothing else, so the made up INSIGHTS_VIEWER_USER_ID (tests/support/session.ts, never the
# real viewer) and the CI placeholder USAGE_HASH_SECRET (USAGE_TEST_HASH_SECRET in
# tests/support/session.ts) go in a throwaway .env.production.local, which wins over .env and is
# removed afterwards. Nothing is read from the shell or .env: no real secret is baked or used.
set -euo pipefail
cd "$(dirname "$0")/.."/..
local_file=.env.production.local
[ ! -e "$local_file" ] || { echo "$local_file exists; remove it first." >&2; exit 1; }
trap 'rm -f "$local_file"' EXIT
{
  echo "INSIGHTS_VIEWER_USER_ID=00000000-0000-4000-8000-00000000e2e1"
  echo "USAGE_HASH_SECRET=ci-only-placeholder-usage-secret-0123456789"
  # Cloudflare's documented Turnstile test keys (always pass). Run the e2e with
  # TURNSTILE_SITE_KEY=1x00000000000000000000AA exported, as CI does (B2-T176).
  echo "TURNSTILE_SITE_KEY=1x00000000000000000000AA"
  echo "TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA"
} > "$local_file"
env -i PATH="$PATH" HOME="$HOME" BETTER_AUTH_URL="http://127.0.0.1:8787" pnpm build:worker
