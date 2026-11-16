# Cross check of spec 0023 (Upload first, sign in after), B2-T167, 2026-11-16

**Read by**: Dwight (sonnet), as the builder would, step by step through the 11 step build plan
**Scope**: `docs/specs/0023-upload-first-sign-in-after.md` against the code it will touch: `src/server/uploads/*`, `src/server/api-auth.ts` and `api-auth-deps.ts`, `src/server/auth.ts`, `src/db/schema/{take,auth,usage,analytics}.ts`, `src/db/data/{cleanup*,deletion,usage,jobs/initial}.ts`, `src/trigger/cleanup.ts`, `src/trigger/email/notify.ts`, `src/lib/{analytics-events,api-rules,usage-rules,legal-facts-data,env}.ts`
**Question asked**: for every action in the build plan, is the source of each value it must produce named? Where it is not, the builder would invent it.

## Summary

The spec is strong on the money rules (AC-8) and the claim race. It is thin on the plain plumbing around them. I found **34 gaps** (G1 to G34). Each has one clearly right answer, because the code already settles it or the spec's own rules force it, so all are folded into the spec in this PR (marked **Folded**). Separately, **6 real choices** (C1 to C6) have no single right answer and are listed for Toyin at the end, each with a recommendation. The numbers (500 MB, 3 min, 24 h, 600 minutes a day) are untouched, and the status stays Proposed.

Four gaps would have caused a real bug if built as written:

1. **G19**: job start charges the creator's email hash, so a guest would be charged to a junk hash `guest-<uuid>@guest.invalid` and the 60 minute ceiling would run against it.
2. **G17**: `analytics_event.creator_id` is NOT NULL with a cascade, so `guest_expired` (written as the guest user is deleted) would vanish with the user.
3. **G20**: the budget release has no record of which day it reserved on, so a release after midnight UTC would subtract from the wrong day.
4. **G6**: `guard` is shared by every route, so "guest aware" resolution would let the cookie reach the library and every other route unless it is opt in per route.

## How to read the tables

Each gap shows **where it bites** (build step, AC), **what is missing**, and the **answer**. **Folded** means the answer is now in the spec. Step numbers are the spec's build plan.

## Gaps

### The guest cookie and the guest record

**G1. Cookie details beyond the flags.** Step 2, AC-1, AC-10. The spec gives the flags and 24 h but not the encoding, the hash, who sets it, when it is cleared or renewed.
Answer (**Folded**): 32 random bytes from `crypto.getRandomValues`, base64url in the cookie, SHA-256 hex in `token_hash` (same pattern as `hashApiKey`). The route handler sets it with `Set-Cookie` (Better Auth does not touch it). `Secure` only when `BETTER_AUTH_URL` is https, so local http dev works. Cleared (Max-Age 0) when a claim finishes and when a lookup finds an expired or missing guest. Renewed to a fresh 24 h on each new drop (see G18).

**G2. Same guest, two tabs.** Step 3, AC-6. "1 active guest upload per browser" does not say what counts as active, where it is checked, or what a second tab gets.
Answer (**Folded**): both tabs send the same cookie, so they resolve to the same guest user. Active means a take of that guest in status `uploading`. The check runs inside the drop transaction after locking the guest user row (the same lock `createUpload` already takes on the creator row), so two tabs with the same cookie cannot both pass. The very first drop has no cookie yet, so two tabs could each create their own guest and the later response would overwrite the cookie of the other upload. Two rules close this: the page takes a cross tab lock (`navigator.locks`, name `ts-guest-drop`) from the click until the response has set the cookie, so a second tab waits and then sends the cookie; and the drop transaction first upserts the `guest_ip_day` row for the address (a row lock), which serializes first drops from one address. A browser without the Locks API can still race, and the address limit of 3 bounds the damage. The second tab gets 429 `guest_busy` with the calm message "You already have an upload running. Wait for it to finish." Once the first take is past `uploading`, a second drop is allowed and counts against the address limit (see C4 in Choices for whether Toyin wants that).

**G3. Cookie present but dead.** Step 2. A cookie whose guest row is expired, claimed or deleted.
Answer (**Folded**): treated as no cookie. The drop creates a new guest and overwrites the cookie. The upload routes answer 401 as with no cookie.

**G4. The guest user row's required columns.** Step 1. The `user` table needs a name, a unique email and an id; Better Auth creates these normally and the guest bypasses it.
Answer (**Folded**): id `crypto.randomUUID()`, name `Guest`, email `guest-<uuid>@guest.invalid`, `emailVerified` false, `guest` true, `takeEmails` false, no default background. The existing magic link before hook also rejects any address ending `@guest.invalid`, so nobody can request a sign in link for a guest row.

**G5. Guest rows in counts.** Step 1, AC-9. The spec says "excluded from user counts" but never lists where. The code has no single count helper.
Answer (**Folded**): step 1 includes a search of every query over the `user` table (`grep "from(user)"`: `src/trigger/hello.ts`, the insights and founding member queries, `usage`, `api-keys`, `realtime-mints`, `backgrounds/library`, `email-prefs`) and adds `guest = false` to each query that counts or lists people. A test per changed query is not needed, but one shared test inserts a guest and asserts the founding member and signup counts are unchanged.

### The drop route

**G6. How the existing upload routes accept a guest.** Step 2, AC-1, AC-10. The spec says "guest aware creator resolution". `guard` in `src/server/api-auth.ts` is shared by every route, so a global change would let the cookie act on the library, takes, keys and the rest.
Answer (**Folded**): add an opt in option `allowGuest` to `guard`. Only `parts`, `complete` and `DELETE /api/uploads/[takeId]` pass it (and `/api/guest/take`, `/api/guest/email` have their own guest only guard). Order inside `guard`: Authorization header present means key only (unchanged, a guest never uses a key); otherwise Origin on writes, then the session, then, only when `allowGuest` is set, the `ts_guest` cookie. The session wins only when it owns the take: for these three routes, if the session user does not own the take but the cookie's guest does, the cookie is used. This matters for a parked claim, where the claimant is signed in on the first device while the upload still runs under the guest (AC-4). `Creator` gains a `guest` boolean so handlers can refuse. Per route refusals:

| Route | Guest without cookie | Guest with a cookie, wrong take |
| --- | --- | --- |
| `POST /api/uploads` (create) | 401 | 403 `guest_use_guest_route` (a guest must use `/api/guest/uploads` so limits apply) |
| `POST /api/uploads/[takeId]/parts` | 401 | 404 (the existing `ownedTake` check) |
| `POST /api/uploads/[takeId]/complete` | 401 | 404 |
| `DELETE /api/uploads/[takeId]` | 401 | 404 |
| every other route | 401 (cookie ignored) | 401 |

`handleCreate`'s early usage refusal (`earlyRefusal`) never runs for a guest. The new routes are added to the API registry exclusions (`src/lib/api-registry-exclusions.ts`) because they are not part of the public key API, and the registry test then passes.

**G7. What the guest drop accepts.** Step 2. The spec says `filename, size, type, turnstileToken` but `createUpload` takes `fileName, sizeBytes, container, backgroundId, source, script`.
Answer (**Folded**): body is `uploadCreateSchema` without `backgroundId`, `source` and `script` (a guest has none, source is `file`) plus `turnstileToken`. Unknown keys are rejected. Output is the same as today (`takeId`, `partSize`, `partCount`) plus the cookie. `createUpload` gets a `maxBytes` option so the guest cap (500 MB) replaces `MEDIA_LIMITS.maxBytes` (2 GB). The stored size check at complete already catches a declared size that differs from the real file, so the cap cannot be lied about.

**G8. Order of checks in `POST /api/guest/uploads`.** Step 2 and 3, AC-1, AC-6. The spec names the checks but not their order, and a Turnstile token is single use and costs a fetch.
Answer (**Folded**): Origin; kill switch (503 `guest_paused`); body zod (422); size over the cap (422 `too_large`); a cheap early look at the day's budget row (403 `guest_budget_spent` if already spent, advisory only, the reservation in G20 is the real check); Turnstile (G9); then one transaction: lock guest user (create it if no live cookie), active upload check (G2), per address count (G11), create the take, increment the day count; then the R2 multipart start; then set the cookie. A refusal before the transaction creates no guest, no take and no count.

**G9. Turnstile: the call and how a failure shows.** Step 2, AC-1, AC-6. Missing: endpoint, fields, timeout, what happens on a failed or unreachable check, how the page shows it.
Answer (**Folded**): `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` with form fields `secret`, `response` and `remoteip`, 5 second timeout, response parsed with zod (`success` boolean, `error-codes` array). `success: false` gives 403 `bot_check_failed`, "We couldn't check that you're a person. Try again." The page resets the widget and keeps the chosen file, with a Try again button. A timeout, a non 2xx or a body that fails zod gives 503 `guest_unavailable` (fail closed: no check, no upload). A failed check does not count toward the address limit and creates nothing. Tests use Cloudflare's published test secrets (always passes `1x0000000000000000000000000000000AA`, always fails `2x0000000000000000000000000000000AA`). There is no Content Security Policy in the repo today; if one is added the page needs `challenges.cloudflare.com` in script and frame sources.

**G10. Turnstile and the two keys in the environment.** Step 2, Configuration. The spec names the two keys but not the plumbing.
Answer (**Folded**): add `TURNSTILE_SECRET_KEY` to the web env zod schema in `src/lib/env.ts`, `TURNSTILE_SITE_KEY` as a public value for the page, and both to the deploy env list (the `deploy-env-list` test and the Worker secrets list), `.env.example` and CI, in step 2. The secret is a Worker secret, never in `NEXT_PUBLIC_*`.

**G11. How the per address count works.** Step 3 and 6, AC-6. The spec says 3 per address per day from `guest_ip_day` but not when it counts, whether a failed drop counts, or what happens with no address header.
Answer (**Folded**): counted when the take row is created, in the same transaction, by an upsert on `(ip_hash, day)` with a conditional update (`drops < 3`); never decremented (a failed, cancelled or claimed drop still counts, because claims delete the guest row but not this one). No `cf-connecting-ip` (the helper `clientIpOf` returns null) means refuse with 503 `guest_unavailable`: with no address the cap cannot hold, so fail closed. Tests inject the header.

**G12. The address hash is not salted.** Step 3, AC-11. The spec says "hashed with the existing hash helper". `hashClientIp` is an unsalted SHA-256 with a fixed label, so every IPv4 address can be read back by trying all of them. It was built for rows that live an hour; this one lives 2 days and is named in the legal copy. IPv6 users can also rotate through a whole /64 range for free.
Answer (**Folded**): a new `hashGuestIp` that uses HMAC SHA-256 with `USAGE_HASH_SECRET` and the label `guest-ip:`, over the address for IPv4 and over the first 64 bits for IPv6.

**G13. `guest_ip_day.minutes`.** Step 6. The data model gives the table a `minutes` column and the value sourcing says "reserved against `guest_ip_day`", but AC-6 sets no minutes limit per address. Nothing reads it.
Answer (**Folded**): drop the `minutes` column. `guest_ip_day` holds `drops` only. If Toyin wants a per address minutes cap, it is a new number and a new AC (see C3).

### Limits that need the probe

**G14. The 3 minute check runs after the upload.** Step 3, AC-6. Length is only known after the probe, so a 4 minute video uploads fully, then must be refused. The spec does not say how the take ends or where the check sits.
Answer (**Folded**): one function `reserveGuestMinutes(tx, takeId)` runs where the probe result is written, before any processing job is created. For a guest take it checks `duration_ms` against 180000, then reserves the budget (G20). Over length fails the take with the new failure code `guest_too_long`; no budget is reserved. A spent budget fails it with `guest_budget_spent`. Both are added to the failure code registry (`src/lib/failure-codes.ts`) with calm messages and are not refundable (nothing was charged). The original is queued for deletion at once, because there is no retry path for a guest. The browser also reads the file length from metadata before the upload and refuses early as a convenience; the probe stays the real check.

**G15. The kill switch and takes already running.** Step 3, AC-6. "Turns the feature off" does not say if uploads in flight stop.
Answer (**Folded**): the switch refuses new drops only (503 `guest_paused`). A drop already started can finish, be probed and processed, and be claimed. Stopping in flight work would strand people who already typed their email.

**G16. How the settings are read.** Step 1 and 3, AC-6. The spec names two keys. The code already has `app_setting` (key text, value jsonb) and `readUsageSettings` (`src/db/data/usage.ts`), which reads rows at the time of the check.
Answer (**Folded**): `src/lib/guest-rules.ts` with `parseGuestSettings` modelled on `parseUsageSettings`: `guest_upload_enabled` must be a boolean, default true when missing or any other type; `guest_daily_minutes` must be a non negative integer, default 600 when missing or invalid. Read in the drop route and again in the reservation. No migration inserts the rows (the defaults live in code, nothing to seed). Changing either takes a SQL update and no deploy, as for the usage settings.

### Analytics

**G17. Guest events cascade away.** Step 10, AC-12. `analytics_event.creator_id` is NOT NULL and references `user` with `ON DELETE CASCADE`. A guest event written under the guest user disappears when the claim or the sweep deletes the guest, so `guest_expired` could never be read. The spec also says the claim "moves events", which only covers events that still have an owner.
Answer (**Folded**): the migration makes `analytics_event.creator_id` nullable. `guest_drop`, `guest_email_added` and `guest_expired` are written with a null creator. `guest_claimed` is written with the claimant's creator id (a real account). Take events a guest already has (`take_uploaded` and others) move to the claimant at claim. The funnel counts by event name. Account deletion still removes an account's events by creator id, so no privacy promise changes. `repairAnalyticsEvents` is unaffected (it only inserts milestone events from real rows).

Props, closed and enum or small integer only (`src/lib/analytics-events.ts` is a closed list, so the four names and their zod props are added there):

| Event | Fires | creator | props | oncePer |
| --- | --- | --- | --- | --- |
| `guest_drop` | after the drop transaction commits (the take exists) | null | none | none |
| `guest_email_added` | after the magic link was sent | null | none | none |
| `guest_claimed` | after the claim transaction commits | claimant | `{ via: "email" or "cookie", timing: "before_start", "after_start" or "parked" }` | none |
| `guest_expired` | after the sweep transaction commits | null | `{ hadEmail: boolean }` | none |

Refused drops record no new event (the existing `limit_hit` enum is for the monthly allowance and is left alone). All four use `recordEvent`, after commit, never throwing.

### Budget and the account charge

**G18. When a guest expires, from when.** Step 7, AC-9. `guest_claim.expires_at` is "created + 24 h", but one cookie can hold several takes dropped hours apart. A second take dropped at hour 23 would be deleted an hour later while it processes.
Answer (**Folded**): AC-9 says "24 hours after the drop", so it is per take. The sweep deletes each unclaimed guest take at `take.created_at + 24 h`. `guest_claim.expires_at` is the last drop plus 24 h (updated on each drop, and the cookie is renewed with it), and the guest user and claim row are deleted when that passes and no take is left.

**G19. Who charges a guest at job start.** Step 6, AC-8. `src/db/data/jobs/initial.ts` joins the take's creator and calls `usageAccountHash(locked.email)`, then `chargeUsage`. For a guest creator that would write a usage row against the hash of `guest-<uuid>@guest.invalid` and apply the 60 minute ceiling to it, and the job would remember that hash for refunds. The spec says unclaimed takes charge no account.
Answer (**Folded**): for a creator with `guest` true, job start still computes and stores `secondsCharged` and `chargedMonth` on the job row but skips `chargeUsage` and leaves `chargedAccountHash` null; a failure refund then only marks the job refunded. When a claim lands after job start, it reads each `initial` job of the take with `secondsCharged > 0` and not refunded, and charges that same number of seconds to the claimant's hash (using the AC-8 ceiling rule), then writes `chargedAccountHash` on the job so a later refund works. A failed or refunded job charges nothing at claim. A claim before job start moves the take with no charge, and job start then charges the claimant as for any signed in account, with the `guest_origin` rule from AC-8. This also fixes a unit mismatch: the guest budget counts whole minutes (`ceil`), the account counts seconds (`chargeSeconds`); the claim uses seconds from the job row, never the reserved minutes.

**G20. Which day a release goes back to.** Step 6, AC-8. A release subtracts from `guest_budget_day.reserved_minutes`, but the take records only `guest_reserved_minutes`. A take reserved at 23:50 UTC that fails at 00:10 would subtract from the new day's row.
Answer (**Folded**): add `take.guest_reserved_day` (date), written in the same statement as `guest_reserved_minutes`, and cleared with it. The release subtracts from that day's row. The day used for the reservation is the UTC date of the reservation, not of the drop.

**G21. Which step builds the reservation.** Build plan steps 3 and 6 both mention the budget. A builder cannot tell which owns the reservation and which owns the claim side.
Answer (**Folded**): step 3 owns every limit that refuses a guest (size, active, address, kill switch, probe length, budget reservation and its release). Step 6 owns the account side (job start skips a guest, claim charges, `guest_origin` ceiling rule). The build plan text is edited to say so.

**G22. The ready and failed emails for a guest.** Step 5, AC-7. `src/trigger/email/notify.ts` loads the creator and sends to `creator.email` when `takeEmails` is on. A guest has `takeEmails` false (G4), which already stops it, but that is an accident of the default, and the "didn't finish" email path (cleanup AC-5) is separate.
Answer (**Folded**): one explicit guard, `if (creator.guest) return ok("guest")`, in `notify.ts` and in the failed job email queue, tested. Spec AC-7 already says the ready email goes only to a claimed account; this ties it to the code.

### The email step and the claim

**G23. The email step while the upload runs.** Step 4, AC-2. The spec lets the email be typed during upload but not what is stored, what a second email does, or how often one can send.
Answer (**Folded**): `POST /api/guest/email` stores the lowercased email and its usage hash on the guest claim (state `emailed`). A second call replaces both and sends a new link; an earlier link no longer matches by email on another device (the stored hash is the new address), but it still claims in the same browser through the cookie until it expires (15 minutes, `MAGIC_LINK_EXPIRES_SECONDS`). The page tells the visitor that the earlier link is replaced. The call goes through `auth.api.signInMagicLink` so the existing before hook (3 sends per email per 15 minutes, `takeSignInEmailSlot`) and the 10 per hour per address Better Auth rule apply. A send failure returns 503 `EMAIL_SEND_FAILED` and stores nothing new. The total number of sends per guest is a choice (C2).

**G24. The callback URL for new and existing accounts.** Step 4, AC-3. Better Auth uses `newUserCallbackURL` for a first time user and `callbackURL` otherwise.
Answer (**Folded**): pass `/claim?c=<guest_claim.id>` as both `callbackURL` and `newUserCallbackURL`. A new account fires the normal `signup` event (it is a real user); an existing account signs in and the take lands in it.

**G25. What `/claim` does in each case.** Step 5, AC-3, AC-4, AC-5. The spec gives the rule but not the outcomes.
Answer (**Folded**):

| Situation | Result |
| --- | --- |
| No session (page opened without signing in) | redirect to `/sign-in` with `/claim?c=<id>` as the return path |
| Session, `email_hash` of the verified signed in email equals the claim's, or the cookie hash matches | run the claim; one take redirects to `/takes/<id>`, more than one to `/library` |
| Session, neither matches | calm "no upload found" message with a link to the library, nothing moves |
| Claim id unknown, or the guest was already claimed or swept | the same calm message, which says the video may already be in the library |
| Some takes still uploading | parked, as in the spec; finished takes move now, the guest row stays until the last one moves |
| Session email not verified (`emailVerified` false) | email match does not count; the cookie match still does |
| The account already exists | same path, the takes join the existing account |

The email match uses the same canonical usage hash as AC-8, so a plus tag does not break it. A parked claim is a flag on the guest claim row, not per take; the complete route finishes it for its own take and deletes the guest user when no take of that guest is left.

**G26. Parking with several takes.** Step 5. The spec parks "the take" but a guest can hold one finished and one uploading take.
Answer (**Folded**): see G25. The claim moves every take not in `uploading` at once and parks only the rest. For each take it moves, the claim first locks the take row `FOR UPDATE`, then reads its jobs, then moves it and charges, the same take first order as job start (`src/db/AGENTS.md`). Otherwise a job could start for the guest after the claim read the jobs, and its seconds would never reach the claimant.

**G27. What the claim moves.** Step 5, AC-3. "Move takes, move events" is not a list.
Answer (**Folded**): `take.creator_id`, `analytics_event.creator_id` for the guest's take events, and the job rows' `chargedAccountHash` (G19). Take keys in R2 do not include the creator id (checked in `src/server/takes`), so no file moves. `background` and other creator scoped rows do not exist for a guest.

### Cleanup

**G28. What the sweep deletes, and in which order.** Step 7, AC-9. "Existing cleanup sweep and delete queue" does not say how. `expireTake` keeps the row and skips takes with active jobs, so it is the wrong tool: AC-9 wants rows gone.
Answer (**Folded**): a new step in `cleanupTask`, placed before the existing delete queue drain so keys go out in the same run. Per expired guest take, in one transaction: lock the take, read its `uploadId` and active job run ids, call `deleteTakesInTx` (queues the original and render keys and deletes the rows, jobs and cuts). After commit: cancel the runs, abort any open multipart upload (a failure is logged and left to the R2 lifecycle backstop, like `failAbandonedUploads`), and record `guest_expired`. When the guest has no take left and `expires_at` has passed, delete the guest user in its own transaction (this cascades `guest_claim`). R2 comes last through the existing queue, rows before storage, as everywhere else. No usage is refunded (an unclaimed guest was never charged to an account), and the guest budget reservation stays (the minutes were spent). `guest_ip_day` rows older than 2 days and `guest_budget_day` rows older than 2 days are deleted in the same step. A parked claim whose guest expires is swept the same way. Batch size is `CLEANUP.batchSize`.

### Security and legal

**G29. The cookie and the rest of the routes.** AC-10. Covered by G6: the cookie is ignored by any route that does not opt in. A test that calls ten other routes with a valid guest cookie and expects 401 each is added.

**G30. The view only result route.** Step 5, AC-10. `GET /api/guest/take` has "none" as input, but a guest can hold several takes, and the link has no named lifetime.
Answer (**Folded**): optional `takeId` query, default the guest's most recent take; unknown or not theirs gives 404. Output `{ status, playUrl, expiresInSeconds }` with `playUrl` null until a render is ready. The link is a presigned R2 GET for the newest render, with the same lifetime as the signed in media route (`src/app/api/takes/[id]/media`). Honest limit: a presigned link can be saved by anyone who holds it, so "no download" means no download button, not a technical guarantee. The 5 second polling for a parked claimant is `GET /api/takes/[id]` as the spec says.

**G31. The legal facts list.** Step 9, AC-11. The spec says "three new stored fields" but the model stores four: `email`, `email_hash`, `ip_hash`, `token_hash`.
Answer (**Folded**): list the four, plus the cookie (`src/lib/legal-facts-data.ts` today documents only the Better Auth session cookie and has a test that says it is the only cookie, so that test and its comment change), Cloudflare Turnstile as a service that sees the visitor's address and browser signals, the 24 hour life, and the 2 day life of the count rows. The `LEGAL_VERSION` date changes. `pnpm test:legal-launch` is the launch gate and needs Toyin's and the lawyer's facts again for the new items (C6).

**G32. The sign in email copy for a guest.** Step 4. `signInEmail` is the generic "sign in" email. The guest email must say what it is.
Answer (**Folded**): the same template with one extra line chosen by a flag: "You dropped a video on Take Studio. This link adds it to your account." The copy is for Toyin to approve before launch (C5 in the design reference). It never shows a file name or title.

### Tests

**G33. AC to test check.** Every AC has a scenario, but several rules inside them do not:

| AC | Covered | Missing, added to the spec's test list |
| --- | --- | --- |
| AC-1 | happy path | Turnstile fail and Turnstile unreachable (G9) |
| AC-2 | happy path | resend limit; "no other email to an unclaimed address" (assert one mail only after a failed job) |
| AC-3, AC-4 | same browser, other device, early claim | claim with several takes, one uploading (G26); expired link then sign in (C1) |
| AC-5 | mismatch | unverified email does not match (G25) |
| AC-6 | limits list | probe too long (G14); two tabs (G2); no address header (G11) |
| AC-7 | happy path | guest take finishes before claim, no email; failed job email skipped (G22) |
| AC-8 | usage line | job start skips a guest (G19); claim after start charges seconds; claim before start; ceiling skip only under 60; release on fail then cancel returns minutes once; release after midnight (G20); concurrent reservations |
| AC-9 | expiry | claimed take keeps normal retention and its `created_at`; parked claim expiring; multipart abort; second take at hour 23 (G18) |
| AC-10 | result view, library | ten other routes with the cookie return 401 (G29); a claimant reading a parked take |
| AC-11 | drift and cookie | the updated "only cookie" test |
| AC-12 | props | the nullable creator and the four prop shapes (G17) |
| AC-13 | axe and keyboard | none |

**G34. Tests are not named per build step.** The scenarios are a flat list, so a builder cannot tell which step's PR must carry which. Answer (**Folded**): the build plan now names, per step, the tests it must ship, using the table above.

## Choices for Toyin

These have no single right answer, so the builder will wait for an answer or take the recommendation. Each has a recommendation.

**C1. A link that expired before it was opened.** (Depends on C5: if C5 is not accepted, drop C1.) The magic link lasts 15 minutes and the guest keeps the take for 24 hours. A visitor who opens the link late must sign in again, but the claim only happens through `/claim`, so a normal sign in does not claim the take and it is deleted after 24 hours.
Options: (A) leave it, the visitor gets a Resend on the claim screen on the same browser, and a different device is out of luck; (B) also claim on any sign in whose verified email matches a waiting guest.
Recommendation: **B**, but only together with the C5 confirm step: a sign in that matches by email shows the same "A video was added with your email. Add it to your library?" question before anything moves, so a stranger's drop never lands in an account without its owner's click. It is one hook after sign in (the same claim function), uses only the email match (never the cookie), and protects the visitor from losing a take. It adds a claim path outside `/claim`, which Toyin should know about. If Toyin rejects the confirm step, drop C1.

**C2. How many links can one guest send.** The per email limit is 3 per 15 minutes and 10 per hour per address, which still allows many sends to many addresses from one drop.
Recommendation: a cap of **5 sends per guest** for its whole 24 hours, stored as a counter on the guest claim. This is a new number, so it is not folded.

**C3. A minutes cap per network address.** AC-6 caps drops (3 a day) and the whole feature (600 minutes a day) but not minutes per address, so one address could use at most 9 minutes a day (3 drops of 3 minutes), so draining the 600 minute budget takes at least 67 addresses.
Recommendation: none for now. The per address count already bounds it, and a drain by 67 or more addresses is a different attack that a minutes cap per address would not stop. Add one only if the budget is drained in practice, and then as its own number.

**C4. A second take after the first finished.** "1 active guest upload per browser" lets a visitor drop again once the first is past `uploading`, up to 3 a day per address.
Recommendation: allow it. It is simpler and the address cap already limits it. Choose "one take per guest" only if Toyin wants to push everyone to sign up after one try.

**C5. Someone else's email.** The claim by email match puts a take into whoever owns the typed address when they sign in. A stranger can type a victim's address, upload something, and the victim who signs in with that address gets a take they did not make in their library. The take is theirs to delete and no minutes of theirs are used before the claim, but they may see unwanted content.
Options: (A) keep it automatic; (B) show a confirm step ("A video was added with your email. Add it to your library?") whenever the match is by email only, on `/claim` and on a normal sign in (C1), and never for the cookie match.
Recommendation: **B**. It costs one click only for the case where the email matched and the cookie did not, which is the other device case, and AC-4 still works. Declining deletes nothing yet and moves nothing; the take expires on its own.

**C6. The legal review gate.** New facts (cookie, Turnstile, four stored fields) reopen `pnpm test:legal-launch`, which fails until Toyin's facts and the lawyer's review are recorded again.
Recommendation: schedule the legal review before the build step 9 PR merges, and decide whether Toyin accepts a Cloudflare Turnstile notice in the privacy copy.

## What is not a gap

Settled by the code already and left as is: the multipart sizes and part links, the stored size check at complete, the idempotent complete, the hour limit on creates (10 per hour per creator, which a guest cannot hit because the address cap is lower), the take row lock order, the 15 minute sweep cadence and batch size, `recordEvent` after commit and never throwing, the magic link expiry and the per email slot.

Reviewed by Dwight over the files above.
