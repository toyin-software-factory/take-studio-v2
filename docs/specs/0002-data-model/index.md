# 0002. Data model for Take Studio

**Date**: 2026-11-10
**Status**: Proposed

## Summary

This spec fixes what Take Studio stores and how the pieces relate: takes, processing jobs and their steps, cuts, renders, backgrounds, transcripts, monthly usage, settings and API keys, all owned by a signed in creator. It is designed whole now so no later slice needs a breaking change, but each slice creates only the tables it uses, starting with the core take loop. Every read and write is scoped to the creator who owns the data, money like actions (charging and refunding minutes) happen in single database transactions, and files are deleted through a background queue so nothing is orphaned.

## Requirements

**User stories**:
- As a creator, I want my takes, their processing progress, cuts, finished video and transcript kept together so I can come back and review or download them.
- As a creator, I want to undo any cut and re render without paying again, keeping my own cut choices even if the AI re runs.
- As a creator, I want my uploaded backgrounds saved so I can reuse them.
- As a creator, I want deleting a take or my account to remove my videos and transcripts.
- As the product owner, I want a free monthly allowance that is charged fairly and can't be reset by deleting and rejoining.

**Acceptance criteria**:
- **AC-1**: The schema holds every entity in `## Feature design` with the listed fields, keys and constraints; each slice's migration creates only the tables that slice needs, and later slices only add tables, columns or values (never rename, retype or drop).
- **AC-2**: Every creator facing read or write (takes, jobs, steps, cuts, renders, transcripts, backgrounds, API keys) is scoped to the signed in creator through `take.creator_id` or the row's own `creator_id`; another creator's ID returns `not_found`.
- **AC-3**: A take moves only through the allowed status transitions in `## Feature design`, each applied as a compare and swap (`WHERE status = from`); anything else returns `invalid_transition`.
- **AC-4**: At most one processing job per take is `queued` or `running`, enforced by a partial unique index.
- **AC-5**: A take is `uploaded` only after the stored object's size is checked and the video is probed (length, width, height, container) within the limits (10 minutes, 2 GB, 1080p, MP4 or MOV); otherwise it becomes `failed` with a non refundable code.
- **AC-6**: Starting a job, in one transaction: the system derives the kind (`initial` if the take has no succeeded initial job, else `rerender`), charges `ceil(duration_ms / 1000)` seconds for a chargeable initial run and 0 for a re render, refuses with `limit_exceeded` if the charge would pass the allowance, creates the job and its ordered steps, and moves the take to `processing`; if any part fails, nothing is charged.
- **AC-7**: Each job step records status, progress (0 to 100) and its position, from the fixed step list per kind.
- **AC-8**: Each cut stores start and end (milliseconds, `0 ≤ start < end ≤ take length`, no overlap with another cut of the take), kind, who proposed it (rules, AI or creator), a short reason, whether it is applied, and when the creator last changed it.
- **AC-9**: A re render never recomputes cuts; it uses the current `applied` flags. Re analysis (initial run or an AI re run) keeps every cut the creator changed or added, and replaces only untouched rules or AI cuts.
- **AC-10**: Each render snapshots the exact removed ranges and background it used; captions for a render are built from its own snapshot. Only the latest succeeded render keeps a video file (`renders/{takeId}/{renderId}.mp4`); the previous latest's file is queued for deletion when a newer render succeeds.
- **AC-11**: If a job fails and the take already has a latest render, the take returns to `ready`; if it has none, it becomes `failed`. The job keeps the failure code.
- **AC-12**: Finishing a job is one transaction: job status (compare and swap, `already_final` on repeat), take transition, latest render flip, and refund when the failure code is refundable.
- **AC-13**: Refunds use the month and account stored on the job, happen at most once, and never take `seconds_used` below 0. Refundable codes are fixed in a code registry; creator cancels are refunded only before the job is `running`.
- **AC-14**: Built in backgrounds have no owner and are visible to everyone; uploaded backgrounds belong to one creator, never expire and can be deleted. If a take's background was deleted, starting a re render returns `background_missing` until the creator picks one.
- **AC-15**: A take has at most one transcript (full text, per word timings relative to the original upload, filler flag); it survives video expiry and is removed only with the take.
- **AC-16**: Usage is stored in seconds per account per UTC month under an HMAC of the canonical email (lowercased, `+tag` removed, Gmail dots removed, `googlemail.com` as `gmail.com`), so it survives account deletion; the allowance is the `free_monthly_seconds` setting (default 3600).
- **AC-17**: Deleting a take or account removes all its rows (except usage), queues every stored file for deletion in the same transaction, and cancels any running job; a background task deletes the files with retries.
- **AC-18**: A scheduled cleanup fails abandoned uploads (and aborts their multipart upload), fails stuck jobs with a refundable code, and expires takes whose `video_expires_at` passed (queuing their files for deletion, keeping take, cuts, render settings and transcript).
- **AC-19**: API keys store only a hash and a short display prefix, never the key itself, and can be revoked.

## Decision

**Chosen option**: Option 2: one relational schema, designed whole, created slice by slice, with creator scoping and transactions in a shared data access layer (see `rationale.md`).

Product tables live in Postgres (Neon) via Drizzle under `src/db/schema/`, owned by Better Auth's `user` (the creator). All access goes through per feature data functions under `src/server/<feature>/` (web) and `src/db`/`src/lib` helpers usable by jobs, which take the creator ID from the session.

**Implementation skills**: `neon-postgres` (`neondatabase/agent-skills`, `.claude/skills/neon-postgres/`) · `better-auth-best-practices` (`better-auth/skills`, `.claude/skills/better-auth-best-practices/`) · `trigger-tasks` (`triggerdotdev/skills`, `.claude/skills/trigger-tasks/`)

## Rationale

Reasoning and options: see `rationale.md`.

## Feature design

**Conventions**:
- Table and column names `snake_case`; product IDs are `uuid`, generated in the app before insert (keys embed them); `creator_id` is `text` referencing `user.id`.
- Product timestamps use `timestamp({ withTimezone: true })` through one shared `timestamps` helper (`created_at`, `updated_at`); Better Auth's tables stay as generated. Raw SQL in jobs must set `updated_at` itself.
- Media times and lengths are integer milliseconds; `original_bytes` is `bigint({ mode: "number" })`.
- Postgres enums only for `take.status` and `processing_job.status` (add values only, each in its own migration). Other categorical fields are `text` with a CHECK and a TypeScript registry in `src/lib`, so new values are additive; code must tolerate unknown values during a deploy.
- No soft deletes.

**Data model sketch**:

| Table | Key fields | Relationships and constraints | Created in |
|---|---|---|---|
| `user` (Better Auth, exists) | `id` text PK, `email` unique | Owns takes, backgrounds, API keys | scaffold |
| `take` | `id`; `creator_id`; `title` (1 to 200); `status` enum; `original_key`; `original_bytes`; `upload_id` text (multipart ID, null when done); `container` text (`mp4`, `mov`); `duration_ms`, `width`, `height` (null until probed); `video_expires_at` (null until uploaded); `failure_code` (null) | FK `creator_id` → `user` CASCADE; index (`creator_id`, `created_at` desc, `id`); index (`status`, `video_expires_at`) | slice 1 |
| `processing_job` | `id`; `take_id`; `kind` text (`initial`, `rerender`, later `reanalyse`); `status` enum (`queued`, `running`, `succeeded`, `failed`, `cancelled`); `trigger_run_id` (null); `seconds_charged` int ≥ 0; `charged_month` date (first of month, UTC, null if 0 charged); `charged_account_hash` text (null if 0 charged); `refunded` bool default false; `failure_code` (null); `started_at`, `finished_at` (null) | FK `take_id` → `take` CASCADE; partial unique (`take_id`) WHERE status IN (`queued`,`running`); index (`take_id`, `created_at` desc); index (`status`, `updated_at`) | slice 1 |
| `job_step` | `id`; `job_id`; `name` text; `position` smallint; `status` text (`pending`, `running`, `succeeded`, `failed`, `skipped`); `progress` smallint 0 to 100; `started_at`, `finished_at`, `failure_code` (null) | FK `job_id` → `processing_job` CASCADE; unique (`job_id`, `name`); check progress 0 to 100 | slice 1 |
| `cut` | `id`; `take_id`; `start_ms`, `end_ms`; `kind` text (`pause`, `false_start`, `filler`, `manual`); `proposed_by` text (`rules`, `ai`, `creator`); `reason` (null, ≤ 280); `applied` bool default true; `creator_changed_at` (null = untouched) | FK `take_id` → `take` CASCADE; check `start_ms >= 0 AND end_ms > start_ms`; index (`take_id`, `start_ms`); no overlap and `end_ms ≤ duration_ms` enforced in `cuts.*` (tested) | slice 1 |
| `render` | `id`; `take_id`; `job_id`; `status` text (`pending`, `succeeded`, `failed`); `video_key` (null; set only on success); `duration_ms` (null); `removed_ranges` jsonb `[{startMs,endMs}]` (snapshot at render step start); `is_latest` bool default false | FK `take_id` → `take` CASCADE; FK `job_id` → `processing_job` CASCADE; partial unique (`take_id`) WHERE `is_latest`; index (`take_id`); index (`job_id`) | slice 1 |
| `storage_deletion` | `id`; `object_key`; `attempts` int default 0; `last_error` (null); `created_at` | no FK (outlives the rows); index (`created_at`) | slice 1 |
| `transcript` | `id`; `take_id` unique; `language` default `en`; `text`; `words` jsonb `[{w,startMs,endMs,conf,filler}]` | FK `take_id` → `take` CASCADE | slice 2 |
| `background` | `id`; `creator_id` (null = built in); `name` (≤ 80); `image_key`; `width`, `height` | FK `creator_id` → `user` CASCADE; index (`creator_id`); built ins seeded by migration | slice 3 |
| slice 3 additions | `take.background_id`; `render.background_id`, `render.background_name` (snapshot) | FK → `background` ON DELETE SET NULL; index on each | slice 3 |
| slice 5 additions | `transcript.edits` jsonb `[{index,old,new,reason,undone}]`; `take.suggested_background_id`, `take.suggestion_reason` | additive, nullable | slice 5 |
| `usage_month` | `id`; `account_hash`; `month` date (first of month, UTC); `seconds_used` int ≥ 0; `hash_version` smallint default 1; timestamps | unique (`account_hash`, `month`); no FK | slice 6 |
| `app_setting` | `key` text PK; `value` jsonb | seeded `free_monthly_seconds` = 3600 | slice 6 |
| `api_key` | `id`; `creator_id`; `name` (≤ 80); `prefix` (8 chars); `key_hash` unique; `last_used_at`, `revoked_at` (null) | FK `creator_id` → `user` CASCADE; scopes and expiry added in slice 7 spec | slice 7 |

Before slice 6, `seconds_charged` and the charged month and hash are recorded on each job (the limit check starts in slice 6, charges are known from day one).

**Step list per kind** (rows created at job start, `position` in this order; a step whose slice is not live yet is not created):
- `initial`: `trim` (slice 1), `transcript` (slice 2), `background` (slice 3), `ai_edit` (slice 5), `render` (slice 1).
- `rerender`: `background` only if the take's background changed since the latest render, then `render`.
- `reanalyse` (slice 5): `ai_edit`, `render`.
Overall progress shown to creators is the average of step progress (weights can be tuned later).

**State transitions** (`take.status`, each a compare and swap):
- `uploading` → `uploaded` (size checked and probed within limits) · `uploading` → `failed` (rejected media or abandoned upload)
- `uploaded` → `processing` (job start) · `uploaded` → `expired`
- `processing` → `ready` (job succeeded, or job failed while a latest render exists) · `processing` → `failed` (job failed, no render yet)
- `ready` → `processing` (re render or re analyse) · `failed` → `processing` (retry; probed takes only)
- `ready` / `failed` → `expired` (video expiry passed; skipped while `processing`, retried next sweep)
- `expired`: no further video work; read only (title rename still allowed).

`processing_job.status`: `queued` → `running` → `succeeded` | `failed`; `queued` | `running` → `cancelled`. Final states never change.

**Failure code registry** (`src/lib`, each with a `refundable` flag):
- Refundable: `internal_error`, `ffmpeg_error`, `trigger_failed`, `timeout`, `stale_run`, `provider_error`, `cancelled_before_start`.
- Not refundable: `invalid_media`, `too_long`, `too_large`, `resolution_exceeded`, `corrupt_upload`, `cancelled_while_running`.

**API surface** (data access functions; HTTP endpoints and UI are owned by each slice spec):
| Function | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `takes.create` | creatorId, title, container, bytes | take (`uploading`), its id and `original_key` | creator | `invalid` |
| `takes.markUploaded` | takeId, probe result | take (`uploaded` or `failed`), `video_expires_at` = now + 30 days | system | `invalid_transition` |
| `takes.getForCreator` | creatorId, takeId | take with latest render and latest job | creator | `not_found` |
| `takes.listForCreator` | creatorId, cursor, limit ≤ 50 | rows (title, status, duration, expiry, latest render id and duration), nextCursor; newest first | creator | none |
| `takes.rename` | creatorId, takeId, title | take | creator | `not_found`, `invalid` |
| `takes.transition` | takeId, from, to | take | system | `invalid_transition` |
| `jobs.start` | creatorId, takeId | job with ordered steps | creator | `not_found`, `job_in_progress`, `limit_exceeded` (slice 6), `background_missing` (slice 3), `invalid_transition` |
| `jobs.markRunning` | jobId, triggerRunId | job | system | `already_final` |
| `jobs.updateStep` | jobId, name, status, progress | step | system | `invalid` |
| `jobs.finish` | jobId, status, failureCode | job, take, keys queued | system | `already_final` |
| `jobs.cancel` | creatorId, jobId | job | creator | `not_found`, `already_final` |
| `cuts.listForTake` / `cuts.setApplied` / `cuts.addManual` | creatorId, takeId / cutId, applied / range | cuts | creator | `not_found`, `invalid`, `overlap` |
| `cuts.reanalyse` | takeId, proposed cuts | cuts (creator touched kept) | system | `not_found` |
| `renders.create` / `renders.completeLatest` | takeId, jobId / renderId, videoKey | render; old latest key queued | system | `not_found` |
| `takes.expire` | takeId | take (`expired`), keys queued | system | `invalid_transition` |
| `deleteTake` / `deleteAccount` | creatorId, takeId / creatorId | rows removed, keys queued, runs cancelled | creator | `not_found` |
| later: `transcripts.*`, `backgrounds.*`, `usage.*`, `settings.get`, `apiKeys.*` | defined in slices 2, 3, 6, 7 | | | |

**Value sourcing**:
| Action | Value | Source |
|---|---|---|
| any creator function | `creator_id` | Better Auth session on the server, never the request body |
| `takes.create` | `id`, `original_key` | App generated UUID; `originals/{takeId}/source.{container}` (spec 0001 prefixes) |
| `takes.create` | `title` | Upload file name, trimmed, sanitised, 1 to 200 chars |
| `takes.markUploaded` | size | R2 HEAD of `original_key` |
| `takes.markUploaded` | `duration_ms`, `width`, `height` | ffprobe in a short probe task (spec 0001 job runner) |
| `takes.markUploaded` | `video_expires_at` | Upload completion time + 30 days (fixed per take; re renders do not extend it) |
| `jobs.start` | kind | Derived: `initial` if no succeeded initial job, else `rerender` |
| `jobs.start` | `seconds_charged` | `ceil(duration_ms / 1000)` for an initial run with no prior non refunded initial job; else 0 |
| `jobs.start` | `charged_month` | Job start time, UTC, first of month |
| `jobs.start` | `charged_account_hash` | `HMAC_SHA256(canonical(user.email), USAGE_HASH_SECRET)` hex; canonical per AC-16 |
| limit check (slice 6) | allowance, used | `app_setting.free_monthly_seconds`; atomic upsert on `usage_month` that only applies if `seconds_used + charge ≤ allowance` (zero rows = `limit_exceeded`) |
| `jobs.finish` | refund | Failure code registry; amount = job `seconds_charged`, row = job's `charged_account_hash` and `charged_month` |
| render step | `removed_ranges` | Cuts with `applied = true` at render step start |
| render step | `video_key` | `renders/{takeId}/{renderId}.mp4` |
| render (slice 3) | `background_name` | `background.name` at render start |
| progress UI | step and overall progress | `job_step.progress`; overall = average |
| captions (SRT) | caption times | Transcript words minus the render's `removed_ranges` (computed at read time) |
| API key create | `prefix`, `key_hash` | Generated key shown once; SHA256 of the full key |

**Key invariants**:
- Every product row is reachable from exactly one creator (built in backgrounds excepted); every function filters by it.
- At most one active job and one `is_latest` render per take; only the latest render has a `video_key`; an `expired` take holds no file keys.
- Cuts of a take never overlap and lie within the take's length.
- A job is refunded at most once; `seconds_used` never goes below 0.
- Every stored file key removed from a row is inserted into `storage_deletion` in the same transaction.
- No video content, transcript text, presigned link or secret goes into logs, error reports or Trigger.dev payloads (IDs only).

**Background work** (Trigger.dev tasks, defined here because the model depends on them):
- `storage-deletion`: drains `storage_deletion` with retries and backoff.
- `cleanup` (scheduled, every 15 minutes): fails `uploading` takes older than the upload link lifetime plus margin and aborts their multipart upload (`upload_id`); fails jobs `queued` over 15 minutes or `running` past the task's `maxDuration` with `stale_run`; expires takes past `video_expires_at`.
- Jobs are triggered with idempotency key `job.id`; if triggering fails, the job is finished at once with `trigger_failed`. Tasks treat a missing take as a clean abort.

**Security model**: Creators read and write only their own rows, enforced in the data access functions (creator ID from the session, joins through `take.creator_id` for child rows). Jobs act as the system and receive only IDs. Built in backgrounds are readable by all signed in creators, writable by none through the app. API keys are hashed; the plain key is shown once. Videos and transcripts are personal data: deletion is hard and immediate (cascade plus queued file deletion, running jobs cancelled), and usage rows hold only an HMAC of the canonical email. Account deletion uses Better Auth's `user.deleteUser` with a `beforeDelete` hook that queues all the creator's file keys and cancels their runs. No Postgres row level security for now (single app role).

**Configuration required**:
- `USAGE_HASH_SECRET`: HMAC secret for usage rows (needed from slice 1 because jobs record the charged account hash; Worker secret and Trigger.dev env).

**Critical test scenarios**:
- Happy path: create, mark uploaded, start (charges length), steps progress, cuts stored, render completes; take reads `ready` with its latest render, verifies **AC-1**, **AC-5**, **AC-6**, **AC-7**, **AC-10**.
- Concurrency: two simultaneous starts on one take, one gets `job_in_progress` and only one charge exists, verifies **AC-4**, **AC-6**.
- Failure: a refundable failure on a re render returns the take to `ready` and refunds nothing (charge was 0); on an initial run with no render it becomes `failed` and refunds once, even if finished twice, verifies **AC-11**, **AC-12**, **AC-13**.
- Cuts: re analysis keeps creator changed and manual cuts; overlapping manual cut is rejected, verifies **AC-8**, **AC-9**.
- Ownership: creator B gets `not_found` on A's take, job, cut and render functions, verifies **AC-2**.
- Deletion: deleting a take queues its original and render keys and cancels its run; deleting the account keeps the usage row, verifies **AC-17**, **AC-16**.
- Expiry and cleanup: an expired take keeps transcript and cuts, file keys queued; an abandoned upload fails and its multipart upload is aborted, verifies **AC-15**, **AC-18**.

## Build plan

Tracer Bullet: this feature builds the slice 1 tables and the shared data rules the core take loop needs; each later slice adds its own tables and columns from this target in its own migration.

1. Shared schema helpers and registries: `timestamps` helper, status enums, text value registries (kinds, steps, failure codes with `refundable`), canonical email and HMAC helper, satisfies **AC-1**, **AC-13**, **AC-16**.
2. Slice 1 migration: `take`, `processing_job`, `job_step`, `cut`, `render`, `storage_deletion` with all keys, checks and indexes (partial unique indexes include their `WHERE`, checked by a test), satisfies **AC-1**, **AC-4**, **AC-7**, **AC-8**, **AC-10**.
3. Takes and jobs data functions: create, markUploaded, get, list (cursor), rename, transition (compare and swap), jobs.start (one transaction: kind, charge recorded, steps, take to `processing`), markRunning, updateStep, finish (one transaction incl. refund rule), cancel, satisfies **AC-2**, **AC-3**, **AC-5**, **AC-6**, **AC-7**, **AC-11**, **AC-12**, **AC-13**.
4. Cuts and renders data functions: list, setApplied, addManual (overlap and range checks), reanalyse (keep creator touched), renders.create and completeLatest (queue old key), satisfies **AC-8**, **AC-9**, **AC-10**.
5. Deletion and background work: deleteTake, Better Auth `deleteUser` with `beforeDelete`, `storage-deletion` task, `cleanup` scheduled task, trigger idempotency, satisfies **AC-17**, **AC-18**.
6. Tests for the risky rules (the scenarios above, plus one ownership test per creator function), satisfies **AC-2**, **AC-4**, **AC-6**, **AC-9**, **AC-11**, **AC-12**, **AC-13**, **AC-17**.
7. Later slices, from this target in their own specs: slice 2 `transcript` (**AC-15**); slice 3 `background` and its columns, built in seed, `background_missing` (**AC-14**); slice 5 transcript edits and background suggestion; slice 6 `usage_month`, `app_setting`, the atomic limit check (**AC-16**); slice 7 `api_key` (**AC-19**).

## Consequences

**Positive**:
- Every later slice extends one coherent model with additive migrations only.
- Charging, refunds and job completion are atomic; files are never orphaned.
- Ownership is enforced in one place; jobs carry IDs only; usage survives account deletion without personal data.

**Negative / tradeoffs**:
- No database level row security: ownership depends on every function filtering correctly, so an ownership test per function is mandatory.
- Cut overlap and range rules live in code, not the database.
- Word timings as JSON means word level queries happen in code (fine for display, SRT and AI cleanup).
- More background machinery from slice 1 (deletion queue, cleanup schedule).
- A Google account email change starts a fresh usage row (rare, accepted).

**Neutral**:
- Captions are computed, not stored.
- Usage enforcement starts in slice 6; charges are recorded from slice 1.

## Follow-up

- [ ] Toyin adds `USAGE_HASH_SECRET` (any long random string) to the Worker secrets and Trigger.dev Production env before slice 1 jobs record charges.
- [ ] Slice 1 spec (core take loop) defines the upload link lifetime used by `cleanup`, and the task `maxDuration`.
- [ ] Feature 11 spec adds R2 lifecycle rules as a backstop to the deletion queue.
- [ ] Slice 7 spec adds API key scopes, expiry and throttled `last_used_at` writes.
- [ ] If a second database role is ever added, revisit Postgres row level security.
