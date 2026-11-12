# 0007. Transcript for every take

**Date**: 2026-11-11
**Status**: Accepted

## Summary

Every processed take gets an English transcript made by Deepgram from its sound. The take is ready (and its email goes out) as soon as the trimmed video is done, then a small transcript job starts and the transcript appears on the take page a few seconds later. What creators see matches the trimmed video: timestamps on the trimmed timeline, captions in the player behind a CC button, and downloads as plain text and SRT captions. Older takes and failed transcripts get one "Make transcript" button, and non-English takes get a clear "English only for now" note instead of a wrong transcript.

## Context

Slice 1 trims pauses, but a creator still has to watch the whole take to know what they said, and they publish videos with no captions. The scope (feature 7) asks for a transcript beside the video, with timestamps, and downloads as text and SRT that line up with the trimmed video. Captions are also an accessibility rule of this project (WCAG AA). Slice 5's AI editing will read the same words, with filler flags, so the stored shape must serve it too.

Forces:
- **Timing.** Transcripts are made from the original take (spec 0002, AC-15: word times relative to the original upload), but creators watch the trimmed video. Every time shown or exported must be mapped onto the trimmed timeline through the render's `removed_ranges`.
- **Jobs.** Spec 0002 allows at most one active job per take (a partial unique index) and charges minutes at job start. A transcript must never delay or fail the video, and must never charge minutes twice.
- **Provider.** Spec 0001 chose Deepgram Nova-3 pre recorded with word timings and filler words, from slice 2. Deepgram does not make SRT; we build it from word timings.
- **Privacy.** Transcripts are personal data: they live in the database only (not R2), are deleted with the take, and never appear in logs, error reports or job payloads (spec 0001). The audio leaves our system for Deepgram, so Deepgram's model improvement program must be off for our requests.
- **Answers from Toyin (2026-11-11):** English only, with a note otherwise; video ready first, transcript follows; show only what is in the trimmed video; captions in the player with a CC button; fillers shown in the transcript but left out of captions and text downloads; a "Make transcript" button for older takes that doubles as "Try again"; no speaker labels; read only in this slice (edits come in slice 5).

## Requirements

**User stories**:
- As a creator, I want a transcript of my trimmed take beside the video so I can find and check what I said without watching it all.
- As a creator, I want to download my transcript as text and as captions so I can publish an accessible video.
- As a creator, I want captions in the player so I can check them before I download.
- As a creator with an older take, I want to make its transcript on demand.

**Acceptance criteria** (the contract):
- **AC-1**: When a take's video becomes ready (an `initial` job succeeds), a `transcribe` job starts by itself without delaying the take's Ready status or its ready email. The take page shows the transcript as being made, then shows it when done, without a reload.
- **AC-2**: The transcript on the take page matches the trimmed video: words that fall inside a removed range are left out; it is split into paragraphs, each with an `m:ss` timestamp on the trimmed timeline; clicking a word or a paragraph timestamp moves the player there; the paragraph being played is highlighted.
- **AC-3**: Filler words ("um", "uh") appear in the transcript panel with a dotted underline, and are left out of captions and the text download.
- **AC-4**: The take page offers two downloads: plain text (paragraphs, no timestamps, no fillers) and SRT captions (each cue at most 2 lines of at most 42 characters and at most 7 seconds, times on the trimmed video), named after the take title.
- **AC-5**: The player has a CC button, off by default, that shows the same captions as the SRT (from a WebVTT track); it has an accessible name, works by keyboard, and shows its on or off state.
- **AC-6**: When the detected language is not English, no transcript is stored, the transcript step ends `skipped` with reason `not_english`, the transcript area says "Transcripts are English only for now", and the take stays Ready.
- **AC-7**: When a take has no sound, or Deepgram finds no words, the step ends `skipped` with reason `no_speech` and the transcript area says "No speech found in this take". A take with no audio stream is skipped without calling Deepgram.
- **AC-8**: A Deepgram outage, rate limit or timeout is retried (3 attempts in total); a request Deepgram rejects (for example, out of credit) is not retried and raises one Sentry alert. A final failure leaves the take Ready with its video untouched; the transcript area says "The transcript didn't finish" with a "Try again" button. A transcript never charges minutes and never sends an email.
- **AC-9**: A take with no transcript, no active job, and an original still stored shows "Make transcript" (or "Try again" after a failure). It starts a `transcribe` job (0 seconds charged, take stays Ready). Starting is refused with a friendly message while another job runs for the take, or when the original is gone. While a transcript is being made, any other job start for the take is refused with "Your transcript is still being made. Try again in a moment."
- **AC-10**: A transcript outlives video expiry: the panel and both downloads still work on an expired take (Make transcript is hidden there, since the original is gone). A take is not expired while its transcript is being made; if its original disappears mid job anyway, the transcript ends quietly as not available. Deleting the take deletes its transcript.
- **AC-11**: Every transcript route checks that the take belongs to the signed in creator (another creator's take returns not found), and the start route checks `Origin`. No transcript text, audio, or presigned link appears in logs, Sentry events, or job payloads. Requests to Deepgram opt out of its model improvement program.
- **AC-12**: The transcript panel follows `design.md` (light panel, Inter, 1.7 line height, at most 72 characters per line) and WCAG AA: keyboard use, visible focus, phone width with no sideways scroll, and axe finds no serious or critical issues on the ready, making, skipped and failed states.

## Options considered

### Option 1: A separate `transcribe` job, started when the video is ready

`process-take` finishes the video as today, then starts a `transcribe` job for the take (one step, `transcript`, 0 seconds charged, take status unchanged) and dispatches a `transcribe-take` task. The same job kind serves "Make transcript" and "Try again".

**Pros**:
- Keeps every spec 0002 rule: one active job per take, a job finishes only when its steps do, one charge per initial run.
- One code path for automatic, on demand and retry transcripts.
- A transcript failure is contained in its own job; the video job is already done.

**Cons**:
- The transcript starts after the trim instead of alongside it, so it appears a little later (for a typical take, seconds; up to about a minute for a 10 minute take).
- A new job kind needs its own start and finish path in the job code (today both always move the take's status), plus no email, its own stale cutoff, and expiry waiting for it.

### Option 2: Transcript as a step inside the initial job, run in parallel

`process-take` starts the Deepgram call at the beginning, beside the trim, as spec 0002's original step list (`trim, transcript, …`) imagined.

**Pros**:
- The transcript is ready at about the same time as the video.

**Cons**:
- Either the take waits for the transcript (Toyin chose against this), or the job finishes while one of its steps still runs, breaking the "a job ends when its steps end" rule that cleanup, retries and stale job detection rely on.
- Older takes and "Try again" still need a separate path.

### Option 3: A transcript worker outside the job model

A standalone task writes the transcript with its own status column, with no job or steps.

**Pros**:
- Free of job rules; could run in parallel.

**Cons**:
- A second progress and failure model beside jobs (stale detection, retries, UI states all built twice).

## Decision

**Chosen option**: Option 1: A separate `transcribe` job, started when the video is ready.

Transcripts are made by a new `transcribe` job kind (started by `startTranscribeJob`, which never moves the take) and a `transcribe-take` task, started by `process-take` after the video succeeds and by the take page's Make transcript / Try again button; spec 0002's `initial` step list drops `transcript`.

## Rationale

Toyin's rule that the video must never wait for or fail because of the transcript, plus spec 0002's one active job per take, leave Option 1 as the only design that needs no exception to the job model. The cost is a short wait after Ready, which the panel shows as progress. Reusing the job kind for older takes and retries means one task, one set of states, and one place to test.

Smaller calls made here:
- **Plain `fetch` to Deepgram, response checked with zod**, not the Deepgram SDK: one endpoint, no new dependency in the job bundle, and our rule that external responses are validated. Runner up: `@deepgram/sdk`.
- **Audio only, sent as bytes.** ffmpeg reads the original through a presigned URL (as `probe` does) and makes a mono 16 kHz Opus file (about 2.5 MB for 10 minutes), which is posted to Deepgram. No presigned link leaves our system. Runner up: pass Deepgram a presigned URL (simpler, but hands a link to our private file to a third party).
- **Deepgram options**: `model=nova-3`, `detect_language=true`, `smart_format=true`, `punctuate=true`, `paragraphs=true`, `filler_words=true`, `mip_opt_out=true`. Language detection drives AC-6; paragraphs drive the panel and the text download.
- **Captions built once, three ways.** One pure function turns kept words into cues; SRT, WebVTT and the panel all use it, so the CC track and the SRT download can never disagree.
- **Paragraph level keyboard targets.** Each paragraph's timestamp is a button (one tab stop per paragraph); words are clickable with a pointer but are not tab stops, so a long transcript stays usable by keyboard.

## Feature design

**Data model sketch** (target; the `transcript` table is the one planned in spec 0002, now built):

| Table | Fields | Rules |
|---|---|---|
| `transcript` (new) | `id`; `take_id` (required); `language` text default `en`; `text` text (Deepgram's full transcript, fillers included); `words` jsonb `[{w, startMs, endMs, conf, filler, para}]` (times on the original take; `w` is Deepgram's `punctuated_word`; `para` true on the first word of a paragraph); `source_fps` numeric (frame rate of the original, from the task's own probe, so captions use the same frame aligned cuts as the video); `model` text (`nova-3`); timestamps | FK `take_id` → `take` ON DELETE CASCADE; unique (`take_id`) |
| `processing_job` (existing) | `kind` gains `transcribe` (migration updates the kind CHECK) | `transcribe` jobs charge 0 seconds and never change `take.status` (seam below) |
| `job_step` (existing) | `transcript` step goes live; a skipped step may store a skip reason in `failure_code` | step list per kind: `initial` = `trim`, `render` (`background`, `ai_edit` from their slices); `transcribe` = `transcript` |

Registries (`src/lib`): `JOB_KIND_SLICES.transcribe = 2`; `STEPS_BY_KIND.transcribe = ["transcript"]`; `transcript` removed from `STEPS_BY_KIND.initial`; `LIVE_SLICE = 2`. A new `SKIP_REASONS` registry (`not_english`, `no_speech`, `original_gone`), separate from failure codes, is the only set allowed in `job_step.failure_code` on a `skipped` step; `updateStep` validates that (skip reason only with `skipped`, failure code only with `failed`). Failure codes add `provider_rejected` (not refundable; nothing is charged anyway). `FILLER_WORDS` (`um`, `umm`, `uh`, `uhh`, `er`, `erm`, `ah`, `hmm`, `mm`), matched on the lower cased word without punctuation, decides `filler`; slice 5 reuses it.

**Job model seam** (today `startJob` derives the kind and always moves the take to `processing`, and `finishInTx` always transitions the take; transcribe needs neither):
- New `startTranscribeJob(tx, { takeId })` in `src/db/data/jobs/`, one transaction: lock the take row (`FOR UPDATE`); require `take.status = ready` and the original still stored (`video_expires_at` null or in the future); refuse `already_done` if a transcript row exists; insert the job (`kind = transcribe`, `seconds_charged = 0`, no charged month or hash) and its `transcript` step; no take transition. The existing one active job per take index refuses a second job (`job_active`).
- `finishInTx`: for `kind = transcribe`, set the job status and failure code only: no take transition, no render flip or discard, no refund.
- Emails: `notify-take` and `queueTakeEmail` act only on `initial` and `rerender` jobs; transcribe jobs never email (cleanup's stale job loop included).
- Cleanup: `src/lib/cleanup-rules.ts` gains a per kind stale cutoff (`TRANSCRIBE_TAKE_LIMITS`: 3 attempts, 15 minute maximum, so stale after 50 minutes). `expireDueTakes` skips any take with an active job of any kind; it expires on the next run after the job ends.
- Sentry: `jobFailureTags` allowlists the `transcribe` kind and the new codes.

**State transitions**:
- `transcribe` job: `queued → running → succeeded | failed` (spec 0002 machine; not cancellable from the app). The take stays `ready` throughout.
- Transcript area on the take page, derived per request: `none` (no transcript, no transcribe job) → `making` (a transcribe job queued or running) → `ready` (transcript row exists) | `skipped` (latest transcribe job succeeded with its step skipped) | `failed` (latest transcribe job failed). From `none` or `failed`, Make transcript / Try again returns to `making`.

**Pipeline**:
1. `process-take` finishes the initial job as today (take Ready, ready email queued). Then, only when it succeeded with a rendered video, it calls `startTranscribeJob` and triggers `transcribe-take` with idempotency key `transcribe-{jobId}`. If the start is refused or throws, log IDs and move on (the take shows Make transcript). If the trigger throws after the job exists, finish that job `failed` with `trigger_failed` at once, so it never sits queued (the take shows Try again). A crash between the two steps leaves no transcript and no job; the creator uses Make transcript.
2. `transcribe-take` (3 attempts, 15 minute maximum, payload `{ jobId }` only; parses its own `transcriptEnvSchema`, so other jobs never need `DEEPGRAM_API_KEY`):
   - Mark running. Presign the original (1 hour). If it is missing (expired or deleted mid job), skip `original_gone` quietly (no Sentry).
   - Probe it (`probeFile`); record the frame rate; no audio stream → skip `no_speech` without calling Deepgram.
   - Extract audio with the pinned ffmpeg: `-vn -ac 1 -ar 16000 -c:a libopus -b:a 32k` to an Ogg temp file (about 2.5 MB for 10 minutes; the take limit is 10 minutes).
   - POST it to `https://api.deepgram.com/v1/listen` with `Content-Type: audio/ogg`, options `model=nova-3`, `detect_language=true`, `smart_format=true`, `punctuate=true`, `paragraphs=true`, `filler_words=true`, `mip_opt_out=true`, and a 5 minute timeout. Validate the response with zod.
   - Errors: network, 429 and 5xx → throw (retried; final code `provider_error`, or `timeout`); other 4xx (400, 402 out of credit, 413) → no retry (`AbortTaskRunError`), job `failed` with `provider_rejected` and a Sentry error tagged with the status code, so a spending cap hit alerts the same day.
   - Read `results.channels[0].detected_language`; English when it starts with `en` (`en`, `en-US`, `en-GB`, …); otherwise skip `not_english`.
   - Words from `results.channels[0].alternatives[0].words` (`punctuated_word`, `start`, `end`, `confidence`, seconds converted to ms); none → skip `no_speech`. `filler` from `FILLER_WORDS`. `para` on the first word whose start is at or after each paragraph's start (`alternatives[0].paragraphs.paragraphs[].start`); with no paragraphs block, the first word only. `text` = `alternatives[0].transcript`.
   - Upsert the `transcript` row (one per take; a repeat overwrites). If the take was deleted meanwhile (foreign key error), skip quietly. Mark the step succeeded and finish the job.
3. Read time (pure, `src/lib/transcript-timeline.ts`):
   - `toTrimmedTranscript(words, { removedRanges, durationMs, sourceFps })` computes keep ranges with the same `alignToFrames(keepRanges(removedRanges, durationMs), sourceFps)` the render uses. A word is kept when its midpoint falls in a keep range; its trimmed times are its offset within the concatenated keep ranges, clamped to its own keep range, made non decreasing, with `endMs > startMs`. A paragraph starts at its first kept word; a paragraph with no kept words disappears.
   - `buildCues(keptWords)`: fillers dropped; a new cue at a paragraph start, after a word ending in `.`, `?` or `!`, or when the cue would pass 7 seconds or 84 characters; text wrapped onto at most 2 lines of at most 42 characters, breaking at the word boundary nearest the middle; each cue lasts at least 1 second when the gap to the next cue allows; cues never overlap.
   - `toSrt` (numbered from 1, `hh:mm:ss,mmm`), `toVtt` (`WEBVTT` header, `hh:mm:ss.mmm`), `toPlainText` (paragraphs separated by a blank line, no fillers, no timestamps) all format the same cues or paragraphs.

**API surface** (route handlers on the Worker; session from `src/server/request.ts`; zod checked inputs; typed errors mapped to friendly messages):

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/takes/[id]/transcript` | GET | `id` (path) | `{ state, reason?, canMake, version?, paragraphs?: [{ startMs, words: [{ w, startMs, endMs, filler }] }] }` on the trimmed timeline | signed in, owner | 401, 404 |
| `/api/takes/[id]/transcript` | POST | `id` (path) | `{ state: "making" }` | signed in, owner, `Origin` checked | 401, 403 (Origin), 404, 409 `job_active`, 409 `original_gone`, 409 `already_done` |
| `/api/takes/[id]/transcript/[format]` | GET | `id`, `format` in `txt` · `srt` · `vtt`, `v` (query, ignored by the server, busts caches) | the file: `text/plain; charset=utf-8`, `application/x-subrip`, `text/vtt`; `txt` and `srt` as attachments (`filename` ASCII safe plus `filename*=UTF-8''…` from the take title), `vtt` inline; `Cache-Control: private, no-store` | signed in, owner | 401, 404 (also when no transcript or no kept words), 422 bad format |

Any job start refused with `job_active` while a transcribe job runs (retry today, re edits in later slices) shows "Your transcript is still being made. Try again in a moment."

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| GET transcript | `state` | derived: `transcript` row exists → `ready`; else latest `transcribe` job by `created_at`: queued or running → `making`, succeeded with skipped step → `skipped`, failed → `failed`; no such job → `none` |
| GET transcript | `reason` | `job_step.failure_code` of that job's `transcript` step (`not_english`, `no_speech`, `original_gone`) |
| GET transcript | `canMake` | `state` in `none`, `failed`; `take.status = ready`; `video_expires_at` null or in the future; no active job for the take |
| GET transcript, downloads | trimmed word times, paragraph `startMs` | `transcript.words` through `toTrimmedTranscript` with the take's render where `is_latest = true` (`removed_ranges`), `take.duration_ms` and `transcript.source_fps`; no latest render (a take handed back uncut) → `removedRanges = []` |
| GET transcript | `version` (for the track URL `?v=`) | `transcript.updated_at` plus the latest render's `id` |
| GET transcript | a ready transcript with no kept words | `state = ready`, `paragraphs = []`; the panel says "No words in the trimmed video"; downloads hidden |
| Panel highlight | paragraph being played | player `currentTime` compared with paragraph `startMs` (client) |
| Downloads | file name | `take.title` (at most 200 characters), made ASCII safe for `filename`, full for `filename*`; fallback `take` |
| Downloads, CC track | cues | `buildCues` over kept, non filler words (rules above) |
| POST transcript | job | `startTranscribeJob`: `seconds_charged = 0`, one `transcript` step |
| transcribe-take | audio, has audio, `source_fps` | the take's `original_key` (presigned GET, 1 hour) and the task's own probe of it |
| transcribe-take | language, words, paragraphs, text | Deepgram fields named in the pipeline above |
| transcribe-take | `filler` | `FILLER_WORDS` |
| transcribe-take | `model` | the `model` option sent (`nova-3`) |

**Key invariants**:
- At most one active job per take (existing index); a `transcribe` job never changes `take.status`, never charges or refunds, and never sends an email.
- At most one transcript per take (unique `take_id`); stored times are on the original take; trimmed times are computed at read time from the same frame aligned keep ranges as the render, never stored.
- The CC track, the SRT and the plain text come from the same `buildCues` and paragraph functions.
- A take is never expired while it has an active job.
- Payloads, logs and Sentry carry IDs, counts, durations and status codes only; never text, audio, file keys or links.

**Security model**: Creators read and start transcripts only for their own takes (`take.creator_id` from the session, through the existing take data functions); another creator's take returns 404. The POST route checks `Origin` like other mutations. Jobs act as the system with IDs only. Audio goes to Deepgram over HTTPS with `mip_opt_out=true`; no presigned link is shared. Transcripts are personal data: database only, cascade deleted with the take or account, kept after video expiry as spec 0002 says. The privacy page (scope feature 16) must name Deepgram as a processor.

**Configuration required**:
- `DEEPGRAM_API_KEY`: Deepgram key, Trigger.dev environments only (dev and prod), never the Worker. Parsed only by `transcribe-take` through `transcriptEnvSchema`; a missing key fails that task at start with a names only error and touches no other job. Prerequisite: Toyin creates the Deepgram account, sets a spending cap, and adds the key.

**UI (take page)**:
- Transcript panel beside the stage on desktop, below it on phones (design.md "Transcript panel", minus struck through words until slice 4): paragraphs with a mono `m:ss` timestamp button, words in Inter at most `72ch` wide with fillers dotted underlined, current paragraph highlighted with `aria-current`.
- States: making (spinner and "Making your transcript"), ready, skipped (the AC-6 or AC-7 message; `original_gone` says "This take's video has expired, so a transcript can't be made"), failed (message and Try again), none (Make transcript, or "No transcript for this take" when `canMake` is false). Polls with the existing `use-poll` while making. The processing progress view ignores transcribe jobs.
- Downloads: "Download text" and "Download captions (SRT)" buttons, shown when ready with kept words.
- Player: a `<track kind="captions" srclang="en" label="English">` from the VTT route with `?v={version}`, added only when ready; a CC toggle in `player-controls.tsx` (off by default, `aria-pressed`).

**Critical test scenarios**:
- Happy path: an English fixture with pauses goes Ready, then the transcribe job succeeds; the panel shows paragraphs with trimmed timestamps; SRT cue times land on the trimmed video within one frame, verifies **AC-1**, **AC-2**, **AC-4**.
- Job seam: `startTranscribeJob` leaves the take `ready`, charges 0, refuses `already_done`, `original_gone`, `job_active`; `finishInTx` for transcribe never transitions the take or refunds; no email is queued for transcribe jobs, including stale ones (unit tests against the test database), verifies **AC-1**, **AC-8**, **AC-9**.
- Timeline mapping: words inside removed ranges are dropped, words after shift by the frame aligned removed time, midpoint rule at range edges, many cuts on a long take without drift, empty paragraphs removed, all words removed (unit tests), verifies **AC-2**.
- Caption rules: fillers dropped; 2 lines of 42 characters with a balanced break; 7 second cap; 1 second minimum without overlap; breaks at paragraph and sentence ends; SRT and VTT share cues (unit tests), verifies **AC-3**, **AC-4**, **AC-5**.
- Non English and silent fixtures end skipped with the right message; a no audio take never calls Deepgram; `en-GB` counts as English, verifies **AC-6**, **AC-7**.
- Deepgram 500 then success on retry; three 500s leave the take Ready with Try again; a 402 fails at once with `provider_rejected` and one Sentry event; 0 seconds charged, verifies **AC-8**.
- Make transcript: refused while a job runs (409), refused when the original is gone (409), starts a job otherwise; a trigger failure finishes the job `trigger_failed` at once, verifies **AC-9**.
- Expired take: panel and downloads still work, Make transcript hidden; expiry waits for an active transcribe job; the original disappearing mid job skips `original_gone` with no Sentry event; deleting the take removes the transcript row, verifies **AC-10**.
- Another creator's take: GET, POST and downloads return 404; POST without a good `Origin` returns 403; a payload and Sentry scrub test finds no text, verifies **AC-11**.
- Browser: CC toggle by keyboard; the track URL changes after a new render; axe on each transcript state at desktop and phone width, verifies **AC-5**, **AC-12**.

## Build plan

Tracer Bullet: after one enabling step, the next task is a thin thread from Deepgram to a visible transcript; later tasks thicken it.

1. Job model seam: migration (`transcript` table, kind CHECK with `transcribe`), registries (`transcribe` kind and step lists, `LIVE_SLICE = 2`, `SKIP_REASONS`, `provider_rejected`, `FILLER_WORDS`), `updateStep` skip reason rule, `startTranscribeJob`, the transcribe branch in `finishInTx`, no emails for transcribe jobs, per kind stale cutoff, expiry skipping takes with an active job, `jobFailureTags`; tests against the test database, satisfies **AC-1**, **AC-8**, **AC-9**, **AC-10**.
2. Thin thread: `transcriptEnvSchema`, the `transcribe-take` task (probe, extract audio, Deepgram, validate, skips, save), `process-take` starting it after a successful video, and a plain GET `/api/takes/[id]/transcript` with the transcript shown as plain paragraphs on the take page. Proven with one real take locally, satisfies **AC-1**, **AC-6**, **AC-7**, **AC-11**.
3. Trimmed timeline and captions: `toTrimmedTranscript`, `buildCues`, `toSrt`, `toVtt`, `toPlainText` with unit tests; the download route; the GET route returns trimmed paragraphs and `version`, satisfies **AC-2**, **AC-3**, **AC-4**, **AC-10**.
4. Failure, retry and on demand: the retry and error matrix, the trigger failure path, POST `/api/takes/[id]/transcript` with its refusals, `canMake`, Make transcript / Try again, the `job_active` message, satisfies **AC-8**, **AC-9**, **AC-11**.
5. Take page polish: the full transcript panel per `design.md` (states, timestamps as buttons, word seek, current paragraph, fillers), download buttons, CC track and toggle, phone layout, browser tests with axe, Mobbin references for transcript panels, satisfies **AC-2**, **AC-3**, **AC-5**, **AC-12**.
6. End to end: extend `pnpm test:pipeline` with English, non English and silent fixtures against real Deepgram; the expired and deleted take checks, satisfies **AC-1**, **AC-6**, **AC-7**, **AC-10**.

## Consequences

**Positive**:
- Creators get searchable words, accessible captions and publishable files from every take, at about $0.04 for a 10 minute take.
- The word data (times, fillers, paragraphs) is the base slice 5's AI editing needs.
- The video path is unchanged; a Deepgram outage never touches Ready or the email.

**Negative / tradeoffs**:
- The transcript appears after the video, not with it (seconds for typical takes, up to about a minute for long ones).
- The take's audio goes to a third party (Deepgram); the privacy page must say so.
- Each transcription reads the original from R2 again (only its audio stream is extracted, but ffmpeg may read much of the file); R2 egress is free, so the cost is task time, acceptable at current volume.
- Captions can't be corrected until slice 5; creators fix exported files by hand meanwhile.

**Neutral**:
- Spec 0002's step list changes: `transcript` leaves `initial` and becomes its own job kind.
- Skip reasons (`not_english`, `no_speech`, `original_gone`) get their own registry, stored in `job_step.failure_code` only on skipped steps.
- Spec 0002's `transcript.words` shape gains `para`, and the table gains `source_fps`.

## Follow-up

- [ ] Toyin: create a Deepgram account, set a monthly spending cap, and add `DEEPGRAM_API_KEY` to Trigger.dev dev and prod (and to the builder's App variables for local runs); allow network access to `api.deepgram.com`.
- [ ] Install the `deepgram/skills` Agent Skill (approved in spec 0001 for slice 2) after confirming it is published by Deepgram; add a pointer line to `src/trigger/AGENTS.md`.
- [ ] Scope feature 16 (privacy page): name Deepgram as a processor of take audio.
- [ ] Slice 4 (cut review) will show removed words struck through; slice 5 adds transcript edits (`transcript.edits`, spec 0002).
