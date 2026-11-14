# Verify: cut quality measurement, spec 0017

**Verdict: PASS locally, two items open. Every AC is met by the code and mapped to a passing test or a recorded check below, except AC-10's cloud run ("pending Toyin's run") and the production checks (the deploy of `3f54f77` had not run when this was written).**

Run on 2026-11-14 on branch `b2-t39-verify-cut-quality` (main at `3f54f77`), against `next dev` with the local Postgres. Only synthetic accounts and seeded takes (`tests/support/session.ts`, `tests/support/takes.ts`, a fixed viewer id for `/insights`). No creator take was used.

## Result per acceptance criterion

| AC | Result | Coverage |
| --- | --- | --- |
| AC-1 `cuts_reviewed` at download | Pass | `cuts-reviewed.test.ts` ("counts proposed, undone, restored and added, and repeat downloads count one take", "stores numbers only, no words or ids", "a failed insert never throws and logs only the name and take id"); `analytics-events.test.ts` (closed list, no free text) |
| AC-2 `cut_missed` event | Pass | `missed.test.ts` ("records a rounded time and the edited length, writes no cut", "keeps the stored time on a 100 ms boundary"); `analytics-events.test.ts` |
| AC-3 "Missed something?" button | Pass | `tests/missed-button.spec.ts`, 4 of 4 against `next dev`: keyboard press and polite note, failed note keeps the button usable, axe, 44 px target, focus ring, phone width without sideways scroll |
| AC-4 `POST /api/takes/[id]/missed` | Pass | `missed.test.ts` (403 wrong Origin, 401 signed out, 404 not yours, 409 not ready or expired, 422 bad body or past the length, 20 a day cap with a new UTC day, never past 20 under simultaneous presses) |
| AC-5 `/insights` Cut quality | Pass | `cut-quality.test.ts` ("sums one snapshot per take and hides rates below the minimum"), `cuts-reviewed.test.ts` (**added**: window, deleted take excluded, missed marks in the window); seen in the browser at both widths (screenshots in the PR) |
| AC-6 legal facts and copy | Pass | `legal-facts.test.ts` ("lists every event name, the retention and deletion with the account", copy hash tests); `pnpm legal:drift`: nothing flagged |
| AC-7 test set | Pass | `cut-quality.test.ts` ("has 12 or more cases, at least a third held out", "every case passes the schema", "covers the required patterns"); 14 cases, 5 held out |
| AC-8 scorer | Pass | `cut-quality.test.ts` (nine scorer tests: exact, partial, missing, wrong keep, 50% vs 60%, overlap, per kind, totals add counts) |
| AC-9 floor in CI | Pass | `cut-quality.test.ts` (floor on all cases, held out floor, rules path floor, AI beats rules on recall, a dropped must cut fails the floor, names every missed span) |
| AC-10 `ai-eval` cloud task | Task code Pass; **cloud run pending Toyin's run** | `run-eval.test.ts` (no call for a wrong, empty or missing token, no key stops with `no_key`, one call per case, log lines hold no text, token or key). The real model run needs Toyin to start the task from the prod dashboard |
| AC-11 docs | Pass | `tests/cut-quality/AGENTS.md`, pointer in `tests/AGENTS.md` |

## Added by this task

- `cuts-reviewed.test.ts`: snapshots outside the window and snapshots of a deleted take are left out; missed marks are counted in the window.
- `analytics-repair.test.ts`: `cut_missed` and `cuts_reviewed` older than 13 months are purged, recent ones kept.
- Fix found while verifying: the Cut quality table's horizontal scroll area on a phone failed axe (`scrollable-region-focusable`, serious). It now has `role="region"`, a name and `tabIndex={0}` (`src/components/insights/cut-quality-table.tsx`).

## Notes

1. **Production checks pending.** The deploy of `3f54f77` was still behind CI on main. `/insights` cannot be viewed on prod (`INSIGHTS_VIEWER_USER_ID` is not ours), so it was checked locally with a seeded viewer. The prod check left is the "Missed something?" button on a synthetic test take; it will be done when the deploy is live.
2. **AC-10 cloud run:** record as "pending Toyin's run"; the lead folds it into the run already requested.
3. **No permanent `/insights` e2e.** The browser check used a throwaway spec (deleted). CI's web server has no viewer id, so a permanent spec needs that env first; the new unit tests cover the data path.
4. **Sandbox limits.** Local `pnpm typecheck` runs out of memory and the Worker build crashes here, so CI is the proof for both. The browser checks ran on `next dev`, not a built Worker. `next dev` leaks Postgres connections; the local database was restarted between runs.
5. First seeding attempt showed "0 reviewed takes": it was my seed (counts stored without the `counts` wrapper that the strict schema requires), not a code fault.
