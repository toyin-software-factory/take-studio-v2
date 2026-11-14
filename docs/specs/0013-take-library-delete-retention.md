# 0013. Take library, delete and retention

**Date**: 2026-11-13
**Status**: Accepted

## Summary

Most of this feature already exists: the library lists every take with its status and expiry note, a sweep every 15 minutes removes videos after 30 days and keeps the transcript, and a server function can delete a take with every file and record. What is missing is the part a creator can touch: there is no Delete button anywhere, because the delete route was never added. This spec adds that route and a clear Delete flow on the take page and the library, makes the expired state read well (video gone, transcript kept), and adds a storage side backstop (R2 lifecycle rules) so a file can never outlive its 30 days even if the sweep fails.

## Context

Spec 0002 built the data side of retention: `video_expires_at` is set 30 days after the upload completes and is never extended, the cleanup task moves `ready` and `failed` takes to `expired` and queues their files in `storage_deletion`, and `deleteTake` removes a take's rows and queues every file key in one transaction (AC-15, AC-17, AC-18). The transcript and the cuts are database rows, so they survive expiry on purpose. Spec 0004 built the library (`/library`, newest first, 24 per page) with a status badge and the note "Video expires in N days" or "Video expired on <date>". Account deletion already removes all of a person's takes through the same function.

Three things are left for feature 11. First, `DELETE /api/takes/{id}` does not exist and the take page's Details tab says "no delete: slice 6", so a creator cannot delete a take at all. Second, spec 0002 and spec 0001 both left a follow up here: R2 lifecycle rules as a backstop to the deletion queue, because the queue and the sweep are the only things removing files today and a stuck job would leave video in storage past the promise. Third, feature 16 (privacy and terms) will state "30 days, delete any time", so the behaviour must be provable end to end before that text is written.

Forces: logs and job payloads carry IDs only; no soft deletes (a deleted take is gone, which is what the privacy promise says); a delete must never leave an orphan file; only the creator who owns a take can delete it.

## Requirements

**User stories**:
- As a creator, I want to see my past takes with their status and when the video goes away, so I know what I can still download.
- As a creator, I want to delete a take whenever I like and be sure everything about it is gone.
- As a creator, I want my transcript to stay after the video is removed, so I keep the words.

**Acceptance criteria**:
- **AC-1**: The library shows, for every take, its status and its video expiry. A take with a live video says "Video expires on 12 Dec" (the UTC date, the same short date the expired note uses) and, when fewer than 8 days remain, adds the days left ("in 3 days", "in less than a day"). An expired take says "Video removed on 12 Dec. Your transcript is kept." Dates are UTC. A take still uploading or processing has no expiry line until its upload has completed.
- **AC-2**: An expired take opens normally. The take page shows the title, Rename, the transcript and its downloads (text and captions), and says the video and original were removed on that date. Nothing on the page asks for a video link that is gone (no player error, no Download video button). Rename keeps working.
- **AC-3**: `DELETE /api/takes/{id}` deletes the signed in creator's take through `deleteTake`. It needs a session (401), a matching Origin (403, as on the other write routes), and ownership. A take that does not exist or belongs to someone else is 404 `not_found` with the same body, so ownership is not revealed. Success is 204 with no body. A repeat call is 404 and changes nothing.
- **AC-4**: The take page has a Delete button (in the Details tab and the header menu of the take, reachable by keyboard, 44 px target). It opens a confirm dialog that says what goes: "This removes the video, the original, the transcript and every edit. You can't undo it." with the take's title, a "Delete take" button (destructive style) and "Keep it". While the request runs the button is disabled and shows progress. On success the page goes to `/library`, a status message says "Take deleted." and focus lands on the library's main heading. On a server error the dialog stays open with "We couldn't delete this take. Try again." On a network failure or timeout the outcome is unknown (the server may have committed before the reply was lost), so the dialog says "We couldn't confirm the delete. Try again to check." and keeps the button enabled; a retry that gets 404 counts as success (it is already gone).
- **AC-5**: Each library card has a Delete action (a menu on the card, not covering the card's link; keyboard reachable) that uses the same dialog and the same rules. On success the card leaves the list at once, the count of takes in the page updates, and a polite status message says "Take deleted." Focus moves to the next card, or to the upload area when the list is now empty. An empty library shows the existing empty state.
- **AC-6**: Deleting a take removes every stored file and every record for it,: the original, its thumbnail, every render file, every preview still, and the rows for the take, its jobs, steps, cuts, renders, transcript, transcript edits and previews. Every file key is queued in `storage_deletion` in the same transaction as the row delete, and the queue drain is requested after commit. Only the usage row is kept (it records processed seconds under an HMAC of the email, not the take). A failure in the drain never undoes the delete and is retried by the drain task and by the cleanup sweep.
- **AC-7**: Deleting a take while a job runs is allowed. The job's Trigger.dev run is cancelled after commit (best effort), a job step that finds its take gone ends quietly, and no file the job wrote after the delete is left to the backstop: every step that uploads a file (render, preview, thumbnail, waveform) checks right after the upload that its take row still exists, and if it does not, queues the key it just wrote in `storage_deletion` (the queue has no foreign key, so this works after the take is gone) and asks for a drain. The key is known to the step because render and preview keys are derived from ids. Time already charged to usage stays charged.
- **AC-8**: Videos older than 30 days are removed automatically and their transcripts remain. The cleanup sweep (every 15 minutes) expires every take whose `video_expires_at` has passed, except a take whose job is still running, which waits until the job ends. After expiry the original, thumbnail, renders and preview stills are queued and removed; the take row, its cuts and its transcript stay; the expiry time is never extended. Media links for an expired take answer 410, and a request that needs the original answers 409 `original_gone`.
- **AC-9**: R2 lifecycle rules are a backstop. The storage bucket carries rules, kept in the repo and applied by a script, that delete objects under `originals/`, `renders/` and `previews/` 35 days after they were written (5 days later than the app promise, so the sweep stays the owner of the normal case; the 35 days run from each object's write time, so a late render or preview can outlast day 35 after upload, see Consequences), and abort incomplete multipart uploads after 2 days. No rule touches `backgrounds/` (studio images and the creator's own backgrounds), and a test fails if a rule's prefix could match them. The script is safe to run twice and is run by the deploy workflow before the Worker ships.
- **AC-10**: Deleting an account still removes all of the person's takes and files through the same path (spec 0006 `beforeDelete`), proven by a test that creates a take with every kind of row and file, deletes the account and finds nothing left.
- **AC-11**: Every delete and expiry is job safe and private: logs, errors and job payloads carry take IDs and counts only, never titles, transcripts, keys with a creator's name in them or presigned links. The confirm dialog and messages never include anything but the take's own title, which only the owner sees.
- **AC-12**: The new controls are accessible and responsive: the dialog traps focus, Escape closes it, and a dialog closed without a delete (Keep it or Escape) returns focus to the control that opened it (after a successful delete the focus targets in AC-4 and AC-5 apply instead; after a failed delete the dialog stays open and focus moves to its error message, a `role="alert"` line inside the dialog, so the trap holds), the Delete action is announced with the take's title ("Delete <title>"), the destructive button meets AA contrast, and the library and take page work at phone width without sideways page scroll.

## Options considered

### Option 1: Finish what is there (chosen)

Add the missing delete route and UI, tighten the expired wording, and add lifecycle rules as a backstop. Reuses `deleteTake`, `expireDueTakes`, `storage_deletion` and the existing cards and dialog.

**Pros**:
- Small and low risk; the data side is already tested.
- Keeps one path for every deletion (creator, expiry, account), so the privacy promise has one mechanism to prove.

**Cons**:
- The lifecycle backstop needs a bucket level credential in CI.

### Option 2: Soft delete with a short undo window

Mark a take deleted and remove it 10 minutes later, with an Undo link.

**Pros**:
- Forgives an accidental click.

**Cons**:
- Breaks "no soft deletes" and the promise that delete removes everything now; adds a hidden state to every query.

### Option 3: Rely only on the app sweep

Skip lifecycle rules.

**Pros**:
- No new infrastructure.

**Cons**:
- One stuck cleanup task would keep videos past 30 days, which is the one promise we publish.

## Decision

**Chosen option**: Option 1: Finish what is there.

Add `DELETE /api/takes/{id}`, a confirm dialog on the take page and the library cards, clearer expired states, and R2 lifecycle rules at 35 days as a backstop to the existing deletion queue.

**Implementation skills**: `cloudflare` (`cloudflare/skills`, `.claude/skills/cloudflare/`) · `wrangler` (`cloudflare/skills`, `.claude/skills/wrangler/`) · `vercel-react-best-practices` (`vercel-labs/agent-skills`, `.claude/skills/vercel-react-best-practices/`)

## Rationale

The expensive and risky parts (one transaction that queues every file, cancelling a running job, expiring without touching transcripts) are already built and tested, so the honest design is to expose them and prove them, not rebuild them. A soft delete would be friendlier but contradicts the privacy promise and the project rule, so the confirm dialog carries the safety instead. Lifecycle rules are set at 35 days, not 30, so the sweep and the queue stay the normal path, with storage itself as a net that never fires in a healthy system and never removes anything a creator was promised.

## Feature design

**Data model sketch**: no schema change. Reads `take.video_expires_at`, `take.status`; deletes through the cascades in spec 0002; `storage_deletion` is the queue.

**State transitions**: unchanged (spec 0002): `ready` or `failed` becomes `expired` once `video_expires_at` passes (not while `processing`); `expired` is read only apart from Rename. A delete removes the take from any state.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/takes/{id}` | DELETE | id in the path | 204, no body | session, same Origin | 401, 403, 404 `not_found`, 500 |

Existing routes are unchanged: GET lists and reads, PATCH renames. The library page keeps using `GET /api/takes` for more pages.

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Library card | status badge | `effectiveStatus(take.status, take.videoExpiresAt, take.expired, now)` in `take-display.ts` |
| Library card | "expires on" date and days left | `video_expires_at` (UTC), `now` from `use-now.ts`; "less than 8 days" rule decided here |
| Library card, take page | "removed on" date for an expired take | `video_expires_at` (the date the video was due to go; the sweep can lag 15 minutes, not days) |
| Delete dialog | the take's title | take row `title`, already in the card and take GET |
| DELETE | creator identity | session user id, never a body field |
| DELETE | file keys to remove | `takeFileKeys` (original, thumbnail, derived render keys, derived preview keys) |
| DELETE | runs to cancel | `processing_job.trigger_run_id` of active jobs, read inside the transaction |
| Lifecycle script | prefixes and days | constants in `src/lib/storage-lifecycle.ts` (35 days, 2 days; the 30 day promise stays `VIDEO_RETENTION_DAYS`) |
| Lifecycle script | bucket and credentials | `R2_BUCKET` and a deploy only R2 admin token held as a CI secret (never in the Worker) |

**Key invariants**:
- Retention is 30 days from upload completion and is never extended.
- A transcript lives until its take is deleted; expiry never removes it.
- Every file key removed from a row is queued in the same transaction.
- Lifecycle days are greater than `VIDEO_RETENTION_DAYS`, enforced by a unit test.
- A take is deletable only by its owner.

**Security model**: creator scoped like every route in `src/server/takes`: session, Origin check, `creator_id` in the where clause, and the same 404 for "missing" and "not yours". The lifecycle token is deploy only, scoped to the one bucket, never present in the Worker or Trigger.dev environment.

**Configuration required**:
- `R2_LIFECYCLE_TOKEN` (CI secret, bucket scoped): applies the lifecycle rules in the deploy workflow.

**Critical test scenarios**:
- Happy path: a creator deletes a ready take from the library and from the take page; the card goes, files are queued, rows are gone, verifies **AC-3**, **AC-4**, **AC-5**, **AC-6**.
- Failure case: a failure before the commit keeps the take and shows the retry message; a failure after the commit (cancelling the run or requesting the drain) still answers 204, because the delete happened and the drain is retried by the sweep; a network failure shows the unknown outcome message and a retry that gets 404 ends as done; a repeat DELETE is 404, verifies **AC-3**, **AC-4**, **AC-6**.
- Late upload: a job uploads a file after its take was deleted; the step queues that key and it is removed by the drain, not left for the 35 day backstop, verifies **AC-7**.
- Auth and permission: signed out is 401, another creator's take is 404 with the same body, a wrong Origin is 403, verifies **AC-3**.
- A running job: delete while `processing` cancels the run and leaves no file or row, verifies **AC-7**.
- Expiry: a take past 30 days is expired by the sweep, its files are queued, its transcript and cuts remain and the page shows the transcript, verifies **AC-2**, **AC-8**.
- Backstop: a unit test fails if a lifecycle rule prefix could match `backgrounds/`, or if the days are not above retention; the script is idempotent, verifies **AC-9**.
- Account deletion leaves nothing, verifies **AC-10**.
- Accessibility: axe on the dialog and the card menu, keyboard path, phone width, verifies **AC-12**.

## Build plan

Tracer Bullet: one real thread first (route, then the button, then proven through the real API), then the library, the expired wording and the backstop.

1. Add `handleDelete` and the `DELETE` handler on `/api/takes/[id]` with Origin and session checks, route tests (401, 403, 404, 204, repeat 404, another creator's take), satisfies **AC-3**
2. Make `deleteTake` best effort after the commit (catch and log the IDs of a failed cancel or drain, still return ok), make each uploading job step queue its own key when its take is gone, then prove the whole removal: extend `delete.test.ts` and the pipeline checks so transcript rows, edits, previews, thumbnail and render files are all gone or queued, and a delete during a running job leaves nothing, satisfies **AC-6**, **AC-7**
3. The confirm dialog and the take page Delete button with the failure and 404 paths, then back to `/library` with the status message, satisfies **AC-4**, **AC-11**, **AC-12**
4. The library card Delete action using the same dialog, with focus handling and the empty state, satisfies **AC-5**, **AC-12**
5. Expiry wording and the expired take page: the date lines in `take-display.ts`, hide the video controls and links for an expired take, keep Rename and the transcript, satisfies **AC-1**, **AC-2**, **AC-8**
6. Confirm the sweep rule with a test (expired after the date, waits for a running job, transcript and cuts stay), satisfies **AC-8**
7. R2 lifecycle rules: `src/lib/storage-lifecycle.ts` (rules and guard tests), `scripts/apply-r2-lifecycle.sh`, and a deploy workflow step before the Worker ships, satisfies **AC-9**
8. Account deletion test with a take of every kind, then browser tests and axe for the dialog, card menu and expired page, satisfies **AC-10**, **AC-12**

## Consequences

**Positive**:
- A creator can delete anything, any time, and the promise "delete removes everything" is tested end to end.
- One deletion path serves the creator, the 30 day sweep and account deletion.
- A stuck sweep removes originals and thumbnails no later than 35 days after upload. Renders and previews go no later than 35 days after they are written. A render can only be written while the original exists (a re render after day 30 is refused with `original_gone`), so the worst case is a render written near day 30 that stays until about day 65, and only when the sweep itself is stuck. The backstop is a net for that failure, not a second 30 day promise; the sweep owns the 30 days.

**Negative / tradeoffs**:
- A deploy needs one more credential and step.
- A delete cannot be undone, by design.

**Neutral**:
- No schema change and no new email.
- The expiry date in the library is the date the video was due to go, in UTC, not the time of the sweep.

## Follow-up

- [x] Decisions for Toyin (C-30, 2026-11-14, she took the recommended option of each): no reminder email before a video expires; the time saved counter stays Deferred; no search or filters in the library; the R2 lifecycle backstop is 35 days.
- [ ] Nightly check that lists storage and compares it with the database, to catch an orphan the lifecycle rules do not (deferred, the lifecycle rules cover the promise).
- [ ] Feature 16 (privacy and terms) quotes this behaviour: 30 days, transcripts kept until deleted, delete any time.
- [ ] `/sync` adds the delete route and the lifecycle script to `src/server/AGENTS.md`, `src/components/takes/AGENTS.md` and `scripts/AGENTS.md` once built.

## References

**Project sources**:
- Spec 0002 (data model, AC-15, AC-17, AC-18 and the lifecycle follow up), spec 0001 (the 30 day details line), spec 0004 (library and expiry notes), spec 0006 (account deletion), spec 0012 (transcript and cuts kept)
- `src/db/data/deletion.ts`, `src/db/data/cleanup.ts`, `src/trigger/cleanup.ts`, `src/trigger/storage-deletion.ts`, `src/server/takes/index.ts`
- Installed skills: `cloudflare`, `wrangler`

**Practices and standards**:
- Defence in depth for retention: an application sweep plus a storage side rule
- Same 404 for missing and not yours, so ownership is not revealed
