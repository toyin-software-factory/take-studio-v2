# Deploy and scripts (scripts/, patches/)

- Production deploys run only from CI (`.github/workflows/deploy.yml`), in this order: migrate (`MIGRATE_TARGET=prod`), Trigger.dev tasks, Worker. `pnpm run deploy` runs `deploy:check-env` (refuses any `.env*` or `.dev.vars*` file), `opennextjs-cloudflare build`, `deploy:check-maps` (refuses `.map` files in `.open-next/assets`), then `scripts/deploy-worker.sh`.
- `deploy-worker.sh`: a wrangler dry run builds the final bundle and its map. With `SENTRY_AUTH_TOKEN` it adds the debug ID (`sentry-cli`), makes ours the only one (`scripts/sentry-debug-id.ts`), uploads the map, then deletes the maps. It deploys with a generated config (`scripts/worker-deploy-config.ts`) and `--no-bundle`. Never run `wrangler deploy <file>` by hand: it ignores `wrangler.jsonc` and drops the bindings.
- Why the debug ID must be the only one: the bundle holds many Sentry debug IDs (some in lazily loaded modules) and the SDK keeps the last one registered, so `src/lib/sentry-debug-id.ts` replaces the registry.
- Worker frames map back to `src/` through an inline map chain: `pnpm build` runs `scripts/inline-server-maps.ts` (only when `WORKER_SOURCE_MAPS` is set, which `pnpm deploy` does when there is a Sentry token), `next.config.ts` turns on server source maps under the same flag, and `patches/@opennextjs__cloudflare@1.20.16.patch` makes OpenNext write the handler map. When you bump `@opennextjs/cloudflare`, redo the patch (`pnpm patch`) or Worker frames stop resolving to `src/`.
- The Worker runs with Sentry Dedupe off (`workerSentryOptions`) so every route error counts.
- Other scripts: `db-guard.ts` (see root `AGENTS.md`), `r2-cors.ts` (`pnpm r2:cors`), `pr-proof.sh` (publishes PR proof files).
- The pre commit hook runs ESLint and Prettier on staged files only; typecheck and tests stay in CI.

_Drafted by /sync from a catch up over the merged work, worth a quick human pass._
