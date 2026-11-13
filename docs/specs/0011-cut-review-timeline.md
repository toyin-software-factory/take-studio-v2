# 0011. Cut review timeline

**Date**: 2026-11-12
**Status**: Proposed

## Summary

After the automatic trim, the take page shows every cut on a timeline under the player, drawn over the take's audio waveform. You tap a cut to put that part back (or tap again to cut it), hear the change on the player straight away, and nothing changes for real until you press Render in the pending changes bar. Cut changes and a new background choice wait in that one bar and go out in one free re render, which counts toward the same 10 changes an hour as background changes. The transcript is not made again; it is shown and exported for whatever the new video keeps.

## Context

Slice 1 trims pauses automatically: `process-take` finds silences, stores each one as a `cut` row and renders the take without them. Creators cannot see or change those decisions today. A deliberate pause gets removed and there is no way to get it back, short of uploading the take again. The scope (feature 9) asks for every cut to be visible and playable, each one undoable, and the final render and transcript to match exactly the kept cuts, all usable by keyboard.

Most of the data side already exists (spec 0002): a cut has `applied` and `creator_changed_at`, `cuts.setApplied` flips one, re analysis keeps creator touched cuts, and every render snapshots its `removed_ranges` at the render step. Spec 0008 added a free re render of a Ready take (`startBackgroundJob`, job kind `background`) that reuses the take's applied cuts, keeps the current video playable and is capped at 10 per creator per hour. The transcript is stored on the original take's timeline and mapped onto each render's snapshot at read time (spec 0007), so a render with different cuts already gets a matching transcript without calling Deepgram again.

Toyin's take page draft (`docs/design/take-page-v2.html`, `design.md` §4b) shows the target: a waveform timeline in the stage panel, hatched cut blocks you tap to restore, a summary line ("2 pauses cut, 3.0 s saved."), and a pending changes bar with Discard and Render that also holds a new background choice. Spec 0009 left these parts out until this slice.

Forces: a re render of a keyed 10 minute take costs about 15 minutes of `large-1x` compute, so changes must be batched and capped. Only the latest render keeps a video file, so a change can only be undone by rendering again. The original upload expires (`original_gone`), after which nothing can be rendered.

## Requirements

**User stories**:
- As a creator, I want to see every pause that was cut from my take, so I can check the trim didn't remove something I meant to keep.
- As a creator, I want to put a cut back (or cut it again) and hear the result before I commit, so I only spend a render on a version I like.
- As a creator, I want one Render for all my changes (cuts and background), so I wait once and my downloads and transcript match the new video.

**Acceptance criteria**:
- **AC-1**: On a Ready take with at least one cut, the stage panel shows a timeline of the whole original take under the player: the waveform, every cut as a block at its place, the playhead, and a summary line. Every cut is numbered 1, 2, 3… in time order (all cuts, whatever their kind or state). A block is drawn at least 12 px wide, centred on the cut, with a hit area at least 24 px wide and 44 px tall; where blocks overlap, the later one is on top. The timeline is `max(container width, 8 px × duration in seconds)` wide and scrolls sideways inside itself when wider. The summary counts the cuts that are cut in the pending state: "1 pause cut, 0.4 s saved." / "N pauses cut, X.X s saved." (seconds = sum of their lengths in ms ÷ 1000, rounded half up to one decimal). A take with no cuts, or with every cut kept, shows "No pauses cut." (and no blocks when there are no cuts). Kept cuts (including any the trim never applied) show as an outlined, dashed block.
- **AC-2**: Each cut block is a button. Activating it (click, tap, Enter or Space) toggles that cut between cut and kept as a pending change, and seeks the player to 1 second before the cut start (clamped to 0) and plays, so the creator hears it. Its accessible name says its label, length and state: "Pause 3, 1.4 seconds, cut. Press to keep it." / "… kept. Press to cut it.", where the label is "Pause N" for a cut of kind `pause` and "Cut N" for any other kind. `aria-pressed` is true when kept. Cut blocks are in the tab order in time order; focus is visible.
- **AC-3**: While there are pending cut changes, the player plays the original upload and skips every range that is cut in the pending state, so what you hear is what Render will make. Skips are checked every frame (`requestVideoFrameCallback`, else `requestAnimationFrame`), not on `timeupdate`. At the end of the last kept range the player pauses; the time display shows the pending version's position and its total (original length minus the pending cut total). Switching source (the first pending change, Discard, or a success) keeps volume and playback rate and maps the current position across through the ranges. With no pending cut changes, the player plays the latest render as today and the playhead maps render time onto the original timeline through that render's `removed_ranges`. Before the first switch, the page checks the original can play (`canPlayType` for its type, then the `error` event); if it cannot (for example HEVC in Chrome), the player keeps the current render, the line "Preview isn't available for this file. Render to hear it." shows, and the timeline stays editable. The preview shows the original as recorded (green screen, no background, no tone map); the page says so in one line under the player while previewing ("Previewing your cuts on the original recording.").
- **AC-4**: A pending changes bar appears in the stage panel whenever the pending state differs from the current video: it lists each change in plain words, cuts in time order then the background last. A cut change is "Keep" (the change keeps the part) or "Cut" (the change removes it) followed by the AC-2 label in lower case: "Keep pause 3", "Cut pause 5", "Keep cut 6". The background change is "Background: Warm studio", or "Background: Original" for the original. The bar has Discard and Render. Picking the background the video already has removes the background change. Discard returns every cut and the background choice to the current video's state. Leaving the page with pending changes asks for confirmation: the browser's leave warning on reload or close, and a confirm on in app navigation (links and back).
- **AC-5**: Picking a background in the Background tab makes it a pending change in the same bar (the still preview from spec 0008 AC-4 works as before). There is no separate "Use this background" render any more; Render applies cut and background changes together in one job.
- **AC-6**: Render starts one re render that keeps the take Ready with its current video playable, charges 0 seconds, sends no email, does not make the transcript again, and shows render progress (the existing processing steps). While any job runs for the take, cut blocks, the Background tab's pick and Render are disabled and the status line says "Rendering…"; the pending state is frozen as it was at the Render press. On success the new video, background and cut states become current, pending resets to them, and a status message says "Rendered. Your downloads are up to date." (no Undo button). On failure or cancel the previous video, background and cut states all stay, the frozen pending state comes back as pending, and the page offers "Try again", which sends the same changes. Try again exists only while the page still holds that state (a reload loses it, like any pending change).
- **AC-7**: After a successful render, the video, the downloads, the captions and the transcript (view and every export format) reflect exactly the kept cuts: a restored range is present in the video and its words appear in the transcript; a cut range is absent from both.
- **AC-8**: Render is refused with a friendly message, nothing changed, when: another job runs for the take; the take is not Ready; its original has expired (then the timeline is read only, its blocks are disabled and a line says "The original has expired, so cuts can't be changed."); a change names a cut that is not this take's; the changes would cut the whole take; nothing differs from the current video (a request after a failed render is accepted only if it still holds at least one real change, so an empty request never starts a render); the chosen background is not ready or the take has no green screen (as spec 0008 AC-6); the take is keyed but its current background was deleted and the request names no new one (409 `background_missing`, "The background on this take was deleted. Pick a background to render."). Cut and background changes share one limit: at most 10 changes started per creator per hour (429, "You've made a lot of changes in the last hour. Please try again later."); after a 429 the page hides Render until reload. Every refusal body is `{ error: code }` as in the existing routes, and each code has one friendly line in `src/lib/take-messages.ts`. If the original's link expires or the original stops playing mid session (410 or a media error), the page switches to the read only state and keeps the pending state on screen.
- **AC-9**: A cut the creator kept or cut again is never undone by a later re analysis (spec 0002 AC-9): its `creator_changed_at` is set, to the job's `finished_at`, when the render that applied it succeeds.
- **AC-10**: The timeline is fully usable by keyboard and screen reader: Tab reaches every cut block and the bar's buttons; the summary line and the pending bar are announced through polite live regions (`role="status"`) that are in the page from first load, empty until needed; the waveform is decorative (`aria-hidden`). It meets WCAG AA contrast for the cut, kept and focus states on the dark stage panel, and it works at phone width (horizontal scroll inside the timeline only, never the page).
- **AC-11**: Every take processed after this ships stores a waveform of its original audio (at most 1000 values, each 0 to 100); an older take gets one on its first successful change render. A take with no stored waveform (not yet computed, or no audio) shows a plain track with the cut blocks and playhead instead; nothing else changes.

## Options considered

### Option 1: Flip cut flags at once, then render the take's applied cuts

Each tap calls `cuts.setApplied` right away; Render then starts the existing `background` job, which snapshots the take's applied cuts.

**Pros**:
- Almost no new server code: the endpoint and the job already exist.

**Cons**:
- The stored cut flags stop matching the playing video between a tap and a successful render, and stay wrong after a failed render or a closed tab. The timeline would show cuts that are not what the video has.
- Two tabs on the same take overwrite each other's taps.

### Option 2: The job carries the requested cut changes; flags change only on success (recommended)

Taps stay in the browser as pending state. Render sends the full set of changes in one request; the job stores them as its `cut_plan`; the render step builds `removed_ranges` from the take's cuts with the plan applied on top; `finishInTx` writes the new `applied` flags and `creator_changed_at` only when the render succeeds.

**Pros**:
- The stored cut flags always describe the current video, so the timeline, transcript and downloads never disagree, and a failed render changes nothing.
- One request, one lock, one job: cut and background changes are atomic together.

**Cons**:
- A new column on `processing_job` and a change to the render snapshot and the finish path.
- Pending changes live only in the page, so a closed tab loses them (the leave warning covers the common case).

### Option 3: Save pending changes as a server side draft

Store a draft cut set per take on the server; Render promotes it.

**Pros**:
- Pending changes survive a reload and another device.

**Cons**:
- A draft table, its lifecycle and its cleanup, for changes that take seconds to redo. Nothing in the scope asks for it.

## Decision

**Chosen option**: Option 2: The job carries the requested cut changes; flags change only on success.

A single `POST /api/takes/[id]/changes` starts one free `background` job carrying the requested background and cut changes, and the take's cut flags only change when that render succeeds.

**Implementation skills**: `trigger-tasks` (`triggerdotdev/skills`, `.claude/skills/trigger-tasks/`) · `vercel-react-best-practices` (`vercel-labs/agent-skills`, `.claude/skills/vercel-react-best-practices/`) · `web-design-guidelines` (`vercel-labs/agent-skills`, `.claude/skills/web-design-guidelines/`)

## Rationale

The scope's done when is "the final render and transcript reflect exactly the kept cuts". That only holds if the stored cut flags never run ahead of the video, because the transcript, captions and downloads are all derived from the latest render's snapshot and the cut list. Option 1 breaks that the moment a render fails or a tab closes. Option 2 keeps the stored state equal to the shipped video and makes Render atomic, which is also what lets one job carry both a background and cut changes (Toyin's choice of one Render button).

The job keeps the kind `background` rather than adding a new kind. In this codebase a `background` job already means "a free change of a Ready take: no trim, no email, no transcript, capped per hour", and every path that matters (`isBackgroundChange`, the hourly count, the email filter, the stale cleanup cutoffs) already treats it that way. A new kind would need a migration of the kind CHECK and a second legacy path during the deploy, for a name only. The function and route names change to say "change" instead; the kind stays.

The waveform is computed in the job that already decodes the audio, so it costs a fraction of a second there, while computing it in the browser would mean downloading the whole original first. Pending state stays in the page (not Option 3) because nothing in the scope asks for drafts that survive a reload, and the leave warning covers the common accident.

## Feature design

**Data model sketch** (one migration):

| Table | Change | Type | Null | Notes |
|---|---|---|---|---|
| `processing_job` | add `cut_plan` | `jsonb` `readonly { cutId: string; applied: boolean }[]` | nullable | Only on a `background` job started by the changes endpoint; null on every other job and on a background only change. Holds only the cuts whose state changes. |
| `take` | add `waveform` | `jsonb` `readonly number[]` | nullable | Integers 0 to 100, length 1 to 1000, evenly spaced over the original's length (`take.duration_ms`). Written by `process-take` on an `initial` job (and a full `rerender`), and on a `background` job when it is still null. Null when there is no audio or not computed yet. Personal data in a weak sense (shape of the voice): never log it. |

No change to `cut` or `render`. A cut row keeps its id across re renders (re analysis runs only on `initial`, and only replaces untouched cuts; spec 0002 AC-9).

**State transitions**: the take stays `ready` throughout (as spec 0008). Job: `queued → running → succeeded | failed | cancelled`, as today. On `succeeded` only: each `cut_plan` entry sets `cut.applied` and `cut.creator_changed_at` (the job's `finished_at`, one value for all entries); the latest render flips and `take.background_id` updates from the new render (as today). On `failed` / `cancelled` (including the cancel path): no plan is applied, no cut or background change.

Page state (browser only): `current` (from the take GET: cut flags + background) and `pending` (a copy the creator edits). Pending changes = cuts whose pending `applied` differs, plus the background if it differs. Render sends them and freezes `pending` (no edits while a job runs); a success poll resets `pending` to the new `current`; a failure poll unfreezes it and shows Try again; Discard resets it at once.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/takes/[id]` | GET | (existing) | adds `cuts: { id, startMs, endMs, kind, applied }[]` (time order, `applied` as stored = current video), `originalAvailable: boolean`, `render.removedRanges: { startMs, endMs }[]` (the latest render's snapshot; `[]` when there is no render) | session, owner | 404 |
| `/api/takes/[id]/waveform` | GET | none | `{ waveform: number[] \| null }`, fetched once per page load (not part of the polled take GET, which would resend about 4 KB every poll); re fetched once after a success if it was null | session, owner | 404 |
| `/api/takes/[id]/changes` | POST | `background` (opt): `{ id: uuid \| null }` (null is the original; absent keeps the current) · `cuts` (opt): `{ id: uuid, applied: boolean }[]`, max 2000, unique ids | 202 `{ jobId }` | session, owner, Origin check | body `{ error: code }`: 404 `not_found` (take, cut or background not this creator's) · 409 `job_active`, `invalid_transition`, `original_gone`, `nothing_changed`, `no_green_screen`, `background_not_ready`, `background_missing` · 422 `invalid` (bad body, whole take cut) · 429 `change_limit` |
| `/api/takes/[id]/background` | PUT | `{ backgroundId }` | 202 `{ jobId }` | as today | as today |
| `/api/takes/[id]/media?kind=original` | GET | (existing) | presigned original URL | session, owner | 404, 410 `original_gone` |

`PUT /background` stays one release as a thin wrapper over the same start function (`cuts` empty), so a tab loaded before the deploy keeps working; a follow up removes it. Body validated with zod; `cuts` entries that do not change a cut's stored state are dropped before comparing (so a stale tab cannot "change" a cut to what it already is).

**Server function**: `startBackgroundJob` becomes `startChangeJob(db, { creatorId, takeId, background?: { id: string | null }, cuts: readonly { id, applied }[], now? })` in `src/db/data/jobs/background.ts`, same transaction and lock order (creator, background `FOR KEY SHARE`, take `FOR UPDATE`, then the take's cuts read inside the lock). Steps 0 to 7 of today's function stay, with these changes:
- After the take checks, read the take's cuts; any requested id not among them is `not_found`; drop entries equal to the stored state.
- `nothing_changed` (replaces `same_background`): target background equals the effective one (or absent) and no cut entry remains. There is no exemption keyed on a failed latest job: Try again resends real changes, which pass this check because a failed job changed nothing.
- Inherited background (request names no background): derive it from the latest render as `same_background` does today (`keyed ? render.background_id : null`), not from `take.background_id`. If the latest render is keyed and its `background_id` is null (the background was deleted), refuse `background_missing`. Otherwise check the inherited background is still `ready` (`background_not_ready`).
- `invalid`: the stored ranges with the plan applied would remove the whole take (no kept range of at least 1 frame; reuse the render's own "nothing to keep" rule from `src/lib/cut-rules.ts`).
- The `no_green_screen` refusal applies only when the request names a real background different from the current one; a cut only change on a no green screen take is allowed.
- `background_change_limit` keeps its code internally but the HTTP error is `change_limit` with the new message (AC-8); count unchanged (all `background` jobs, plus the legacy `rerender` rule).
- Insert the job with `target_background_id` (requested, else the inherited one above, so an unchanged keyed take stays keyed) and `cut_plan` (null when empty), steps `background` (only for a real background) and `render`.

**Job changes** (`src/trigger/process-take.ts`, `src/db/data/jobs/`):
- Render snapshot: build `removed_ranges` from the take's cuts with `applied` taken from the job's `cut_plan` where present, else the stored flag. The plan is read from the locked job row inside `renders.create`'s transaction, never from the task payload, so a Trigger retry (a fresh render row) reads it again and gets the same result. One pure function in `src/lib/cut-rules.ts` (`effectiveRemovedRanges(cuts, plan)`), used by both the snapshot and the start check.
- `finishInTx`, `background` job succeeded: inside the same transaction, for each plan entry update `cut.applied` and `creator_changed_at` (the job's `finished_at`) `WHERE id = $cut AND take_id = $take`. Safety check first: if the job has a non null plan and the new render's `removed_ranges` do not equal `effectiveRemovedRanges(cuts, plan)`, fail the job instead (`render_mismatch`, logged with IDs), so an old task version that ignores the plan can never ship a wrong video as success. Failed or cancelled: nothing.
- Deploy order: CI already ships migrate, then Trigger.dev, then the Worker, so the task that reads `cut_plan` is live before any page can send one; keep that order.
- Waveform: on `initial` (and full `rerender`), and on a `background` job when `take.waveform` is null, after the download, one ffmpeg pass (`-ac 1 -ar 8000`, raw PCM to stdout) bucketed into `min(1000, ceil(durationMs / 100))` RMS values. Each bucket becomes `v = round(100 × clamp((20 × log10(rms) + 60) / 60, 0, 1))` (rms of samples scaled to −1..1, so absolute dBFS with a −60 dB floor; digital silence, rms 0, is 0), by a pure function `waveformFromSamples` in `src/lib/waveform.ts`; written through `whileJobActive`. A failure here logs the take and job IDs and leaves `waveform` null; it never fails the job. No audio stream: null.

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Timeline | block position and width | `cuts[].startMs`, `endMs` over `take.durationMs` (take GET) |
| Timeline | cut / kept state | pending state, seeded from `cuts[].applied` (stored = current video) |
| Timeline | number and label | index in the time ordered `cuts` list (all kinds), 1 based; "Pause" for kind `pause`, "Cut" otherwise |
| Timeline | width | `max(container, 8 px × durationMs / 1000)` |
| Timeline | waveform bars | `GET /waveform`, once per page load; null → plain track |
| Summary line | N and seconds saved | derived in the page from pending state: count of applied cuts, sum of their lengths in ms ÷ 1000, rounded half up to one decimal; singular "pause" at N = 1 |
| Player, pending | the video played | `/media?kind=original` presigned URL, after a playability check; ranges skipped = pending applied cuts |
| Player, pending | total duration shown | `take.durationMs` minus the sum of pending applied cut lengths |
| Player, no pending | playhead on the original timeline | `render.removedRanges` (take GET) |
| Pending bar | change list and background name | diff of pending vs current, cuts in time order then background; "Keep"/"Cut" + lower case label; background name from the existing background list, null → "Original" |
| Render | job request | pending diff → `POST /changes` body |
| Render progress | steps | existing take GET `job.steps` polling |
| Read only state | `originalAvailable` | `!isExpired(take, now)` (same rule as `original_gone`); also entered on a 410 or media error from the original mid session |
| Preview unavailable | whether the original can play | `canPlayType` for the original's type, then the `error` event |
| Refusal messages | friendly text | `src/lib/take-messages.ts`, one entry per error code |
| Success message | "Rendered. Your downloads are up to date." | shown when a polled `background` job goes `succeeded` |
| Transcript after render | kept words | unchanged spec 0007 read path over the new latest render's `removed_ranges` |
| `creator_changed_at` | timestamp | the job's `finished_at` in `finishInTx` |

**Key invariants**:
- The stored `cut.applied` flags of a take equal the latest succeeded render's `removed_ranges` (after any job finishes). Only `finishInTx` of a succeeded `background` job with a plan changes them through this feature.
- `cut_plan` is set only on `background` jobs and names only cuts of the job's take.
- A render never removes the whole take (start check plus the existing render guard).
- At most one active job per take (existing unique index); at most 10 `background` jobs started per creator per rolling hour.

**Security model**: creator scoped like every take route. Ownership in the query (`take.creator_id`); a cut id is matched only among the locked take's own cuts, so another creator's cut id is `not_found`. Origin check on POST (existing route pattern, `src/server/AGENTS.md`). The original URL is presigned only after the ownership check and an R2 HEAD (existing media rule). No new personal data leaves the server; logs carry take, job and cut IDs only, never ranges with words, waveforms or presigned links.

**Configuration required**: none.

**Critical test scenarios**:
- Happy path: restore one cut and change background in one request; the job succeeds; the new render's `removed_ranges` lacks that range, `cut.applied` is false with `creator_changed_at` set, the background is current, 0 charged, no email, verifies **AC-5**, **AC-6**, **AC-9**.
- Transcript: a restored range's words appear in the transcript view and SRT after success, and a range cut again disappears, verifies **AC-7**.
- Failure: the render fails; cut flags, background and latest render are unchanged; Try again with the same body is accepted (not `nothing_changed`), and an empty body after the failure is `nothing_changed`, verifies **AC-6**, **AC-8**.
- Refusals: job active, take not Ready, original expired, unknown cut id, whole take cut, nothing changed, keyed take whose background was deleted with a cut only request (`background_missing`), 11th change in an hour (cut only and background changes counted together), verifies **AC-8**.
- Plan mismatch: a render whose `removed_ranges` ignore the plan fails the job and changes no flags, verifies **AC-7**.
- Waveform: an old take with null waveform gets one after its first successful change render, verifies **AC-11**.
- Re analysis after a creator change keeps the creator's state, verifies **AC-9**.
- Auth: another creator's take or cut id gives 404 and changes nothing, verifies **AC-8**.
- Pure: `effectiveRemovedRanges` (plan over stored flags, ordering, merge of touching ranges), the render time to original time mapping and back, `waveformFromSamples` (length cap, scaling, silence is 0), verifies **AC-3**, **AC-7**, **AC-11**.
- Browser (Playwright, fixture take with 3 cuts): Tab to a cut, Space toggles `aria-pressed` and the pending bar lists it; Discard clears it; Render disables the blocks and shows progress then the success status; an in app link with pending changes asks to confirm; an unplayable original shows the preview unavailable line and keeps the render playing; phone width has no page horizontal scroll; axe passes on the take page, verifies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-6**, **AC-10**.
- Old take with no waveform shows the plain track, verifies **AC-11**.

## Build plan

Tracer Bullet: one thin thread first (restore one cut, render, see it in the video and transcript), then thicken.

1. Migration (`processing_job.cut_plan`, `take.waveform`), `effectiveRemovedRanges` in `src/lib/cut-rules.ts`, `startChangeJob` with all refusals, the render snapshot reading the plan, the `finishInTx` success write, `POST /api/takes/[id]/changes`, `PUT /background` as a wrapper, the take GET additions (`cuts`, `originalAvailable`, `render.removedRanges`), `GET /waveform`, the plan mismatch safety check, the new messages; data and route tests incl. lock order and the shared limit (Jim), satisfies **AC-6**, **AC-7**, **AC-8**, **AC-9**.
2. Waveform: `src/lib/waveform.ts` and the ffmpeg pass in `process-take` (`initial`, full `rerender`, and `background` when still null), extend `pnpm test:pipeline` to check a waveform is stored and a cut change render matches its plan (Jim; can run beside task 3 once task 1 is merged), satisfies **AC-11**, **AC-7**.
3. Timeline and pending bar UI in the stage panel per `docs/design/take-page-v2.html` and `design.md` §4b (Mobbin references first): timeline with waveform or plain track, cut buttons, summary line, original playback with skipping, playhead mapping, pending bar with Discard and Render, leave warning, Background tab feeding the pending bar instead of its own render button, success status, read only state, refusal messages; `design.md` copy rules updated (the "only built features" lines for the timeline and pending bar), Playwright and axe (Dwight, after task 1), satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-6**, **AC-10**, **AC-11**.
4. Verify end to end on production with the approved test account: restore a cut, render, check video length, transcript and downloads, then cut it again (lead runs `/check verify`), satisfies **AC-1** to **AC-11**.

## Consequences

**Positive**:
- Creators can fix a bad trim without uploading again, and every change is reversible by tapping again.
- Cut and background changes cost one render instead of two.
- The stored cut flags always describe the current video, so the transcript, captions and downloads stay consistent with no new transcript work.

**Negative / tradeoffs**:
- Each Render is a full re render (about 15 minutes of compute for a keyed 10 minute take) even for one restored pause. The shared limit of 10 an hour caps the cost; render speed work stays parked (see the job hosting notes).
- Pending changes are lost if the tab closes despite the warning.
- Previewing plays the original with client side skips checked every frame, so a skip can land up to about one frame off the exact cut point; the render itself is exact. The preview shows the raw recording (green screen, no tone map), and some browsers cannot play some originals (HEVC), where the creator renders to hear the change.
- The Background tab's "Use this background" behaviour from spec 0008 changes (AC-5), so its tests and copy change too.
- Takes processed before this ship show a plain track until their first change render computes the waveform.

**Neutral**:
- Job kind `background` now covers any free change of a Ready take, with or without a new background; the function and route names say "change".
- One release carries both `PUT /background` and `POST /changes`.

## Follow-up

- [ ] Spec 0008: AC-4 and AC-6 note that rendering a background choice now goes through the pending bar and the shared change limit (spec 0011 AC-5, AC-8); updated in the same PR as this spec.
- [ ] Remove `PUT /api/takes/[id]/background` one release after task 3 ships.
- [ ] Adding your own cuts (select a range to remove) is out of this slice by Toyin's decision; enroll it as its own feature if wanted.
- [ ] Slice 5 (AI editing agents) shows the reason for each agent proposed cut on this timeline; `cut.reason` and `proposed_by` are already stored.
