# Cut quality test set (tests/cut-quality, spec 0017)

A written, invented test set for the AI edit. No real creator words, no real take: every case is made up. The scorer and the case schema are `src/lib/cut-quality.ts`; the CI test is `src/lib/cut-quality.test.ts` (Vitest only runs `src/**/*.test.ts`, so the test lives there and imports from here).

## Layout

- `cases/*.json`: one invented take each: `words` (`w`, `startMs`, `endMs`, `filler`, optional `conf`: the transcriber confidence, under 0.6 the AI sees the word flagged `u`), `pauses` (the pause candidates, already the cut span the rules propose), `durationMs`, and `expected` spans marked `cut` or `keep` with a kind. A word cut span runs from the first word's start to the next word's start (like `validateAiEdit`), clipped at a kept pause.
- `cases/holdout/*.json`: about a third of the set. Never read them while changing the prompt or rules; their score is checked against its own floor, so a good score means speech the prompt was not tuned on.
- `cases/index.ts`: static JSON imports (bundled, so a Trigger.dev task can import it). Add every new case here, with its answer.
- `answers/<id>.json`: the recorded model answer for the case, in the `aiEditAnswerSchema` shape, matching the B2-T27 prompt. They are hand written until someone runs `pnpm cut-quality:record` (spec 0017 step 3, local only, needs a real `ANTHROPIC_API_KEY`; see `scripts/AGENTS.md`), which refreshes them from the real model. After a refresh update `baseline.json` and `knownMisses` in the same PR.
- `baseline.json`: floors for total precision and recall (all cases, held out only, and the rules path alone). They are the current scores rounded down, so losing one must cut span fails CI.

## Add a case

1. Write the JSON in `cases/` (or `cases/holdout/` for a held out case). Use invented words only; the schema rejects overlaps and spans past the end.
2. Write `answers/<same id>.json` as the model should answer, then add both to `cases/index.ts`.
   A case may carry an optional `script` (what the speaker meant to say, invented text, at most 20000 characters): the scorer, `ai-eval` and the record script then send it to the model and validate with the script share (spec 0021 AC-13). The `script-*` cases cover a line said twice, three times, fluffed then clean, an ad lib and a skipped line.
3. Run `pnpm vitest run src/lib/cut-quality.test.ts`. The answer must validate with nothing dropped. If a total goes up, raise `baseline.json` in the same PR; never lower it to get green without saying why.

## Rules

- Any PR touching `src/lib/ai-edit.ts`, `src/lib/cut-rules.ts`, `src/lib/transcript-rules.ts` or `src/trigger/take-run/ai-*.ts` states the before and after totals from `ai-eval` (spec 0017 step 3, started by Toyin from the dashboard on request) in its description. `ai-eval` (`src/trigger/ai-eval/`, token gated, Toyin pastes `{ "token": "<AI_EVAL_TOKEN>" }` in the prod dashboard) runs the real model on this set and logs per case and total precision, recall and wrong keeps, numbers only. Agents cannot run it (C-29). The recorded answers alone only prove the validator and scorer, not the real model.
- Never put a real word a creator said in a case, a note or an answer.
- `baseline.json` `knownMisses` lists the must cut spans the hand written answers miss on purpose (`caseId@startMs`); `cut-quality.test.ts` fails by name on any other miss. Change it only together with an answer.
