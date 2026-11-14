# Review, b2-t90-public-api-test-review, 2026-11-14

**Reviewed by**: claude-opus-5-5 (author on a different session of the same family)
**Scope**: 3 files changed (tests only), branch vs main. Review target: the whole public API of spec 0018.
**Verdict**: Approve with nits

## Summary

This branch adds tests only: bearer header edge cases and rate window edges in `src/lib/api-rules.test.ts`, Origin, revoke and rate window edges in `src/server/api-auth.test.ts`, and a new `src/server/api-session-only.test.ts` that drives every `session-only` route in the registry. You asked for a review of the whole public API too, so I read the guard, the key data layer, the schema and migration, the key routes, the auth route guard and the cleanup call. The core is sound: a present `Authorization` header always means the key path with no cookie fallback, the Origin rule order matches AC-6, the rate window is one atomic upsert on the UTC minute, revoke is a hard delete read by an `UPDATE ... RETURNING`, and only the hash and prefix are stored. I found no blocker and no major. The findings below are small test gaps, one scaling limit in the purge, and one weak assertion in the new tests. All 63 tests in the three files pass locally.

## Minor

### 🟡 The AC-4 test per sensitive auth path is missing, `src/app/api/auth/[...all]/route.test.ts:16`
**Problem**: AC-4 asks for a test per sensitive path (delete user, change email, change password, sign out) that sends a valid session cookie plus a bearer header and expects 401. The route test only sends a bearer to `sign-in/magic-link` and the OAuth paths, with no cookie, and never an empty `Authorization` header.
**Why it matters**: The rule is one path agnostic line today, so behavior is right. But the spec names these paths so a later change (for example widening `isClientAuth`, which already lets Basic through on two paths) cannot quietly open delete account to a header. Nothing would catch it now.
**Suggested fix**: In the same file, loop over `POST /api/auth/delete-user`, `/change-email`, `/change-password` and `/sign-out` with a `cookie` header plus `Bearer tsk_x`, and also with an empty `authorization` value, expecting 401 `session_required` and `handler` never called. Real bug? No. Small and in scope to fix now.

### 🟡 The rate window purge cannot keep up past about 66 busy keys, `src/db/data/api-keys.ts:93` and `src/trigger/cleanup.ts:103`
**Problem**: `purgeOldRateWindows` deletes one batch of 1000 rows per sweep, and the sweep runs every 15 minutes, so it removes at most 4000 rows an hour. Each key that is used every minute writes 60 rows an hour. Past about 66 keys in steady use, rows arrive faster than they leave and the table grows without bound. The filter `window_start < cutoff` also cannot use the primary key (`key_id` comes first), so each sweep scans the whole table, and that scan gets slower as it grows.
**Why it matters**: Not a problem at today's scale, but the AC-15 privacy copy promises request counts are kept "about an hour", and that stops being true once the backlog builds.
**Suggested fix**: Loop batches inside the sweep until a batch returns fewer than `RATE_WINDOW_PURGE_BATCH` rows (with a cap on rounds), and add an index on `window_start` (a new migration). Follow up.

### 🟡 A rate limited request still moves `last_used_at`, `src/server/api-auth.ts:95`
**Problem**: `authenticateApiKey` updates `last_used_at` before the rate window is counted, so a 429 refusal can still set it.
**Why it matters**: AC-10 says "a failed check changes nothing". Whether a 429 counts as a failed check is open; the effect is tiny (at most once an hour). I flag it so the spec and the code say the same thing.
**Suggested fix**: Decide and write it down. The simplest is to note in spec 0018 AC-10 that a valid key that is rate limited still counts as used, since the key itself was accepted. Follow up.

### 🟡 One new assertion cannot fail, `src/server/api-auth.test.ts:352`
**Problem**: "a revoked key is not counted in the rate window" checks that no `api_rate_window` row exists for the revoked key's ID. The key row is already deleted, and `api_rate_window.key_id` is a foreign key with `ON DELETE CASCADE`, so no row with that ID can exist whatever the guard does: an insert would fail on the foreign key and a 500 would show up instead.
**Why it matters**: The test reads as proof of AC-9 ("an unknown key is not counted") but the database guarantees it, not the code. The 401 and `session.calls === 0` checks in the same test are real.
**Suggested fix**: Drop the window row assertion, or replace it with a spy on `countApiRequest` (or on the database) that shows no insert was attempted. Small and in scope to fix now.

## Nits

- ⚪ `src/lib/api-rules.test.ts:142`, `keepMs > 60_000` is a weak check; asserting `API_RATE.keepMs` equals one hour (the value the privacy copy promises) would lock in the real contract.
- ⚪ `src/server/api-auth.test.ts:303`, "a plain GET works without an Origin" repeats what the earlier "gives the same answer for GET /api/usage" test already proves.
- ⚪ `src/server/api-session-only.test.ts:56`, `base as unknown as RealtimeHttpDeps` hides a type gap; if `handleToken` ever touches another dependency before the guard the test throws a confusing TypeError. Build a typed realtime deps object whose other members throw a clear "must not be called" error.
- ⚪ `src/app/api/auth/[...all]/route.ts:197`, the `session_required` message here differs from the one in `api-auth.ts:133`. Reuse one constant so clients see one wording.

## Strengths

- `guard` and `resolveCreator` in `src/server/api-auth.ts` are small and read in the exact AC-6 order; any header, even empty or another scheme, goes to the key path and the cookie is never read beside it. Tests check `session.calls === 0` in every bearer case, which proves the no fallback rule rather than inferring it.
- The rate window is one `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` with the window and the second both from database `now()`, and there is a concurrency test (30 parallel requests count exactly 30).
- Secrets: only `key_hash` (unique) and `prefix` are stored, the data layer takes the hash and never the key, `listApiKeys` selects named columns so the hash is never read, the one log line carries a reason code only, and every answer is `private, no-store`.
- Revoke is an ownership scoped hard delete, and the key check is a write so Hyperdrive cannot serve a stale answer.
- The new `api-session-only.test.ts` is a good test: it derives its list from `API_EXCLUSIONS`, fails if a session only route is added without a case, and checks Origin before the bearer on writes, the 401 body, and the cache header.
- The new edge tests are real: tab, newline, second token, Cyrillic look alike and NUL in the bearer; the last millisecond of a minute against the first of the next with `Retry-After: 1`; a trailing slash, `null`, an empty and an uppercase Origin.

## Test coverage

Covered well: no fallback (AC-5), Origin order (AC-6), revoke right away and ownership (AC-3), rate limit with `Retry-After`, a per key window, refused requests counted, unknown keys not counted, the database clock path (AC-9), last used (AC-10), the session only routes (AC-4 for our own routes), account deletion cascade through the real delete path (`src/server/account/delete-user.test.ts:153`, AC-14), and registry parity in `src/server/api-parity.test.ts`. Gaps: the per path AC-4 test on the Better Auth routes with a cookie beside the header, and a test that the purge drains more than one batch. One new assertion is guarded by the foreign key rather than the code (see Minor).

## What was done with these findings (B2-T90)

Fixed in this PR, all in tests:
- The AC-4 test per sensitive auth path now exists in `src/app/api/auth/[...all]/route.test.ts`: delete user, change email, change password and sign out, each with a valid cookie beside a bearer, a Basic value and an empty header, all 401 `session_required` and the handler never called.
- The assertion that could not fail (a revoked key has no rate window row) is removed. The 401 and the "cookie never read" checks stay.
- Nits: the one hour check on `API_RATE.keepMs` now pins the real value, and the repeated plain GET test is removed.

Follow ups, not done here (none is a bug that hurts today):
1. Purge drains one batch per sweep and has no index on `window_start`. Loop the batches inside the sweep, with a cap, and add an index in a new migration, before more than about 60 keys are in steady use. A small task of its own, because it changes the schema.
2. A rate limited request still updates `last_used_at`. Decide whether that is right and say so in AC-10 of spec 0018 (a spec edit, which is /architect's).
3. `session_required` has two different wordings (`api-auth.ts` and the auth route). Share one constant. It touches the message text clients see, so it waits for a decision.
4. `api-session-only.test.ts` uses `as unknown as RealtimeHttpDeps`. Replace it with a typed deps object whose other members throw a clear error.
