#!/usr/bin/env bash
# Applies the R2 lifecycle backstop (spec 0013 AC-9) in the deploy, before the Worker ships.
# R2_LIFECYCLE_TOKEN is a bucket level token Toyin creates once; until it is a CI secret this
# step only warns and skips, so a deploy never fails for want of it. A real API failure with
# the token present does fail the step (the rules are part of the retention promise).
set -euo pipefail
if [ -z "${R2_LIFECYCLE_TOKEN:-}" ]; then
  echo "::warning::R2_LIFECYCLE_TOKEN is not set, so the R2 lifecycle backstop was not applied (spec 0013, AC-9). The app's own 30 day cleanup still runs."
  exit 0
fi
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${R2_BUCKET:?R2_BUCKET is required}"
pnpm exec tsx scripts/apply-r2-lifecycle.ts
