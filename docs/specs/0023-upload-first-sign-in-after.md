# 0023. Upload first, sign in after

**Date**: 2026-11-15
**Status**: In Progress

## Summary

A visitor drops a video on the homepage and it starts uploading at once, with no account. While it uploads and processes, the page asks for an email. That email gets the sign in link (the magic link), and opening it claims the take into a real account. The upload is held under a short lived guest record, capped hard against abuse, charged to the same 60 free minutes, and deleted after 24 hours if nobody claims it.

## Context

Today every homepage button goes to `/sign-in`, so a visitor must hand over an email before they see any value. The growth idea is to flip the order: show the result first, ask for the email while the work runs.

Three forces shape it. A take must have an owner (`take.creator_id` is NOT NULL and `createUpload` needs a creator), so an anonymous upload needs a holder. Processing costs real money (Deepgram, Claude, ffmpeg), and an open door invites abuse. And the email is personal data, so everything stored before sign in must be small, short lived and listed in the legal facts.

## Requirements

**User stories**:
- As a visitor, I want to drop my video and watch it get processed before I make an account, so I can see the value first.
- As a visitor, I want to type my email while the upload runs, so I lose no time.
- As a visitor, I want to open the sign in link on my phone even if I dropped the video on my laptop, and still get my take.
- As the team, I want anonymous uploads capped and short lived, so they cannot run up cost or hold data for long.

**Acceptance criteria**:
- **AC-1**: A signed out visitor can choose or drop a video on the homepage and the upload starts without an account, after an invisible Turnstile check passes.
- **AC-2**: While the upload and processing run, the page asks for one email and sends one magic link to it. No other email is sent to an unclaimed address.
- **AC-3**: Opening the magic link in the same browser lands on the take, now owned by the signed in account.
- **AC-4**: Opening the magic link on another device also claims the take, because the signed in email matches the email typed at upload. If the upload is still running on the first device when the link is opened, the claim is parked and finishes when the upload completes (the `/claim` page waits and polls the take, which answers 404 until it moves), and the first device keeps its upload access until then.
- **AC-5**: Signing in with a different email and without the guest cookie does not claim the take. The page shows a calm "no upload found" message.
- **AC-6**: Anonymous uploads are limited to 500 MB, 3 minutes of video, 1 active guest upload per browser, 3 per network address per day and a global daily minutes budget. A kill switch setting turns the feature off. A refused drop shows a friendly reason.
- **AC-7**: Processing starts after the upload finishes, before the email is confirmed. The take ready email is sent only to a claimed account. A take that finishes before the claim needs no email, because the claim lands on it.
- **AC-8**: While a guest take is unclaimed, its processing minutes count only against the global guest budget (`guest_daily_minutes`) and never against any email's 60 free minutes, so typing someone else's address cannot use up their allowance. When the take is claimed by a verified account, its minutes are added to that account's usage. A guest take that would exceed 60 minutes on its own is refused whole, like a signed in take. If the claim puts the account over 60 minutes, the take is kept and the next take is refused (the same gap as the usage backfill). Every guest take reserves its probed minutes against `guest_daily_minutes` right after the probe (the length is only known once the upload finishes) and before any job can start, and is refused when the budget is spent, whatever the claim timing, so a parked claim never skips the global cap. A claim never releases that reservation. It changes only which usage hash the minutes are charged to. A take is charged to an account exactly once, and which charge applies depends on when the claim lands. A claim after job start (the guest budget already took the minutes) moves the take and adds those minutes to the account. The take is already processed, so it is always kept whole and the ceiling is not applied to it, even when the added minutes take the account past 60 (an account at 59 that claims two finished 3 minute takes ends at 65). That overshoot is bounded by the guest caps (at most 3 takes of 3 minutes per network address per day), and from then on the account is at or over 60, so the next take is refused. A claim before job start (a parked claim finishing at upload complete, so the length is not known yet) moves the take with no charge, and job start then charges the account those minutes once, and the guest reservation made after the probe stays in place. In both cases the 60 minute account ceiling is skipped for a take that came from a guest drop only while the account is under 60 minutes before that take is charged, so a 3 minute take claimed by an account at 59 minutes is kept. A guest take whose job starts when the account is already at or over 60 minutes is refused the same way as a signed in take, so a second guest take claimed straight after is refused, and so is the next take. The refusal of a single take over 60 minutes happens at the drop, as above, and the guest take flag (`take.guest_origin`, set at the drop and cleared never) tells job start to allow the one take that crosses the ceiling, and nothing after it.
- **AC-9**: An unclaimed guest upload, its file, rows, typed email and guest record are all deleted 24 hours after the drop. A claimed take follows normal retention.
- **AC-10**: A guest holds no session and can reach only the upload routes for their own take, a view only result route for that same take (status and a short lived link to play the finished video, no download, no transcript edit), and the claim. No library, no other take.
- **AC-11**: The cookie, new stored fields, Turnstile and retention are in `src/lib/legal-facts*.ts`, the Privacy and Terms copy, and `LEGAL_VERSION`, and `pnpm legal:drift` is clean.
- **AC-12**: Four new analytics events record the funnel with enum props only. No email, file name or address appears in any event.
- **AC-13**: The drop zone works by keyboard, announces progress to screen readers, has 44 px targets and meets WCAG AA. Errors are friendly and name the next step.

## Options considered

### Option 1: Guest user row plus a claim record

At the first drop, create a `user` row marked `guest` (placeholder address, no sign in method) and a `guest_claim` row. Reuse `createUpload` unchanged with the guest id as creator. On claim, move the takes to the real account and delete the guest.

**Pros**: the whole upload, probe and process path works as is. Small change surface.
**Cons**: guest rows must be kept out of every user count, and the signup event must not fire for them.

### Option 2: A separate anonymous take table

Keep anonymous uploads in their own tables and copy into `take` on claim.

**Pros**: no fake users.
**Cons**: duplicates the upload, probe, process and cleanup paths, and every later feature must handle two shapes.

### Option 3: Better Auth anonymous plugin

Let the library create an anonymous session, then link accounts on sign in.

**Pros**: ready made.
**Cons**: gives a real session to an unknown visitor, which widens what a guest can reach (against AC-10), adds a plugin and a cookie we do not control, and still needs our own claim and cleanup rules.

### Option 4: Hold the file in the browser until sign in

**Pros**: nothing stored server side.
**Cons**: this removes the whole point, since processing cannot run while the visitor types the email, and large files in a closed tab are lost.

## Decision

**Chosen option**: Option 1: Guest user row plus a claim record.

Recommendations for each C-30 point, in short:

- **(a) Where it lives and how it is claimed**: guest `user` row plus `guest_claim` row. The guest holds an httpOnly cookie `ts_guest` (a random token, only its hash stored). Claim succeeds if the signed in email matches the typed email (works on any device) or the cookie matches (same browser, any email).
- **(b) Abuse limits**: Turnstile before the first byte, 500 MB, 3 minutes, 1 active upload per cookie, 3 per network address (hashed) per day, a global budget of 600 guest minutes per day, and a kill switch. Processing runs before the email is confirmed, because waiting for the click removes the wow moment.
- **(c) The 60 free minutes**: an unclaimed take is charged to the global guest budget only. At claim, its minutes join the verified account's usage. An unverified email is never charged.
- **(d) Retention**: 24 hours for unclaimed, deleted by the existing cleanup sweep and delete queue.
- **(e) Legal facts**: one new cookie, four new stored fields (typed email, email hash, address hash, cookie token hash), Turnstile listed, copy and version updated.
- **(f) Analytics**: `guest_drop`, `guest_email_added`, `guest_claimed`, `guest_expired`.
- **(g) Fit**: the existing multipart routes accept a guest as the creator. The magic link goes through the existing Better Auth plugin with a `/claim` callback.

### Choices C1 to C6, taken as recommended (C-30, B2-T169)

Toyin said all open questions take the recommended option (C-30). Each is recorded here so the build does not guess. The reasoning is in `docs/reviews/0023-spec-crosscheck.md`.

- **C1**: yes. A sign in whose verified email matches the typed address can claim the take, only together with the C5 confirm step, and only by the email match (never the cookie). Built in step 5.
- **C2**: a guest can send at most 5 sign in links in total (step 4).
- **C3**: no minutes cap per network address. The 3 drops a day and the 600 minute daily budget stay the only limits.
- **C4**: a second drop is allowed once the first is past `uploading`, and it counts against the 3 a day for the address.
- **C5**: option B. When only the email matched, a confirm click ("A video was added with your email. Add it to your library?") comes before anything moves or is charged. The cookie match needs no confirm.
- **C6**: the legal review is scheduled before the step 9 PR merges. `pnpm test:legal-launch` stays red for the new facts until Toyin's facts and the lawyer's review are recorded again.

### Where steps 1 and 2 stop (B2-T169)

Step 2 builds the thin thread: Origin check, body check, 500 MB cap, Turnstile, one transaction that makes the guest user, the claim and the `guest_origin` take, the multipart start, and the `ts_guest` cookie. Step 3 owns every other limit: the kill switch (`guest_upload_enabled`), the active upload check (`guest_busy`), the per address count, the daily minutes budget and the probe duration check. The Turnstile keys are `TURNSTILE_SECRET_KEY` (required to accept a drop) and `TURNSTILE_SITE_KEY` (the browser widget). With no secret, no address header or an unreachable check, the route refuses with 503 `guest_unavailable`, so it fails closed. Only `parts`, `complete` and `DELETE /api/uploads/{takeId}` accept the cookie, and only for the guest's own take.

**Implementation skills**: `better-auth-best-practices` (`better-auth/skills`, `.claude/skills/better-auth-best-practices/`) · `better-auth-security-best-practices` (`better-auth/skills`, `.claude/skills/better-auth-security-best-practices/`) · `workers-best-practices` (`cloudflare/skills`, `.claude/skills/workers-best-practices/`)

## Rationale

Option 1 keeps one upload path, which matters because the multipart rules in `src/server/uploads/AGENTS.md` are strict and already tested. Option 3 hands strangers a session, and AC-10 wants a guest to reach almost nothing. Matching the typed email makes the other device case work without putting a secret in the link, and the cookie covers a visitor who signs in with Google on a different address.

Charging only the global guest budget while unclaimed, and the verified account at claim, means a stranger cannot drain a victim's allowance by typing their address. Spec 0014 keys usage by email hash, so at claim we add the take's minutes under the account's hash, with no new counting model. A 24 hour life keeps stored personal data tiny compared with the 30 days for owned takes. We never email an unverified address beyond the single magic link, which the existing per email limit (3 per 15 minutes) already guards.

## Feature design

**Data model sketch**:
- `user.guest` boolean NOT NULL default false. A guest has email `guest-<uuid>@guest.invalid`, `emailVerified` false, no account row.
- `guest_claim`: `id` uuid PK, `guest_user_id` FK `user` ON DELETE CASCADE (unique), `token_hash` text NOT NULL, `email` text NULL (typed, lowercased), `email_hash` text NULL (usage hash), `ip_hash` text NOT NULL, `claim_user_id` text NULL (parked claim), `created_at`, `expires_at` (the last drop plus 24 h, moved forward on each drop, see "Cross check answers"), `claimed_at` NULL, `email_sends` int NOT NULL default 0.
- `guest_ip_day`: `ip_hash`, `day` (UTC date), `drops` int, primary key `(ip_hash, day)`. The daily address count reads this table, so claims (which delete the guest row) never reduce a count. There is no per address minutes column, because AC-6 sets no such limit. Rows older than 2 days are swept. The global total lives in one more table, `guest_budget_day` (`day` UTC date primary key, `reserved_minutes` int). Reservation runs in one transaction: the insert on conflict do nothing, the conditional daily update below, and the write of `guest_reserved_minutes` on the take, so a crash between them rolls all three back and the budget and the take never disagree. The conditional update is `UPDATE ... SET reserved_minutes = reserved_minutes + $m WHERE day = $d AND reserved_minutes + $m <= guest_daily_minutes` (the row is created first with an insert on conflict do nothing); no row updated means the budget is spent and the take is refused with the calm message. It reserves the probed `duration_ms` (in whole minutes, rounded up) before any processing job starts, so two takes at the same moment cannot both pass. The take row records the reserved minutes in `guest_reserved_minutes` (null once released). A failed or cancelled take releases its reservation in one transaction first reads and locks the old value (`SELECT guest_reserved_minutes FROM take WHERE id = $t FOR UPDATE`; null or no value means it was already released and nothing more happens), then clears it (`UPDATE take SET guest_reserved_minutes = NULL WHERE id = $t`) and subtracts the value it read from `reserved_minutes`, all in that one transaction (a `RETURNING` would give the new null, not the old value), so a take that fails and is then cancelled returns its minutes once (the second release updates no row). A finished take keeps it (what is charged is what was reserved, to the minute). A claimed take's reservation stays in the day's total (the budget is a rate limit on guests, not an account).
- `take.guest_reserved_day` date NULL, written in the same statement as `guest_reserved_minutes` and cleared with it, so a release subtracts from the day that was reserved (the UTC date of the reservation), not the day of the release.
- `analytics_event.creator_id` becomes nullable, so guest events survive the guest user being deleted (see "Cross check answers", analytics).
- `take.guest_origin` boolean NOT NULL default false, set when the take is created by a guest drop and never cleared. Job start reads it to skip the 60 minute account ceiling for a take that came from a guest drop (AC-8).
- Index on `expires_at` for the sweep.
- Setting keys: `guest_upload_enabled` (default true), `guest_daily_minutes` (default 600).

**State transitions**: claim: `open` (no email) → `emailed` (email typed, link sent) → `claimed` (takes moved, guest user deleted) or `expired` (swept at 24 h). A take keeps its normal states (`uploading` to `ready`).

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/guest/uploads | POST | `uploadCreateSchema` without `backgroundId`, `source`, `script`, plus turnstileToken (req) | takeId, partSize, partCount, sets `ts_guest` | none, Turnstile | 403 bot_check_failed or guest_budget_spent, 422, 429 guest_busy or address limit, 503 guest_paused or guest_unavailable |
| /api/uploads/[takeId]/parts, /complete, /[takeId] | POST, DELETE | as today | as today | session, else `ts_guest` owning the take (opt in `allowGuest`) | 401, 404 |
| /api/guest/take | GET | optional `takeId` (default the most recent) | `{ status, playUrl or null, expiresInSeconds }` (view only) | `ts_guest` | 401, 404 |
| /api/guest/email | POST | email (req) | ok | `ts_guest` | 422, 429, 503 EMAIL_SEND_FAILED |
| /claim | GET page | claim id in query | redirect to the take | session | calm "no upload found" |

**Value sourcing**:
| Action | Value | Source |
|---|---|---|
| Create guest upload | creator id | new guest user id |
| Create guest upload | ip_hash | `cf-connecting-ip` through a new `hashGuestIp` (HMAC SHA-256 with `USAGE_HASH_SECRET`, label `guest-ip:`, first 64 bits for IPv6); no header refuses the drop |
| Create guest upload | duration limit | probe result `duration_ms`, compared to 180000 |
| Email step | callbackURL | `/claim?c=<guest_claim.id>` |
| Claim | match | `email` (typed, lowercased) equals the lowercased verified signed in email, or `token_hash` equals hash of the cookie; `email_hash` is for charging only |
| Process charge | budget | reserved against the global `guest_daily_minutes` (`guest_budget_day`) after the probe, before job start, for every guest take; the claiming account's usage hash at claim or job start |
| Sweep | cutoff | `guest_claim.expires_at` |

**Key invariants**:
- A guest never has a session. The guest id is resolved only from the cookie, only for upload routes, `/api/guest/take` and `/api/guest/email`.
- Guest rows are excluded from user counts, founding member counts and the `signup` event (the guest is inserted with the database, not through Better Auth).
- Claim is one transaction: move takes, move events, mark claimed, delete the guest user. A second claim finds nothing and shows the calm message. If a take is still uploading, the claim sets `claim_user_id` and moves nothing; the upload complete route finishes the claim. Both routes first lock the same take row (`SELECT ... FOR UPDATE`) before they read the take status or `claim_user_id`, and the upload complete route checks `claim_user_id` while it holds that lock, so either order finishes the claim. If the parked upload fails or is cancelled instead, the same route that releases the reservation also clears `claim_user_id` and moves the take to the claimant when it is a failed take they can retry or delete, so the claimant's waiting state ends with the calm message "That upload didn't finish. Upload it again from here." and a link to the upload page (the take is moved so they can dismiss it from the library). A parked claim whose guest row expires without a finish leaves nothing behind (the sweep deletes the take, its file and the guest rows, and the `guest_claim` row with them), so the claimant sees the normal "no upload found" message, not the failure one, and the guest cookie keeps authorizing that upload until then. While a claim is parked, the claimant (signed in through the link) sees a waiting state on the `/claim` page itself: "Your video is still uploading. Keep this page open." The page polls `GET /api/takes/<id>` for the parked take every 5 seconds. The takes API is not changed: a take that has not moved yet belongs to the guest, so it answers 404 exactly like any unknown take (no hint that a guest take exists, covered by a test), and the first 200 means the claim finished, so the page goes to `/takes/<id>` (one take) or `/library` (several). The failed or cancelled case is approximated the same way: the failed take moves to the claimant, the poll turns into a redirect and the take page shows the normal failed state with its retry and delete. (Replaces the earlier `claim_pending` status idea, which would have changed the takes API.)

- **Claim race and the finish hook (step 5)**: a multipart upload that has been completed in storage stays `uploading` until the probe moves it. So the claim, while it holds the take row lock, asks storage (`headObject` on the original key) for each `uploading` take. The object exists: the upload is done, so the take moves now. No object: the claim parks it. This avoids a claim that waits forever because the complete route had already passed its own check. The complete route calls `finishParkedClaim` after the probe is dispatched (also on its early return for an already uploaded take), and the cancel route calls it after the fail transition. It locks the take then the claim row, moves the take if `claim_user_id` is set, and deletes the guest user when no take is left. It never throws, so the upload's own answer is not affected.
- The ready email goes only to `creator.email` of a non guest creator.
- Claimed takes keep their original `created_at`, and the 30 day retention clock does not restart.

**Security model**: Anonymous callers pass Turnstile (server side `siteverify` through plain `fetch`, response checked with zod). The cookie token is random 32 bytes, stored as a hash, httpOnly, secure, SameSite Lax, path `/`, 24 hours. Callers can act only on the take bound to their guest id (ownership check as in `src/server/uploads/AGENTS.md`). The claim checks email or token, never the claim id alone. Compliance scope: GDPR style duties for a stored email, address hash and cookie. All of it is in the legal facts with a 24 hour life.

**Configuration required**:
- `TURNSTILE_SITE_KEY` (public, page) and `TURNSTILE_SECRET_KEY` (secret, server): Cloudflare Turnstile. Tests use Cloudflare's published always pass test keys.

**Cross check answers** (from `docs/reviews/0023-spec-crosscheck.md`, each has one right answer in the code or in this spec, so the builder does not invent it; G numbers point to the review):
- **First drops (G2)**: with no cookie yet, two tabs could each make a guest. The page holds a cross tab lock (`navigator.locks`, `ts-guest-drop`) from the click until the cookie is set, and the drop transaction upserts the address row first, which serializes first drops from one address. A browser without Locks is bounded by the address limit of 3.
- **Cookie (G1 to G3)**: 32 random bytes, base64url in the cookie, SHA-256 hex stored. The route handler sets it (Better Auth does not). `Secure` only on https. Cleared when a claim finishes or a lookup finds it dead. A cookie whose guest is expired, claimed or gone counts as no cookie. The drop creates a new guest and overwrites it.
- **Guest row (G4, G5)**: id `crypto.randomUUID()`, name `Guest`, `takeEmails` false, `emailVerified` false. The magic link before hook rejects any address ending `@guest.invalid`. Build step 1 adds `guest = false` to every query over `user` that counts or lists people, with one shared test.
- **Existing routes (G6, G7)**: `guard` gets an opt in `allowGuest`, used only by `parts`, `complete` and `DELETE`. A header means key only. A session wins over the cookie only when it owns the take; if the session user does not own the take but the cookie's guest does (a parked claim, signed in on the first device), the cookie is used. Origin is still checked. `Creator` gains a `guest` flag. `POST /api/uploads` and its early usage check refuse a guest (403 `guest_use_guest_route`). Every other route ignores the cookie (401). The new routes are added to the API registry exclusions. `createUpload` gets a `maxBytes` option (500 MB for a guest), and the stored size check at complete still enforces the declared size.
- **Order of checks on the drop (G8 to G11)**: Origin, kill switch (503 `guest_paused`), body zod (422), size cap (422), a cheap look at the day's budget (advisory), Turnstile, then one transaction: lock the guest user (create it if there is no live cookie), the active check (a take in `uploading` gives 429 `guest_busy`, so two tabs cannot both pass), the per address count (upsert with `drops < 3`, counted when the take row is created, never decremented), then the multipart start, then the cookie. A refused drop before the transaction creates nothing and counts nothing. No `cf-connecting-ip` gives 503 `guest_unavailable` (fail closed).
- **Turnstile (G9, G10)**: `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` with `secret`, `response`, `remoteip`, 5 second timeout, zod on the body. `success: false` gives 403 `bot_check_failed`; a timeout, non 2xx or bad body gives 503 `guest_unavailable`. The widget resets and keeps the chosen file. `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are added to `src/lib/env.ts`, `.env.example`, the deploy env list and CI in step 2. The secret is a Worker secret.
- **Length and budget (G14, G15, G20, G21)**: one function `reserveGuestMinutes` runs where the probe result is written, before any job exists. The predicate is `take.guest_origin`, never the creator's `guest` flag, so a take already moved to a claimant is still checked. Over 180000 ms fails the take with `guest_too_long`; a spent budget fails it with `guest_budget_spent`. Both are new failure codes in the registry, are not refundable and queue the original for deletion. The browser also checks the length early as advice only. The kill switch refuses new drops only; takes already dropped finish. Step 3 owns every limit and the reservation and its release. Step 6 owns the account side.
- **Settings (G16)**: `src/lib/guest-rules.ts` with `parseGuestSettings` modelled on `parseUsageSettings` (`guest_upload_enabled` boolean, default true; `guest_daily_minutes` non negative integer, default 600; anything else falls back to the default). Read at drop time and at reservation time. No rows are seeded.
- **Account charge (G19)**: job start for a guest creator skips `chargeUsage` and leaves `chargedAccountHash` null, because the guest email hash is junk. A claim after job start charges the job's stored `secondsCharged` (seconds, not the reserved minutes) to the claimant, for each initial job not refunded, and writes `chargedAccountHash` so a later refund works. A failed or refunded job charges nothing.
- **Emails (G22)**: `notify.ts` and the failed job email return early for a guest creator (explicit guard, tested), not only because `takeEmails` is false.
- **Email step (G23, G24)**: `POST /api/guest/email` stores the lowercased email and hash, goes through `auth.api.signInMagicLink` (so the 3 per 15 minutes slot and the 10 per hour rule apply), and passes `/claim?c=<id>` as both `callbackURL` and `newUserCallbackURL`. A second call replaces the stored email, so an earlier link no longer matches by email on another device; it still claims in the same browser through the cookie until it expires.
- **`/claim` outcomes (G25 to G27)**: no session redirects to `/sign-in` with `/claim?c=<id>` as the return path. A cookie match runs the claim at once. A verified email match without the cookie (the exact lowercased typed address, not the usage hash) shows the C5 confirm step first and moves and charges nothing until the click (if Toyin picks option A of C5 it runs at once); one take redirects to `/takes/<id>`, several to `/library`. No match, or an unknown or already claimed id, shows the calm message with a library link. An unverified email never matches by email. The claim moves every take not in `uploading` at once, and an `uploading` take whose object already exists in storage (see "Claim race"), and parks only the rest. For each take it moves, the claim locks the take row `FOR UPDATE` first, then reads its jobs, then moves and charges, the same order as job start. It moves `take.creator_id`, the guest's take analytics events and the job charge hashes. R2 keys do not contain the creator id, so no file moves. The parked flag lives on `guest_claim`, and the complete route deletes the guest user when no take of that guest is left.
- **Expiry (G18, G28)**: the sweep deletes each unclaimed guest take at `take.created_at + 24 h`. `guest_claim.expires_at` is the last drop plus 24 h, and the guest user and claim row go when that passes and no take is left. It runs before the delete queue drain in `cleanupTask`. Per take, in one transaction: lock, read the upload id and active run ids, `deleteTakesInTx`. After commit: cancel runs, abort the multipart upload (a failure is logged and left to the R2 lifecycle backstop), record `guest_expired`. The budget reservation stays. `guest_ip_day` and `guest_budget_day` rows older than 2 days are deleted in the same step.
- **Analytics (G17)**: `guest_drop`, `guest_email_added` and `guest_expired` are written with a null `creator_id`, `guest_claimed` under the claimant. Props are enums only: `guest_claimed` has `via` (`email` or `cookie`) and `timing` (`before_start`, `after_start`, `parked`), `guest_expired` has `hadEmail` (boolean), the other two none. All four have `oncePer: null` and fire after commit through `recordEvent`. The four names are added to the closed list in `src/lib/analytics-events.ts`.
- **Result route (G30)**: `GET /api/guest/take` returns `{ status, playUrl or null, expiresInSeconds }` for an optional `takeId`, default the most recent. The link is a presigned R2 GET with the same lifetime as the signed in media route. "No download" means no download button, not a technical guarantee.
- **Legal (G31)**: list the four stored fields, the cookie, Turnstile as a service that sees the visitor's address and browser signals, the 24 hour life and the 2 day life of the count rows. The "only cookie" comment and test in `legal-facts` change. `LEGAL_VERSION` changes, and `pnpm test:legal-launch` needs the new facts recorded.
- **Sign in email copy (G32)**: the same template plus one line for a guest, "You dropped a video on Take Studio. This link adds it to your account." Never a file name or title. Copy for Toyin to approve.

**Choices for Toyin** (no single right answer, listed in the review as C1 to C6; the builder takes the recommendation unless told otherwise): (C1) also claim on any sign in whose verified email matches a waiting guest, not only on `/claim`, recommended yes only together with C5, and dropped if C5 is rejected; (C2) at most 5 magic link sends per guest, recommended yes; (C3) no minutes cap per network address, recommended none; (C4) a second drop is allowed after the first is past `uploading`, recommended yes; (C5) a confirm click, on `/claim` and on a normal sign in, whenever only the email matched (not the cookie), recommended yes; (C6) record the new legal facts and the lawyer's review before the step 9 PR merges.

**Critical test scenarios**:
- Happy path: drop, type email, open link in the same browser, land on the ready take, verifies **AC-1, AC-2, AC-3, AC-7**
- Other device: open the link in a fresh browser context, take is claimed by email match, verifies **AC-4**
- Mismatch: sign in with another email, no cookie, nothing moves, verifies **AC-5**
- Limits: 501 MB, 4 minute video, second active upload, fourth drop from one address, daily budget, kill switch, verifies **AC-6**
- Usage: typing another person's email charges nothing to them, a take over 60 minutes is refused whole, a claim adds minutes to the account, verifies **AC-8**
- Early claim: open the link while the first device still uploads, the upload finishes and the claim completes, verifies **AC-4**
- Result view: the guest plays the finished render before claiming, cannot download or reach another take, verifies **AC-10**
- Expiry: after 24 hours the sweep deletes file, rows and guest, verifies **AC-9**
- Guest tries `/library` or another take, gets 401 or 404, verifies **AC-10**
- Added by the cross check, each shipped with the build step that owns it (database level unless noted): Turnstile fails and Turnstile unreachable (step 2); two tabs, one active upload, and a missing address header (step 3); a 4 minute video fails with `guest_too_long` and a spent budget fails with `guest_budget_spent` (step 3); a release after midnight UTC subtracts from the reserved day, and two concurrent reservations cannot both pass (step 3); the cookie sent to ten other routes returns 401 each (step 2); an unverified email does not match, and a claim with one finished and one uploading take moves one and parks one (step 5); job start skips a guest, a claim before start charges at job start, a claim after start charges the stored seconds, the ceiling skip applies only under 60, a failed job charges nothing, and a second guest take claimed straight after is refused (step 6); a guest take that finishes before the claim sends no email, and a failed job sends none to an unclaimed address (step 5); a second take at hour 23 survives until its own 24 hours, a claimed take keeps its `created_at`, and the multipart upload is aborted (step 7); the four event prop shapes and the nullable creator, and a guest in the signup and founding member counts changes nothing (steps 1 and 10); the expired link then normal sign in case follows choice C1 (step 5)
- Drift check and cookie test pass, verifies **AC-11**; event props contain no personal data, verifies **AC-12**; axe and keyboard pass on a phone and desktop, verifies **AC-13**

## Build plan

Tracer Bullet: one thin thread first (drop, claim, see the take), then thicken.

1. [x] Migration: `user.guest`, `guest_claim`, indexes, settings keys. Satisfies **AC-9, AC-10**
2. [x] Guest session helper, Turnstile verify, `POST /api/guest/uploads`, guest aware creator resolution on the existing upload routes. Satisfies **AC-1, AC-10**
3. Guest limits: size, count per cookie, per address per day, kill switch, probe duration check, and the daily budget reservation and its release (this step owns every limit that refuses a guest). Satisfies **AC-6**
4. [x] Email step: `POST /api/guest/email` with the existing magic link and `/claim` callback. Satisfies **AC-2**
5. [x] Claim transaction and `/claim` page. Satisfies **AC-3, AC-4, AC-5, AC-7**
6. [x] Usage, the account side only: job start skips a guest, the claim charges the account, and the `guest_origin` ceiling rule. Satisfies **AC-8**
7. [x] Cleanup sweep for expired guests through the existing delete path. Satisfies **AC-9**
8. Homepage drop zone and email step UI, with Mobbin checked and `design-check`. Satisfies **AC-1, AC-2, AC-13**
9. Legal facts, cookie list, Privacy and Terms copy, `LEGAL_VERSION`, text hash line. Satisfies **AC-11**
10. Analytics events and funnel on `/insights`. Satisfies **AC-12**. Also records `guest_expired` after the sweep: `deleteExpiredGuestTakes` (`src/db/data/guest-expiry.ts`) already returns `{ takeId, hadEmail }` per deleted take, and `sweepExpiredGuests` (`src/trigger/guest-expiry.ts`) is where to call `recordEvent` with a null creator. Adding the name needs the CHECK migration and the legal facts line (agreed with Michael)
11. Playwright end to end and `/check verify`. Satisfies **AC-1 to AC-13**
12. [x] Result route `GET /api/guest/take` (`src/server/guest/take.ts`): `{ status, playUrl, expiresInSeconds }` for the guest cookie's own take (optional `takeId`, else the most recent), inline play link only when the take is ready, one 404 for every refusal. Added after Dwight found no step owned G30. Satisfies **AC-10**

## Consequences

**Positive**:
- A visitor sees value before giving an email, and the email step costs no waiting time.
- One upload path, so every later improvement reaches guests too.
- Little personal data is held, for a short time.

**Negative / tradeoffs**:
- Guests cost real processing money before any commitment. The daily budget and kill switch cap it, and a determined abuser can still burn the budget (the feature then pauses).
- Fake user rows need care in every count, and a missed exclusion would skew metrics.
- Someone can type another person's email and trigger one magic link to them. The per email limit contains this, and it is the same exposure as `/sign-in` today.
- A claim can push an account past 60 minutes, because the minutes were spent before the account existed. We keep the take and refuse the next one, as with the backfill gap.

**Neutral**:
- Adds one cookie, one secret pair (Turnstile) and one table.
- The homepage hero changes, which spec 0010 owns, so that spec gets a short note when the UI task lands.

## Follow-up

- [ ] Toyin to confirm the numbers: 500 MB, 3 minutes, 24 hours, 600 guest minutes per day.
- [ ] Toyin to answer the six choices C1 to C6 (listed under Feature design and in `docs/reviews/0023-spec-crosscheck.md`).
- [ ] Confirm the published Turnstile behaviour on cookies when writing the legal copy.
- [ ] Step 9 (B2-T175): decide whether the Terms need guest upload wording (agreed with Michael on #377; the Terms name no service or cookie today). The ts_guest cookie and Turnstile are already in the Privacy copy.
- [ ] Add the guest drop zone to `docs/feature-map.md` when built.

## References

**Project sources**:
- Specs 0004 (uploads), 0006 (email sign in), 0010 (homepage), 0013 (retention), 0014 (usage limit), 0015 (legal facts), 0016 (analytics)
- `src/server/uploads/AGENTS.md`, `src/lib/AGENTS.md`
- Commitments C-30 (this task's asks), C-24, C-26

**Practices and standards**:
- Hash secrets and addresses at rest, keep the claim token only as a hash
- Verify a captcha token on the server, once, before any costly work

**Mobbin references (web)**:
- WeTransfer, send panel: the file picker and the email field sit on one card, and sign up comes after. Shapes our "file first, email next" card.
- Docusign, "Uploading a document" (flow 10684cb5): the file card shows "Finishing" progress while the next fields stay open below. Shapes our email field beside live progress.
