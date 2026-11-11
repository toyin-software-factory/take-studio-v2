# Data layer (src/db)

Drizzle over Postgres. Spec: [0002 data model](../../docs/specs/0002-data-model/index.md).

## Layers and rules

- `src/db/data/*` are system functions: they act on IDs only and are safe for jobs. `src/server/*` wraps them for a creator (it takes `creatorId` from the session). Job code imports `src/db/data`, never `src/server`.
- Expected failures return a `Result` (`src/lib/result.ts`: `ok`, `err`). Another creator's resource and a malformed ID both give `not_found`, never "forbidden".
- A take's status changes only through `transitionTake` (compare and swap on the old status; the rules are `TAKE_TRANSITIONS` in `src/lib/take-rules.ts`). One known exception: `expireTake` in `data/deletion.ts` writes `expired` itself after a row lock.
- Transactions: `runTx(db, fn)` in `src/db/tx.ts`. `fn` returns a `Result`; `{ ok: false }` rolls back and comes back as a normal result, a thrown error rolls back and propagates, and an open transaction becomes a savepoint. Data functions take an `Executor` (`Db | Tx`) so they compose; `pgErrorCode` reads the SQLSTATE even when Drizzle wraps the error.
- Job kinds: `startJob` moves the take to `processing` and charges; a `transcribe` job (spec 0007) works beside a `ready` take. `startTranscribeJob` locks the take, refuses `original_gone`, `already_done`, `job_active` and `invalid_transition`, charges 0 and never moves the take. `finishInTx` for a transcribe job sets only the job status and code: no take transition, no render flip or discard, no refund. `expireTake` and `expireDueTakes` skip any take with a queued or running job of any kind. The `transcript` table (one row per take, cascade deleted, words with times on the original) is read and written through `data/transcripts.ts`; its text is personal data, never log it.
- Row locks are the concurrency guard: the upload rate limit locks the creator row, cut edits lock the take, cancel locks the job. Keep those checks inside the transaction.

## Clients

- Web: `createWebDb` builds a new client per request over Hyperdrive (`max: 5`, `fetch_types: false`). Never keep one at module level; `getDb()` in `src/server/request.ts` is the way in.
- Jobs: `withJobDb` opens and closes a client inside each task (`max: 2`, the Neon pooled URL, first connect retried 3 times for scale to zero).

## Tests and migrations

- `openTestDb()` (`src/db/testing/test-db.ts`) refuses any host but localhost, creates the database if it is missing and applies `drizzle/`. It needs `pnpm db:up`. A test that sweeps whole tables passes its own `{ database: "take_studio_test_<name>" }`. `createCreator` and `seedTake` insert rows directly (`seedTake` defaults to `uploaded`).
- After a schema change run `pnpm db:generate` and commit `drizzle/`; CI fails if generate would change it. `schema/migration.test.ts` checks the generated SQL text (drizzle-kit has dropped partial index WHERE clauses before), so run it after you regenerate. Deploys migrate before the code ships, so migrations must be backward compatible. The connection guard is `scripts/db-guard.ts` (see root `AGENTS.md`).

_Drafted by /sync from a catch up over the merged work, worth a quick human pass._
