# 0014. Monthly usage limit

**Date**: 2026-11-13
**Status**: In Progress

## Summary

Every account gets a free monthly allowance of processed video: 60 minutes, counted in seconds of take length, from the 1st of each month (UTC). A take that would pass the allowance is refused with a clear message, a failed take can be retried after the reset, and the creator sees "minutes used and left" in the library and next to the upload area. The charge is already recorded on every first processing run since slice 1; what is missing is the table that adds it up, the check that says no, the numbers on screen and the proof that retries, refunds and parallel uploads never count twice. Billing (months 3 and on, C-26) plugs into one function, so nothing here is thrown away.

## Context

Spec 0002 designed this whole feature and built half of it. Today, in `startJob` (`src/db/data/jobs/initial.ts`), an `initial` run records on its `processing_job` row `seconds_charged` (= `ceil(duration_ms / 1000)`), `charged_month` (the UTC month, `chargedMonth` in `src/lib/billing.ts`) and `charged_account_hash` (the HMAC of the canonical email, `src/lib/usage-hash.ts`). A take is charged once: a later `initial` run on the same take costs 0 unless the earlier charge was refunded. A re render, a background change, a cut change, a transcript run and every AI edit charge 0. A job that ends with a refundable failure code gives the seconds back once (`refundSeconds`, the `refunded` compare and swap). Nothing adds these up, nothing reads an allowance, `limit_exceeded` exists only in a comment, and the creator cannot see their usage. Spec 0002 lists the missing tables (`usage_month`, `app_setting` seeded with `free_monthly_seconds` = 3600) and the rule for the check: an atomic upsert that applies only if `seconds_used + charge <= allowance`.

The first job of a take starts without anyone clicking: the probe task (`src/trigger/probe.ts`, `startAndDispatch`) calls `startJob` right after the upload is probed. So when the limit says no, the creator has already uploaded the file, and today the probe would return `not_started` and leave the take `uploaded` forever. That path needs a defined ending.

Forces: the limit protects cost until billing exists (every processed minute costs transcription, AI and encoding); the check must be right under parallel requests (two uploads started together must not both slip under the line); a refund, a retry or a crash must never double count; usage must survive account deletion and re joining (the HMAC, no personal data, spec 0002 AC-16); logs, errors and job payloads carry IDs and counts only; billing and founding members (C-26: 50 free founding members in months 1 and 2, billing built in month 2) must not need a rewrite.

## Requirements

**User stories**:
- As a creator, I want to see how many minutes I have used and have left this month, so I am never surprised.
- As a creator, I want a clear message when a take does not fit, with the date the allowance comes back, not a vague error.
- As a creator, I want a take I uploaded just before the line to wait for me, not be lost.
- As the product owner, I want a hard monthly cost ceiling per account that survives deleting and re joining.
- As the product owner, I want the limit to be one number I can change without a deploy, and to be ready for plans later.

**Acceptance criteria**:
- **AC-1**: What counts. Only the first processing run of a take (`kind = initial`) charges, `ceil(duration_ms / 1000)` seconds, once per take. Re renders, background changes, cut changes, previews, transcript runs, AI edits, downloads and retries of a take that is still charged cost 0. Deleting a take or expiring its video does not give the seconds back (so a creator cannot reuse minutes by uploading and deleting).
- **AC-2**: The allowance is the `free_monthly_seconds` setting (default 3600, 60 minutes), read at the time of the check, so it can be changed in the database without a deploy. One pure function, `monthlyAllowanceSeconds(settings, account)`, is the only place that turns settings into a number for an account; billing later changes only this function (AC-12).
- **AC-3**: Usage is stored in `usage_month` (`account_hash`, `month`, `seconds_used`), one row per account per UTC month, under the HMAC of the canonical email and never with an ID or an email. It is not deleted with a take or an account. A month is the UTC calendar month: it starts on the 1st at 00:00 UTC and does not roll over; unused seconds are lost.
- **AC-4**: The check is atomic and job safe. Inside the existing `startJob` transaction, an `initial` charge of `c` seconds applies with one statement, `insert ... on conflict (account_hash, month) do update set seconds_used = seconds_used + c where seconds_used + c <= allowance returning`, and the insert side only happens when `c <= allowance`. Zero rows returned means `limit_exceeded`: no job row, no charge, nothing changes. Two takes started together for the same account can never total more than the allowance. A take is all or nothing: a 10 minute take with 5 minutes left is refused, not cut short.
- **AC-5**: A refund returns the seconds to the month that was charged. When a job ends with a refundable failure, the one time `refunded` swap also subtracts `seconds_charged` from `usage_month` for the job's `charged_month` and `charged_account_hash`, in the same transaction, never below 0. A job refunded once is never refunded twice, and a retry of that take then charges again, once, like a fresh run. A non refundable failure (`invalid_media`, `too_long`, and so on) keeps its charge, as spec 0002 AC-6 says.
- **AC-6**: When the check says no after the upload, the take is not lost. The probe moves it from `uploaded` to `failed` with the new non refundable failure code `limit_exceeded` (no job, nothing charged, the original kept for the normal 30 days, as spec 0013 promises; this spec does not extend retention). The take page and the library say "This month's allowance is used up. Your upload is kept until {expiry date}: try again from {1 Dec}, or delete it." When the video will expire before the reset (a refusal on the first day of a 31 day month), the message says so instead: "Your upload is kept until {expiry date}, before your minutes come back on {1 Dec}. Upload it again then." The date comes from `take.video_expires_at` and `resetsOn`, never typed. The existing Retry action starts the job again, which runs the same check: it works after the reset, or after the allowance setting is raised. Retry of a `limit_exceeded` take before then returns the same message and charges nothing. The "failed" email of spec 0006 says the same in plain words.
- **AC-7**: Early refusal. `POST /api/uploads` (create) refuses with 403 `limit_exceeded` when the account has 0 seconds left this month, before any file is sent, and, when the client sends the optional `durationHintMs` it read from the file, when the hint is more than the seconds left. The hint is advisory and never trusted: the probed length decides at the check in AC-4. A missing hint skips only the second part. The browser reads the hint from the file's metadata and falls back to none if it cannot.
- **AC-8**: `GET /api/usage` returns, for the signed in creator, `{ usedSeconds, allowanceSeconds, remainingSeconds, resetsOn }` for the current UTC month, where `resetsOn` is the first of next month (`YYYY-MM-DD`). It needs a session, never shows another account's usage and carries no email or hash. Every response of `/api/usage`, and the `limit_exceeded` bodies of the upload and retry routes (they carry the same numbers), are sent with `Cache-Control: private, no-store`, so a shared browser or a proxy never shows one account's numbers to the next person who signs in. The library page and the take page read the same numbers on the server (no second client request needed on first paint).
- **AC-9**: What the creator sees. The library header and the upload area show "{used} of {allowance} minutes used this month · resets {1 Dec}" with a meter (a `progressbar` with an accessible name and the values), with "minutes left" worded as whole minutes rounded down and "used" rounded up so they add up to the allowance. From 80% used the line also says "You have {n} minutes left this month". At 0 left the upload button is disabled with the reason in text next to it (not only a colour), and the drop zone says "You've used this month's {60} minutes. They come back on {1 Dec}." The meter never uses colour alone; contrast AA; reduced motion respected. Numbers come from the server, never typed in the component.
- **AC-10**: The limit survives account tricks. Deleting an account keeps `usage_month` (AC-3), so signing up again with the same canonical email (`+tag` and Gmail dots removed) lands on the same usage. A changed hash version (`USAGE_HASH_VERSION`) is stored on each row so a future canon change can be migrated, not guessed.
- **AC-11**: Existing data is carried over. The migration that creates `usage_month` adds up every `processing_job` row with `seconds_charged > 0`, not refunded and with a `charged_account_hash` and `charged_month`, into `usage_month` (grouped by hash and month), so charges recorded since slice 1 count from the first day. Known gap, accepted as a one-time rollout exception (to be approved by Toyin through Michael): deleting a take removes its `processing_job` rows (spec 0002 AC-17), so charges of takes deleted before this migration cannot be recovered and those minutes are not counted. The backfill therefore never over counts the takes that still exist and at worst gives an early account back some minutes in its first month. Refunds in the rollout window: deploy runs the migration, then Trigger.dev, then the Worker, so for a short time code from before this spec can still refund a job (finish, cancel, stale cleanup) without touching `usage_month`. To close that window, the migration seeds a setting `usage_limit_enabled` = false, and the check in AC-4 and the early refusal in AC-7 do nothing while it is false (charges and refunds still update `usage_month`). After the deploy has finished, a one-time reconcile script runs and only then is the setting switched to true. The script never overwrites a total (that would give back the charge of a take deleted after the migration, against AC-1); it applies differences using two flags the migration adds to `processing_job`: `usage_counted` (this job's charge is in `usage_month`) and `usage_returned` (its refund was taken out). The backfill sets `usage_counted` on every row it adds up, and the new code sets it when it charges, and sets `usage_returned` when it refunds. The script (1) adds each job that has a charge, is not refunded and is not `usage_counted`, (2) subtracts each job that is `usage_counted`, refunded and not `usage_returned`, flips the flags in the same transaction, and (3) is safe to run twice (a second run finds nothing). Each job is handled in its own transaction that first locks the job row (`SELECT ... FOR UPDATE`) and re checks `refunded`, `usage_counted` and `usage_returned` under that lock before it applies the delta; the refund's `refunded` swap in AC-5 takes the same row lock, so a refund and the reconcile of one job are serialised: whichever commits second sees the other's flags and either adds nothing or subtracts what was added, never leaving a refunded job's charge behind. Rows of takes deleted meanwhile are simply not seen: their charge stays in `usage_month`. Every refund after the deploy subtracts in the same transaction (AC-5). From the migration on, usage lives in `usage_month` and deleting a take never changes it (AC-1). The migration also seeds `app_setting.free_monthly_seconds` = 3600 and is safe to run twice.
- **AC-12**: Billing fits without a rewrite. `monthlyAllowanceSeconds` takes the account and the settings and returns the free number today; a later billing spec adds a plan lookup inside it and a per account override for founding members (C-26) without changing `startJob`, the table or the screens. Nothing in this spec stores a plan, a price or a payment detail.
- **AC-13**: Private and observable. Logs, errors, reports and job payloads carry the account hash only as an ID like value (never the email), seconds as numbers, and take IDs. A `limit_exceeded` is an expected result (a typed `{ ok: false, error }`), not an exception, and is counted but not reported to the error tracker as an error.
- **AC-14**: Accessible and responsive. The meter and the messages work with a screen reader (the used and left values are in the text, the status message is polite), the disabled upload button is explained in text and focusable help, 44 px targets, and the layout holds at phone width.

## Options considered

### Option 1: Usage table plus an atomic check in `startJob` (chosen)

Create `usage_month` and `app_setting` as designed in spec 0002 and put the check inside the transaction that already charges. Early refusal and the meter are conveniences on top.

**Pros**:
- The check and the charge are one statement, so parallel uploads and retries cannot overshoot or double count.
- Reuses the charge columns, `chargeSeconds`, `chargedMonth`, `refundSeconds` and the usage hash as they are.
- Billing later changes one function.

**Cons**:
- One more table and a backfill.
- The creator can still upload a file that is then refused, if the early check cannot know the length (the hint covers most cases).

### Option 2: Sum `processing_job` on every check

No new table: add up this month's charges for the hash each time.

**Pros**:
- No new table, no backfill.

**Cons**:
- Cannot be made atomic without locking the account; two parallel starts can both pass.
- Gets slower as jobs grow, and rows vanish with a deleted take, so deleting a take would give minutes back and break the hash survival rule.

### Option 3: Soft limit (warn but allow)

Show usage but never refuse.

**Pros**:
- Simplest, nobody is blocked.

**Cons**:
- No cost ceiling, which is the reason for the feature.

## Decision

**Option 1.** Build the defaults of the open decisions below (60 minutes, refuse the whole take that crosses the line, UTC calendar month, the same allowance for founding members) until Toyin answers; each is one setting or one function, so a different answer is cheap.

## Rationale

The data model, the hash and the charge are already decided and recorded; the missing pieces are small and fit the transaction that is already the single place money like seconds move. Only an atomic upsert gives a hard ceiling under parallel requests. Keeping the failed upload (AC-6) instead of deleting it respects the creator's time, and the existing Retry action gives "try again after the reset" for free. Rounding left down and used up keeps the two numbers honest.

## Feature design

**Data model sketch** (migration, one new table and one setting, spec 0002 rows 76 and 77):

| Table | Columns | Rules |
|---|---|---|
| `usage_month` | `id`; `account_hash` text; `month` date (first of month, UTC); `seconds_used` int; `hash_version` smallint default 1; timestamps | unique (`account_hash`, `month`); check `seconds_used >= 0`; no FK (survives deletion) |
| `app_setting` | `key` text PK; `value` jsonb | seeded `free_monthly_seconds` = 3600 and `usage_limit_enabled` = false (switched on after the reconcile, AC-11) |

The migration backfills `usage_month` from `processing_job` (AC-11).

**State transitions**: a new edge `uploaded` to `failed` with `limit_exceeded` (probe, AC-6); `failed` (`limit_exceeded`) to `processing` through the existing retry. No new take status.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/usage` | GET | none | `{ usedSeconds, allowanceSeconds, remainingSeconds, resetsOn }` | session | 401 |
| `/api/uploads` | POST | existing body plus optional `durationHintMs` | existing, or 403 `limit_exceeded` with the same four numbers | session, same Origin | 401, 403, 403 `limit_exceeded` |
| `/api/takes/{id}/retry` | POST | existing | existing, or 403 `limit_exceeded` | session, same Origin | adds `limit_exceeded` |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Charge on first run | seconds | `chargeSeconds(duration_ms)` in `startJob` (existing) |
| Month of a charge | `YYYY-MM-01` | `chargedMonth(now)` (existing) |
| Account key | hash | `usageAccountHash(email, USAGE_HASH_SECRET)` (existing) |
| Allowance | seconds | `monthlyAllowanceSeconds(settings, account)` reading `app_setting.free_monthly_seconds` |
| Used this month | seconds | `usage_month.seconds_used` for hash and `chargedMonth(now)`; 0 when there is no row |
| Left | seconds | `max(0, allowance - used)` |
| Shown used and left (minutes) | whole minutes | left = floor(left seconds / 60), used = allowance minutes - left, in `src/lib/usage-rules.ts` |
| Reset date | date | first of the next UTC month, from `now` |
| `now` | time | one clock read per request, passed in (so tests and the boundary at midnight UTC are exact) |

**Pure rules** (`src/lib/usage-rules.ts`, with tests): `monthlyAllowanceSeconds`, `remainingSeconds`, `usageDisplay` (the rounding in AC-9), `resetsOn`, `fitsInAllowance`, `usageNotice` (the 80% and 0 wording). They never read the database or the clock.

**Error handling**: `limit_exceeded` is added to `StartError` and to the failure code registry (non refundable, nothing was charged) with its friendly message in `take-messages` that names the reset date; a failed refund update (should not happen) rolls the whole finish back, as today.

**Security model**: usage is read and written by account hash; the hash is computed from the session user's email on the server and never leaves it. A creator can only read their own numbers.

**Performance**: one row per account per month; the check adds one statement to a transaction that already holds the take row lock. The meter is one indexed read per page.

**Testing approach**: pure rule tests (rounding, month edges, the 80% line); data tests against the real test database for the atomic check (two parallel starts for one account with room for one: exactly one wins), exact boundary (`used + c == allowance` passes, one more second fails), refund returns to the charged month once, a retried take is charged once, the backfill, and a month rollover; route tests for 401, 403 and the numbers; a probe test for the `uploaded` to `failed` ending; browser tests and axe for the meter and the disabled upload state (Dwight).

## Build plan

Tracer Bullet: prove one real thread first (a charge that adds up and a refusal at the line), then the early refusal, then the screens.

1. `src/lib/usage-rules.ts` with its tests, and the `limit_exceeded` code and message, satisfies **AC-2**, **AC-9** (the numbers and wording), **AC-12**
2. Migration for `usage_month` and `app_setting` with the backfill and the seed (`usage_limit_enabled` false), the two `processing_job` flags, the one-time reconcile script, plus data functions to read usage and to apply the charge, satisfies **AC-3**, **AC-11**
3. The atomic check inside `startJob` and the refund inside the finish, with the parallel, boundary, refund and retry tests, satisfies **AC-1**, **AC-4**, **AC-5**, **AC-10**
4. The probe ending (`uploaded` to `failed` with `limit_exceeded`), the retry route message and the failed email wording, satisfies **AC-6**
5. `GET /api/usage`, the early refusal in `POST /api/uploads` and the `durationHintMs` hint, satisfies **AC-7**, **AC-8**, **AC-13**
6. The meter, the upload area states and the failed take message (Dwight; needs Mobbin), then browser tests and axe, satisfies **AC-9**, **AC-14**
7. Real pipeline check (`tests/pipeline/`): two uploads against a small allowance, one refused and kept, the retry after raising the setting, satisfies **AC-4**, **AC-6**

## Consequences

**Positive**:
- A hard monthly cost ceiling per account that survives deleting and re joining.
- One transaction owns charge, check and refund, so there is nothing to reconcile.
- Billing and founding members change one function, not the flow.

**Negative / tradeoffs**:
- A take longer than the seconds left is refused whole, even if most of it would fit.
- If the early check cannot know the length (no hint), a creator can upload a file and then be told no; the file is kept for a retry.
- A Google email change starts a fresh usage row (rare, accepted in spec 0002).
- Charges of takes deleted before the migration are not in the backfill (AC-11): a small, one time gap in the first month.

**Neutral**:
- Re renders, background changes, cut changes and AI edits stay free; they are bounded by their own limits (background changes per hour, the 10 minute take cap, the 30 day retention).
- The allowance is a database setting, changed by a one line SQL update or a later admin screen, not an environment variable.

## Follow-up

- [ ] Decisions for Toyin, sent to Michael as numbered options (this spec builds the recommended default of each until she says otherwise): the free allowance (60 minutes), what happens to the take that crosses the line (refuse it whole), when the month resets (UTC calendar month), and whether founding members get more than everyone else (no).
- [ ] After the deploy and the reconcile script, switch `usage_limit_enabled` to true (Michael or Jim; one SQL update).
- [ ] Toyin approves the backfill gap in AC-11 (takes deleted before the migration are not counted), through Michael.
- [ ] The billing spec (C-26, month 2) adds plans, the per account override and the payment flow inside `monthlyAllowanceSeconds`; this spec stores none of them.
- [ ] Optional later: an email at 80% used (not built; no new email in this spec).
- [ ] Feature 16 (privacy and terms) quotes this behaviour: 60 free minutes a month, resets monthly, usage kept as a pseudonymous hash (not anonymous: whoever holds the secret could compute it for a known email) after account deletion.
- [ ] `/sync` adds the usage rules to `src/lib/AGENTS.md`, `src/db/AGENTS.md` and `src/server/AGENTS.md` once built.

## References

**Project sources**:
- Spec 0002 (data model: `usage_month`, `app_setting`, AC-6, AC-16 and the limit check row), spec 0004 (core take loop), spec 0006 (failed email), spec 0013 (retention, 30 days)
- `src/lib/billing.ts`, `src/lib/usage-hash.ts`, `src/lib/failure-codes.ts`, `src/db/data/jobs/initial.ts`, `src/trigger/probe.ts`, `src/app/api/uploads/route.ts`
- Commitments C-26 (founding members, billing in month 2)

**Practices and standards**:
- Atomic conditional upsert for a counter with a ceiling, so concurrent writers cannot overshoot
- Usage keyed by an HMAC of the canonical email, so the stored row holds no email or name; it is pseudonymous, not anonymous, and is described that way
