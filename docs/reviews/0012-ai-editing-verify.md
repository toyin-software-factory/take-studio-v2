# Verify: AI editing agents, spec 0012

> **Re-verify of AC-2, 2026-11-14 (B2-T42): not yet passing.** The code for meaning based cuts, the throwaway sentence rule and the short take cap is in main, and the local test set is green, but Toyin's production `ai-eval` run shows weak cases. Scope row 10 stays open and spec 0012 stays In Progress until B2-T73 fixes them. Details in "AC-2 re-verify" at the end. The sections below are the first check (main at `b8fa203`), kept as it was.

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

## AC-2 re-verify (B2-T42, 2026-11-14)

What changed since the first check, all in main: meaning based word cuts with no fixed filler list (B2-T20, #216), cutting a sentence that only fills time or says the speaker has nothing to say (B2-T36, #238), and the word cut cap of 60% for takes under 30 s and 40% from 30 s (B2-T41, #241, C-42). The code is in `src/lib/ai-edit.ts` (`wordCutMaxShareFor`, `AI_EDIT.shortTakeMs`, the system prompt).

### Local run (`pnpm vitest run src/lib/cut-quality.test.ts`, 26 of 26 pass)

This scores the validator, the scorer and the hand written recorded answers in `tests/cut-quality/answers/`. It does not call the real model, so it proves the plumbing, not the model's judgement.

| Group | Cases | Precision | Recall | Wrong keeps |
| --- | --- | --- | --- | --- |
| All | 23 | 0.9705 | 0.9906 | 1 |
| Main (not held out) | 15 | 0.9790 | 1.0000 | 0 |
| Held out | 8 | 0.9541 | 0.9725 | 1 |
| Rules only (no AI) | 23 | 0.5741 | 0.0729 | 2 |

All four match the floors in `tests/cut-quality/baseline.json`. The one known miss is `drawn-out-hesitation@3620`, listed on purpose in `knownMisses`. The AI answers beat the rules on recall (0.9906 against 0.0729).

### Production `ai-eval` (real model, run by Toyin: `run_06gtm60jt4f1thmq5c61aupsa2`, 2026-11-14 17:25Z)

| Group | Cases | Precision | Recall | Wrong keeps |
| --- | --- | --- | --- | --- |
| All | 23 | 0.936 | 0.906 | 1 |
| Main | 15 | 0.916 | 0.914 | 1 |
| Held out | 8 | 0.979 | 0.890 | 0 |

The gap between the local recall (0.9906) and the real model's (0.906) is the point of running the real model: the recorded answers are what a good answer looks like, the run is what the model did.

Weak cases in that run:

| Case | Result | What it means |
| --- | --- | --- |
| `doubled-words` | 0 / 0 | Jim thinks this is a scorer issue, not the model, and is confirming it under B2-T73 |
| `toyin3-pattern` | precision 0.759, recall 0.815, 1 wrong keep | The model cut speech it should have kept, and left some in |
| `toyin4-nothing-to-say` | recall 0.872 | Part of the nothing to say sentence was left in |
| `tics-sort-of` | recall 0.4 | "sort of" style tics mostly stay in |
| `short-take-heavy-cuts` | recall 0.933 | Close, but under the target on a short take |

### Verdict on AC-2

- **Meaning based cuts, throwaway sentence, short take cap: built and tested.** The cap and the word cut validation are covered by `ai-edit.test.ts` and `ai-edit-step.test.ts`, and the local set is at its floors.
- **Against the real model: not passing yet.** AC-2 asks for cuts judged from what was said. `tics-sort-of` (recall 0.4) and `toyin3-pattern` (a wrong keep and precision 0.759) show it still misses or mis-cuts on those patterns. The `doubled-words` result may be a scorer problem, which T73 confirms.
- I did not re-run a live take on the production site: no one time link was available to me, and the real model check is Toyin's `ai-eval`, which agents cannot start (C-29). The first check's live observations (pauses and a filler cut with reasons) still stand but predate the meaning based change.

**Row 10 stays `in-progress` and spec 0012 stays In Progress.** B2-T73 is the fix. After it lands, Toyin runs `ai-eval` again, and if every case clears the floors and `doubled-words` is settled, B2-T42 is repeated to close the row.
