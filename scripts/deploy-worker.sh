#!/usr/bin/env bash
# Deploy the Worker in two phases, so everything that can fail without touching production
# runs before the migration and the jobs deploy, and the only step that changes the live
# Worker is the last one (spec 0001 deploy order, spec 0005 AC-6).
#
#   build: wrangler dry run builds the final bundle and its map; with SENTRY_AUTH_TOKEN the
#          debug ID is added (ours the only one), the map is checked to list our src/ files and
#          uploaded to Sentry; maps are removed; a deploy config is written. Nothing ships.
#          The verified bundle stays in .wrangler-dist for the ship phase.
#   ship:  checks the bundle on disk is still the clean one, then `wrangler deploy --no-bundle`
#          of exactly that bundle, with the bindings from wrangler.jsonc.
#
# Run `opennextjs-cloudflare build` before `build` (pnpm deploy:build does). Without
# SENTRY_AUTH_TOKEN the Sentry steps are skipped and the Worker deploys the same way.
# Usage: bash scripts/deploy-worker.sh <build|ship> <environment> <release>
set -euo pipefail
[ $# -eq 3 ] || { echo "usage: $0 <build|ship> <environment> <release>" >&2; exit 2; }
mode="$1"
env_name="$2"
release="$3"
out=".wrangler-dist"
export OPEN_NEXT_DEPLOY=true # wrangler must not hand this deploy back to OpenNext
vars=(--var "SENTRY_ENVIRONMENT:${env_name}" --var "SENTRY_RELEASE:${release}")

# The bundle is only kept when the phase finished: a failed build leaves nothing to ship.
keep=0
trap 'if [ "$keep" != 1 ]; then rm -rf "$out"; fi' EXIT

# A bundle may carry no source map: maps travel only as the separate worker.js.map (deleted
# before shipping), and an inline map or a map file left in the bundle would ship.
check_clean_bundle() {
  [ -f "$out/worker.js" ] || { echo "no $out/worker.js: run the build phase first" >&2; exit 1; }
  if grep -q '^//# sourceMappingURL=data:' "$out/worker.js"; then
    echo "worker.js still carries an inline source map; refusing to deploy it" >&2
    exit 1
  fi
}

case "$mode" in
  build)
    rm -rf "$out"
    pnpm exec wrangler deploy --dry-run --outdir "$out" --upload-source-maps "${vars[@]}"
    check_clean_bundle

    if [ -n "${SENTRY_AUTH_TOKEN:-}" ]; then
      [ -f "$out/worker.js.map" ] || { echo "wrangler made no source map to upload" >&2; exit 1; }
      pnpm exec sentry-cli sourcemaps inject "$out"
      # The bundle holds many debug ID snippets and the SDK keeps the last registered; make ours the only one.
      pnpm exec tsx scripts/sentry-debug-id.ts "$out/worker.js"
      # With a Sentry token the deploy builds with the server map chain on (package.json), so the
      # final map must list our sources. If a framework change breaks the chain, stop here instead
      # of deploying traces that cannot be read. (Not conditional on WORKER_SOURCE_MAPS: that is set
      # only for the build step, not for this script.)
      if ! grep -q '/src/app/' "$out/worker.js.map"; then
        echo "worker.js.map lists no src/ sources: the source map chain is broken, refusing to deploy" >&2
        exit 1
      fi
      pnpm exec sentry-cli sourcemaps upload --release "$release" "$out"
    fi

    # Maps stay out of the deployed Worker (never served, never sent to Cloudflare).
    rm -f "$out"/*.map
    sed -i '/^\/\/# sourceMappingURL=/d' "$out/worker.js"
    pnpm exec tsx scripts/worker-deploy-config.ts "$out"
    [ -f "$out/wrangler.json" ] || { echo "no $out/wrangler.json was written" >&2; exit 1; }
    keep=1
    echo "Worker bundle built and checked in $out; nothing has been deployed."
    ;;
  ship)
    check_clean_bundle
    [ -f "$out/wrangler.json" ] || { echo "no $out/wrangler.json: run the build phase first" >&2; exit 1; }
    if compgen -G "$out/*.map" > /dev/null; then
      echo "a source map file is still in $out; refusing to deploy it" >&2
      exit 1
    fi
    pnpm exec wrangler deploy --config "$out/wrangler.json" --no-bundle "${vars[@]}"
    ;;
  *)
    echo "unknown mode '$mode': use build or ship" >&2
    exit 2
    ;;
esac
