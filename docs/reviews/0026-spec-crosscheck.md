# Cross check of spec 0026 (Edited with Take Studio credit), B2-T177, 2026-11-16

**Read by**: another model (Opus, read only), as the builder would, step by step through the 6 step build plan. Dwight (sonnet) checked each finding against the spec and folded the answers.
**Scope**: `docs/specs/0026-edited-with-credit.md` against `src/trigger/take-run/render.ts`, `src/trigger/render-fallback.ts`, `src/lib/trim-render.ts`, `keying-ffmpeg.ts`, `background-preview.ts`, `src/trigger/process-take.ts`, `src/lib/processing.ts`, `src/db/data/jobs/finish.ts`, `src/db/data/renders.ts`, `src/trigger/analytics/*`, `src/lib/api-registry*`, `src/components/legal/terms-copy.tsx`, `legal-facts-entity.ts`, `contrast-table.ts`, `theme.css`, and specs 0015 and 0024.
**Question asked**: for every action in the build plan, is the source of each value named? Where not, the builder would invent it.

## Summary

The idea and the numbers are sound. The plumbing around them had **12 gaps**. Eight have one clearly right answer and are **Folded** into the spec. Four are real choices (C1 to C4) listed for Toyin with a recommendation, and the recommended answer is already written into the spec so the build is not blocked. Status stays Proposed.

## Gaps

| # | Where it bites | What was missing | Answer | |
|---|---|---|---|---|
| G1 | Build 5, job kind | A `credit` job kind connected to nothing: `process-take` would run the full pipeline, a failure would move the take, analytics would count a processed video | Add `credit` to the `background` family: `jobFamily` case, `STEPS_BY_KIND` row, widened check, every `isBackgroundKind` call becomes `jobFamily(...) === "background"` | **Folded**, choice C1 |
| G2 | AC-8, AC-13, builds 3, 4, 6 | The copy promises "Paid plans can remove it" while `billing_enabled` is false | Paid sentence only while `billing_enabled` is true; Terms worded for both states; go live does not wait for billing | **Folded**, choice C2 |
| G3 | AC-5 against AC-10 | When `credit_applied` is written; retry order; time budget | Written at create, flipped by `markUncredited`; PNG probed before the encode; clean retry only after a non zero exit, never a timeout | **Folded** |
| G4 | AC-7 | Switch state and PATCH details: false "could not be added" line, null against `off`, transaction, 409, a PATCH equal to the file | Show the line only when choice is `on` and the file has none; write `off`; choice and job in one transaction; 409 changes nothing; equal PATCH is 200 with no job | **Folded** |
| G5 | AC-11 | The background gate reads the centre frame: under 8 s it lands on the credit start, and a portrait credit overlaps the centre third | Seek at `min(d/2, creditStart/2)`; test a short portrait clip | **Folded** |
| G6 | AC-4, AC-5 | `creator` against `paid`, the source of `now`, a failed settings read | Map `creator` to `paid`; `now` from the job clock; a read error means no credit, logged, never a failed render | **Folded** |
| G7 | Build 2 | Filter graph: PNG is input 1 plain and 2 keyed; the final label; looping; format | One frame with `-f image2`, `overlay` with `enable` and `eof_action=repeat`, then `format=yuv420p`; the label changes in both filter files | **Folded** |
| G8 | AC-1 | Nobody designs the PNG; the contrast test uses constants, not the file. The 5.74 to 1 claim itself checks out (`color-on-dark` on `media-glass`) | Committed script renders the PNG from fixed values; a test reads its pixels | **Folded**, choice C4 |
| G9 | API surface | The new route and field break `api-registry.test.ts` | `API_EXCLUSIONS` entry (session only) plus the MCP exclusion; schema and docs updated | **Folded** |
| G10 | AC-13 | More legal work than listed: the Terms line limiting our right to "process them and show them to you", a text hash line, lawyer review and Draft banner (spec 0015), a notice decision, `LEGAL_VERSION` is `2026-11-14` | Listed in AC-13 | **Folded**, choice C3 |
| G11 | AC-5 | Where the decision lives | `createRender` reads choice, created_at and settings in its transaction; a Trigger.dev retry decides again | **Folded** |
| G12 | AC-2, tests | The 10% portrait inset is an estimate for TikTok and Reels; tests must seed both settings | Screenshot check before go live (build 5); tests seed `credit_enabled` and `credit_starts_at` | **Folded**, choice C5 |

No action needed: existing render rows get `credit_applied` false from the column default.

## Choices for Toyin

Each has a recommendation, already written into the spec so the build can start.

- **C1. The job kind.** Recommend a new `credit` kind in the `background` family. Runner up: no new kind, reuse a `background` job with the current background and no cut plan (less code, but the job list cannot tell the two apart).
- **C2. Copy before billing exists.** Recommend no paid plan text anywhere until `billing_enabled` is true. Runner up: hold go live until billing is on (cleaner words, but no free credit for weeks).
- **C3. Telling creators about the Terms change.** Recommend treating it as a change that matters and telling signed in creators (spec 0015 AC-7). Runner up: update the page only, with a new date.
- **C4. The PNG.** Recommend a small committed script that renders it. Runner up: a hand made PNG with a manual contrast check.
- **C5. The portrait inset.** Recommend keeping 10% and checking a screenshot against TikTok and Reels before go live. Runner up: no inset difference, 5% for all.
