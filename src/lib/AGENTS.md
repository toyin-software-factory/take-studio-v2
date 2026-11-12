# Shared rules (src/lib)

Mostly pure modules used by the web app, the browser, the Worker and the jobs. Specs: [0002](../../docs/specs/0002-data-model/index.md), [0004](../../docs/specs/0004-core-take-loop/index.md), [0005](../../docs/specs/0005-error-monitoring.md). The modules that matter most to a job, an upload or a route are described in [src/trigger](../trigger/AGENTS.md), [src/db](../db/AGENTS.md), [src/server](../server/AGENTS.md) and [src/components/takes](../components/takes/AGENTS.md); this file covers what is shared.

## What lives where

- Rules and registries: `take-rules`, `take-media`, `cleanup-rules`, `cut-rules`, `cuts`, `billing`, `processing`, `failure-codes`, `uploads`, `upload-rules`.
- Media: `probe` (ffprobe JSON to facts), `trim` (silence to cuts, ffmpeg filter scripts, progress).
- Storage and jobs: `r2` (S3 API through aws4fetch), `r2-file-upload` (Node only, for jobs), `trigger-runs`.
- `keying` (spec 0008, pure): green screen detection on raw RGB frames (16 border patches, HSV rules, key colour median; `DETECTION`) and the chroma key filter lines (`compositeFilters`, `KEYING`); `renderFilterScript(keep, { hdr, hasAudio, background })` in `trim.ts` calls it. The ffmpeg side is `src/trigger/keying.ts`.
- `deadline` (pure): `runWithDeadline` aborts a job attempt 90 s before `maxDuration`, waits for the work to clean up, then throws `DeadlineExceeded` (mapped to `timeout`); see `src/trigger/AGENTS.md`.
- API shapes and wording: `take-api` (zod), `take-display`, `take-messages`, `upload-client`.
- Email (spec 0006): `email/send` (Resend, the only network edge), `email/templates` (pure), `email-links` (signed turn off links, Web Crypto). Used by the Worker and by the `notify-take` job.
- Transcript read time (spec 0007): `transcript-timeline` (stored word times to the trimmed video with the render's own `alignToFrames(keepRanges(...))`, caption cues, SRT, VTT, plain text; all pure) and `transcript-download` (formats, file body, `Content-Disposition` with a safe name). The CC track, the SRT and the text all come from the same cues and paragraphs; never build captions anywhere else.
- Backgrounds (spec 0008): `background-rules` (limits, `backgroundKeys`, the failure codes with their friendly messages, `checkImageFacts`, `displaySize`, `rotationFilter`, `isAnimatedWebp`; pure, shared by the routes, the task and the picker) and `background-api` (zod shapes of the list).
- Config: `env` (zod parsers), `worker-deploy-config`, `server-source-maps`, `sentry-*` (options, scrubbing, check guard, debug ID).
- Small helpers: `result`, `utils`, `usage-hash`, `fonts`, `auth-client`.

## Conventions and gotchas

- Most modules are pure or take their I/O as a parameter (`upload-client` does), and tests rely on that. The ones that do I/O are `env` (reads `process.env`), `r2` (network), `email/send` (network, Resend), `r2-file-upload` (Node files), `trigger-runs` (Trigger.dev SDK), `fonts` (`next/font`, web only) and `auth-client` (browser, `"use client"`). Keep new modules pure unless they belong in that list.
- Imports (ESLint, `eslint.config.mjs`): `src/lib` may not import `@/app`, `@/server`, `@/trigger` or `@opennextjs/cloudflare`. It may import `next`, but jobs may not, so anything a job uses must stay free of `next`.
- `transcript-rules` (spec 0007): the stored word shape (`TranscriptWord`, times on the original upload) and `FILLER_WORDS`/`isFillerWord`.
- `deepgram` (spec 0007): pure. The request options (`deepgramUrl`, always with `mip_opt_out=true`) and `parseDeepgramResponse` (zod, `en*` is English, words, fillers, paragraph starts, `not_english` and `no_speech` results). The fetch lives in `src/trigger/transcribe-take.ts`. `transcriptEnvSchema` (`DEEPGRAM_API_KEY`) is parsed only by that task. `processing.ts` also holds `SKIP_REASONS` (`not_english`, `no_speech`, `original_gone`, `no_green_screen`: stored in `job_step.failure_code` only on a skipped step; a failed step carries a failure code, never both), `jobKindSendsEmail` (only `initial` emails; `rerender` and `transcribe` never do) and `LIVE_SLICE = 3`; `stepsFor(kind, { hasBackground })` creates the `background` step only for a job with a background. `transcript` is a step of the `transcribe` kind, not of `initial`. `TRANSCRIBE_TAKE_LIMITS` (3 attempts, 15 minutes) sets that kind's stale cutoff (50 minutes; video jobs 85).
- Registries are add only. Failure codes are an open set with no database check (see [src/trigger](../trigger/AGENTS.md)). The status, job, step and render lists in `processing.ts` build Postgres enums and checks, so never rename or remove a value. `LIVE_SLICE` keeps steps from later slices out until it is raised, and a step missing from `STEP_WEIGHTS` counts as 0 in the progress bar.
- Units: `maxDurationSeconds` is in seconds; every other timing in `cleanup-rules.ts` is in milliseconds. `TRIM.minSilenceMs` is milliseconds and is divided by 1000 for ffmpeg. When the frame rate is unknown, `alignToFrames` and `outputFps` both assume 30.
- Usage hash: usage is stored under an HMAC of the canonical email (`usage-hash.ts`): lowercased, `+tag` removed, and for Gmail the dots removed and `googlemail.com` written as `gmail.com`. `USAGE_HASH_SECRET` (at least 32 characters) has its own schema in `env.ts` and is parsed only where the hash is computed. `USAGE_HASH_VERSION` is stored beside each row. Changing the canonical rules or the version changes every hash, so old usage would stop matching. Never log the secret or the email.
- `emailEnvSchema` (app URL, Resend key, sender, link secret) is parsed only where email is sent or a link is signed; `BETTER_AUTH_URL` must also be set in Trigger.dev, or `notify-take` stops at once with a names only error.
- Durations shown to people (take length, player time, "Removed m:ss of pauses", the same number in emails) all go through `formatClock` in `take-display.ts`, which floors to whole seconds (2501 ms is `0:02`). Never write a second formatter; emails import this one.
- `env.ts` error messages name the variables and never show values.
- `take-media.ts` keeps its own copy of the media failure codes next to the one in `failure-codes.ts`. They are the same today; change both, or remove the copy.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
