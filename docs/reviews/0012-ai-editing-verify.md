# Verify: AI editing agents, spec 0012

**Verdict: PASS where it could be run live (AC-2, AC-3, AC-5); the rest is covered by tests, with one new test added.** AC-4 and AC-7 were not exercised on the live site, and AC-8 and AC-9 cannot be seen in a browser. Each is cited below against the tests that already cover it.

Run on 2026-11-14 against production (`https://take-studio.jnr4u2.workers.dev`, main at `b8fa203`), signed in with a one time link supplied by the lead. One test take only: `tests/fixtures/media/speech-en.mp4` (made up speech, 7 s). No other take in the account was opened, read or captured.

## Result per acceptance criterion

| AC | Live result | Coverage |
| --- | --- | --- |
| AC-1 | Take went to Ready with 2 pauses cut, 2.6 s saved, and the transcript made in the run | `transcript-step.test.ts` (reuse on retry, no second Deepgram call), `ai-edit-step.test.ts` |
| AC-2 | **Pass.** Each cut carried a reason: "Pause of 2.6 s", "Filler 'Um' at start of sentence." | `ai-edit.test.ts` (merge, word cuts, kept pause unapplied), `ai-edit-step.test.ts` "happy path" |
| AC-3 | **Pass.** The reason shows under the timeline for the cut | `cut-review.spec.ts` "an AI cut shows its reason on focus and on press, and each block is described by it" |
| AC-4 | **Not exercised live.** The AI proposed no fixes on this clean clip, so there was no fixes list or Undo to try | `transcript-fixes.test.ts`, `src/server/transcripts/edits.test.ts` (GET, SRT and export use the fix, undo and redo, 403, 401, 404, 422), `tests/transcript.spec.ts` "fixes: marks, list, undo and redo" |
| AC-5 | **Pass.** Background tab showed "Suggested: Soft blue gradient" with a one line reason and a "Use it" button; nothing was applied. I did not press "Use it" | `background-take-page.spec.ts` ("Suggested: Warm studio" card), `ai-edit-step.test.ts` (valid, bad ID, upload, fallback clears it) |
| AC-6 | Run finished normally, the transcript and AI steps added no visible delay on a 7 s clip. Not a timing proof | The C-15 measurement on Trigger.dev cloud (B2-T02, PR for the token estimate), `transcript-step.test.ts` deadline case |
| AC-7 | **Not exercised live.** The AI answered, so no fallback happened | `ai-edit-step.test.ts` (timeout, missing key, too large, retry rules, failed transcript, not English or no speech), `cut-review.spec.ts` (unavailable line shown on fallback, hidden when `aiEdit` is null) |
| AC-8 | **Not visible in a browser** | `ai-edit.test.ts` "cannot leak what it is never given", `ai-edit-step.test.ts` "sends only words, candidates, length", "logs and reports no text from the take, the prompt or the answer", "sends only ready built in backgrounds" |
| AC-9 | **Not visible in a browser** | One call, one retry, retry only on 429, 5xx and network: `ai-edit-step.test.ts` and `ai-call.test.ts`. Input guard: `ai-edit.test.ts` (60 000 boundary). Reuse on attempt 2: `ai-edit-step.test.ts`. **Request shape (new, this PR):** `ai-call-request.test.ts` |
| AC-10 | Not tried live | `changes.test.ts` and `change-job.test.ts` (spec 0011) keep the stored AI cuts; `ai-edit-step.test.ts` "keeps a cut the creator changed" |
| AC-11 | Not tried live | `src/server/transcripts/edits.test.ts` (Origin, session, other creator's take, index with no fix) |
| AC-12 | Not run live | `cut-review.spec.ts` and `transcript.spec.ts` (axe, keyboard, 44 px targets, phone width) |

## Evidence kept

No screenshots were taken. The check read the take page's text only, so the lead's instruction to attach screenshots of the test take could not be met; the observations above come from that text. A later check on a fresh take can add screenshots if Toyin wants them.

## Gap closed by /test

AC-9 names the request shape (`max_tokens` 8000, `effort` low, no `thinking` parameter, no streaming, SDK retries off). No test asserted it. `src/trigger/take-run/ai-call-request.test.ts` replaces the SDK with a recorder and asserts all of these. Tests only; no feature code changed.

## Remaining gaps

1. AC-4 (fixes and undo) and AC-7 (fallback) have never been seen on the live site. Both need a take where the AI proposes a fix or fails, which a clean test clip does not give. The tests above are the only evidence.
2. AC-6 has no live timing here (7 s clip). The 10 minute take measurement is the C-15 run.
3. The test take `4f555bfe-6899-4123-a0cf-183cee55ea95` is still in the account. The lead will ask Toyin to delete it once the delete dialog (PR #202) is live.
