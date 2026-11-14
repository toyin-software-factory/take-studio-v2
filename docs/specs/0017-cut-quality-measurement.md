# 0017. Cut quality measurement without watching videos

**Date**: 2026-11-14
**Status**: Proposed

## Summary

You need to know whether the AI cuts are good without watching anyone's video. This spec adds three things. First, when a creator downloads a take, we record how many cuts of each kind they kept, undid or added (counts only), and /insights shows undo rates. Second, a "Missed something?" button on the take page records the time a creator says a cut was missed (a number, no words). Third, a fixed set of made up transcripts with known right cuts in the repo, a scorer that grades any AI change, and a manual cloud task that runs the real model on that set and reports scores only.

## Context

On 2026-11-14 Toyin's own test take ("Toyin 3") showed the AI edit leaving "uh", "um" and one "my my" repeat in, while cutting other repeats well. The only reason we know is that Toyin sent the video. Creators will not send videos, and we must never look at their takes, transcripts or words (spec 0016, the security rules). So today a change to the prompt, the rules or the model ships blind: nothing tells us whether cuts got better or worse.

Forces. Privacy: nothing a creator said may leave their take; events carry only enums, small integers and booleans (spec 0016 AC-2, AC-3), and every new event updates `src/lib/legal-facts.ts`, the Privacy copy and `LEGAL_VERSION` (0016 AC-11). Cost: the real model can only run in Trigger.dev cloud through token gated tasks Toyin starts, because the sandbox proxy swaps the Anthropic key (C-29). Signal: one creator's behaviour is noise; we need rates across many takes, and a repeatable offline check for every change to the AI edit.

The AI edit never hears audio. It reads Deepgram's words (with `filler` flags and times) and the rules' pause candidates (`buildAiRequest` in `src/lib/ai-edit.ts`). So a transcript shaped fixture is exactly the model's input, and a fixture set can test the AI leg without recording anything. What fixtures cannot test is whether Deepgram heard the "uh" in the first place.

Toyin chose all three measures (C-37, thread 1794648305.020569) and, under C-30, the recommended option for every open question.

> ⚠️ Premise note: C-37 says "10 to 20 takes we record ourselves". Recording real takes needs a person and real audio, and the AI step only ever sees a transcript. This spec builds the test set from written transcripts in the Deepgram shape (words, times, filler flags, pauses) with the right cuts marked, which tests exactly what the model sees and runs with no recording. Whether Deepgram reports the fillers at all is a separate question, checked by the existing `tests/pipeline` speech fixture, not by this set. If you still want recorded takes later, they slot in as more fixtures (Follow-up).

## Requirements

**User stories**:
- As Toyin, I want to see how often creators undo each kind of AI cut and how often they say a cut was missed, so I know whether the AI edit is too bold or too careful without watching anyone's video.
- As a creator, I want a quick way to say "you missed something here" so the product gets better.
- As a developer, I want every change to the AI edit scored against a fixed test set, so I can show it improved cuts before it ships.

**Acceptance criteria**:
- **AC-1**: A new event `cuts_reviewed` is added to the closed list in `src/lib/analytics-events.ts`. It is recorded each time a `download` link is issued (the same moment as `take_downloaded`), with the take ID. Its properties are integer counts only, keyed by proposer (`rules`, `ai`, `creator`) and kind (`pause`, `false_start`, `filler`, `manual`): `proposed` (cuts the system proposed, applied or not at proposal), `undone` (system cuts proposed applied, now `applied = false` with `creator_changed_at` set), `restored` (system cuts proposed `applied = false`, kept pauses, that the creator turned on), and `added` (creator manual cuts). Counts are computed from the take's `cut` rows at that moment. No time, word, reason or text is stored. Best effort as in 0016 AC-6 (a failed insert never changes the download response).
- **AC-2**: A new event `cut_missed` is added with the take ID and two integer properties: `atMs` (the playhead time in the edited video, rounded to 100 ms) and `durationMs` (the edited video length). No word, no reason, no free text. It is repeatable and kept 13 months like the other repeatable events (0016 AC-9).
- **AC-3**: The take page shows a "Missed something?" button next to the player controls whenever the take is `ready` and not expired. Pressing it (mouse, touch or keyboard) records `cut_missed` at the current playhead and shows "Thanks, noted at 0:07. This helps us improve AI edits." in a polite live region. It changes no cut and starts no render. At most 20 `cut_missed` per take per day are recorded; the rest answer success without writing. The button is at least 44 px, has a visible focus ring and meets AA contrast.
- **AC-4**: `POST /api/takes/[id]/missed` takes `{ atMs }`, checks the Origin and that the take belongs to the signed in creator (same 404 for missing and not yours), validates `atMs` with zod (integer, 0 up to the edited duration), and returns `204`. Signed out gets `401`. Expired takes get `409`.
- **AC-5**: `/insights` gains a "Cut quality" section for the chosen window: for each proposer and kind, the number of reviewed takes, cuts proposed, the undo rate (`undone / proposed`), the restore rate for kept pauses, manual cuts added per reviewed take, and `cut_missed` per reviewed take. Only the latest `cuts_reviewed` per take in the window counts, so repeat downloads never double count. Rows with fewer than 5 reviewed takes show "too few takes" instead of a rate. No per creator or per take rows.
- **AC-6**: `COLLECTED` in `src/lib/legal-facts.ts` lists `cuts_reviewed` and `cut_missed` with their purpose ("to measure how well automatic cuts work"), the Privacy copy says so in one line, and `LEGAL_VERSION` is bumped in the same PR that ships the first of the two events. The 0016 legal tests pass with the new names.
- **AC-7**: A fixed test set lives in `tests/cut-quality/cases/`, 12 or more JSON files, each one a written (synthetic) take: the `AiWord` list (`w`, `startMs`, `endMs`, `filler`), the pause candidates, and the expected spans, each marked `cut` or `keep` with a kind. A zod schema in `src/lib/cut-quality.ts` validates every case, and a unit test fails on a bad case. The set covers at least: plain fillers ("uh", "um", "hmm"), doubled words ("my my"), stammered repeats ("know know know"), a restart ("I was, I was gonna say"), placeholder words ("blah blah"), a deliberate pause to keep, a filler that is meaning ("like" as a verb, "you know" as a real question), a clean take with nothing to cut, and the "Toyin 3" pattern rebuilt with made up words. No case contains real creator words. At least a third of the cases sit in `tests/cut-quality/cases/holdout/`: they are never shown while changing the prompt or rules, and their score is reported separately, so a good score means the AI handles speech it was not tuned on. Cases cover speech habits beyond any one creator (for example "sort of", "basically", "okay so", "right?").
- **AC-8**: A pure scorer `scoreCuts(expected, actual)` in `src/lib/cut-quality.ts` returns, per case and in total, precision (share of cut time that was right to cut), recall (share of must cut time that was cut), the number of `keep` spans wrongly cut, and the same split by kind. A span counts as hit when at least 60% of its time is covered. Unit tests cover exact, partial, missing and wrong cuts, and an empty take.
- **AC-9**: A unit test runs every case through the rules path and through `validateAiEdit` with a recorded model answer per case (fixtures in `tests/cut-quality/answers/`), and fails if the total recall or precision drops below the floor stored in `tests/cut-quality/baseline.json`. Changing the prompt, the rules or `validateAiEdit` without updating the answers or the baseline shows up as a failing or changed score in CI.
- **AC-10**: A Trigger.dev task `ai-eval`, manual only and gated by a payload token matched against `AI_EVAL_TOKEN` (like `sentry-check`), runs the real model on every case with the production request (`buildAiRequest`, `AI_EDIT` settings), scores each answer with `scoreCuts`, and logs numbers only: case ID, precision, recall, wrong keeps, tokens in and out, and seconds. It never logs a prompt, a word or an answer. It reads the cases through `tests/cut-quality/cases/index.ts` (a static list of JSON imports, so they are bundled; job code may import `tests/`, only `src/app` and `src/server` are off limits). Refreshing the `answers/` fixtures is a separate local script, `pnpm cut-quality:record`, that a developer runs only with a real key where one works; the cloud task never writes files.
- **AC-11**: `tests/cut-quality/AGENTS.md` (pointed to from `tests/AGENTS.md`) says how to add a case, how to run the scorer, and that any PR touching `src/lib/ai-edit.ts`, `src/lib/cut-rules.ts`, `src/lib/transcript-rules.ts` or `src/trigger/take-run/ai-*.ts` must state the before and after totals from `ai-eval` in its description, which Toyin starts from the dashboard on request.

## Options considered

### Option 1: Derive quality from the `cut` table at read time

/insights reads the live `cut` rows of every take and computes undo rates on the fly. No new event.

**Pros**:
- No new event, no legal change, no stored derived value.

**Cons**:
- Cuts disappear when a take is deleted or expires, so the rate drifts and is biased toward takes creators keep.
- The insights page would read creator content tables directly, which spec 0016 kept apart on purpose.
- Says nothing about cuts the AI missed.

### Option 2: Snapshot counts at download, a missed mark, and an offline fixture set (chosen)

Record a counts only snapshot when a creator downloads (the moment they accept the edit), a time only "missed" mark, and keep a written fixture set with a scorer and a manual real model run.

**Pros**:
- Field signal from real use with no words; survives take deletion; fits the 0016 event model.
- The fixture set gives a repeatable before and after number for every AI change, in CI and in cloud.
- The missed mark captures the failure the snapshot cannot see (cuts never proposed).

**Cons**:
- Two new events and a legal copy bump.
- Download is a proxy for "satisfied"; a creator who never downloads is not counted.
- Fixtures are written by us, so they test what we thought of, not every real voice; and they do not test Deepgram.

### Option 3: Ask creators to rate each take, or opt in to sharing a take for review

A thumbs up or down per take, or a consent box that lets us review a chosen take.

**Pros**:
- Direct opinion; a shared take shows exactly what went wrong.

**Cons**:
- Ratings are rare and vague; sharing needs consent flows, new retention rules and a person to review, which is the manual loop Toyin wants to leave.

## Decision

**Chosen option**: Option 2: download snapshot counts, a time only missed mark, and a written fixture set with an automatic scorer.

Build on spec 0016's events and /insights, add a pure scorer and a fixture set, and run the real model only through a token gated cloud task.

**Implementation skills**: `trigger-tasks` (`triggerdotdev/skills`, `.claude/skills/trigger-tasks/`) · `web-design-guidelines` (`vercel-labs/agent-skills`, `.claude/skills/web-design-guidelines/`)

## Rationale

The three forces are privacy, no human review loop, and a real model that can only run in cloud. Option 1 fails the first and gives a biased number. Option 3 brings back a human review loop. Option 2 keeps every stored value an integer, reuses the 0016 event path (closed list, zod, best effort, repair free because a missed snapshot only lowers the sample), and turns "is the AI better?" into a number we can compare per PR.

Snapshot at download, not at each cut toggle, because the toggle happens through `POST /changes` together with a re render, and a creator may toggle back and forth; the download is when they accept the result. Taking the latest snapshot per take in the window avoids double counting without a unique index.

The missed mark stores a time, not a cut, because a single tap cannot say how long the missed part is, and adding a guessed cut would change the creator's video without asking. Turning a mark into a real cut is a separate, later UI decision (Follow-up). Recorded model answers in the repo let CI score every change to the rules and the validator for free; the real model is scored only when someone runs `ai-eval`, which keeps cost and key handling inside C-29.

## Feature design

**Data model sketch**:
- No new table. Two new names in the 0016 `analytics_event` closed list.
- `cuts_reviewed`: `creator_id` (FK, cascade), `take_id` (nullable, set null on take delete), `props` = `{ counts: Record<"rules"|"ai"|"creator", Record<"pause"|"false_start"|"filler"|"manual", { proposed: int, undone: int, restored: int, added: int }>> }`, each int 0 to 10000. Repeatable, 13 month retention.
- `cut_missed`: same columns, `props` = `{ atMs: int 0..7_200_000, durationMs: int 0..7_200_000 }`. Repeatable, 13 month retention.
- Fixture case (file, not database): `{ id: string, note: string, words: AiWord[], pauses: { startMs, endMs }[], expected: { startMs, endMs, kind: CutKind, verdict: "cut" | "keep" }[] }`.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/takes/[id]/missed | POST | atMs:int (req) | 204 | signed in, owner, same Origin | 401 signed out, 404 missing or not yours, 409 expired, 422 bad atMs |
| download link issue (existing) | GET | kind=download | link (unchanged) | owner | unchanged; snapshot failure never surfaces |
| /insights (existing page) | GET | window | cut quality table | config viewer only | 404 for everyone else |
| `ai-eval` Trigger.dev task | manual | token:string | logs: numbers only | `AI_EVAL_TOKEN` match | wrong token: exits with no model call |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| download | `proposed`, `undone`, `restored`, `added` per proposer and kind | the take's `cut` rows: `proposed_by`, `kind`, `applied`, `creator_changed_at` (`restored` = system cut with `applied = true`, `creator_changed_at` set, and `reason` equal to `AI_EDIT.keptPauseReason`, i.e. stored off at proposal) |
| missed | `atMs` | request body, from the player's current time |
| missed | `durationMs` | derived server side: `take.duration_ms` minus the total length of the take's applied cuts at that moment (the edited length); `atMs` is checked against it |
| missed | daily cap | count of `cut_missed` rows for the take since 00:00 UTC |
| insights | undo rate | derived: sum `undone` / sum `proposed` over the latest `cuts_reviewed` per take in the window |
| insights | missed per reviewed take | count `cut_missed` in window / number of takes with a `cuts_reviewed` in window |
| insights | "too few takes" | reviewed take count below 5 (constant `CUT_QUALITY_MIN_TAKES` in `src/lib/cut-quality.ts`) |
| ai-eval | precision, recall, wrong keeps | `scoreCuts` over the case's `expected` and the validated answer |
| ai-eval | tokens | the response `usage` fields |
| CI floor | baseline numbers | `tests/cut-quality/baseline.json` |

**Key invariants**:
- No event property is a string from a person; both new schemas pass the 0016 blocklist test.
- `cuts_reviewed` counts add up: for each proposer and kind, `undone <= proposed`; `added` is non zero only for proposer `creator`, kind `manual`.
- The missed endpoint never writes a `cut` row or starts a job.
- `ai-eval` never logs or stores a prompt, word, reason or answer in cloud.
- Fixture cases contain only invented words.

**Security model**:
- `missed` is owner only, Origin checked, rate capped per take per day, same 404 for missing and not yours (the `src/server/AGENTS.md` route pattern).
- /insights stays gated by `INSIGHTS_VIEWER_USER_ID` (0016 AC-8); no new viewer.
- `ai-eval` runs only with the token; the token lives in Trigger.dev env, never in the repo or Slack.
- Personal data: the new events hold IDs and integers only, deleted with the account (0016 AC-10). Privacy copy updated per AC-6.

**Configuration required**:
- `AI_EVAL_TOKEN`: Trigger.dev prod env only, the payload token that lets `ai-eval` run. Toyin sets it in the dashboard; it is never printed. `ANTHROPIC_API_KEY` is reused.

**Critical test scenarios**:
- Happy path: a take with 3 AI fillers, 1 AI pause, 1 kept pause; the creator undoes one filler, turns on the kept pause, adds one manual cut, then downloads twice; /insights shows one reviewed take with filler undo 1/3 and restore 1/1, verifies **AC-1**, **AC-5**.
- Failure case: the event insert fails during download; the link is still returned and the error log holds the event name and take ID only, verifies **AC-1**.
- Missed: 21 presses in one day record 20 rows and all answer 204; an `atMs` past the duration gets 422, verifies **AC-2**, **AC-3**, **AC-4**.
- Auth/permission: another creator's take ID gets 404 on `missed`; a signed out request gets 401; a non viewer gets 404 on /insights, verifies **AC-4**, **AC-5**.
- Scorer: exact match gives precision 1 and recall 1; cutting a `keep` span counts one wrong keep; 50% coverage is a miss, verifies **AC-8**.
- Regression: changing `FILLER_WORDS` or `validateAiEdit` so a case loses a must cut span drops recall below the baseline and fails CI, verifies **AC-9**.
- Token gate: `ai-eval` with a wrong token makes no model call, verifies **AC-10**.

## Build plan

Tracer Bullet: the offline set first (it needs no legal change and helps the open filler problem now), then the field signal end to end, then the missed mark.

1. `src/lib/cut-quality.ts`: the case schema and `scoreCuts`, with unit tests, satisfies **AC-8**.
2. `tests/cut-quality/`: 12 or more cases (the "Toyin 3" pattern first), recorded answers, `baseline.json`, the CI test, and `tests/cut-quality/AGENTS.md`, satisfies **AC-7**, **AC-9**, **AC-11**.
3. `ai-eval` Trigger.dev task, token gated, numbers only logs, and the local `pnpm cut-quality:record` script for answers, satisfies **AC-10**.
4. `cuts_reviewed` event: schema in the closed list, the count builder (pure, from cut rows) and recording at download, plus the legal facts, copy and `LEGAL_VERSION`, satisfies **AC-1**, **AC-6**.
5. /insights "Cut quality" section, satisfies **AC-5**.
6. `cut_missed` event, the `missed` route, the button and live region on the take page (with Mobbin references), satisfies **AC-2**, **AC-3**, **AC-4**, **AC-6**.

Steps 1 to 3 do not depend on spec 0016 shipping. Steps 4 to 6 start after 0016 step 8 is merged.

## Consequences

**Positive**:
- Every AI change gets a before and after score, in CI for free and in cloud on request.
- Toyin sees undo and missed rates from real use without any words or video leaving a take.

**Negative / tradeoffs**:
- Two more events and a Privacy copy bump.
- Fixtures reflect what we thought to write; real voices will find cases we missed. The missed rate is the signal for that.
- Download is a proxy for acceptance; creators who never download are not measured.
- Recorded answers go stale when the prompt changes and must be refreshed with `pnpm cut-quality:record`, which costs a real model run.

**Neutral**:
- No schema migration; only new event names.
- The "Missed something?" mark does not fix the take for the creator.

## Follow-up

- [ ] Decide later whether a missed mark should offer to add a cut at that time (a UI decision; needs its own spec step).
- [ ] Add recorded takes as fixtures if we want to test Deepgram's filler detection, not only the AI step.
- [ ] Add a scope row for cut quality measurement (linked to this spec) after the analytics row.
