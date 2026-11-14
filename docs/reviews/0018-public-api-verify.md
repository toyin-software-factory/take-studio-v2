# Verify: Public API, spec 0018

**Verdict: met in code and tests, one production check still owed. Scope row 13 and spec 0018 stay open for now.** Every acceptance criterion has a passing test on main. Step 9 of the build plan (a real run by key, and a revoke in production) is the only thing left, and it needs a production account, which we do not use without Toyin saying "ready" (C-31). Once someone runs it, row 13 can move to done and the spec to Accepted.

Run on 2026-11-14 on branch `b2-t88-verify-public-api`, main at `47ff009`, against the local test database. Synthetic keys and data only. No production sign in. Playwright cannot run in this sandbox, so the browser specs were read, not run. CI runs them on every PR.

Run here: 12 unit and database test files for this spec plus the legal and cleanup checks, all pass (153 of 154 first, the one failure was a stale `node_modules` missing `@better-auth/oauth-provider`; after `pnpm install` the parity file passes 32 of 32). `pnpm legal:drift` is part of CI.

## Result per acceptance criterion

| AC | Result | Evidence |
| --- | --- | --- |
| AC-1 create | Met | `api-keys-routes.test.ts`: 201 with the key once, only the hash stored, Origin 403, no session 401, bad body 422, 5 keys then 409 `key_limit`, concurrent creates never pass 5, per creator count, body over 4 KB refused. `tests/api-keys.spec.ts` drives it in the browser. |
| AC-2 format and storage | Met (one test added) | `api-rules.test.ts` (47 character format, SHA-256, prefix, parse), `db/data/api-keys.test.ts` (hash and prefix stored, hash unique). Header only: a key in the query string was not tested, so this PR adds "never reads a key from the query string" to `api-auth.test.ts`. The key never reaches a log, job payload, analytics event or URL: no code path puts it there, and the logging tests below check logs. |
| AC-3 list and revoke | Met | `api-keys-routes.test.ts` (list newest first, 204 then 404 on a repeat, another creator's and malformed IDs 404, Origin and session checks). `api-auth.test.ts` "a revoked key is refused on the very next request". The one write statement lookup is in `authenticateApiKey`. Revoke in production is part of step 9 (see below). |
| AC-4 session only | Met | `api-keys-routes.test.ts` "session only" (bearer beside a valid session is 401 `session_required`, Origin still first). `api-parity.test.ts` "Better Auth paths are session only" covers delete user, change email, change password and sign out. |
| AC-5 one identity entry | Met | `api-auth.test.ts`: any bad header is 401 `invalid_api_key` and the cookie is never read, same `Creator` either way, a deps object with no key support still refuses a header, "builds no session check of its own" in usage, takes and uploads. `api-parity.test.ts` checks every route file takes its creator from the shared guard. |
| AC-6 Origin order | Met | `api-auth.test.ts` "Origin": session write from another origin 403, bearer write skips Origin, a bad bearer beside a valid cookie and wrong Origin is 401. |
| AC-7 same limits and permissions | Met | `api-parity.test.ts`: every route compared by session and by key, a key of someone else gets 404, the spent allowance gives the same `limit_exceeded` body, usage numbers match. Allowance and hourly limits are the handlers' own code. |
| AC-8 coverage | Met | `api-registry.test.ts` compares each exported method and path of every `route.ts` against the registry and the typed exclusions, refuses `export *`, and keeps sign in, delete account and key management out of the public list. Email preferences stay public. |
| AC-9 rate limit | Met (one test added) | `api-auth.test.ts`: 120 a minute then 429 `Retry-After`, another key unaffected, sessions and unknown keys not counted, concurrent requests never over count, database clock. `api-rules.test.ts` for the window and `Retry-After`. The cleanup of old windows has a function test (`db/data/api-keys.test.ts`); this PR adds a check that `cleanup.ts` calls `purgeOldRateWindows` on every sweep. |
| AC-10 last used | Met | `api-auth.test.ts` "is set on the first use, then at most once an hour, and a failed check changes nothing". |
| AC-11 documentation | Met in tests, browser specs read only | `api-docs.test.ts`, `api-openapi.test.ts`, `api-schemas.test.ts` (every route has request and response schemas, JSON Schema for each), `robots.test.ts`, and `tests/api-docs.spec.ts` (public, indexable, axe, keyboard, phone, openapi.json, robots and sitemap). The response schemas are used by the parity test. |
| AC-12 creator screen | Met in tests, browser specs read only | `api-keys-screen.test.ts` and `tests/api-keys.spec.ts`: menu item, empty state, create by keyboard, copy, denied Clipboard fallback, leave warning, bad name, 6th key message, revoke dialog and focus return, failed revoke alert, phone width, axe. |
| AC-13 private and observable | Met | `api-keys-routes.test.ts` "writes the raw key, its hash and its prefix to no log" and `cache-control: private, no-store`; `api-auth.test.ts` "logs one api_key_rejected line with a reason only". |
| AC-14 account deletion | Met (one test added) | `db/data/api-keys.test.ts` deleted the user row directly. The spec asks for the real delete path, so this PR adds a case to `account/delete-user.test.ts` that deletes a user through Better Auth's `/api/auth/delete-user` and checks the keys and rate windows are gone. |
| AC-15 legal facts | Met | `src/lib/legal-facts.ts` has the API keys row, `legal-facts.test.ts` and `legal-text-hashes.test.ts` pass, `pnpm legal:drift` is part of CI. |
| AC-16 ready for MCP | Met | `resolveCreator` is exported from `api-auth.ts` and the MCP layer (`src/server/mcp/http.ts`) calls the shared `guard` from the same module; the registry is importable data. |

## Small gaps fixed in this PR

- AC-2: test that a key in the query string is never accepted (`api-auth.test.ts`).
- AC-9: test that the cleanup sweep calls `purgeOldRateWindows` (`built-in-backgrounds.test.ts`, with the other cleanup wiring checks).
- AC-14: account deletion through the real route removes keys and rate windows (`delete-user.test.ts`).

## Not done, and why

- **Step 9, real run in production (AC-3, AC-5, AC-7):** a script that goes from upload to download with only a key on a real take, and a revoked key that stops in production. It needs a production account and a real take. Not done here (C-31). Someone with a production sign in runs it, then row 13 can close.
- **Browser specs:** read, not run, here. CI runs them.

## Bigger gaps

None found. The rule that the key never appears in an analytics event or a job payload rests on there being no code that puts it there; there is no test that scans for it.

## Scope and spec

Not changed: row 13 stays `planned` and spec 0018 stays `Proposed` until the step 9 production run is done.
