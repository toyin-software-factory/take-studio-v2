# Verify of spec 0026 steps 1 and 2 (credit rules, overlay filter, render thread), B2-T178, 2026-11-16

**Verdict: PASS for everything this sandbox can run. Four paths are listed under "Needs a deployed check" because they need keys or a real deploy.**

**Checked by**: Jim (sonnet), after merging main (migration renumbered to `0023_sturdy_nitro.sql`).
**Scope**: spec `docs/specs/0026-edited-with-credit.md`, AC-1 to AC-6, AC-10 and AC-11, plus the migration and the new `credit` job kind. AC-7 to AC-9, AC-12 to AC-14 belong to steps 3 to 6 and are not part of this task.
**Approach**: Tracer Bullet. This slice has to make the rules, the filter, the stored decision and the render thread real. The take page, the PATCH route, the Terms copy and go live come later.

## What I ran

| # | Behaviour | How I checked it | Result |
|---|---|---|---|
| 1 | The migration applies and the live schema matches (AC-4, AC-5) | `pnpm db:migrate` on the local Postgres, then `psql` on `information_schema`, `app_setting` and `pg_constraint` | `render.credit_applied boolean default false`, `take.credit_choice text`, `credit_enabled = false`, `credit_starts_at = null`, `take_credit_choice_check` allows only `on` and `off`, and `processing_job_kind_check` lists `credit` |
| 2 | The credit is drawn top left in the last 4 s, landscape (AC-1, AC-2) | Real `encodeRender` with the committed PNG on a generated 1280x720, 10 s clip. Frames at 2 s and 8 s saved to the scratchpad | 2 s: no credit. 8 s: "Edited with Take Studio", white on a dark box, left edge 64 px (5% of 1280), top 36 px (5% of 720), 288 px wide (40% of 720) |
| 3 | The portrait inset is lower (AC-2) | Same run on 720x1280 | 8 s frame: box left 36 px (5%), top 128 px (10% of 1280). No credit at 2 s |
| 4 | Length, audio and size do not change (AC-3) | `render-credit.test.ts` compares a plain and a credited render of the same take (duration, audio stream, size) and the dark box only in the last 4 s | Passes |
| 5 | Keyed background still works with the credit (AC-11) | `render-credit.test.ts`: a keyed credited render (PNG is input 2) and the gate on a 6 s portrait clip, false with `creditStartSeconds: 3`, true without | Passes |
| 6 | The decision and its rules (AC-4, AC-5, AC-6) | `credit-rules.test.ts` (every row of `creditFor`) and `src/db/data/credit.test.ts` against a real database: off by default, on credits a free take, an earlier take, a future start and a disabled flag give none, a failed settings read gives no credit, `markUncredited` only changes `pending` | Passes |
| 7 | Failure falls back clean (AC-10) | `take-run/credit.test.ts` (clean retry after a non zero exit or the credited cap, never after an abort), `credit-filter.test.ts` (`isUsableCreditPng`) | Passes |
| 8 | The `credit` job kind belongs to the background family | `processing.test.ts` (`jobFamily`, `isBackgroundKind`, steps) | Passes |
| 9 | The longest allowed take fits the time limit | A synthetic 10 min 1080p30 test pattern with audio, plain render | Clean encode 318 s, credited 288 s, against the 20 min (1200 s) credited cap; the clean retry gets what is left of the 38 min limit, about 3.8 times of room. The source is easy content, so a real take is slower, still far inside it |
| 10 | The whole repo is green | `pnpm lint && pnpm typecheck && pnpm test && pnpm check:lines` | Lint 0 errors, typecheck clean, check:lines clean, and the final run on the merged branch passed: 309 test files, 2759 tests. An earlier run after merging main had two failures of my own (a stale local test database and a job kind list in `processing.test.ts`), both fixed |

## Found and fixed during this check

- A keyed credited graph had a missing `;`, so ffmpeg exited 234. Fixed in `trim-render.ts`, with a unit test and a real ffmpeg test.
- The first retry rule never retried a timeout. AC-10 says a credited encode that hits its own cap is retried clean, so I changed it. A job abort or deadline is still never retried.

## Spec conformance (steps 1 and 2)

| AC | Verdict |
|---|---|
| AC-1 | met (row 2, plus the PNG pixel test `credit-png.test.ts`) |
| AC-2 | met (rows 2 and 3) |
| AC-3 | met for the render (row 4). The transcript is made from the original before the render, so it cannot contain the credit |
| AC-4 | met (rows 1 and 6) |
| AC-5 | met (row 6). The decision is made inside `createRender`'s transaction and a failed read means no credit |
| AC-6 | met, nothing touches stored renders and no backfill exists |
| AC-10 | met in unit and real ffmpeg tests. The deployed run is listed below |
| AC-11 | met (row 5) |

Specced but missing: none for these steps. Specced but not applied: none, the migration is applied locally (row 1).

## Needs a deployed check

These need keys or a real deploy, which the sandbox does not have. Nothing here was exercised, so none of it is marked met.

1. `pnpm test:pipeline` (the API level end to end check with R2 and Trigger.dev keys) with `credit_enabled` on in a throwaway database, to see the transcript and the cut plan unchanged next to a credited render.
2. A real Trigger.dev run to confirm `additionalFiles` ships `assets/credit/edited-with-take-studio.png`. If it did not, the render still ships clean (the PNG check fails, `markUncredited` runs), but there would be no credit.
3. A real R2 upload of a credited render, and a playback of it.
4. The portrait inset against TikTok and Reels (choice C5), by screenshot, before go live.
5. Production migration `0023` through the CI deploy, then reading the two `app_setting` rows.

`credit_enabled` stays false in the seed, so nothing changes for anyone until go live.

## Fragile but working

- The credit PNG and `CREDIT_BOX` must change together. `credit-png.test.ts` guards it.
- The measured encode time uses an easy test pattern, so treat 318 s as a floor, not a typical figure.
