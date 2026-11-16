# Verify of spec 0026 step 3 (credit line on the take page and GET field), B2-T179, 2026-11-16

**Verdict: PASS for everything this sandbox can run. One path is listed under "Needs a deployed check".**

**Checked by**: Dwight (sonnet).
**Scope**: spec `docs/specs/0026-edited-with-credit.md`, build plan step 3: AC-8, AC-9 and the parts of AC-14 that do not wait on billing. The switch, the PATCH route and the paid sentence are step 5 and not part of this task.
**Approach**: Tracer Bullet, thickening the render thread from steps 1 and 2 to the take page.
**Mobbin**: Mobbin unavailable (C-39), built from design.md tokens. The line is a `text-small text-muted-foreground` paragraph, the same style as the other notes on the page.

## What I ran

| # | Behaviour | How I checked it | Result |
|---|---|---|---|
| 1 | `GET /api/takes/{id}` returns `credit { applied, canChange, choice }` (AC-8, AC-9) | `routes-get-api-takes.test.ts` on a real database: a take with no render, a succeeded render without the credit, and one with `credit_applied` | None and plain give `{ applied: false, canChange: false, choice: null }`, the credited one gives `applied: true` |
| 2 | The documented API and the schemas agree | `api-registry.test.ts` and the client schema tests with the new field and a fixture | Pass; an older body without `credit` still parses (defaults) |
| 3 | The words (AC-8) | `credit-copy.test.ts`: no note when not applied or changeable, the free line when applied, the paid sentence only when `paidRemoval` is true | Pass |
| 4 | The line shows near Download on a credited take, and not on one without a credit (AC-8, AC-9) | `tests/takes.credit.spec.ts` (Chromium, built Worker): the summary row and the Export tab both show "Free videos end with an Edited with Take Studio credit."; a plain take shows neither | Pass |
| 5 | No paid plan wording while billing is off (AC-8) | Same spec: no text matching paid plan, upgrade or remove it | Pass |
| 6 | Accessibility (AC-14) | Same spec: axe no serious issues at desktop and at 390 px, no sideways scroll at 390 px. The line is plain text in a paragraph | Pass |
| 7 | Nothing else on the take page moved | `takes.take-page.spec.ts` and `takes.library.spec.ts` | 14 passed in the final run |
| 8 | Repo checks | lint on changed files, `pnpm typecheck`, `pnpm test`, `pnpm check:lines`, `pnpm legal:drift` | See the PR; legal drift flagged nothing (no service, secret, cookie, field or event added) |

Screenshots: `docs/reviews/screenshots/0026-credit-line-desktop.png` (Export tab at 1280 px) and `0026-credit-line-phone.png` (summary row and Export at 390 px), test clip only.

## Spec conformance (step 3)

| AC | Verdict |
|---|---|
| AC-8 | met for the free line; the paid sentence is deliberately off until billing and step 5 (`creditNote(…, false)` at both call sites) |
| AC-9 | met: an as is take has no render, so `applied` is false and no line shows; Download original is never credited |
| AC-14 | partly met: the line is real text, axe clean. The switch part is step 5 |

## Needs a deployed check

- A real credited render opened on the deployed take page (the e2e seeds the render row and plays the test clip), once go live (step 6) sets `credit_enabled`.
