# Tests (tests/ and how to run each kind)

- Unit: `pnpm test` (Vitest, only `src/**/*.test.ts`). Database tests need `pnpm db:up`.
- Browser: `pnpm build:worker`, then `pnpm test:e2e`. It runs against a built Worker (`opennextjs-cloudflare preview` on 127.0.0.1:8787), not `next dev`, and nothing builds the Worker for you. Locally a stale preview server is reused (`reuseExistingServer`), so stop old ones. It needs Postgres: `tests/support/session.ts` seeds users and sessions and forges Better Auth's signed cookie, so the Worker must be built with the same `BETTER_AUTH_SECRET`, and non local hosts are refused. CI writes a placeholder `.env` before the build because OpenNext bundles it.
- The design specs split by mode: `design.spec.ts` and `design-components.spec.ts` skip when `E2E_PRODUCTION=1`, and the production check is a separate run.
- Pipeline: `pnpm test:pipeline` is the API level end to end check against the real R2 and Trigger.dev dev environments. It is a pre release check, not PR CI, and needs R2 and Trigger.dev keys (`harness.ts` lists them), Docker Postgres, and ffmpeg 7 with libx264 and libx265. It starts `next dev` and `trigger dev` as child processes; the root `AGENTS.md` says what to do when a failed run leaves them behind.
- Manual checks: `tests/probe-check.ts` and `tests/process-check.ts`, run as `DATABASE_URL_DIRECT=postgres://postgres:postgres@localhost:5432/take_studio pnpm tsx tests/probe-check.ts`.
- Fixtures: `tests/fixtures/media/` is committed. Regenerate with `bash tests/fixtures/make-media.sh` and `bash tests/fixtures/make-pause-media.sh`; the pause fixtures depend on exact tone and flash timings written in the script comments.
- In CI Playwright retries once and `forbidOnly` is on.
- Keyboard tests on Radix menus must wait for `[data-overlays-ready='true']` (set by `OverlayDemos` after its effects run) before pressing keys: Radix only learns a menu was opened from the keyboard through a document listener added in an effect, and an early Enter leaves focus on the menu instead of the first item. Never fix this with a sleep or a retry.

_Drafted by /sync from a catch up over the merged work, worth a quick human pass._
