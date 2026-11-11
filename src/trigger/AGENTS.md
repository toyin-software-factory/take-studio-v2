# Background jobs (src/trigger)

Trigger.dev v4 tasks, configured in `trigger.config.ts`. Specs: [0001](../../docs/specs/0001-stack-architecture/index.md), [0002](../../docs/specs/0002-data-model/index.md), [0004](../../docs/specs/0004-core-take-loop/index.md).

## What each task owns

- `probe`: ffprobe of the original through a presigned URL, the thumbnail (not fatal), `markUploaded` (this is where media failure codes are set), then it starts and dispatches `process-take`. Idempotency key `probe-{takeId}` (global scope), so repeated upload completions never probe twice.
- `process-take`: download, local re probe, silence detection (`-35dB`, 700 ms, in `src/lib/trim.ts`), cuts, render, upload, finish. Key `job-{jobId}`. Payloads carry IDs only.
- `notify-take` (`src/trigger/email/`): sends the ready or didn't finish email for one finished job (spec 0006). `process-take` queues it after every `finish` through `queueTakeEmail`, which never throws. 3 attempts; `notified_at` and the Resend key `take-email-{jobId}` make a repeat harmless; a bad email env aborts without retrying. Cancelled jobs send nothing.
- Take emails go through `queueTakeEmail(jobId, kind)`, which queues nothing for a kind that is never emailed (`transcribe`), and `notifyTakeFinished` refuses such a job too; every caller passes the job's kind (the cleanup sweep gets it from `StaleJob.kind`). Cleanup's stale loop uses a per kind running cutoff.
- `cleanup` (every 15 minutes, UTC): fails abandoned uploads and stale jobs, expires takes, then drains `storage-deletion` (its own queue, concurrency 1; a row that fails 10 times is left for a person).
- `render-spike` is manual only and builds a 10 minute HDR fixture; it has no token guard. `sentry-check` throws inside `run()` only when its payload token matches `SENTRY_CHECK_TOKEN`. `hello` is the setup check.

## Rules worth knowing

- Imports: job code may not import `@/app`, `@/server`, `next`, `react` or `@opennextjs/cloudflare` (ESLint in `eslint.config.mjs`, tested in `src/import-boundaries.test.ts`). Use `src/db/data/*` and `@/lib`.
- ffmpeg is pinned: `pinnedFfmpeg()` in `trigger.config.ts` installs one BtbN build and checks its SHA 256. To upgrade, change the URL and the hash together. Dev runs use the machine's own ffmpeg (`FFMPEG_PATH` and `FFPROBE_PATH` unset fall back to the bare names).
- Render: constant frame rate (`-fps_mode cfr`, `outputFps` in `src/lib/trim.ts`), keep ranges snapped to frames (`alignToFrames`), HDR goes through `toneMapFilter` (zscale needs `tin=<transfer>` spelled out; `media.test.ts` covers it).
- Progress is throttled (`throttledProgress`: at most every 2 s and at least 1 point). Call `flush()` before the final step write. Render progress is scaled to 95.
- Retries: the default is 3 attempts and none in dev. `process-take` has 2 attempts and a 40 minute maximum (`PROCESS_TAKE_LIMITS`); `src/lib/cleanup-rules.ts` derives the stale job cutoff from them, so change both together. `probe` has 3; `sentry-check` and `render-spike` have 1.
- Failure codes are an open set in `src/lib/failure-codes.ts`: add, never rename or remove. `failureCodeFor` maps ffmpeg errors to `ffmpeg_error`, Trigger's maximum duration to `timeout` and the rest to `internal_error` (all refundable). A timed out ffmpeg is `ffmpeg_error`, not `timeout`. `finish()` refunds once (compare and swap) and the charge happens at `startJob`, so a retry never charges twice.
- Presigned URLs are secrets. `media.ts` rebuilds tool errors with only the tool name and exit code; never log a URL, key or payload.
- Sentry: `init.ts` starts with no default integrations, and a global `tasks.onFailure` sends the allowlisted tags (`jobFailureTags`) and flushes. A payload that fails its schema never reaches `onFailure`, so test failures from inside `run()`. `process-take` and `probe` also have their own `onFailure` that writes database state.
- Tests: `media.test.ts` fakes ffprobe by stubbing `FFPROBE_PATH`; the path is read at module load, so reset modules before importing.

_Drafted by /sync from a catch up over the merged work, worth a quick human pass._
