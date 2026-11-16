# Verify: guest result route GET /api/guest/take (B2-T182, PR #384), 2026-11-16

**Spec**: `docs/specs/0023-upload-first-sign-in-after.md`, AC-10 and G30, build plan step 12.
**Verdict**: PASS for everything that runs locally. One path needs a deployed check (listed below).

## How it was run

`next dev` on port 3111 against the local Postgres and the real `.env` R2 settings. A synthetic guest, claim, two takes (one `ready` with a latest render row, one `uploaded`) and a job were inserted with SQL, then removed after the run. Requests were made with curl and the `ts_guest` cookie. No real video or personal data was used.

## Results

| Case | Request | Got | Expected |
|---|---|---|---|
| No cookie | GET, no cookie | 404 `not_found` | 404 |
| Unknown cookie | `ts_guest=nope` | 404 `not_found` | 404 |
| Own newest take, still uploaded | GET with cookie | 200 `{"status":"uploaded","playUrl":null,"expiresInSeconds":null}` | 200, no link |
| Own ready take by id | `?takeId=<id>` | 200 `{"status":"ready","playUrl":null,...}` (the render file is not in R2, so no link) | 200, no link when the file is missing |
| Bad `takeId` | `?takeId=zzz` | 404 | 404 |
| Take that does not exist | random uuid | 404 | 404 |
| Expired guest | claim expiry in the past | 404 | 404 |
| Claimed guest | `claimed_at` set | 404 | 404 |

Every refusal has the same body, so a caller cannot tell "not yours" from "not there". All responses carried `cache-control: private, no-store`. The ready case made a real R2 head call (about 200 ms, no `storage_error`), so the storage client and keys work from this route.

## Needs a deployed check

- **The play link itself.** It needs a real rendered file in R2, and the sandbox does not write to the shared bucket. On a deployed environment: upload as a guest, wait for `ready`, call the route, and confirm `playUrl` plays inline and stops working after `expiresInSeconds` (3600).
- The link not leaking into logs (Sentry and Worker logs) is a deployed check as well.

## Also covered by tests

`src/server/guest/guest-take.test.ts` (6 tests) covers the ready take with a link (exact keys), other guest's take, account's take, expired video, and a storage error (503). Lint, typecheck, check:lines and `vitest run src/server src/lib` were green.
