# 0023. Upload first, sign in after

**Date**: 2026-11-15
**Status**: Proposed

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
- **AC-4**: Opening the magic link on another device also claims the take, because the signed in email matches the email typed at upload. If the upload is still running on the first device when the link is opened, the claim is parked and finishes when the upload completes, and the first device keeps its upload access until then.
- **AC-5**: Signing in with a different email and without the guest cookie does not claim the take. The page shows a calm "no upload found" message.
- **AC-6**: Anonymous uploads are limited to 500 MB, 3 minutes of video, 1 active guest upload per browser, 3 per network address per day and a global daily minutes budget. A kill switch setting turns the feature off. A refused drop shows a friendly reason.
- **AC-7**: Processing starts after the upload finishes, before the email is confirmed. The take ready email is sent only to a claimed account. A take that finishes before the claim needs no email, because the claim lands on it.
- **AC-8**: While a guest take is unclaimed, its processing minutes count only against the global guest budget (`guest_daily_minutes`) and never against any email's 60 free minutes, so typing someone else's address cannot use up their allowance. When the take is claimed by a verified account, its minutes are added to that account's usage. A guest take that would exceed 60 minutes on its own is refused whole, like a signed in take. If the claim puts the account over 60 minutes, the take is kept and the next take is refused (the same gap as the usage backfill).
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
- **(e) Legal facts**: one new cookie, three new stored fields, Turnstile listed, copy and version updated.
- **(f) Analytics**: `guest_drop`, `guest_email_added`, `guest_claimed`, `guest_expired`.
- **(g) Fit**: the existing multipart routes accept a guest as the creator. The magic link goes through the existing Better Auth plugin with a `/claim` callback.

**Implementation skills**: `better-auth-best-practices` (`better-auth/skills`, `.claude/skills/better-auth-best-practices/`) · `better-auth-security-best-practices` (`better-auth/skills`, `.claude/skills/better-auth-security-best-practices/`) · `workers-best-practices` (`cloudflare/skills`, `.claude/skills/workers-best-practices/`)

## Rationale

Option 1 keeps one upload path, which matters because the multipart rules in `src/server/uploads/AGENTS.md` are strict and already tested. Option 3 hands strangers a session, and AC-10 wants a guest to reach almost nothing. Matching the typed email makes the other device case work without putting a secret in the link, and the cookie covers a visitor who signs in with Google on a different address.

Charging only the global guest budget while unclaimed, and the verified account at claim, means a stranger cannot drain a victim's allowance by typing their address. Spec 0014 keys usage by email hash, so at claim we add the take's minutes under the account's hash, with no new counting model. A 24 hour life keeps stored personal data tiny compared with the 30 days for owned takes. We never email an unverified address beyond the single magic link, which the existing per email limit (3 per 15 minutes) already guards.

## Feature design

**Data model sketch**:
- `user.guest` boolean NOT NULL default false. A guest has email `guest-<uuid>@guest.invalid`, `emailVerified` false, no account row.
- `guest_claim`: `id` uuid PK, `guest_user_id` FK `user` ON DELETE CASCADE (unique), `token_hash` text NOT NULL, `email` text NULL (typed, lowercased), `email_hash` text NULL (usage hash), `ip_hash` text NOT NULL, `claim_user_id` text NULL (parked claim), `created_at`, `expires_at` (created + 24 h), `claimed_at` NULL.
- `guest_ip_day`: `ip_hash`, `day` (UTC date), `drops` int, `minutes` int, primary key `(ip_hash, day)`. The daily address count and the global minutes budget read this table, so claims (which delete the guest row) never reduce a count. Rows older than 2 days are swept. The global total lives in one more table, `guest_budget_day` (`day` UTC date primary key, `reserved_minutes` int). Reservation is one conditional update, `UPDATE ... SET reserved_minutes = reserved_minutes + $m WHERE day = $d AND reserved_minutes + $m <= guest_daily_minutes` (the row is created first with an insert on conflict do nothing); no row updated means the budget is spent and the take is refused with the calm message. It reserves the probed `duration_ms` (in whole minutes, rounded up) before any processing job starts, so two takes at the same moment cannot both pass. A failed or cancelled take releases its reservation with the opposite update, and a finished take keeps it (what is charged is what was reserved, to the minute). A claimed take's reservation stays in the day's total (the budget is a rate limit on guests, not an account).
- Index on `expires_at` for the sweep.
- Setting keys: `guest_upload_enabled` (default true), `guest_daily_minutes` (default 600).

**State transitions**: claim: `open` (no email) → `emailed` (email typed, link sent) → `claimed` (takes moved, guest user deleted) or `expired` (swept at 24 h). A take keeps its normal states (`uploading` to `ready`).

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/guest/uploads | POST | filename, size, type, turnstileToken (req) | takeId, uploadId, sets `ts_guest` | none, Turnstile | 403 limit_exceeded, 422, 429, 503 off |
| /api/uploads/[takeId]/parts, /complete, /[takeId] | POST, DELETE | as today | as today | session or `ts_guest` owning the take | 401, 404 |
| /api/guest/take | GET | none | status, short lived play link for the finished render (view only) | `ts_guest` | 401, 404 |
| /api/guest/email | POST | email (req) | ok | `ts_guest` | 422, 429, 503 EMAIL_SEND_FAILED |
| /claim | GET page | claim id in query | redirect to the take | session | calm "no upload found" |

**Value sourcing**:
| Action | Value | Source |
|---|---|---|
| Create guest upload | creator id | new guest user id |
| Create guest upload | ip_hash | `cf-connecting-ip` hashed with the existing hash helper |
| Create guest upload | duration limit | probe result `duration_ms`, compared to 180000 |
| Email step | callbackURL | `/claim?c=<guest_claim.id>` |
| Claim | match | `email_hash` equals usage hash of the signed in email, or `token_hash` equals hash of the cookie |
| Process charge | budget | `guest_ip_day` and the global `guest_daily_minutes` while unclaimed; the claiming account's usage hash at claim |
| Sweep | cutoff | `guest_claim.expires_at` |

**Key invariants**:
- A guest never has a session. The guest id is resolved only from the cookie, only for upload routes, `/api/guest/take` and `/api/guest/email`.
- Guest rows are excluded from user counts, founding member counts and the `signup` event (the guest is inserted with the database, not through Better Auth).
- Claim is one transaction: move takes, move events, mark claimed, delete the guest user. A second claim finds nothing and shows the calm message. If a take is still uploading, the claim sets `claim_user_id` and moves nothing; the upload complete route finishes the claim, and the guest cookie keeps authorizing that upload until then. While a claim is parked, the claimant (signed in through the link) sees the take page's waiting state: the title, a progress line ("Still uploading from your other device. It will appear here when it finishes.") and no player, polled every 5 seconds through `GET /api/guest/take`'s sibling `GET /api/takes/[id]` returning `{ status: "claim_pending" }` for the parked claimant only (an ownership check that accepts `claim_user_id` for status alone, never for media or downloads). When the upload completes and the claim finishes, the next poll returns the normal take.
- The ready email goes only to `creator.email` of a non guest creator.
- Claimed takes keep their original `created_at`, and the 30 day retention clock does not restart.

**Security model**: Anonymous callers pass Turnstile (server side `siteverify` through plain `fetch`, response checked with zod). The cookie token is random 32 bytes, stored as a hash, httpOnly, secure, SameSite Lax, path `/`, 24 hours. Callers can act only on the take bound to their guest id (ownership check as in `src/server/uploads/AGENTS.md`). The claim checks email or token, never the claim id alone. Compliance scope: GDPR style duties for a stored email, address hash and cookie. All of it is in the legal facts with a 24 hour life.

**Configuration required**:
- `TURNSTILE_SITE_KEY` (public, page) and `TURNSTILE_SECRET_KEY` (secret, server): Cloudflare Turnstile. Tests use Cloudflare's published always pass test keys.

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
- Drift check and cookie test pass, verifies **AC-11**; event props contain no personal data, verifies **AC-12**; axe and keyboard pass on a phone and desktop, verifies **AC-13**

## Build plan

Tracer Bullet: one thin thread first (drop, claim, see the take), then thicken.

1. Migration: `user.guest`, `guest_claim`, indexes, settings keys. Satisfies **AC-9, AC-10**
2. Guest session helper, Turnstile verify, `POST /api/guest/uploads`, guest aware creator resolution on the existing upload routes. Satisfies **AC-1, AC-10**
3. Guest limits: size, count per cookie, per address per day, daily budget, kill switch, probe duration check. Satisfies **AC-6**
4. Email step: `POST /api/guest/email` with the existing magic link and `/claim` callback. Satisfies **AC-2**
5. Claim transaction and `/claim` page. Satisfies **AC-3, AC-4, AC-5, AC-7**
6. Usage: guest budget while unclaimed, account usage at claim, and the `guest_ip_day` counters. Satisfies **AC-6, AC-8**
7. Cleanup sweep for expired guests through the existing delete path. Satisfies **AC-9**
8. Homepage drop zone and email step UI, with Mobbin checked and `design-check`. Satisfies **AC-1, AC-2, AC-13**
9. Legal facts, cookie list, Privacy and Terms copy, `LEGAL_VERSION`, text hash line. Satisfies **AC-11**
10. Analytics events and funnel on `/insights`. Satisfies **AC-12**
11. Playwright end to end and `/check verify`. Satisfies **AC-1 to AC-13**

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
- [ ] Confirm the published Turnstile behaviour on cookies when writing the legal copy.
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
