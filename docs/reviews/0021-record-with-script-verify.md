# Verify: record with script, spec 0021 (B2-T142 run, final on main)

**Status: final (part 2 of 2).** Re run on 2026-11-15 on `main` with B2-T129 (#347, merge `92276eb`) merged, Worker built from that tree. The interim run on Dwight's branch is replaced by the results below. The earlier report from 2026-11-14 follows below and still holds for what this run did not repeat. Synthetic scripts and test takes only; no real creator data, no production sign in.

**Part 2, final (2026-11-15):** on `main` at `92276eb` or later, including the unread prompter lines at `color-on-dark-75`. All pass: `record.spec.ts`, `record-prompter.spec.ts` (default text size reads 28 px), `record-failures.spec.ts`, `record-script-step.spec.ts` (23 tests together, chromium), `record-a11y` (36, including the Pixel 7 run with the phone takeover and bottom sheet) and `record-limits` (7). So AC-1, AC-3, AC-4, AC-7, AC-14 and AC-10's phone part hold on the merged Review step and phone layout, and the prompter default is 28 px. No UI failures. The AC-4 and AC-14 MP4 length finding is closed (see the pipeline rerun below), and real devices (iPhone Safari, Android Chrome, desktop Safari, Firefox) are still owed.

## What was run (this run)

- Worker built with `bash tests/support/build-worker.sh` (clean env, placeholders only), Postgres local, chromium with Chromium's fake camera and microphone.
- `tests/record*.spec.ts` on chromium: **25 passed** (`record`, `record-failures`, `record-follow-voice`, `record-prompter`, `record-script-step`).
- `record-a11y` and `record-limits` projects (`E2E_SPLIT=1`): **43 passed** (axe on every state in both themes, keyboard run, Pixel 7 layout, timer, warning, automatic stop, used up, refused upload, leave confirmation).
- 20 unit test files for the spec (36 files with the neighbours, 334 tests): **all passed** (follow script and state, teleprompter, storage, privacy, recorder rules and devices, realtime stream and routes, script aware cuts, cut quality, uploads, legal facts, recorded fixtures).
- New in this run, two gap tests in `tests/record-script-storage.spec.ts` (**2 passed**).
- Pipeline rerun on 2026-11-15 on `main` at `0b0b8b2` (B2-T148, after the #299 fix): `PIPELINE_ONLY=recorded pnpm test:pipeline` with the sandbox's R2 and Trigger.dev keys, **25 passed, 0 failed.** Both synthetic recordings (the WebM and the Safari style fragmented MP4) passed probe, trim, render, the charge, H.264 plus AAC, constant frame rate with fast start, and the render length check, now "kept pieces snapped to frames (±1 frame)". The MP4 45 ms finding is **closed**. No keys, links or file names are in this report.

## Result per AC (this run)

| AC | Result | Evidence |
| --- | --- | --- |
| AC-2 teleprompter | Pass | `record-prompter.spec.ts` (buttons, keys, remembered settings, no script means no prompter, reduced motion, Record step layout from B2-T128). **Gap found and closed:** the 20000 character cap in the script box had no browser test; `record-script-storage.spec.ts` checks `maxlength` and the counter. |
| AC-5 failures | Pass | `record-failures.spec.ts`, `record.spec.ts` (blocked, busy with Try again, no sideways scroll on a phone). |
| AC-6 length and usage | Pass | `record-limits.spec.ts`, `recorder-rules.test.ts`. |
| AC-8 script storage | Pass | Unit tests for storage, privacy, delete. **Gap found and closed:** nothing tested in the browser that the script and `source: "recording"` travel with the create, or that the device draft is cleared once the take exists; both are now in `record-script-storage.spec.ts`. |
| AC-9 accessibility | Pass | `record-a11y.spec.ts` (every state, both themes, keyboard only, no trap), `record-follow-voice.spec.ts`. |
| AC-10 phone and desktop | Passes on main after B2-T129 (desktop and Pixel 7) | Desktop layout passes in `record-a11y.spec.ts`. The phone part (Pixel 7 layout, thumb reach, no sideways scroll) also passes on `main` with B2-T129 merged (full screen phone takeover and settings bottom sheet, 36 tests in `record-a11y`). Real iPhone Safari, Android Chrome, desktop Safari and Firefox are not reachable here. |
| AC-11 legal | Pass | `legal-facts` tests pass; `pnpm legal:drift` is run before the PR. |
| AC-12 voice following | Pass in tests; live check pending | `record-follow-voice.spec.ts`, follow and realtime unit tests. Toyin's live retry (C-49) is still owed. |
| AC-13 script aware cuts | Pass at code level; model score pending | `ai-edit` and `cut-quality` unit tests. Toyin's `ai-eval` run (C-29) is owed. |
| AC-1, AC-3, AC-4, AC-7, AC-14, and AC-2's default text size | Pass on `main` after B2-T129 | `record.spec.ts` passes on the merged Review step; the prompter default text size reads 28 px (inside AC-2's 28 to 64 range), recorded in `record-prompter.spec.ts`. |

No UI failure was found, so nothing was reported to Dwight and `src/components/record/` is untouched.

---

# Verify: record with script, spec 0021

**Verdict: built and checked as far as this sandbox goes, but row 20 and spec 0021 stay open.** Every criterion is met by code and tests on main, and the one earlier finding (AC-4 and AC-14: the Safari style MP4 render was 45 ms off) is closed by #299 and the 2026-11-15 pipeline rerun. What is still owed cannot be done from here: real phones and browsers, the live voice following check, and Toyin's `ai-eval` run.

Re run on 2026-11-14 on branch `b2-t93-record-script-verify`, main at `19cae65`. This replaces the earlier report, which was written before #272, #284, #285, #286 and #287 merged. No real take, no production sign in (C-31), no creator data. Playwright and `agent-browser` cannot run in this sandbox, so browser specs were read, not run. CI runs them on every PR.

## What was run

- Unit tests for this spec: `follow-script`, `follow-state`, `follow-diagnosis`, `teleprompter`, `prompter-storage`, `script-privacy`, `recorder-rules`, `recorder-state`, `recorder-devices`, `realtime-stream`, `realtime-routes`, `ai-edit`, `cut-quality`, `ai-eval-record`, `upload-client`, `uploads`, `legal-facts` and `recorded-fixtures`. They are part of the full `pnpm test` run in this PR.
- `PIPELINE_ONLY=recorded pnpm test:pipeline` with the R2 and Trigger.dev keys the sandbox has: **24 of 25 checks passed, 1 failed (this was the 2026-11-14 run, before #299; it passes now, see the rerun above).** The two synthetic recordings (a Chrome style WebM with no duration in the header, a Safari style fragmented MP4) both went through probe, trim, render, the charge and cleanup. The failed check is "render length = original minus removed" for the MP4: the render was 8065 ms and the check expected 8020 ms, 45 ms off, over the one frame allowance. The WebM passed the same check. No keys, links or file names are in this report.
- `pnpm legal:drift` is clean.

## Result per acceptance criterion

| AC | Result | Evidence |
| --- | --- | --- |
| AC-1 record | Met in CI spec; real devices pending | `tests/record.spec.ts` (records with a script, reviews, uploads and opens the take; Record again; Record button in the library). Chromium fake devices only. |
| AC-2 teleprompter | Met | `teleprompter.test.ts`, `prompter-storage.test.ts`, `tests/record-prompter.spec.ts` (buttons and keys, remembered settings, no script means no prompter, recording never pauses). |
| AC-3 stop to take | Met | `tests/record.spec.ts` (review, Use this take, take page, a refused upload keeps the take), `upload-client.test.ts`. No new route carries file bytes. |
| AC-4 formats | Met at code level and in the pipeline run (finding closed 2026-11-15) | `recorder-rules.test.ts` (MIME choice), `recorded-fixtures.test.ts` (real probe reads the length from the last packet for both fixtures), and the keyed pipeline run: both fixtures were stored as recordings, probed, trimmed and rendered. On 2026-11-14 one check failed (the MP4 render was 45 ms off the plan); #299 fixed it and the rerun on main `0b0b8b2` passes 25 of 25. |
| AC-5 failures | Met in CI spec; real devices pending | `tests/record.spec.ts` (blocked camera, busy camera with Try again, phone width). New in this PR, `tests/record-failures.spec.ts`: no camera or microphone, insecure page (the camera is never asked), browser without `MediaRecorder` with and without the phone's own camera button, and a file from the native camera input going into the upload create call. `recorder-devices.test.ts`. |
| AC-6 length and usage | Met | `recorder-rules.test.ts`, `upload-client.test.ts`, `tests/record-limits.spec.ts` (timer, one minute warning, automatic stop, used up state, a 403 keeps the take). |
| AC-7 no lost takes | Met in CI spec; two notes untested | Leave confirmation and `beforeunload` in `record-limits.spec.ts`; a refused upload keeps the file. New: `record-failures.spec.ts` checks the screen wake lock is asked while recording and released at Stop. **Not tested:** the "recording stopped because the page went to the background" note and the "camera was lost" note, because Playwright cannot end a track or hide a page the way a phone does. The wording and rules are unit tested in `recorder-devices.test.ts`. Real phone check pending. |
| AC-8 script storage and privacy | Met | Stored on `take.script` (`uploads.test.ts`), shown read only on the Details tab (landed in #284; `take-script.tsx`, `tests/take-inspector.spec.ts` with axe and the empty state). Privacy: `script-privacy.test.ts`, the upload log test, take delete and account delete tests. |
| AC-9 accessibility | Met in CI spec | `tests/record-a11y.spec.ts` from #272: axe on every state in both themes, a keyboard only run, the `/design` recorder section; plus `record-prompter.spec.ts` and `record-follow-voice.spec.ts`. New `record-failures.spec.ts` adds axe on the no camera state. |
| AC-10 phone and desktop | Met in CI spec; real devices pending | Pixel 7 layout run in `record-a11y.spec.ts` (script in the top half, Stop on the first screen, 44 px targets, no sideways scroll). Real iPhone Safari, Android Chrome, desktop Safari and Firefox are not reachable from here. |
| AC-11 legal | Met | `pnpm legal:drift` clean, `legal-facts.test.ts` and the text hash tests pass. The Privacy copy names the script, Deepgram live audio and the AI edit. |
| AC-12 voice following | Met in tests; **live check pending** | `follow-script.test.ts`, `follow-state.test.ts`, `realtime-stream.test.ts`, `realtime-routes.test.ts` (including the `step` in a 503 from #287), `follow-diagnosis.test.ts` (the failure codes), `record-follow-voice.spec.ts`. A live run with a real token and microphone is Toyin's retry (C-49). |
| AC-13 script aware cuts | Met at code level; **model score pending** | `ai-edit.test.ts` (byte for byte without a script, best attempt rule, 65 percent cap, injection safe), `cut-quality.test.ts` and the script cases (repeated line, ad lib, skipped line, fluffed then clean, heavy retakes), floors in `baseline.json`. The real model score needs Toyin's `ai-eval` run (C-29); agents cannot run it. |
| AC-14 same as an upload | Met at code level and in the pipeline run (same closed MP4 length finding as AC-4) | Same create route, jobs and charge (`uploads.test.ts`). In the pipeline run both recordings were stored with `source: "recording"`, and the charge, H.264 yuv420p plus AAC render, constant frame rate and fast start checks passed for both. |

## Still owed before row 20 closes

1. **Real devices:** iPhone Safari, Android Chrome, desktop Safari and Firefox, for AC-1, AC-5, AC-7 and AC-10, including the background stop note and the lost camera note.
2. **AC-12 live voice following** in production (Toyin is retrying, C-49).
3. **AC-13 `ai-eval`** run by Toyin, and then the script cap (65 percent) confirmed or changed.
4. **AC-4 and AC-14 MP4 length: check passes** on 2026-11-15 (main `0b0b8b2`, 25 of 25 pipeline checks pass after #299). The recording tolerance is 150 ms (`tests/pipeline/fixtures.ts`), so the old 45 ms gap would also pass; closure needs the measured render and expected durations, or a one frame tolerance.
5. **A real iPhone MP4** through the pipeline (the fixtures are synthetic).

## Script aware cuts (tasks 10 to 12)

All three are built: the prompt and cap in `ai-edit.ts`, the script cases in `tests/cut-quality`, and the legal copy. Nothing is missing in code. Only the real model score (item 3) is owed.

## Scope and spec

Row 20: Build it ticked in full, `Test it` and `Verify it` left unticked on purpose, because the owed list above is open. Spec 0021 is not changed.
