# 0004. Core take loop (slice 1)

**Date**: 2026-11-11
**Status**: In Progress

## Summary

The first real product slice: a signed in creator uploads a video take from the library, processing starts by itself, pauses are trimmed with simple rules (silence over 0.7 seconds cut down, 0.25 seconds kept each side, start and end trimmed almost fully), and the creator watches step by step progress, then plays and downloads the result (or the original). iPhone HDR video is converted to normal colour; a take with no pauses or no sound is handed back as is with a clear note. It is the walking skeleton: browser upload to R2, the data model, Trigger.dev with ffmpeg and the dark stage player all work end to end, narrowly. Google sign in only; magic link, emails, transcripts, backgrounds and the review timeline come later.

## Requirements

**User stories**:
- As a creator, I want to drop a video on my library and have it trimmed without any more clicks.
- As a creator, I want to see what's happening while it processes, and leave and come back.
- As a creator, I want to download the trimmed video, or the original if I don't like the cuts.

**Acceptance criteria**:
- **AC-1**: Signed in, `/` is the library: an upload area at the top ("Choose a video" or drop a file, limits written underneath: MP4 or MOV, up to 10 minutes, 2 GB, 1080p) and the creator's takes newest first as cards (thumbnail or placeholder, title, duration in mono, status badge with icon and label, expiry note), 24 per page. Signed out, `/` shows the existing sign in page.
- **AC-2**: A file over 2 GB, or not `.mp4` / `.mov` (MIME `video/mp4` or `video/quicktime`, or empty MIME with a valid extension), is refused in the browser before upload with a friendly inline message.
- **AC-3**: A valid file uploads straight from the browser to R2 in equal 16 MiB parts (last smaller), 3 in parallel, each retried up to 3 times with backoff and fresh links if expired, with a progress bar and a Cancel button; a warning shows if the creator tries to leave mid upload. The file never passes through the web app.
- **AC-4**: On completion the server checks the stored size equals the declared size, then the probe reads the video. A valid take becomes `uploaded` and processing starts by itself; otherwise the take becomes `failed` with a message naming the problem ("This video is 14 minutes long. The limit is 10 minutes.") and an "Upload another video" action.
- **AC-5**: Trimming: each silence longer than 700 ms (at -35 dB) becomes a `pause` cut proposed by `rules` with a reason ("Pause of 1.4 s"), keeping 250 ms on each side; silence touching the start or end of the take keeps only 100 ms; cuts closer than 100 ms apart are merged.
- **AC-6**: The render is MP4 (H.264 `yuv420p`, AAC), same resolution and orientation as the upload, constant frame rate at the source's average, CRF 18, `+faststart`, with audio and video in sync at every cut. HDR sources (PQ or HLG) are tone mapped to normal colour (BT.709).
- **AC-7**: If no cuts are found, no render is made: the take is ready with "No long pauses found. Your video is ready as is", and Download gives the original. If the video has no audio track, it is not trimmed: "No audio found, so nothing was trimmed", and Download gives the original.
- **AC-8**: The take page (`/takes/[id]`) shows live step progress on the dark stage while processing (each step with its own state, plus an overall bar weighted trim 10 % and render 90 %), refreshed every 2 seconds while the tab is visible; the creator can leave and return. The tab title reads "Processing… · <title> · Take Studio" then "Ready · <title> · Take Studio". Library cards of processing takes refresh every 5 seconds while visible.
- **AC-9**: When ready, the take page shows the player on the stage, the renamable title, "Removed m:ss of pauses" (or the AC-7 note), "Download" (`<slug>-trimmed.mp4`) and "Download original" (`<slug>-original.<ext>`, while not expired).
- **AC-10**: If processing fails with a retryable code, the page and card show a friendly message and "Try again" (a new run, not charged again for a refunded failure); failures from the media itself show "Upload another video". Refundable failures record the refund (spec 0002).
- **AC-11**: A creator can only see, play, download, rename or retry their own takes; another creator's or a malformed take ID gets the same styled not found page (404), and media routes the same 404 body.
- **AC-12**: Playback and download use presigned R2 links issued after the ownership check (play 1 hour, inline; download 15 minutes with `Content-Disposition` attachment); upload part links last 15 minutes. Creating uploads is limited to 10 per creator per hour (friendly 429).
- **AC-13**: All screens follow `design.md` (states, voice, light app and dark stage), work by keyboard and at phone width, and pass the axe check.

## Decision

**Chosen option**: Option 1: browser direct multipart upload to R2, server confirmed completion, a `probe` task then a `process-take` task on Trigger.dev, polling for progress (see `rationale.md`).

**Implementation skills**: `trigger-tasks` (`triggerdotdev/skills`, `.claude/skills/trigger-tasks/`) · `cloudflare` (`cloudflare/skills`, `.claude/skills/cloudflare/`) · `vercel-react-best-practices` (`vercel-labs/agent-skills`, `.claude/skills/vercel-react-best-practices/`) · `web-design-guidelines` (`vercel-labs/agent-skills`, `.claude/skills/web-design-guidelines/`)

## Rationale

Reasoning and options: see `rationale.md`. Toyin's calls after the cross check: tone map HDR now; trim start and end almost fully; skip the render when there are no cuts; accept silent videos without trimming.

## Feature design

**Flow**:
1. Browser validates, then `POST /api/uploads` → server checks the hourly limit, `takes.create` (creatorId, title from file name, container, bytes), R2 `CreateMultipartUpload` for `originals/{takeId}/source.{ext}`, `takes.attachUpload`; returns takeId, partSize, partCount.
2. Browser asks `POST /api/uploads/{takeId}/parts` for links in batches (part numbers within `partCount` only), PUTs parts with `XMLHttpRequest` (for progress), keeps ETags (quotes stripped).
3. `POST /api/uploads/{takeId}/complete` with parts → server validates the list (count equals `partCount`, ascending, ETags non empty), R2 `CompleteMultipartUpload` (parses the XML body for errors even on 200), HEADs the object (size must equal `take.original_bytes`, else 422 and the take fails `corrupt_upload`), then dispatches `probe` with idempotency key `probe-{takeId}`. Idempotent: a repeat call finds the object and does not dispatch twice.
4. `probe` task (system): reads `take.creator_id` from the database; runs ffprobe on a presigned GET URL (ffmpeg reads with ranges, so a `moov` at the end works; 60 s timeout; the URL is never logged or put in payloads); reports width and height after rotation, audio presence, frame rate, HDR transfer; writes a thumbnail (frame at 1 s, or 0 for shorter clips, 640 px) to `originals/{takeId}/thumb.jpg`, failure non fatal; calls `markUploaded`. If valid, calls `jobs.start` with the take's creatorId, then `dispatchJob` for `process-take`. On crash, `onFailure` fails the take with `internal_error` (refundable code set, nothing charged yet).
5. `process-take` task (`large-1x`, `maxDuration` 40 minutes, 2 attempts): `markRunning`; downloads the original to disk; trim step: `silencedetect=noise=-35dB:d=0.7` (skipped as `skipped` if no audio), parses silences (an unclosed silence ends at the duration), converts to ms (floor start, ceil end, clamp), applies AC-5 margins and merging, writes cuts with `cuts.reanalyse`. If no cuts or no audio: render step `skipped`, `jobs.finish(succeeded)` with no render, AC-7 note. Otherwise render step: `renders.create` (snapshots applied cut ranges), keep ranges built from `removed_ranges`, ffmpeg with a `-filter_complex_script` of `trim`/`atrim` + `setpts`/`asetpts` per range and one `concat` (segments capped at 500 by merging), `-fps_mode cfr` at the rounded average fps, autorotate, HDR → `zscale` + `tonemap=hable` to BT.709, `libx264 -preset fast -crf 18 -pix_fmt yuv420p`, AAC 192 kb/s, `+faststart`; deletes the local original; multipart uploads the render (32 MiB parts, 3 retries, abort on failure) to `renders/{takeId}/{renderId}.mp4`; `renders.completeLatest`; `jobs.finish(succeeded)`. A retry discards the job's pending render (`discardJobRenders`) and starts it again; charge is not repeated. Final failure: `jobs.finish(failed, code)` with ffmpeg exit → `ffmpeg_error`, `maxDuration` → `timeout`, download or upload failure → `internal_error`.
6. Progress: tasks write `job_step.progress` from ffmpeg `-progress`, throttled to at most once every 2 seconds and only on a change of at least 1 point.
7. Take page polls `GET /api/takes/{id}` every 2 seconds (`Cache-Control: no-store`) while `uploading` after completion or `processing`, pauses when the tab is hidden, backs off on errors (2 → 10 s), stops on final status, 401 or 404.

**Data model**: no new tables (spec 0002). Constants in `src/lib`: pause threshold 700 ms, margin 250 ms, edge margin 100 ms, merge gap 100 ms, noise -35 dB, part size 16 MiB (render upload 32 MiB), link lifetimes, upload limit 10 per hour, poll intervals. Job code imports data functions from `src/db/data/*` (not `src/server`, per the boundary rule). Thumbnail key is derived; `deleteTake`, account deletion and expiry also queue `originals/{takeId}/thumb.jpg`; the UI falls back to a placeholder if the image fails to load.

**API surface** (route handlers; session from `src/server/request.ts`, 401 JSON when signed out; `Origin` checked on POST, PATCH and DELETE; zod validated bodies; typed errors mapped to friendly messages):
| Endpoint | Method | Key inputs | Key outputs | Key errors |
|---|---|---|---|---|
| `/api/uploads` | POST | fileName, sizeBytes, container | takeId, partSize, partCount | 422 too large or bad type, 429 limit |
| `/api/uploads/{takeId}/parts` | POST | partNumbers[] (≤ 50, within partCount) | presigned PUT URLs (15 min) | 404, 409 not uploading |
| `/api/uploads/{takeId}/complete` | POST | parts[{partNumber, etag}] | take status | 404, 409, 422 bad parts or size |
| `/api/uploads/{takeId}` | DELETE | none | ok (aborts multipart, take failed `upload_abandoned`) | 404, 409 already completed |
| `/api/takes` | GET | cursor | cards (24), nextCursor | none |
| `/api/takes/{id}` | GET | none | take, latest job with steps, latest render, removedMs (sum of the latest render's removed ranges, or of applied cuts if no render) | 404 |
| `/api/takes/{id}` | PATCH | title | take | 404, 422 |
| `/api/takes/{id}/retry` | POST | none | job | 404, 409 in progress or not retryable |
| `/api/takes/{id}/media` | GET | kind (`play`, `download`, `original`, `thumb`) | JSON `{ url }` (`thumb`: inline, 1 hour) | 404 no file, 410 expired |

R2 helpers added to the existing `createR2` (aws4fetch, `signQuery: true`, no signed `Content-Type` or `Content-Length`): `createMultipartUpload`, `presignUploadPart`, `completeMultipartUpload`, `abortMultipartUpload`, `headObject`, `presignGet` (with `response-content-disposition`, RFC 5987 encoded), and a job side multipart uploader.

**Value sourcing**:
| Action | Value | Source |
|---|---|---|
| any route | `creatorId` | Better Auth session |
| probe and jobs.start | `creatorId` | `take.creator_id` read by the task |
| upload create | partCount | `ceil(sizeBytes / 16 MiB)` |
| complete | stored size check | R2 HEAD vs `take.original_bytes` |
| probe | duration, rotated width and height, audio, fps, HDR | ffprobe |
| trim | cuts | `silencedetect` + AC-5 rules |
| render | keep ranges | `render.removed_ranges` snapshot |
| page | "Removed m:ss" | sum of removed ranges |
| page | AC-7 note | no cuts, or probe said no audio (`job_step` trim `skipped`) |
| download | file names | slug of title (non ASCII handled; empty slug → `take`) + `-trimmed.mp4` or `-original.<ext>` |
| upload limit | count | takes created by this creator in the last hour |

**Screen states** (per `design.md`): upload area idle, dragging, uploading (progress, Cancel), completing ("Finishing upload…"), rejected (inline alert), cancelled; take page uploading, processing (steps), ready, ready with AC-7 note, failed retryable, failed media, expired; library empty, loading skeletons, error with Retry; styled not found page linking back to the library.

**Key invariants**: the web app never proxies file bytes; every route and media link checks ownership; dispatches are idempotent (`probe-{takeId}`, job ID); no file contents, transcript text or links in logs or task payloads (IDs only).

**Security model**: signed in creators only; ownership on every route and link; presigned links short lived and single object; R2 CORS (JSON in the repo, applied with the Cloudflare API token by `pnpm r2:cors`) allows `PUT`, `GET`, `HEAD` from `https://take-studio.jnr4u2.workers.dev`, `http://localhost:3000`, `http://localhost:8787`, allowed headers `content-type`, exposes `ETag`, max age 3600.

**Configuration required**: none new beyond spec 0001 and `USAGE_HASH_SECRET` (spec 0002), which must be set on the Worker and in Trigger.dev Production before this slice ships.

**Critical test scenarios**:
- Happy path: a 2 minute fixture with known pauses → auto processing → ready; output plays with pauses removed and A/V in sync, verifies **AC-3**, **AC-4**, **AC-5**, **AC-6**, **AC-9**.
- Edge media: portrait phone MOV with `moov` at the end, an HDR clip, a clip with no pauses, a silent clip, verifies **AC-4**, **AC-6**, **AC-7**.
- Limits: 11 minute or 4K file → failed with the right message; 3 GB file refused before upload; 11th upload in an hour → 429, verifies **AC-2**, **AC-4**, **AC-12**.
- Failure: a render that crashes → friendly error and "Try again", refund recorded, verifies **AC-10**.
- Ownership: creator B gets 404 on A's take page, API and media links, verifies **AC-11**.

## Build plan

Tracer Bullet: one thin thread first (upload → trim → download), then thicken.

1. [x] R2 helpers (multipart, presign, HEAD, abort, job uploader), CORS JSON and `pnpm r2:cors`; upload routes (create, parts, complete, abort) with limits, idempotency and ownership; a timing spike of the render on `large-1x` with a 10 minute 1080p fixture (record the result in the PR), satisfies **AC-3**, **AC-4**, **AC-12**.
2. [x] Pin a tagged ffmpeg 7.x build with `libx264`, `zscale` and `silencedetect`; `probe` task (ranged ffprobe, rotation, audio, HDR, thumbnail, `markUploaded`, auto `jobs.start` and dispatch), satisfies **AC-4**.
3. [x] `process-take` task: trim rules, no cut and no audio paths, render with sync, CFR, HDR tone map, faststart, multipart upload, progress throttling, retries and failure codes; deletion of `thumb.jpg` added to delete and expiry, satisfies **AC-5**, **AC-6**, **AC-7**, **AC-10**.
4. Library and take pages with upload area (states, cancel, leave warning), cards, polling, player, downloads, rename, retry, tab titles, not found page, media routes, satisfies **AC-1**, **AC-2**, **AC-8**, **AC-9**, **AC-11**, **AC-12**, **AC-13**.
5. End to end tests with small fixtures (pauses, portrait MOV, HDR, silent, no pauses), ownership and limit tests, axe on both pages, satisfies **AC-2**, **AC-4**, **AC-6**, **AC-7**, **AC-11**, **AC-13**.

## Consequences

**Positive**:
- The whole product pipe is proven in production with real phone video, including HDR and portrait.
- Later slices add steps to this pipeline and panels to the take page.

**Negative / tradeoffs**:
- Polling costs a few database reads per minute per open page (fine at this scale).
- Rules only trimming will sometimes cut a deliberate pause; the review timeline (slice 4) and AI (slice 5) fix that.
- HDR tone mapping adds processing time; a 10 minute take may take 10 to 20 minutes on `large-1x` (the timing spike sets expectations).
- Closing the tab mid upload loses it (no resume yet); cleanup fails it later.

**Neutral**:
- Usage is charged and recorded now; the monthly limit is enforced from slice 6.

## Follow-up

- [ ] Toyin sets `USAGE_HASH_SECRET` on the Worker and in Trigger.dev Production before this slice ships.
- [ ] Magic link sign in plus the "your take is ready" email, right after this slice.
- [ ] Error monitoring (scope feature 6) spec, the other half of slice 1.
- [ ] Later: resumable uploads, R2 lifecycle rule for incomplete multipart uploads (feature 11), realtime progress, a per creator concurrent job cap, CORS origin update when a custom domain arrives.
- [ ] Tune the pause numbers on real takes with Toyin.
