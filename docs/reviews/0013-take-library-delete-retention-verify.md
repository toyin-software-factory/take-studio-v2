# Verify: take library, delete and retention, spec 0013

**Verdict: PASS, with two notes.** Every acceptance criterion maps to a passing test. The browser checks ran locally on 2026-11-14 against the dev server (`next dev` on 127.0.0.1:8787) with synthetic seeded takes only (made up titles such as "Gamma take", rows written straight into the local Postgres, DELETE stubbed where the exact answer matters). No production take and none of Toyin's takes were opened.

1. **Not run on production.** A live run needs a sign in link from the lead, which this task did not include. The delete route, sweep and storage drain are proven by real database tests and the pipeline checks instead (rows below).
2. **AC-11 logging is now tested.** The only delete log line (`take delete: after commit step failed` in `src/server/takes/index.ts`) writes the take ID, the step name and the error name. `src/server/takes/delete.test.ts` "logs the take ID only when a step after the commit fails (AC-11)" fails if a title, key, link or message is added to it.

## Result per acceptance criterion

| AC | Result | Covered by |
| --- | --- | --- |
| AC-1 | Pass | `src/lib/take-display.test.ts` (expiry line, days left, "Video removed on", no line before the upload completes, UTC date whatever the host time zone); `tests/expired-take.spec.ts` "the library card says Video removed on a date, transcript kept" |
| AC-2 | Pass | `tests/expired-take.spec.ts` "an expired take says the video was removed, keeps the transcript, offers no video" (no `video`, no Download buttons, transcript downloads and Rename present, axe) at desktop and phone width |
| AC-3 | Pass | `src/server/takes/routes.test.ts` "DELETE /api/takes/{id}": 401 signed out, 403 for a missing or foreign Origin, 204 with no body then 404 on a repeat, the same 404 for another creator's take, 204 when cancel or drain fails |
| AC-4 | Pass | `tests/delete-take.spec.ts` "network failure is unknown; a retry that gets 404 counts as done" (progress, unknown outcome wording, back to `/library`, "Take deleted.", focus on the heading), "a server error keeps the dialog open with the message focused", "the header menu opens the same dialog", "the Delete button in Details is keyboard reachable" |
| AC-5 | Pass | `tests/delete-take.spec.ts` "deleting removes the card at once, updates the count and moves focus", "deleting the last take shows the empty state and focuses the upload area" |
| AC-6 | Pass | `src/server/takes/delete.test.ts` (every row, original and render keys queued, in progress render key, transcript with edits, previews and their stills, another creator untouched); `tests/pipeline/transcript.ts` "deleting the take deletes its transcript" |
| AC-7 | Pass | `src/server/takes/delete.test.ts` "leaves nothing behind when the take is deleted during a running job (AC-7)"; step level checks in `src/trigger/media.test.ts`, `preview-background.test.ts`, `ingest-background.test.ts` |
| AC-8 | Pass | `src/db/data/cleanup.test.ts` "expires due takes, queues their files, clears render keys, and keeps cuts and render settings", "expires only after the date, and the transcript with its edits stays", "refuses to expire a processing take", "does not expire a take while a transcribe job runs"; `routes.test.ts` "is 404 with no file and 410 once expired" |
| AC-9 | Pass | `src/lib/storage-lifecycle.test.ts` (35 days above the 30 day promise, once each prefix, never `backgrounds/`, seconds, one constant). The deploy step skips with a warning until `R2_LIFECYCLE_TOKEN` is a CI secret (B2-T06) |
| AC-10 | Pass | `src/server/account/account.test.ts` "leaves no row of the creator and queues every file, whatever state each take is in" |
| AC-11 | Pass | `src/server/takes/delete.test.ts` checks that `bestEffort` logs `takeId`, `step` and the error name only; the dialog shows only the take's own title (`tests/delete-take.spec.ts`) |
| AC-12 | Pass, gaps closed by this task | `tests/delete-take.spec.ts`: focus trap on the card dialog and the take page dialog (new), Escape and Keep it return focus to the opener, "Delete <title>" names on the card menu, header menu and Details button, error message focused inside the dialog, axe with the menu and the dialog open, 44 px targets and no sideways scroll on the library (Pixel 7) and on the take page and its dialog (new); `tests/expired-take.spec.ts` axe on the expired page and card at both widths |

## Added by this task

Tests only, in `tests/delete-take.spec.ts` (11 tests, all passing, plus the 4 in `tests/expired-take.spec.ts`):

- the dialog traps focus (Tab and Shift+Tab never leave it), on the library card and on the take page
- the Details Delete button is reached and opened from the keyboard, and Keep it returns focus to it
- the take page at phone width: no sideways scroll, 44 px Delete, Keep it and Delete take buttons, axe with the dialog open

No feature code changed.
