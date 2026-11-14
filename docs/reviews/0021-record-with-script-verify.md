# Verify: record with script, spec 0021

**Verdict: NOT ready to close. Scope row 20 and spec 0021 stay open.** Most criteria are met by code and tests on main, but one is missing a built feature (AC-8, the script on the Details tab), three need a test that does not exist yet, three cannot be checked from this sandbox (real devices, production Deepgram key, real WebM and MP4 pipeline run), and the accessibility pass (AC-9 and AC-10) is in PR #272, which has not merged.

Run on 2026-11-14 on branch `b2-t77-verify-record`, main at `7c97d60`. Only code and tests were read and run. No real take, no production sign in, no creator data. Playwright and `agent-browser` cannot run in this sandbox, so the browser specs were read, not run. CI runs them on every PR.

Run here: 14 unit test files for this spec, 245 of 245 pass (`follow-script`, `follow-state`, `teleprompter`, `recorder-rules`, `recorder-state`, `recorder-devices`, `prompter-storage`, `realtime-stream`, `ai-edit`, `cut-quality`, `upload-client`, `server/uploads`, `legal-facts`, `ai-eval-record`). `pnpm legal:drift` is clean.

## Result per acceptance criterion

| AC | Result | Evidence |
| --- | --- | --- |
| AC-1 record | Pass (code and CI spec) | `tests/record.spec.ts` "records with a script, reviews, uploads and opens the take" and "Record again brings the camera back"; "the library has a Record button beside Choose a video". Fake devices, so a real camera is not covered (see Pending). |
| AC-2 teleprompter | Pass | `teleprompter.test.ts`, `prompter-storage.test.ts`, `tests/record-prompter.spec.ts` (buttons and keys, remembered, no script means no prompter, recording never pauses). |
| AC-3 stop to take | Pass | `tests/record.spec.ts` (review, use this take, take page, refused upload keeps the take), `upload-client.test.ts`. No new route carries file bytes. |
| AC-4 formats | Partly checked | `recorder-rules.test.ts` covers MIME choice (Safari MP4, Chrome and Firefox WebM, none). The real 10 second WebM and iPhone MP4 through the probe and render, that the spec asks for, is **not in `tests/pipeline`** (only mp4 and mov fixtures) and needs R2 and Trigger.dev keys. Pending. |
| AC-5 failures | Pass | `tests/record.spec.ts` (blocked camera, busy camera with Try again, no sideways scroll on a phone), `recorder-devices.test.ts`. Not covered by a test: no camera or microphone, insecure page, no `MediaRecorder` with the native camera input. |
| AC-6 length and usage | Pass at rule level; **no browser test** | `recorder-rules.test.ts` (cap, allowance left, limit off, used up, 60 second warning), `upload-client.test.ts` sends `durationHintMs`, `record-view.tsx` shows the used up message. No Playwright spec drives the timer, warning, auto stop, used up state or the 403 keep in review. Needs a test. |
| AC-7 no lost takes | Partly checked | A refused upload keeps the file and offers Try again and Save to your device (`record.spec.ts`). Leave confirmation and wake lock are in `use-recorder.ts` (`beforeunload`, `wakeLock`, `visibilitychange`). No test covers the leave confirmation or the background stop note. |
| AC-8 script storage | **Not met: missing feature** | Stored on `take.script`, trimmed, 20000 limit, returned by take GET (`uploads.test.ts`, `views.ts`, schema check). **The Details tab does not show the script**: `src/components/takes/take-details.tsx` has no script row. Also no test checks the script is absent from logs, Sentry, analytics and job payloads (the spec's "Privacy" test), or removed by take delete and account delete. |
| AC-9 accessibility | Pending #272 | Prompter part is covered on main by `record-prompter.spec.ts` (keys, reduced motion, shortcuts ignored in text fields) and `record-follow-voice.spec.ts` (axe on the toggle). The all states axe run, keyboard run and `/design` gallery are in #272. |
| AC-10 phone and desktop | Pending #272 and real devices | The Pixel 7 layout test is in #272 (it was red, fixed in 4e6bd7e, CI running). Real iPhone Safari, Android Chrome, Safari and Firefox: not reachable from here. |
| AC-11 legal | Pass | `pnpm legal:drift` clean, `legal-facts.test.ts` passes, `legal-text-hashes.test.ts` is part of CI. |
| AC-12 voice following | Pass in tests; **live check pending** | `follow-script.test.ts` (ad libs, skip, repeat, overlap after #282), `follow-state.test.ts`, `realtime-stream.test.ts`, `realtime-routes.test.ts` (token route, Origin), `record-follow-voice.spec.ts` (off by default, disclosure, follows, falls back with a note). A real Deepgram token and live audio needs `DEEPGRAM_API_KEY` in the production Worker and a production sign in; not done here. |
| AC-13 script aware cuts | Pass | `ai-edit.test.ts` "script aware cuts" (byte for byte without a script, best attempt rule, 65 percent share, injection safe), `cut-quality.test.ts`, script cases in `tests/cut-quality`. The real model score needs Toyin's `ai-eval` run. |
| AC-14 same as an upload | Pass at code level | A recording uses the same create route, jobs and usage charge. `uploads.test.ts` covers `source` recording. No end to end run of a recorded take through transcript, cuts and render (needs the pipeline keys). |

## What is missing, in order

1. **AC-8, build:** show the script on the take page Details tab (about 15 lines in `take-details.tsx`, a "Script" row, collapsed for long scripts). Dwight can do it as a small task.
2. **AC-8, tests:** a privacy test that the script text is not in logs, the Sentry scrub, analytics events or job payloads; take delete and account delete leave no script; expiry keeps it.
3. **AC-6 and AC-7, browser tests:** timer, 60 second warning, auto stop, used up state, 403 keeps the recording in review, leave confirmation.
4. **AC-4 and AC-14, pipeline check:** a real WebM and a real MP4 from a phone through the probe and render (needs R2 and Trigger.dev keys).
5. **AC-9 and AC-10:** wait for #272 to merge, then re run this table for those two rows.

## Pending, not faked

- **Real devices:** no iPhone or Android phone was reachable. AC-1, AC-5, AC-7 and AC-10 on real hardware are pending.
- **AC-12 live:** needs the Deepgram realtime key in the production Worker. Michael asks Toyin if this blocks. No production sign in was asked for (C-31).
- **Model quality (AC-13):** Toyin's `ai-eval` run.

## Scope and spec

Not changed: row 20 stays `planned`/open and spec 0021 stays as it is, because AC-8 is not met and several rows are pending.
