# Verify: product analytics, spec 0016

**Verdict: PASS locally. Every AC is met by the code and mapped to a passing test or a recorded check below. Pending outside the code: the prod `/insights` view ("pending Toyin's check": the viewer id is not ours) and the prod response headers ("pending a test sign-in").**

Run on 2026-11-14 on branch `b2-t40-verify-analytics` (main at `9448e7d`), against `next dev` with the local Postgres. Only synthetic accounts and seeded takes (`tests/support/session.ts`, `tests/support/takes.ts`, a fixed viewer id). No creator take or data was used. This report holds no IDs beyond the take and job IDs the tests use.

## Result per acceptance criterion

| AC | Result | Coverage |
| --- | --- | --- |
| AC-1 server only, nothing added to pages | Pass | `analytics.test.ts` (rows come from `recordEvent` only); no script, pixel, cookie or storage key is added (`legal-facts.test.ts` "sets no cookie besides the session cookie"); the page is a server component that returns tables |
| AC-2 closed list, strict schemas | Pass | `analytics-events.test.ts` ("is the closed list of eleven names", "rejects an extra key and free text where a code is expected"); `migration.test.ts` "closes the name list and sets the delete rules" |
| AC-3 no free text, blocklist | Pass | `analytics-events.test.ts` "allows only enums, numbers and booleans, and no blocklisted key" (walks every event, now including the nested `cuts_reviewed` counts and `cut_missed`); `analytics.test.ts` "refuses bad props without writing"; `signup-hook.test.ts` "records one signup with the creator ID and no personal field" |
| AC-4 milestone events, once each | Pass | `analytics.test.ts` (signup once per creator, a milestone once per take and name, once per take needs a take ID); `uploads.test.ts` (`take_uploaded` once per take, a retry adds none); `record.test.ts` (`take_ready` with `aiEdit` from the persisted step row, a skipped retry still `done`, `ai_edit_used` once, nothing for a background change or a transcribe job); `migration.test.ts` partial unique indexes |
| AC-5 downloads and transcripts | Pass | `takes/routes.test.ts` ("records take_downloaded for a download link only, every time"), `transcripts/routes.test.ts` ("records transcript_downloaded with the format, and nothing for a refused one"); `funnel.test.ts` counts distinct creators |
| AC-6 best effort and repair | Pass | `analytics.test.ts` ("never throws on a failed insert", "logs the event name and take ID only"), `record.test.ts` (same for jobs), `analytics-repair.test.ts` (missing signup at the user's own time, `take_uploaded` from `video_expires_at`, `take_ready` and `ai_edit_used` at the job and step times, unavailable and none mapping, no repair from a failed or running job, idempotent, batches); `probe-limit.test.ts` records `take_failed` on a failed dispatch |
| AC-7 `/insights` numbers | Pass | `funnel.test.ts` (window counts, distinct creators, second take, AI share, failures by code, founding members); seen in the browser on `next dev` with a seeded viewer for 7d, 30d and all time: counts only, no per creator rows, the only email on the page is the viewer's own shell chip |
| AC-8 viewer only, same 404, private, noindex | Pass locally; prod headers pending | `src/app/insights/page.test.ts` (404 for no session, for another signed in creator and for an unset viewer, before any database or report call; `force-dynamic`; noindex and nofollow). On `next dev`: 404 for anonymous and for another creator, 200 for the viewer, not in the sitemap. `Cache-Control: no-store` on dev; the prod value `private, no-cache, no-store, ...` is Next's default for a dynamic page and is not yet read from the deployed Worker (Notes 2) |
| AC-9 two retention rules | Pass | `analytics-repair.test.ts` "deletes repeatable events past 13 months and keeps newer ones and every milestone"; the newer `cut_missed` and `cuts_reviewed` are covered by the purge test added in #239 |
| AC-10 account cascade, take set null | Pass | `analytics.test.ts` "deleting a take keeps the event with a null take ID; deleting the account removes events"; `migration.test.ts` delete rules |
| AC-11 Privacy facts true by test | Pass | `legal-facts.test.ts` ("lists every event name, the retention and deletion with the account", "states the retention ... from the constant", copy hash tests); `pnpm legal:drift`: nothing flagged |
| AC-12 numbers match rows | Pass | `analytics-repair.test.ts` (idempotent, a deleted take is not recovered), `analytics.test.ts` (a retry does not double count), `funnel.test.ts` (second take, founding member counted once per creator); the page says "Counts come from recorded events and can miss a few." once |

## Added by this task

- `src/app/insights/page.test.ts` (Jim's start, kept): the viewer gate, the 404 cases and the page flags.
- This report; scope row 17 set to done; spec 0016 set to Accepted.

## Notes

1. **Spec drift fixed in this PR:** AC-2 listed nine event names while the code has eleven (`cuts_reviewed` and `cut_missed` came with spec 0017). AC-2 now lists all eleven with a pointer to spec 0017 (the lead approved the edit).
2. **Prod `/insights` and headers: not checked here.** `INSIGHTS_VIEWER_USER_ID` is not ours to set or look up, so the page cannot be opened on prod. The viewer secret may not be set yet (C-35); record prod `/insights` as "pending Toyin's check". The `private, no-store` header read from the Worker is pending a test sign-in, with the other prod checks the lead will hand over.
3. `/insights` is not in `PRIVATE_PATHS` for `robots.txt`; it is `noindex, nofollow` and not in the sitemap. AC-8 does not ask for more.
4. **Sandbox limits.** Local `pnpm typecheck` runs out of memory and the Worker build crashes here, so CI is the proof for both. Browser checks ran on `next dev`, not a built Worker.
