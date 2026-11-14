# 0012. AI editing agents

**Date**: 2026-11-13
**Status**: In Progress
**Updated**: 2026-11-14: word cuts now judged from meaning, with no fixed filler list (Toyin, C-33). See AC-2, Word cut guidance, Validation and build step 9. The word cut cap is 60% for takes under 30 s and 40% from 30 s (Toyin, C-42). See Validation.

## Summary

After the automatic trim finds the pauses, the take is transcribed first and then Claude makes the editing calls: which pauses to cut and which to keep, which false starts, retakes, filler words and placeholder speech to remove (judged from meaning, not from a word list), which misheard words, names and punctuation to fix in the transcript, and which studio background would suit the take. Every AI cut and every fix has a short reason, is applied by default, and the creator can undo any of it (cuts on the timeline, fixes in the transcript); the background is only a suggestion. If the AI step fails, runs out of time or gives a broken answer, the take quietly falls back to today's rules based pause cuts and finishes as normal. The AI step adds at most 2 minutes to a take, and Claude only ever sees the transcript words with their timings and the list of pauses.

## Context

Slice 1 trims every silence of at least 700 ms by a fixed rule (`src/lib/trim.ts`). It cannot tell a deliberate pause (a beat before the key point) from dead air, and it cannot see false starts ("So today, so today we're…") or filler words, because it only hears loudness. The transcript (spec 0007) already has the words with timings and a filler flag, but it is made after the render, as its own job, so nothing can use it to decide cuts. Scope feature 10 asks for AI agents that make these editing calls inside the pipeline, clean up the transcript and suggest a background, each with a short reason, each undoable, while processing still finishes within the agreed time.

Most of the data side is planned (spec 0002): `cut.proposed_by` already allows `ai`, `cut.reason` holds up to 280 characters, `cuts.reanalyse` keeps every cut the creator touched, the `ai_edit` job step exists in the step registry, and slice 5's additions (`transcript.edits`, `take.suggested_background_id`, `take.suggestion_reason`) are named. Spec 0011 made every cut visible and undoable on the timeline with a free change render, so an AI cut needs no new undo mechanism. Spec 0001 fixed the model (`claude-opus-5-5` through `@anthropic-ai/sdk`, in job code only, one structured output per decision).

Forces:
- **Time.** A take is at most 10 minutes; a keyed take already takes up to about 20 minutes of a 38.5 minute deadline (spec 0004). Toyin allowed the AI step at most 2 extra minutes.
- **Cost.** Toyin set a fixed token budget per take (about $0.50 worst case, expected $0.10 to $0.30 for a 10 minute take, to be measured).
- **Privacy.** The repo is public and takes are personal. Toyin limited what reaches Anthropic to the transcript text with word timings and the list of silences: no video, audio, images, name or email.
- **Trust.** The model can be wrong, slow or down. A take must never fail or get stuck because of it, and a wrong cut must be easy to see and undo.
- **The transcript now gates the render.** Deepgram moves onto the path to Ready, so its failures must not delay or fail the video either.

## Requirements

**User stories**:
- As a creator, I want the editing calls (which pauses, false starts and fillers to cut) made with an understanding of what I said, so the first cut already sounds natural.
- As a creator, I want to see why each AI cut or transcript fix was made and undo any of them, so I stay in control of my take.
- As a creator, I want a background suggested that fits my take, so I can pick a good one in one tap.

**Acceptance criteria**:
- **AC-1**: A first run (`initial` job) and the retry of a failed take (`rerender`, a full run) do, in order: waveform, trim (silence detection into rules pause candidates), transcript (Deepgram, inside the run), AI edit (one Claude call), background, render. The take page step list shows "Transcript" and "AI edit" between trim and render. The transcript made inside the run is the take's transcript (no second Deepgram call after Ready). A change render (`background` job, spec 0011) never runs the transcript or the AI step.
- **AC-2**: The AI names the rules pause candidates to keep, each with a reason; a kept pause is stored unapplied, so the creator can still cut it. Every candidate it does not name is cut (applied) with the rules reason. It may also cut false starts and filler words, judged from what was said and never limited to a fixed word list (see Word cut guidance), which are placed on word boundaries (from the first word's start to the next word's start, see Validation). Every cut from an AI run is stored with `proposed_by = 'ai'`, a kind (`pause`, `false_start` or `filler`) and a reason of at most 280 characters (the prompt asks for at most 120); AI cuts are applied by default, kept pauses are not. Cuts the creator already changed are never replaced (spec 0002 AC-9), and a proposal that overlaps a creator owned cut is dropped silently (as `planReanalysis` does today).
- **AC-3**: On the review timeline (spec 0011) each cut shows its reason: the focused or last toggled cut's reason appears in a line under the timeline ("Cut 4: You restarted the sentence."), and each cut block's `aria-describedby` points at its reason. Undo is the spec 0011 flow: tap to keep, Render. A take that fell back to rules shows the rules reasons as today.
- **AC-4**: The AI fixes only misheard words, names and punctuation in the transcript: a fix replaces one stored word's text with new text (1 to 40 characters) and never adds, removes or moves words, so every timing stays. Each fix has a reason. The transcript panel marks fixed words (a solid underline, distinct from the filler dotted underline) and lists the fixes ("'Jon' → 'John': name said earlier in the take.") each with an Undo button (Redo after undo). Undo and redo apply at once with no render. The transcript view, the text download, the SRT, and the player captions all use a word's fixed text unless that fix is undone. Words inside a cut range are left out as today (spec 0007 AC-2).
- **AC-5**: The AI may suggest one built in studio background with a one line reason. The Background tab shows "Suggested: <name>" with the reason and a "Use it" button that makes it the pending background change (spec 0011 AC-5). The suggestion is not shown when there is none, when the take is already on that background, or when the take has no usable green screen. Nothing is applied by itself.
- **AC-6**: The transcript and AI edit steps together add at most 2 minutes to a run: one 120 second deadline starts with the transcript step and covers both. When it runs out, the step in progress is stopped and the run falls back (AC-7). The whole run still finishes within spec 0004's limits.
- **AC-7**: Fallback, the take finishes normally in every case:
  - The AI call fails, times out, is refused, is cut off at the token limit, or its answer fails validation: the take gets the rules pause cuts (as before this spec), no fixes and no suggestion; the `ai_edit` step ends `skipped` with reason `ai_unavailable`; the take page shows "AI edit wasn't available for this take." in the timeline area; Sentry receives one message with IDs and a cause code only.
  - The transcript fails or runs out of time inside the run: the AI step is skipped `ai_unavailable` as above, and after Ready the separate transcribe job starts as today (spec 0007, with its retries and "Make transcript").
  - The take is not English or has no speech: the transcript step is skipped as spec 0007 says, the AI step is skipped with the same reason, the rules cuts are used, and the "wasn't available" line is not shown (the transcript area already explains).
  - `ANTHROPIC_API_KEY` missing in the job environment: treated as `ai_unavailable` (the video job is never aborted for it).
- **AC-8**: The request to Anthropic contains only: the words (index, text, start and end ms, filler flag), the rules pause candidates (index, start and end ms), the take's length in ms, and the built in background catalog (ID, name, alt text). No video, audio, image, title, creator name, email, take ID or link from the account or take records. The spoken words are sent as transcribed, with no redaction: if the creator says a name or an email address in the take, those words reach Anthropic, as Toyin accepted (only the transcript text and timings go, Q7). Prompts and answers are never logged, stored raw or sent to Sentry; logs carry take ID, job ID, token counts, item counts and the cause code only.
- **AC-9**: At most one Claude call per job (plus the one retry below), with a fixed output cap (`max_tokens` 8000) and an input guard (a request estimated over 60 000 input tokens is not sent: `ai_unavailable`). Words go in a compact line form (`index|text|startMs|endMs|f`), not JSON objects, so a 10 minute take fits well under the guard. The request does not send a `thinking` parameter at all (see the decision note under Chosen option), it sets `effort` to `low`, there is no streaming, and the SDK's own retries are off (`maxRetries: 0`), so a 429, 5xx or network error is retried exactly once by our code if the deadline allows; nothing else is retried. When Trigger.dev retries the job (attempt 2), a transcript row and a final `ai_edit` step from attempt 1 are reused and neither Deepgram nor Claude is called again. The run logs input and output token counts so the cost per take can be measured. AI editing never changes the minutes charged.
- **AC-10**: A change render (spec 0011) and a re analysis never call the AI again; the AI cuts, fixes and suggestion stay as stored. A cut the creator changed keeps its state through any later run.
- **AC-11**: The fix undo route checks `Origin`, checks the take belongs to the signed in creator (another creator's take is not found) and refuses an index that has no fix. No transcript text appears in logs or Sentry.
- **AC-12**: The new parts (reason line, fixed word marks, fixes list, suggestion card, "wasn't available" line) follow `design.md` and WCAG AA: keyboard use, visible focus, 44 px targets, polite live region for the reason line, phone width with no sideways page scroll, and axe finds no serious or critical issues on a take with AI cuts, fixes and a suggestion, and on a fallback take.

## Options considered

### Option 1: Rules candidates plus one structured Claude call (recommended)

Silence detection still finds the pauses. One Messages API call with a JSON schema output gets the words and the candidates and returns every decision at once: pause keep or cut, word range cuts, transcript fixes, background pick. A pure validator turns the answer into cuts, fixes and a suggestion; anything broken falls back to rules.

**Pros**:
- One call: predictable latency and cost, easy to time box and fake in tests.
- The model only decides; positions come from the rules and Deepgram's word timings, so it cannot invent a cut in the middle of a word.

**Cons**:
- The whole edit is one answer; a confused answer loses all of it (fallback), not just one part.

### Option 2: Several agents with the SDK tool runner

Separate agents (cuts, transcript, background), each a tool loop that can look things up turn by turn.

**Pros**:
- Each concern gets its own prompt and can be improved on its own.

**Cons**:
- Several round trips: latency and cost grow and are hard to keep under 2 minutes and the budget. Nothing here needs a lookup the input does not already have.

### Option 3: AI suggestions only, never applied

The AI annotates the rules cuts and proposes extras, which the creator must accept before a render.

**Pros**:
- A wrong AI call never reaches the first video.

**Cons**:
- Every take needs a second render before the AI helps, which is the cost and wait the feature is meant to remove. Toyin chose applied by default.

## Decision

**Chosen option**: Option 1: Rules candidates plus one structured Claude call.

The full run transcribes the take before the render, sends the words and the rules pause candidates to `claude-opus-5-5` in one structured output call inside one 120 second deadline, validates the answer into AI cuts, transcript fixes and a background suggestion, and falls back to the rules cuts on any failure.

**Request shape (updated 2026-11-13, matches S5A-T02, #165)**: the first draft of this spec said to call Claude with `thinking: false`. `claude-opus-5-5` rejects that with a 400, so the shipped request leaves `thinking` out and lets the model use its default. To keep the call fast and cheap it sets `effort` to `"low"` in `output_config`, and the answer comes back as structured output through `output_config.format` (a JSON schema, no free text to parse). The `AI_EDIT` config has no `thinking` key; it has `effort: "low"`. Do not add `thinking: false` or `thinking: {type: "disabled"}` back: it fails every call with a 400, which the job would turn into a silent `ai_unavailable` fallback.

**Rollout switch**: `LIVE_SLICE` (`src/lib/processing.ts`) stays 3 on main, so the `ai_edit` step is not created for any real take until S5A-T08 raises it to 5. Until then a real AI run needs a local override that is never committed.

**Implementation skills**: `trigger-tasks` (`triggerdotdev/skills`, `.claude/skills/trigger-tasks/`) · `speech-to-text` (`deepgram/skills`, `.claude/skills/speech-to-text/`) · `claude-api` (built in skill, for the structured output request shape)

## Rationale

The 2 minute limit and the fixed budget (Context: time, cost) rule out multi turn agents: one call is the only shape whose worst case is known before it runs. Keeping silence detection and Deepgram as the source of every position means validation is mechanical (an index in range, a word that matches), so a fallback decision never needs judgment. Rules first also gives the fallback for free: the candidates are exactly today's cuts. The "agents" in the scope are three decisions inside one call, not three processes; if one concern later needs its own loop, it can split out without changing the stored shape.

Runner up: Option 2, if measured quality shows one prompt cannot do all three jobs well.

Settled calls (RECOMMEND items):
- **Transcript inside the run** (runner up: keep it after Ready and run the AI as a later `reanalyse` job, which needs a second render). The transcribe job kind stays for Make transcript and as the fallback.
- **Kept pauses stored unapplied** with the AI's reason (runner up: delete them), so "keep a deliberate pause" is itself undoable.
- **Word cuts span to the next word's start** (runner up: word end plus margin), so the gap after a false start goes with it and audio is never clipped mid word; frame alignment still happens at render.
- **Outcome from the `ai_edit` step** with a new skip reason `ai_unavailable` (runner up: a new `take.ai_edit_status` column), since step status and reason already exist and are shown on the take page.
- **Built in backgrounds only in the catalog** (runner up: include the creator's uploads), because upload names are creator text and Q7 limits what is sent.
- **Sequential steps under one deadline** (runner up: run the AI alongside the background preparation), fewer moving parts; revisit if measured time is tight.

## Feature design

**Data model sketch** (one migration per slice that needs it, see Build plan):

| Change | Shape | Notes |
|---|---|---|
| `transcript.edits` | jsonb NOT NULL default `'[]'`: `[{ index: int, old: text, new: text, reason: text, undone: bool }]` | at most one entry per `index`; `index` into `transcript.words`; never logged |
| `take.suggested_background_id` | uuid NULL, FK `background` ON DELETE SET NULL | built in backgrounds only (validated in code) |
| `take.suggestion_reason` | text NULL, CHECK `char_length <= 280` | ignored when the ID is null |
| `cut` | unchanged | `proposed_by = 'ai'`, kinds `pause`, `false_start`, `filler`; `applied` false for a kept pause |
| `ProposedCut` (`src/lib/cut-rules.ts`) and `proposedSchema` in `src/db/data/cuts.ts` | add `applied?: boolean` (default true) | insert writes it |
| `SKIP_REASONS` (`src/lib/processing.ts`) | add `ai_unavailable` | open set, add only |
| `STEPS_BY_KIND` | `initial` and `rerender`: `trim`, `transcript`, `ai_edit`, `background` (when a target), `render` | `LIVE_SLICE` raised to 5 when the AI path ships |
| `AI_EDIT` config (`src/lib/ai-edit.ts`) | `{ model: "claude-opus-5-5", maxTokens: 8000, maxInputTokens: 60000, deadlineMs: 120000, reasonMax: 280, promptReasonMax: 120, fixMaxChars: 40, wordCutMaxMs: 20000, wordCutMaxShare: 0.4, shortTakeMs: 30000, shortTakeWordCutMaxShare: 0.6, maxFixes: 300, effort: "low", stream: false, sdkMaxRetries: 0, keptPauseReason: "Kept: deliberate pause" }` | the one model constant (spec 0001); confirm the structured output request shape for this model with the `claude-api` skill before task 2 |
| `TrimmedWord` (`src/lib/transcript-timeline.ts`) | add `index` (into `transcript.words`) | lets the panel mark fixed words and match fixes to visible words |
| `STEP_WEIGHTS` (`src/lib/take-display.ts`) | `trim 10, transcript 5, ai_edit 5, background 5, render 75` | progress bar |
| `setStep` (`src/trigger/take-run/context.ts`) | also accepts `failed` with a failure code | for the non fatal `transcript` step |
| `STEPS_BY_KIND.reanalyse` | unchanged, and unreachable this slice | nothing starts a `reanalyse` job (AC-10) |

The AI answer schema (zod and JSON schema from one definition):

```ts
type AiEditAnswer = {
  keepPauses: { candidate: number; reason: string }[]; // only the pauses to keep; every other candidate is cut
  wordCuts: { fromWord: number; toWord: number; kind: "false_start" | "filler"; reason: string }[];
  fixes: { index: number; old: string; new: string; reason: string }[];
  background: { id: string; reason: string } | null;
};
```

**State transitions**: no new state machine. `transcript` step: `pending → running → succeeded | skipped (not_english | no_speech) | failed (provider_rejected | timeout | provider_error)`; a `failed` transcript step never fails the job. `ai_edit` step: `pending → running → succeeded | skipped (ai_unavailable | not_english | no_speech)`; it never ends `failed` and never fails the job. On the take page a `failed` or `skipped` step of a job that succeeded shows as "Skipped". Fix: `active ⇄ undone` by the creator.

**Pipeline** (`src/trigger/take-run/full-run.ts`):
1. Waveform, trim as today; the candidates are `cutsFromSilences(...)` (not yet written). A take with no audio skips `transcript` and `ai_edit` with `no_speech` here, before anything else runs.
2. Reuse on retry: if the take already has a transcript row and this job's `ai_edit` step is already final (attempt 2 of the same job), skip straight to step 5 with the stored result; no Deepgram or Claude call.
3. Start the 120 s edit deadline (its own `AbortSignal`, combined with the run signal for the calls only). `transcript` step: a shared job module (moved out of `transcribe-take.ts`) extracts audio from the run's local `ctx.source` (no presigned link, no second probe; `sourceFps` from the probe facts, `?? 30`), posts to Deepgram, and both are bounded by the edit deadline. One retry on 429, 5xx or network error only. Save with `whileJobActive(client, job.id, tx => upsertTranscript(tx, …), runSignal)`: guarded writes always take the run signal, never the edit deadline signal, so a write after the deadline is not rolled back as `aborted`. Skipped `not_english` or `no_speech` as spec 0007. Failure, deadline, or a missing `DEEPGRAM_API_KEY` in `process-take` ends the step `failed` (`provider_error` for a missing key) and never fails or aborts the job.
4. `ai_edit` step (only with a transcript): build the request (AC-8, compact word lines), call Claude (AC-9 settings) with the remaining deadline as the abort signal, zod parse, `validateAiEdit` (pure, below). Valid: proposals = the AI result; else proposals = the rules candidates and the step is `skipped ai_unavailable` plus one Sentry message through a small `reportAiUnavailable` helper in job code (`captureMessage("ai_edit_unavailable")` then flush; tags `takeId`, `jobId`, `cause`: `timeout`, `invalid`, `cutoff`, `provider_error`, `provider_rejected`, `no_key`, `too_large`, `transcript_failed`).
5. One `whileJobActive` transaction (run signal): `cuts.reanalyse(proposals)`; `transcript.edits` set to the valid result's fixes, or to `[]` on fallback; the suggestion columns set from the valid result, or cleared on fallback; and the `ai_edit` step's final status (`succeeded`, or `skipped` with its reason) is written in this same transaction, never before it, so a final `ai_edit` step always means its results are committed (the reuse rule in step 2 depends on this). `hasCuts` for the no render exit is computed after this step.
6. Background and render as today. Both exits, `ship(..., { withTranscript })` and `finishWithoutRender`, take the same flag and start the separate transcribe job only when the in run transcript step `failed` (today `finishWithoutRender` always starts it).

**Word cut guidance** (the prompt, in `src/lib/ai-edit.ts`; no new cut kind, so no migration and no new label):
- `filler`: any word or run of words that carries no meaning for the viewer: hesitation sounds ("um", "uh", "erm"), verbal tics, and placeholder or nonsense speech ("blah blah blah", "la la la", "something something"). The AI decides from context; the Deepgram filler flag is a hint, not a limit.
- `false_start`: any abandoned or repeated attempt: a sentence started and restarted, a whole line said again (cut the earlier attempts, keep the last complete one), and talk not meant for the audience ("hold on", "let me start that again", "is this recording?").
- Never cut real content the creator meant to say, even when it is long winded; when in doubt, keep it. Each word cut still needs a reason the creator can read ("Placeholder speech, not part of the message.", "You said this line again; the later take is kept.").

**Validation** (`validateAiEdit(answer, words, candidates, durationMs)`, pure, in `src/lib/ai-edit.ts`):
- Item level (the item is dropped, counted): kept pause `candidate` out of range or repeated (a kept pause with an empty or unusable reason keeps the default reason "Kept: deliberate pause"); word cut with `fromWord > toWord`, out of range, or longer than 20 s (no check against a filler word list: the kind is the AI's judgement, Word cut guidance); fix whose `old` is not exactly `words[index].w`, whose `new` is empty, equal to `old`, over 40 characters or on a filler word, or a repeated index; any empty reason; a background ID not in the catalog (no suggestion).
- Answer level (whole answer falls back): schema parse fails; `stop_reason` is `max_tokens`; word cuts total more than 40 % of the take, or more than 60 % when the take is shorter than 30 s (the cap was raised from 25 % to 40 % so a take with several retakes still gets its cuts; Toyin chose the higher short take cap on 2026-11-14, decision C-42, because a short clip can honestly lose about half of its words, and `wordCutMaxShareFor(durationMs)` in `src/lib/ai-edit.ts` is the one place that picks it: 29.999 s gets 60 %, 30 s gets 40 %); more than half of all items dropped.
- Positions: a pause candidate keeps its rules range; a word cut runs from `words[fromWord].startMs` to `words[toWord + 1].startMs` (or the take's end), except that when a kept pause candidate starts inside that range, the word cut ends at that candidate's `startMs`, so a kept pause is never swallowed. A candidate the AI did not name is cut (applied, rules reason, `proposed_by = 'ai'`). Only applied cuts merge with applied cuts: an overlap of a word cut and a cut pause becomes one cut with the word cut's kind and reason; the 20 s word cut limit is checked again after merging (over it, the merged item is dropped and the pause stays alone). An unapplied kept pause never merges. Reasons go through `cleanReason` (280 max).

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/takes/[id]` | GET | id | adds `cuts[].reason`, `cuts[].proposedBy`, `aiEdit: "done" \| "unavailable" \| null`, `suggestion: { backgroundId, name, reason } \| null` | creator session | 404 not owner |
| `/api/takes/[id]/transcript` | GET | id | adds `edits: { index, old, new, reason, undone }[]`; paragraphs carry each word's index | creator session | 404 |
| `/api/takes/[id]/transcript/edits/[index]` | PATCH | `undone: boolean` (req) | the updated edit | creator session, `Origin` check | 403 bad origin, 404 not owner or no transcript or no fix at that index, 422 invalid body |
| `/api/takes/[id]/transcript/[format]` | GET | format | text, SRT, VTT built from `editedWords` | creator session | as today |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| AI edit | pause candidates | `cutsFromSilences` over silencedetect (spec 0004) |
| AI edit | words, timings, filler flags | Deepgram response in the same run (spec 0007 shape) |
| AI edit | background catalog | `background` rows with `creator_id IS NULL` and `status = 'ready'` (ID, name, alt) |
| AI edit | cut ranges | candidate ranges; word cuts from word timings (validation rule) |
| AI edit | cut reasons, fix reasons, suggestion reason | the AI answer, through `cleanReason` |
| Fallback | cuts and reasons | rules candidates (`reasonFor` in `src/lib/trim.ts`) |
| Take GET | `aiEdit` | latest succeeded `initial`/`rerender` job's `ai_edit` step: `succeeded` → `done`; `skipped ai_unavailable` → `unavailable`; otherwise or no step (older takes) → null |
| Transcript panel state | `skipped` with `not_english` / `no_speech` when the run found it | `getTranscriptView` (`src/server/transcripts/index.ts`): with no transcript row and no `transcribe` job, read the `transcript` step of the latest `initial`/`rerender` job; skipped with a reason → `skipped` plus that reason; otherwise as today |
| Captions after a fix undo or redo | caption track version | PATCH updates `transcript.edits` in a row locked Drizzle update, which bumps `transcript.updated_at`; the response returns the new `version` (`updatedAt` plus render ID, as today) and the player reloads the track |
| Fixes list | which fixes show | only fixes whose word index is among the visible `TrimmedWord`s; fixes on words inside a cut stay stored but hidden |
| Transcript text | `transcript.text` | not rewritten by fixes; the text download, SRT and VTT are all built from `editedWords` |
| Take GET | `suggestion.name` | join `background.name` on `take.suggested_background_id` |
| Background tab | hide suggestion | `suggestion` null, or equal to `background.id` of the current video, or the take's green screen state already shown by the tab (spec 0008) |
| Timeline reason line | label and reason | AC-2 label of spec 0011 plus `cuts[].reason` |
| Transcript view and exports | word text | `editedWords(words, edits)`: `new` for an edit with `undone` false, else `w` |
| Fix undo | new `undone` | request body |
| Cost check | token counts | the API response `usage`, logged |

**Key invariants**:
- The AI never fails, delays past the deadline, or charges a take; the rules cuts are always a valid outcome.
- Every stored AI cut lies within the take, does not overlap another cut, and has a non empty reason.
- A fix never changes word count, order or timings; at most one fix per word index.
- Change renders and re analysis never call Claude; creator changed cuts are never replaced.
- Fixes, the suggestion and AI cuts are written in one transaction with the cuts, only while the job is active.
- Nothing from the prompt or answer is logged or sent to Sentry, and that includes the stored AI reasons (`cut.reason`, `take.suggestion_reason`, the `reason` in `transcript.edits`): they can quote what the creator said, so they are personal data.
- Attempt 2 of a job never calls Deepgram or Claude again when attempt 1 already stored their results.

**Security model**: Only the take's creator reads its cuts, reasons, fixes and suggestion, through the existing creator scoped functions (`src/server`); the PATCH route checks `Origin` and ownership. The Anthropic SDK and key live only in `src/trigger` (ESLint boundary already blocks `@anthropic-ai/sdk` in `src/app` and `src/server`). The transcript is personal data (spec 0007): it goes to Anthropic over the API as listed in AC-8 and nowhere else; the API does not train on it by default. No compliance scope beyond that.

**Configuration required**:
- `ANTHROPIC_API_KEY`: Trigger.dev environment only (dev and prod), parsed by a job env schema; never in the Worker or `.env` files committed. Prerequisite: Toyin creates the key and sets a monthly spending cap in the Anthropic console.

**Critical test scenarios**:
- Happy path: a fixture take with a false start, a filler, a deliberate pause and a misheard name, with a fake Claude answer: AI cuts stored with reasons (kept pause unapplied), fixes stored, suggestion stored, one render, transcript not made again after Ready, verifies **AC-1**, **AC-2**, **AC-4**, **AC-5**.
- Meaning cuts: a fake answer with a `filler` cut over "blah blah blah" (no Deepgram filler flag) and a `false_start` cut over an earlier attempt at a repeated line: both stored applied with their reasons; a `filler` cut over plain words is no longer dropped, verifies **AC-2**.
- Failure case: fake Claude times out, returns invalid JSON, returns `max_tokens`, returns word cuts over the cap (over 40 % of a take of 30 s or longer, over 60 % of a shorter one), returns a fix whose `old` does not match: the take ends Ready with the rules cuts, step `skipped ai_unavailable`, one Sentry message with IDs only, verifies **AC-6**, **AC-7**, **AC-9**.
- Failure case: Deepgram fails inside the run: rules cuts, Ready, separate transcribe job started, verifies **AC-7**.
- Request content: the built request contains no title, name, email, take ID or URL, verifies **AC-8**.
- Re render: a change render after AI edits makes no Claude call and keeps fixes and suggestion, verifies **AC-10**.
- Auth/permission: PATCH a fix on another creator's take returns 404; a bad `Origin` returns 403, verifies **AC-11**.
- UI: reason line, fix undo and redo updating the panel and the SRT, suggestion "Use it" making a pending change, axe on AI and fallback takes, verifies **AC-3**, **AC-4**, **AC-5**, **AC-12**.

## Build plan

Tracer Bullet: first a thin real thread (transcript before render, then AI pause decisions on the timeline), then thicken with fixes and the suggestion, each end to end.

1. **Transcript inside the run** (Jim): move Deepgram extraction and post into a shared job module that works from the run's local source; add the `transcript` step to `initial` and `rerender`; start the 120 s deadline; save with `upsertTranscript` under the run signal; `setStep` accepts `failed`; new `STEP_WEIGHTS` and "Skipped" display; no audio skips both new steps; a missing Deepgram key fails only the step; reuse on job retry; `ship` and `finishWithoutRender` start the separate transcribe job only when the in run step failed; `getTranscriptView` reads the run's transcript step; measure the time added on the pipeline check, satisfies **AC-1**, **AC-6**, **AC-7**, **AC-9**.
2. **AI edit thread, cuts only** (Jim): install `@anthropic-ai/sdk` (job code only); check the structured output request shape with the `claude-api` skill; `ANTHROPIC_API_KEY` env schema; `src/lib/ai-edit.ts` (config, compact request builder, answer schema, `validateAiEdit`); the `ai_edit` step with one structured call (no `thinking` parameter, `effort` low, no streaming, SDK retries off, our one retry), token logging; `ProposedCut.applied` and `proposedSchema`; `reanalyse` with AI proposals; `ai_unavailable` skip reason and the `reportAiUnavailable` helper; edits and suggestion cleared on fallback; take GET `cuts[].reason`, `cuts[].proposedBy`, `aiEdit`; fake Claude in tests, satisfies **AC-2**, **AC-6**, **AC-7**, **AC-8**, **AC-9**, **AC-10**.
3. **Reasons on the timeline** (Dwight): reason line under the timeline, `aria-describedby`, the "AI edit wasn't available for this take." line; Mobbin reference for the reason pattern, satisfies **AC-3**, **AC-7**, **AC-12**.
4. **Transcript fixes, backend** (Jim): migration for `transcript.edits`; fixes in the answer and validator; `TrimmedWord.index`; `editedWords` used by the transcript GET and every export; the PATCH route (row lock, returns the new caption `version`), satisfies **AC-4**, **AC-11**.
5. **Transcript fixes, UI** (Dwight): fixed word marks, fixes list with Undo and Redo, captions refresh, satisfies **AC-4**, **AC-12**.
6. **Background suggestion, backend** (Jim): migration for the two `take` columns; catalog in the request; suggestion written in the same transaction; take GET `suggestion`, satisfies **AC-5**, **AC-8**.
7. **Background suggestion, UI** (Dwight): the "Suggested" card in the Background tab with "Use it" into the pending bar, satisfies **AC-5**, **AC-12**.
8. **Measure and close** (Jim): pipeline check on a real 10 minute fixture (no real footage in the repo): time added by transcript plus AI, input and output tokens and cost per take, latency p50 and worst; report the numbers in the PR; set `LIVE_SLICE` to 5, satisfies **AC-6**, **AC-9**.
9. **Meaning based word cuts** (follow up, 2026-11-14): in `src/lib/ai-edit.ts`, rewrite the word cut lines of the system prompt to the Word cut guidance (drop "Use kind filler only over filler words" and "Cut little", keep "never cut real content, when in doubt keep it"); remove the filler word list check from `validateAiEdit` (the `fillerOk` rule); set `wordCutMaxShare` to 0.4; update `ai-edit.test.ts` (the old "filler over a non filler is dropped" case becomes kept) and add the Meaning cuts scenario; no migration, no UI change, satisfies **AC-2**.

## Consequences

**Positive**:
- First cuts follow meaning, not loudness; false starts and fillers go without manual work.
- Every AI decision is visible with its reason and undoable through flows that already exist.
- The fallback is today's behaviour, so the AI can only add value or be absent.

**Negative / tradeoffs**:
- Ready comes later: Deepgram and Claude now sit on the path to Ready, up to 2 extra minutes.
- The in run transcript has one quick attempt; a Deepgram blip now means a transcript after Ready through the separate job, as before this spec.
- A new paid dependency and a per take cost, and a prompt that must be maintained and re checked when the model changes.
- AI cuts are applied by default, so a wrong cut reaches the first video until the creator restores it (one free change render).
- The answer is not deterministic; tests rely on a fake Claude, and quality is checked by people on real takes.

**Neutral**:
- `reanalyse` job kind stays unused; no "re-analyse" button in this slice.
- Older takes keep their rules cuts, no fixes and no suggestion.

## Follow-up

- [ ] Toyin: create `ANTHROPIC_API_KEY` for Trigger.dev (dev and prod) and set a monthly spending cap in the Anthropic console, before task 2 runs live.
- [ ] After task 8, compare measured cost and latency with the targets ($0.10 to $0.30 typical, $0.50 worst, 2 minutes); if latency is tight, try running the AI step alongside the background preparation before changing the model.
- [ ] After step 9: Toyin tries a take with placeholder speech and a repeated line; if the AI still keeps them, tune the prompt wording only. Cutting long winded but real content stays out of scope (an editorial call; it would need its own decision).
- [ ] Quality check on a handful of real takes with the approved test account (numbers and reasons only, never footage in the repo).
- [ ] Spec 0002: note `transcript.edits` and the suggestion columns as built, `ProposedCut.applied`, and the new `initial` step list. Spec 0007: the transcript now runs inside the first run; the separate job is the fallback and Make transcript.
