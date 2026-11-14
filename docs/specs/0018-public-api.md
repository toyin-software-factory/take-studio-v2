# 0018. Public API

**Date**: 2026-11-14
**Status**: Proposed

## Summary

A creator makes an API key in the app and a program or an AI agent uses it to do anything the web app does: upload a take, choose a background, run processing, review and undo cuts, fetch the video and transcript, delete a take. The API is the web app's own routes, opened to a key, so the limits and the ownership rules are the same code and cannot drift. Keys are shown once, can be revoked at any time, and a documentation page plus a machine readable file describe every call. The MCP server (spec 0019) will be a thin layer on top of this.

## Context

Take Studio already has a complete creator scoped HTTP layer in `src/app/api` (spec 0004 onward): every route checks Origin on writes, then the session, then ownership in the query, and every limit (10 uploads an hour, 10 background changes an hour, the monthly allowance of spec 0014, change and retention rules) lives in the handlers or below them. The only thing that stops a program from using it is the way a request proves who it is: a browser session cookie plus an Origin header.

Feature 13 asks for "every web app action has an API equivalent with the same limits and permissions". A second set of endpoints would have to copy every rule and would drift. Feature 14 (MCP server) is built on this API, so the key check must be one reusable entry point, and the contract must be written down and tested, not implied by what the web app happens to call.

Forces: a key is a long lived secret, so it is stored hashed and shown once; a program has no browser, so the cookie and Origin checks cannot apply, but then nothing ambient (a cookie) may ever be accepted together with a key; the usage limit protects cost, so API use must spend the same allowance; the hosted Worker has no shared memory, so any per key rate limit lives in the database like the other limits; and a key is a new stored field that the privacy copy must state (spec 0015).

## Requirements

**User stories**:
- As a creator, I want to create an API key, see which keys I have and when each was last used, and revoke one so a leaked key stops working at once.
- As a developer or an agent acting for a creator, I want to do everything the web app does with a bearer key, so I can automate my videos.
- As a creator, I want a key to reach only my takes and to spend my own allowance, exactly like my browser session.
- As the product owner, I want one set of rules for the web and the API, and a written, tested list of which routes are public.
- As the builder of the MCP server, I want one function that turns a bearer key into a creator, and a documented, stable contract to call.

**Acceptance criteria**:
- **AC-1**: Create. A signed in creator (session, not a key) makes a key with `POST /api/keys` `{ name }` (1 to 60 characters, trimmed). The answer is 201 `{ id, name, prefix, key, createdAt }`; `key` is shown in this answer only and never again, anywhere. At most 5 keys per creator: a sixth is 409 `key_limit`. Origin 403, session 401, bad body 422.
- **AC-2**: Format and storage. A key is `tsk_` plus 32 random bytes in base64url (47 characters). Only its SHA-256 hash (hex, unique), the first 8 characters after `tsk_` as `prefix`, the name, `created_at` and `last_used_at` are stored. The key itself is never stored, logged, put in an error, a report, a job payload, an analytics event or a URL. A key is accepted only in the `Authorization: Bearer` header, never in a query string.
- **AC-3**: List and revoke. `GET /api/keys` (session) returns the creator's keys `{ id, name, prefix, createdAt, lastUsedAt }`, newest first, nothing secret. `DELETE /api/keys/{id}` (session, Origin) deletes the row and answers 204; another creator's, a malformed or a missing ID is 404 with the same body, and a repeat is 404. Revoking works on the next request: the key check reads the row every time, with no cache. Hyperdrive caches plain reads by default (about 60 seconds), so the lookup is one `UPDATE api_key SET last_used_at = CASE WHEN last_used_at IS NULL OR last_used_at < now() - interval '1 hour' THEN now() ELSE last_used_at END WHERE key_hash = $1 RETURNING id, creator_id` (a write, never cached), and the Hyperdrive binding also has caching turned off (see Configuration required).
- **AC-4**: Key management is session only. A bearer key can never create, list or revoke keys, delete the account or change its sign in, so a leaked key cannot mint more keys or lock the creator out. Those routes answer 401 `session_required` to a bearer request. Sign in, change email or password, sign out and delete account are Better Auth routes under `/api/auth/[...all]`, not routes of ours, so the rule is one line in `src/app/api/auth/[...all]/route.ts`: any request with an `Authorization` header gets 401 `session_required` before Better Auth runs (all auth paths, one rule), so the cookie is never read beside a bearer. A test per sensitive path (delete user, change email, change password, sign out) sends a valid session cookie plus a bearer header and expects 401.
- **AC-5**: One identity entry point. A request with an `Authorization` header is judged by the key alone: a valid key gives the creator, anything else (wrong, revoked, malformed, wrong scheme) is 401 `invalid_api_key`, and the session cookie is never consulted as a fallback. A request without the header is judged by the session exactly as today. Both end in the same `Creator` value (`{ db, creatorId }`) that the handlers already take. "Header present" means any `Authorization` header, even an empty one or another scheme. The handlers' bodies stay untouched, but the identity contract changes: `getCreator` can no longer return only `Creator | null`, since `invalid_api_key`, `session_required` and `rate_limited` (with `Retry-After`) must get out. The build adds `src/server/api-auth.ts` with `resolveCreator(request): Promise<Result<Creator, ApiAuthError>>` and ONE exported `guard(request, deps, { checkOrigin })` returning `Creator | Response`, which owns the 401, 403 and 429 bodies and `Retry-After`. The three hand written `getCreator` copies (`takes/deps.ts`, `uploads/deps.ts`, `usage/deps.ts`) and the guards in `takes/http.ts`, `uploads/http.ts` and `usage/http.ts` all call it. A test fails if any `*/http.ts` or `deps.ts` still builds its own session check.
- **AC-6**: Origin. A bearer request skips the Origin check (it carries no ambient credential, so there is nothing to forge). A session request keeps it on every write, unchanged. The order in the shared guard is: (1) `Authorization` header present at all: key path only (parse, hash, look up, rate limit), no Origin check, the cookie is never read; (2) header absent: Origin on writes, then the session, as today; (3) then ownership in the query. This changes the order in `src/server/AGENTS.md` (Origin, then session, then ownership), which /sync updates. Tests: a cross origin write with a cookie and no header is 403; a bogus header with a valid cookie is 401 `invalid_api_key`. The rule is in the shared guard, not repeated per route.
- **AC-7**: Same limits and permissions. A key reaches exactly what the session reaches: ownership still comes from the query (`eq(take.creatorId, creatorId)`), so another creator's take, background or job is 404 for a key too; the monthly allowance (spec 0014), the 10 uploads an hour, the 10 background changes an hour, `change_limit`, retention, `limit_exceeded` and every other check and error code are the handlers' own and identical. No handler has an API only branch. A test runs each public route once by session and once by key and compares status and body.
- **AC-8**: Coverage. Every route under `src/app/api` is listed in the public registry (`src/lib/api-registry.ts`: method, path, summary, which auth it takes, request and response shape, error codes) or in an explicit exclusion list with a reason (see below). The exclusions are a typed array in the registry module with a reason each (so the docs can print the session only routes): `auth/[...all]` (one entry covering sign in and delete account; there is no separate delete account file), `health`, `sentry-check`, `keys` and `keys/[id]` (reason: session only), and `openapi.json` (reason: it is the documentation itself, public and unauthenticated). The test compares each exported method and path of every `route.ts` under `src/app/api` against the registry and exclusions, not just the file, so a new POST in a file that already has a registered GET fails. A `route.ts` or method in neither fails, so a new web action cannot ship without an API decision. Account email preferences are public; delete account is not (it needs a fresh sign in, spec 0015).
- **AC-9**: Rate limit. Each key may make 120 requests a minute (a fixed window per key, counted in the database); the next is 429 `rate_limited` with a `Retry-After` header in seconds. The window is per key, so one noisy key cannot slow another. This is on top of the per route limits, and it protects the database, not cost. Session requests are not counted by it. Every authenticated key request counts, including the one that is refused. An unknown key is not counted (no key row exists; accepted risk, a 256 bit key cannot be guessed). The decision is one atomic statement, `INSERT ... ON CONFLICT (key_id, window_start) DO UPDATE SET count = api_rate_window.count + 1 RETURNING count`, never a read then a write. `Retry-After = 60 - secondsIntoUtcMinute`, at least 1. Old windows are deleted by a step added to `src/trigger/cleanup.ts` (batched, IDs only in logs, with a test).
- **AC-10**: Last used. A successful key check sets `last_used_at` at most once an hour per key, so reading a list is cheap and a key that nobody uses is visible. A failed check changes nothing.
- **AC-11**: Documentation. `/docs/api` is a public page generated from the registry (every public route, how to authenticate, the upload flow step by step, error codes, limits and a worked curl example of upload to download), and `/api/openapi.json` is the OpenAPI 3.1 file from the same registry, with request and response schemas. Registry entries own exported zod request AND response schemas in `src/lib/api-schemas/`; the handlers import the request schemas from there (a small refactor in step 4), and the parity test parses each real response with its response schema so the docs cannot drift. JSON Schema comes from zod 4's built in `z.toJSONSchema` (no new dependency). Both are indexable, need no sign in, and a test fails when either lacks a registered route. `PRIVATE_PATHS` in `src/lib/site.ts` includes `/api/`, so `robots.ts` also gets an Allow for exactly `/api/openapi.json` (more specific than `/api/`, with `robots.test.ts` updated), and `sitemap.ts` lists `/docs/api` (with a test); both are noted in `src/app/AGENTS.md`. The page states that the API is v1, additive changes only, and that a breaking change gets a new version path.
- **AC-12**: Creator screen. A signed in creator reaches "API keys" from the user menu: a list (name, prefix, created, last used), a create form, a "copy it now, it will not be shown again" panel after creating, and a revoke button with a confirm. The route is `/account/api-keys`, server rendered with the session (noindex, `force-dynamic`, in `PRIVATE_PATHS`); the user menu (`src/components/shell/user-menu.tsx`) gets an item with a key icon above Sign out. After create, focus moves to the show once panel; the key stays in component state only (never a URL, storage or an analytics event) in a read only, full width, monospace field that wraps (never truncated) with a Copy button, a select all fallback if the Clipboard API is denied, a polite status "Copied", a button "I have saved it" and a leave warning. List rows show name, prefix, created and last used ("Never used" when null), with a 44 px revoke button named "Revoke key {name}" that opens the existing confirm dialog pattern (`delete-take-dialog.tsx`) and returns focus to the list. There is an empty state, the `key_limit` message "You already have 5 keys. Revoke one to make another.", and name validation of 1 to 60 with an associated error. Keyboard use, visible focus, 44 px targets, AA contrast, a polite status message, a layout that holds at phone width.
- **AC-13**: Private and observable. Logs, errors, reports and job payloads carry the key row ID and the creator ID only, never the key, its hash or its prefix. A failed key check is an expected result (a typed `{ ok: false, error }`), not reported to the error monitor; it writes one log line `api_key_rejected` with a reason code only (no key, hash, prefix or IP), and a rejection has no key row, so it logs no ID. Responses to key routes are `Cache-Control: private, no-store`.
- **AC-14**: Account deletion removes the creator's keys with the user row (foreign key `ON DELETE CASCADE`, and a test through the real delete path). Keys are not exported anywhere else.
- **AC-15**: Legal facts. The build PR adds API keys to `COLLECTED` in `src/lib/legal-facts.ts` (a name, a hash and a last used time, kept until the creator revokes the key or deletes the account, and request counts per key per minute, kept about an hour), adds a plain line to the Privacy copy and a short API use line to the Terms (keep the key secret, the rate limit, the same allowance, no resale of access), bumps `LEGAL_VERSION` to the real date and appends a line to `legal-text-hashes.ts`. No new processor, cookie or env secret is added. The rule follows the checklist in `src/lib/AGENTS.md`.
- **AC-16**: Ready for the MCP server. `resolveCreator(request)` (AC-5) is exported from one module, and the registry is importable as data, so spec 0019 can wrap each registered route as a tool and send the user's key as the bearer without a change to this layer.

## Options considered

### Option 1: Open the existing routes to a bearer key (chosen)

The routes stay where they are. A shared guard reads either the session or a key and hands the same `Creator` to the handlers. A registry and tests make the public surface explicit.

**Pros**:
- One set of rules, so "same limits and permissions" holds by construction.
- Small: a table, a resolver, three key routes, a registry, docs and a screen. No new handler logic.
- The MCP server reuses it unchanged.

**Cons**:
- The web app's own routes become a public contract: their shapes cannot change freely (the registry test and the v1 rule are the guard).
- Two ways in through one door needs care (AC-5, AC-6 close the cookie and Origin gaps).

### Option 2: A separate `/api/v1` tree

New routes that call the same server functions.

**Pros**:
- The web app can change its own routes freely.
- A clean version prefix from day one.

**Cons**:
- Every handler's checks (Origin, errors, limits, messages) get written twice and drift; "same limits and permissions" becomes a promise tests must police route by route.
- About twice the surface to build, document and keep right.

### Option 3: Better Auth's API key plugin

Use a plugin for creation, hashing and verification.

**Pros**:
- Less key code to write.

**Cons**:
- Not in the installed `better-auth` (1.7.19) core; it would be a new dependency (legal facts, supply chain) for about 60 lines of code.
- Its rate limit and metadata model would replace choices this spec wants plain (database counter, no extra stored fields).

## Decision

**Chosen option**: Option 1: Open the existing routes to a bearer key.

Keys are our own table with a hashed secret, resolved by one function that the shared guard uses; no new dependency; the registry is the public contract.

**Implementation skills**: `better-auth-best-practices` (`better-auth/skills`, `.claude/skills/better-auth-best-practices/`) · `better-auth-security-best-practices` (`better-auth/skills`, `.claude/skills/better-auth-security-best-practices/`) · `workers-best-practices` (`cloudflare/skills`, `.claude/skills/workers-best-practices/`)

## Rationale

The routes already hold every rule the feature promises (ownership in the query, the allowance, hourly limits, retention), so the only honest way to promise "the same" is to run the same code. Option 2 repeats it; Option 3 adds a dependency for little code. A key is a long lived secret, so it is hashed with SHA-256 (the key is 256 bits of randomness, so a slow password hash adds nothing) and shown once; the cookie is ignored whenever a bearer header is present so the two ways of proving identity can never combine into a confused request. Keeping key management session only is the one hard rule: a leaked key can do what the creator's videos allow, but cannot create more keys, lock the creator out or delete the account.

## Feature design

**Data model sketch**:

`api_key`
| Field | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `creator_id` | text not null, FK `user.id` ON DELETE CASCADE | indexed |
| `name` | text not null | 1 to 60, trimmed |
| `prefix` | text not null | 8 characters after `tsk_` |
| `key_hash` | text not null, unique | SHA-256 hex of the full key |
| `created_at` | timestamptz not null | |
| `last_used_at` | timestamptz null | set at most hourly |

`api_rate_window`
| Field | Type | Notes |
|---|---|---|
| `key_id` | uuid, FK `api_key.id` ON DELETE CASCADE | |
| `window_start` | timestamptz | minute, truncated |
| `count` | integer | upsert `count + 1` |
| | | pk (`key_id`, `window_start`); rows older than 1 hour are deleted by the existing cleanup sweep |

Revoke is a hard delete, so there is no `revoked_at` and no history of revoked keys to keep or explain. The count of keys per creator (max 5) is enforced in the create transaction after locking the creator row (the same lock order as uploads, see `lock-order.test.ts`).

**State transitions**: none (a key exists or it does not).

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/keys` | POST | `name` | 201 `id, name, prefix, key, createdAt` | session, Origin | 401, 403, 409 `key_limit`, 422 |
| `/api/keys` | GET | none | `keys[]` | session | 401 |
| `/api/keys/{id}` | DELETE | none | 204 | session, Origin | 401, 403, 404 |
| every route in the registry | as today | as today | as today | session or bearer | as today, plus 401 `invalid_api_key`, 429 `rate_limited` |
| `/docs/api` | GET | none | page | public | none |
| `/api/openapi.json` | GET | none | OpenAPI 3.1 | public | none |

The public registry covers: uploads (create, part links, complete, abort), takes (list, detail, retry, delete), media links (preview and download), transcript (read, make, download, fix undo), backgrounds (library list, upload, complete, delete, change for a take, preview), changes (cuts and background, job status, waveform), missed marks, account email preferences and usage.

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Create key | `key` | 32 bytes from `crypto.getRandomValues`, shown once in the 201 |
| Create key | `prefix` | first 8 characters after `tsk_` of the generated key |
| Create key | `key_hash` | SHA-256 of the full key (Web Crypto) |
| Create key | `creatorId` | the session user (never a body field) |
| Any bearer request | creator | `api_key.creator_id` found by `key_hash` of the bearer value |
| Rate limit | window | the current minute (UTC), from database `now()` |
| Rate limit | limit and `Retry-After` | constants in `src/lib/api-rules.ts` (`API_KEYS.maxPerCreator` 5, `API_RATE.perMinute` 120); `Retry-After` is seconds to the next minute |
| Create key | `id` and `created_at` | `gen_random_uuid()` and database `now()` |
| Create key | the 5 key lock | `SELECT ... FROM "user" WHERE id = $1 FOR UPDATE` (as in `db/data/backgrounds.ts`); duplicate names are allowed, the prefix tells keys apart |
| Last used | `last_used_at` | the one statement in AC-3, using database `now()` (two requests at once write at most once) |
| Docs and OpenAPI | route list, shapes, errors | `src/lib/api-registry.ts` and the zod schemas the routes parse with |
| Docs | the base URL | `BETTER_AUTH_URL` (already set), never typed by hand |

**Key invariants**:
- A key is never stored, logged or returned after creation; only its hash is stored.
- Bearer present means cookie ignored; bearer absent means session as before.
- The handlers contain no code that knows whether the caller used a key or a session (except the Origin rule in the shared guard and the session only routes).
- At most 5 keys per creator; `key_hash` is unique.
- Every `route.ts` under `src/app/api` is registered public or excluded with a reason (AC-8).

**Security model**: A key acts as its creator: it can read and change that creator's takes, backgrounds and settings the web app allows, and nothing else. It cannot manage keys, sign in, delete the account or reach another creator's data (404, same as the session). Compare keys by hash lookup (no timing leak on the secret). A bearer request has no CORS headers: the API is for servers and agents, and a browser page cannot call it with a key from another origin. All transport is HTTPS. Compliance scope: a key row is personal data tied to an account (spec 0015), see AC-15.

**Configuration required**: Hyperdrive query caching turned off on the binding (`wrangler hyperdrive update <id> --caching-disabled`; Michael to confirm, then record it in `scripts/AGENTS.md`). The lookup is a write anyway, so a cached read cannot keep a revoked key alive, but step 9 also runs a revoke test in production. No new secret: the hash needs none (the key is high entropy), the base URL is `BETTER_AUTH_URL`.

**Critical test scenarios**:
- Happy path: create a key, upload a take, run it, fetch the transcript and the video link, delete the take, all by key, verifies **AC-1**, **AC-5**, **AC-7**
- Failure case: a revoked key answers 401 on the very next request, verifies **AC-3**
- Failure case: bearer with a valid session cookie but a wrong key is 401 (no fallback), verifies **AC-5**
- Failure case: the 121st request in a minute is 429 with `Retry-After`; another key is unaffected, verifies **AC-9**
- Auth/permission: a key for creator A gets 404 on creator B's take, background and job, verifies **AC-7**
- Auth/permission: a key on `POST /api/keys`, `DELETE /api/keys/{id}` and the Better Auth paths (delete user, change email, change password, sign out), also with a valid cookie beside it, is 401 `session_required`, verifies **AC-4**
- Order: a cross origin write with a cookie and no header is 403; a bogus header with a valid cookie is 401 `invalid_api_key`, verifies **AC-5**, **AC-6**
- Same rules: monthly allowance spent through a key refuses with the same `limit_exceeded` body as the session, and the hourly upload limit counts both together, verifies **AC-7**
- Parity: the real `route.ts` modules are called with `Request`s carrying a cookie versus a bearer key against the test database, each route with its own freshly seeded state, comparing normalized status and body (ids, timestamps and presigned URLs dropped) and parsing each response with its response schema; the hourly limit "counts both together" check seeds the counter instead of making 10 calls, verifies **AC-7**
- Coverage: adding a `route.ts` without a registry or exclusion entry fails the test, verifies **AC-8**
- Docs: the page and `openapi.json` list every registered route, verifies **AC-11**
- Privacy: the key never appears in logs, a failed response or the list, verifies **AC-2**, **AC-13**
- Cleanup: deleting the account deletes its keys, verifies **AC-14**
- Browser: create, copy, list and revoke by keyboard, axe clean, phone width, verifies **AC-12**

## Build plan

Approach: Tracer Bullet. First one key through one real route end to end, then widen to every route, then the screen and the docs.

1. Migration and rules: `api_key`, `api_rate_window`, `src/lib/api-rules.ts` (limits, key format helpers: generate, hash, prefix, parse), the cleanup of old rate windows in `src/trigger/cleanup.ts` with a test, unit tests including the key format and the hash, satisfies **AC-2**, **AC-9**, **AC-14**
2. Key data functions and routes: create (with the 5 key lock), list, revoke, session only, tests through the real handlers, satisfies **AC-1**, **AC-3**, **AC-4**, **AC-13**
3. The tracer thread: `src/server/api-auth.ts` (`resolveCreator` returning a `Result`, and the one `guard` with the Origin order of AC-6), the `auth/[...all]` bearer rejection, rate window and last used, pointing the three `deps.ts` files and the takes, uploads and usage guards at it (so the tracer touches all three guards), with the no private session check test and a live check by key, satisfies **AC-5**, **AC-6**, **AC-9**, **AC-10**, **AC-16**
4. Widen the guard to every remaining route in the registry (the guard calls and deps type change, the handler bodies stay untouched), move request schemas into `src/lib/api-schemas/` with response schemas, the by session and by key parity test (real routes, seeded state), the permission and allowance tests, satisfies **AC-7**
5. The registry (`src/lib/api-registry.ts`), the coverage test per method and path, and the typed exclusion list with reasons, satisfies **AC-8**
6. `/docs/api` and `/api/openapi.json` generated from the registry and the schemas, the robots Allow and sitemap entry with tests, the worked upload to download example, satisfies **AC-11**
7. The "API keys" screen from the user menu (Mobbin is unavailable, C-39: use the existing tokens and dialogs and note it in the PR), browser tests and axe, satisfies **AC-12**
8. Legal facts, Privacy and Terms copy, `LEGAL_VERSION`, hash line, `pnpm legal:drift` clean, satisfies **AC-15**
9. Real run: a script uses only a key to go from upload to download on a real take, and a revoked key stops in production too, satisfies **AC-5**, **AC-7**, **AC-3**

## Consequences

**Positive**:
- Programs and agents can do everything a creator can, with the same protections and no second rulebook.
- The MCP server becomes a small adapter.
- The registry test stops a new web action from silently missing the API.

**Negative / tradeoffs**:
- The web routes become a public v1 contract; changing a shape now needs a version path or an additive change.
- One shared guard carries more weight: a mistake there affects every route, so it has the heaviest tests.
- Each API call costs a key write plus a rate window write through Hyperdrive.
- A leaked key can run up the creator's own allowance and delete their takes until revoked; the mitigations are the monthly allowance, the rate limit, the 5 key cap, last used times and instant revoke.

**Neutral**:
- A key row is a new stored personal field (AC-15); no new processor, cookie or env secret.
- Keys do not expire by themselves; a creator revokes them.

## Follow-up

- [ ] Questions for Toyin, sent to Michael as numbered options (this spec builds the recommended default of each until she says otherwise): (1) who gets keys: every signed in creator (recommended) or only paying ones later; (2) API use spends the same 60 free minutes as the web app, no separate price (recommended) or a separate API allowance; (3) the API docs are public and indexable (recommended) or behind sign in; (4) key management and delete account stay session only, so an agent can never remove the account or create more keys (recommended).
- [ ] Spec 0019 (MCP server) decides how an AI assistant proves who the creator is: the creator's own key as the bearer (works with this spec as is) or a sign in flow per assistant. If read only keys are wanted for assistants, add a `scope` column then; this spec ships full access keys only.
- [ ] Optional later: key expiry, per key allowance, an event for "API call" in the analytics (not built: it needs a new event, a legal facts line and Toyin's say), CORS for browser clients, usage and last 24 hour call counts per key on the screen.
- [ ] `/sync` adds the key rules to `src/server/AGENTS.md`, `src/lib/AGENTS.md` and `src/db/AGENTS.md` once built, and root `AGENTS.md` context list if a new area appears.

## References

**Project sources**:
- Specs 0002 (data model, locks), 0004 (core take loop routes), 0014 (monthly allowance), 0015 (privacy and terms, the legal checklist)
- `src/server/AGENTS.md` (route pattern, Origin then session then ownership), `src/server/takes/deps.ts` (`getCreator`), `src/server/auth.ts`, `src/lib/AGENTS.md` (legal change checklist)
- Commitments C-28 (scope order), C-30 (the recommended option stands unless Toyin says otherwise)

**Practices and standards**:
- Store only a hash of a high entropy bearer secret and show it once
- Credentials in the `Authorization` header only, never in a URL
- Bearer authentication needs no CSRF defence; never accept an ambient credential beside it
- Fixed window rate limit with `Retry-After`
- OpenAPI 3.1 as the machine readable contract
