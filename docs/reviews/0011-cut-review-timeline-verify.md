# Verify: cut review timeline, spec 0011

**Verdict: PASS, with three gaps listed below (none changes an acceptance criterion's outcome).** AC-1 to AC-11 are met with evidence. The server side (AC-6 to AC-9, AC-11) is covered by the change route tests and the real pipeline run; the page side (AC-1 to AC-6, AC-8, AC-10, AC-11) by the browser specs, which I ran again here against a production build of the app. Toyin also tried the timeline on production after #141 and reported "looks good and works" (told to the lead, not a recorded check).

Run on 2026-11-13, branch `dv0-t11-verify-0011`, main at `4568a8d` (spec 0011 parts #141 and the harness switch #144 merged). Fixture media only (`tests/fixtures`: synthetic colour bars and tones, a made up user); no real footage, faces or personal data anywhere in the proof.

## Result per acceptance criterion

| AC | Result | Evidence |
| --- | --- | --- |
| AC-1 | Met | `cut-review.spec.ts` (desktop and Pixel 7): timeline region, numbered blocks, summary "2 pauses cut" in a `role="status"`, block at least 44 px high and 24 px wide on the phone, the page does not scroll sideways. `cut-review.test.ts`: numbering, half up rounding, width rule and block geometry. Screenshots below show dashed kept blocks, hatched cut blocks and the playhead. |
| AC-2 | Met, seek lead in not asserted | The spec toggles a block by keyboard (Space), checks `aria-pressed`, the accessible name (`Pause N, …`) and that Discard restores it. "Seeks 1 s before and plays" is not asserted by any test (fixture playback is headless and stubbed); no failure seen in the video. |
| AC-3 | Met by unit tests and one browser case, skips not shown end to end | `cut-playback.test.ts`: output to original mapping, skip target, totals and end. The preview line "Previewing your cuts on the original recording." and the pending length "0:02 / 0:03" are in the screenshots. A 410 on the original shows "The original has expired" and disables blocks (spec). The per frame skip loop and the `canPlayType` fallback are not covered by a browser assertion. |
| AC-4 | Met | Spec: bar lists "Keep pause 1"; Discard clears it; a link click with pending changes raises a confirm dialog. Bar wording in `cut-review.test.ts`. |
| AC-5 | Met | `background-take-page.spec.ts`, 21 of 21 pass here: a tile pick feeds the pending bar and Render in the bar applies it; no "Use this background" button. |
| AC-6 | Met | Spec: Render sends `baseRenderId` and `cuts`, then "Rendering…", blocks and Render disabled. Server: change route tests (202 with `jobId`, free job). The failure path (job failed or cancelled gives the edits back with Try again) is in `use-change-render.ts`; there is no browser case for it (see gaps). |
| AC-7 | Met | **Pipeline run green:** `PIPELINE_ONLY=changes PIPELINE_START=prod pnpm test:pipeline`, 24 of 24 on the 3 GB sandbox (PR #144): the change render's `removed_ranges` equal the plan (only the kept cut), the flags update, the job is free, and the render length equals the original minus the removed cut (±1 frame). Transcript and export formats are checked by the transcript route tests (trimmed timeline), not by a real Deepgram run. |
| AC-8 | Met | Route tests: stale 409, `nothing_changed`, `change_limit` 429, `job_active` 409, 404 for another creator's take or cut. Browser: 429 hides Render and keeps Discard; 410 original makes the timeline read only. |
| AC-9 | Met | `changes.test.ts` "re-analysis keeps a cut the creator restored", `change-job.test.ts`, `cut-rules.test.ts`. |
| AC-10 | Met | Spec: axe with no serious issues at desktop and phone width; keyboard toggle; summary and bar are `role="status"`. Contrast and the focus ring are not separately asserted here (axe passes at both widths). |
| AC-11 | Met | Pipeline: a waveform is stored by the initial job, none for a take without audio, and an older take gets one on its first change render (all three pass in the 24). Browser: a take with no waveform shows the plain track (no canvas) with blocks. |

## Proof (fixture media only)

- Desktop and phone screenshots and a short video of the timeline and the pending bar are in the PR body, under `## Proof`.
- Captured from a production build of the app (`next build` then `next start`, local Postgres), driving the same stubbed take as `cut-review.spec.ts`.

## Gaps

1. **Not run on the built Worker.** This sandbox cannot build the Worker, so the browser specs ran against `next start` (all 9 in `cut-review.spec.ts` and all 21 in `background-take-page.spec.ts` pass). CI runs the same specs on the Worker and was green for #141.
2. **Skipping and the seek lead in are not asserted in a browser.** The pure functions are tested; the live frame loop (AC-3) and the 1 second lead in (AC-2) rely on the unit tests, CodeRabbit review and Toyin's try on production.
3. **Failure and Try again (AC-6)** has no browser test; it is covered by reading the code only. The frame alignment of the resume position (about one frame per cut) is deferred until the take GET carries `sourceFps` (spec 0011 follow-up, lead).

## Notes for the lead

- On a phone the pending bar's text column is narrow (it wraps to seven lines next to Discard and Render, see `phone-2-pending-bar`). It works, and passes axe, but Dwight may want to stack the text above the buttons below about 400 px.
- Scope feature 9: Verify it is ticked. Its status is left at in-progress for Toyin to decide; "Test it" is still open.

## Checks run

- `cut-review.spec.ts` 9 of 9 and `background-take-page.spec.ts` 21 of 21 against the production build (Postgres connections reaped every few seconds, because `next start` leaks one client per request).
- Pipeline `changes` scenario 24 of 24 (PR #144).
- No code changed in this task, so lint, typecheck and unit tests are unchanged from main.
