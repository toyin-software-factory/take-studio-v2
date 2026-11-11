#!/usr/bin/env bash
# Deploy the Worker so Sentry can read its stack traces (spec 0005, AC-6).
# Wrangler re-bundles src/worker.ts with .open-next/worker.js, so only the bundle it makes
# matches a source map. This builds that final bundle first (dry run), gives it a debug ID
# (placed last, so the SDK picks it),
# uploads its map to Sentry, deletes the map, then deploys exactly that file without bundling, with the bindings from wrangler.jsonc.
# Run `opennextjs-cloudflare build` first (pnpm deploy does). Without SENTRY_AUTH_TOKEN the
# Sentry steps are skipped and the Worker still deploys the same way.
# Usage: bash scripts/deploy-worker.sh <environment> <release>
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: $0 <environment> <release>" >&2; exit 2; }
env_name="$1"
release="$2"
out=".wrangler-dist"
export OPEN_NEXT_DEPLOY=true # wrangler must not hand this deploy back to OpenNext
vars=(--var "SENTRY_ENVIRONMENT:${env_name}" --var "SENTRY_RELEASE:${release}")

rm -rf "$out"
trap 'rm -rf "$out"' EXIT
pnpm exec wrangler deploy --dry-run --outdir "$out" --upload-source-maps "${vars[@]}"
[ -f "$out/worker.js" ] || { echo "wrangler made no $out/worker.js" >&2; exit 1; }
# Maps travel only as the separate worker.js.map; an inline map left in the bundle would ship.
if grep -q '^//# sourceMappingURL=data:' "$out/worker.js"; then
  echo "worker.js still carries an inline source map; refusing to deploy it" >&2
  exit 1
fi

if [ -n "${SENTRY_AUTH_TOKEN:-}" ]; then
  [ -f "$out/worker.js.map" ] || { echo "wrangler made no source map to upload" >&2; exit 1; }
  pnpm exec sentry-cli sourcemaps inject "$out"
  # The bundle holds many debug ID snippets and the SDK keeps the last registered; make ours the only one.
  pnpm exec tsx scripts/sentry-debug-id.ts "$out/worker.js"
  # With the server map chain on, the final map must list our sources; if a framework change
  # breaks the chain, stop here instead of deploying traces that cannot be read.
  if [ -n "${WORKER_SOURCE_MAPS:-}" ] && ! grep -q '/src/app/' "$out/worker.js.map"; then
    echo "worker.js.map lists no src/ sources: the source map chain is broken, refusing to deploy" >&2
    exit 1
  fi
  pnpm exec sentry-cli sourcemaps upload --release "$release" "$out"
fi

# Maps stay out of the deployed Worker (never served, never sent to Cloudflare).
rm -f "$out"/*.map
sed -i '/^\/\/# sourceMappingURL=/d' "$out/worker.js"
pnpm exec tsx scripts/worker-deploy-config.ts "$out"
pnpm exec wrangler deploy --config "$out/wrangler.json" --no-bundle "${vars[@]}"
