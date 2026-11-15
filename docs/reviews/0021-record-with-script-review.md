# Review, b2-t159-record-script-close (spec 0021 Record with script), 2026-11-15

**Reviewed by**: opus (author on sonnet/unknown)
**Scope**: the shipped feature on main at 9565ccb, read in full (no diff on this branch): `src/components/record/*`, `src/app/record/page.tsx`, `src/lib/{follow-script,follow-state,follow-diagnosis,prompter-storage,teleprompter,deepgram,realtime-rules,realtime-stream,recorder-*}.ts`, `src/server/realtime/*`, `src/app/api/realtime/**`, `src/db/data/realtime-mints.ts`, the script handling in `src/server/uploads/*` and `src/server/takes/*`, `src/trigger/take-run/ai-edit-step.ts` and `ai-call.ts`, and the related unit and browser tests
**Verdict**: Changes requested at review time. The major and two of the minors are fixed in this PR (see Resolved in this PR); the rest are follow ups.

## Summary
Record with script is a careful piece of work: the token route checks Origin, session, key, usage and a locked per creator mint count before it ever calls Deepgram; the script is trimmed, capped before zod so no error holds it, read from the database inside the job and never logged; the recorder and follow logic live in pure reducers with good tests. The one real problem is a gap between the follow reducer and its side effects: when the 5 second hold runs out before the socket opens, the reducer falls back and the UI tells the creator voice following is unavailable, but the socket is left to open later and then streams the microphone for the rest of the take. A few smaller issues sit around rate limit accounting, keyboard focus on the Record button and prompter shortcuts acting behind a dialog.

## Resolved in this PR
The reviewer's major and two small minors were in scope, so they are fixed here with tests. The text of each finding below is the reviewer's, unchanged.
- **Late socket after the hold**: a new pure check `followAudioAllowed` in `src/lib/follow-state.ts` is false once following has fallen back with the socket gone. `useVoiceFollow` reads it after the token arrives and when the socket opens, and closes the socket instead of opening the audio gate. Test: "allows audio while connecting, ready and following, and not after the socket is gone", plus a check on the unavailable fallback, in `src/lib/follow-state.test.ts`. A hook level test with a fake socket was not added, because the project has no React hook test setup; the decision lives in the pure function.
- **Shortcuts behind the dialog**: `commandForKey` takes `modalOpen`, and the prompter listener passes whether a Radix dialog content (`data-slot="dialog-content"` and `data-state="open"`) or an open native `dialog` exists. Test: "never fires while a modal dialog is open" in `src/lib/teleprompter.test.ts`.
- **Pause into the next take**: the prompter resets `paused` when recording ends, in the same effect that resets the position. This one has no unit test, because it is state inside a hook; the existing prompter browser tests still pass the pause flow.

## Follow ups (not done in this PR)
- ~~A failed Deepgram grant keeps its mint slot, and the 429 `Retry-After` is the whole window.~~ Done in B2-T161: the route frees the slot when the grant fails, and `Retry-After` is the time until the oldest counted mint leaves the window, both tested in `realtime-routes.test.ts`.
- ~~The Record button is disabled during the countdown, so keyboard focus drops.~~ Done in B2-T160: `aria-disabled`, clicks ignored, focus asserted in the keyboard a11y spec.
- A hook level test for `useVoiceFollow` side effects (late open, close on stop and unmount) needs a React hook test setup first.
- ~~The six nits below.~~ Done in B2-T160, including the two file splits (`use-countdown-start.ts`, `stage-dock.css`).
- Still owed from verify: real iPhone and Android checks, Toyin's live follow retry (C-49) and the `ai-eval` run (C-29).

## Major

### 🟠 (fixed) A socket that opens after the hold ran out streams the microphone while the UI says following is off, `src/components/record/use-voice-follow.ts:153`
**Problem**: The connection effect (lines 130 to 191) fetches a token and calls `connectRealtime` with no regard for the follow state. When recording starts while the status is still "connecting", the reducer moves to fallback with `FOLLOW_NOTE_UNAVAILABLE` and `dropped: true` (`src/lib/follow-state.ts:89`), and `gate.current?.startRecording()` runs at line 202 anyway. If the token or the socket arrives a few seconds later, `onOpen` calls `audioGate.open()` unconditionally, which flushes the held frames and sends every later frame to Deepgram until the take ends. The reducer ignores the late "open" and every "match", so the creator sees "Voice following isn't available" for the whole take while their voice is being sent. The same happens when the token fetch itself resolves after the fallback, because only `cancelled` is checked at line 144. The reducer test at `src/lib/follow-state.test.ts:115` proves the state stays in fallback, but nothing tests the hook's side effect, so the gap is invisible to the suite.
**Why it matters**: It contradicts what the screen tells the creator about their own audio (the spec's privacy promise is that audio leaves only while following is on and working), and it spends Deepgram minutes on the capped realtime key for no benefit. On a slow phone connection, which is exactly when the hold expires, it can run for every take.
**Suggested fix**: In scope, small. Keep a ref to the latest follow state; in `onOpen` (and right after the token resolves) close the connection and skip `audioGate.open()` when the state is `dropped` or status is "unavailable". Simplest is to close `conn` and stop the gate from an effect that watches `state.dropped`. Add a hook level test (fake socket, fake timers) that opens the socket after the hold and asserts no frame is sent.

## Minor

### 🟡 (fixed in B2-T161) A failed Deepgram grant still uses up one of the creator's mints, and Retry-After is the whole window, `src/server/realtime/http.ts:148`
**Problem**: `reserveMint` inserts the row before `grant` runs (lines 148 to 158), so a Deepgram timeout or 5xx counts toward the 10 an hour and 40 a day caps. The 429 answer sets Retry-After to 3600 or 86400 (line 151) rather than the time until the oldest counted mint ages out.
**Why it matters**: During a Deepgram incident, a creator who retries a few takes can lock themselves out of following for an hour for no fault of their own, and the header tells a client to wait far longer than needed.
**Suggested fix**: In scope, small. Delete the reserved row when the grant fails (one delete by id), and compute Retry-After from the oldest mint in the window. Extend the existing "Deepgram fails" test in `src/server/realtime/realtime-routes.test.ts:190` to assert the slot is freed.

### 🟡 (fixed in B2-T160) The Record button is disabled during the countdown, so keyboard focus drops to the page, `src/components/record/record-stage.tsx:186`
**Problem**: `disabled={!recording && (countdown || ...)}` disables the very button the creator just pressed. Browsers move focus to the body when the focused element becomes disabled, and there is no Stop shortcut, so a keyboard or switch user has to tab back through the page to find Stop once recording starts.
**Why it matters**: WCAG 2.4.3 focus order and 2.1.1 keyboard use; this is the main action of the page.
**Suggested fix**: In scope, small. Use `aria-disabled` and ignore clicks while counting down, so focus stays on the button that becomes Stop. Add an assertion to `tests/record-a11y.spec.ts` that focus is still on the button after the countdown.

### 🟡 (fixed) Prompter shortcuts act behind the follow consent dialog, `src/components/record/use-prompter.ts:98`
**Problem**: The window keydown handler uses `commandForKey` in `src/lib/teleprompter.ts`, which skips text fields and modifiers but not an open modal. With the FollowConsent dialog open, P, the arrows and plus and minus still pause or change speed on the stage behind it.
**Why it matters**: Unexpected changes behind a modal, and arrow keys inside a dialog are expected to do nothing outside it.
**Suggested fix**: In scope, small. Return null when the event target sits inside `[role="dialog"]` or when `document.querySelector('[role="dialog"][aria-modal="true"]')` exists, and add a unit test.

### 🟡 (fixed) Pause survives into the next take, `src/components/record/use-prompter.ts:41`
**Problem**: `paused` is never reset when recording ends (lines 117 to 123 reset the position only), so after Record again the prompter can start paused while the countdown runs.
**Why it matters**: The creator starts talking and the script does not move; easy to miss under the camera.
**Suggested fix**: In scope, small. Reset `paused` to false when the stage starts a new countdown.

## Nits
- ✅ (fixed in B2-T160) `src/components/record/use-voice-follow.ts:41`, `class PipeError extends Error` breaks the "no classes where a function works" rule; a tagged Result or a plain object with a code fits the rest of the file.
- ✅ (fixed in B2-T160) `src/components/record/record-stage.tsx:125`, inline `style={{ fontSize: "var(--fs-h3)" }}`; a class in `stage.css` keeps tokens in CSS.
- ✅ (fixed in B2-T160) `src/components/record/use-prompter.ts:82`, `setAnnouncement` is called inside the `setPaused` updater; updaters should be pure (Strict Mode runs them twice).
- ✅ (fixed in B2-T160) `src/components/record/use-prompter.ts:87`, faster and slower read the `settings` closure instead of `latest.current`, so two quick presses can drop one.
- ✅ (fixed in B2-T160) `src/components/record/record-view.tsx:145`, `onBack` stops the tracks but keeps the dead `stream` in state; set it to null so nothing reads an ended stream.
- ✅ (fixed in B2-T160) `src/components/record/use-recorder.ts` and `src/components/record/stage.css` are exactly at the 250 line limit; the next change must split them, so plan where (the countdown effect is a natural hook of its own).

## Strengths
- The token route is ordered well: Origin and session first, a missing key answers 503 without touching the database, usage is checked before a slot is taken, the mint count locks the user row so parallel requests cannot pass the cap, the grant has a 10 second timeout, and only a status or error name is logged, never the token or key.
- The audio gate keeps the microphone off the wire until recording starts, and drops anything captured during the countdown; the PCM path is small and testable.
- Script privacy holds where it matters: `scriptTooLong` runs before zod so no validation error carries the text, the job reads the script from the take row rather than its payload, the AI step logs IDs and token counts only, and the device draft is per creator and cleared on create and on sign out.
- `follow-state`, `recorder-state` and `follow-script` are pure and well tested, including late events after stop and the hold timing.
- The review step is accessible: a status for "Recording stopped early", an alert for a failed upload, a labelled progress bar, and focus moved to the video controls after a keyboard Play.

## Test coverage
Unit coverage of the pure parts is strong (follow state, matching, diagnosis codes, realtime rules and stream parsing, recorder state, rules and devices, teleprompter keys), and the token route has a real database suite for Origin, session, key, caps, usage refusal, Deepgram failure and purge. Eleven Playwright specs cover the record flow, script storage, the phone sheet, prompter, follow toggle, limits, failures and a11y. Missing: any test of `use-voice-follow` side effects (the late open behind the major, and that the socket closes on stop and unmount), a freed slot after a failed grant, focus after the countdown, and shortcuts with a dialog open. Real device checks and the live follow check remain owed from verify and are not repeated here.

Reviewed by opus over the files above.
