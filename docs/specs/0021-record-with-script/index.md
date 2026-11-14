# 0021. Record with script (in app recording and teleprompter)

**Date**: 2026-11-14
**Status**: Proposed

## Summary

Creators can record a take inside Take Studio, on a phone or a laptop, while a teleprompter shows their script in large text near the camera. When they stop, the recording goes through the same upload and processing as any video file, so transcript, AI cuts, backgrounds and downloads all work the same. Two later steps make it smarter: the script scrolls by following the creator's voice, and the AI uses the script to keep only the best attempt of a line the creator said more than once. The script is stored with the take and deleted with it, so the Privacy and Terms copy change in the same pull requests that store it.

## Requirements

**User stories**:
- As a creator, I want to paste my script and read it while I record, so I look at the lens and do not forget my lines.
- As a creator, I want to control the speed, pause and text size, so the prompter keeps my pace and not the other way round.
- As a creator, I want to stop and see my recording straight away in the normal take flow, with no export and upload step.
- As a creator, I want to say a line again when I fluff it and have the best attempt kept, so I do not edit by hand.
- As a creator on a phone, I want it to work in Safari and Chrome, and to tell me clearly when the camera or microphone is blocked.
- As the product owner, I want recorded takes to respect the usage limit, the 10 minute cap and the privacy rules, with nothing about the script in logs.

**Acceptance criteria** (the contract; each is independently checkable):
- **AC-1** (record): a signed in creator opens `/record`, allows camera and microphone, sees a live preview (mirrored for them, never in the file), can pick the camera and microphone and, on a phone, flip the camera, and can start a recording after a 3 second countdown. The Record entry sits beside "Choose video" in the upload area.
- **AC-2** (teleprompter): a pasted script (up to 20000 characters) shows as large text near the top of the preview. The creator can pause and resume it, change the speed (60 to 260 words a minute in steps of 10, default 140) and the text size (5 steps, 28 to 64 px), with buttons and with the keyboard. The scroll position is a pure function of elapsed time and speed. Pausing the prompter never pauses the recording. A recording with no script is allowed and has no prompter. Speed and size are remembered on the device.
- **AC-3** (stop to take): Stop opens a review step (play back, "Use this take", "Record again", "Save to your device"). "Use this take" sends the file through the existing multipart upload (the same routes, retries and progress, `src/server/uploads/AGENTS.md`), makes a take with `source = recording`, and ends on the normal take page. No new route carries file bytes.
- **AC-4** (formats): the recorder picks the first type that `MediaRecorder.isTypeSupported` accepts from: MP4 with H.264 and AAC, WebM with VP9 and Opus, WebM with VP8 and Opus. The probe accepts the result, measures duration and size from the file (never from the browser's timer) and the render makes the normal MP4. Video is at most 1080p in either orientation at 30 frames a second with a capped bitrate, so a 10 minute recording stays far under 2 GiB.
- **AC-5** (permission and device failures): denied, no camera or microphone, device in use by another app, an insecure page, and a browser without recording each show their own plain message and a way forward (browser settings help, close the other app, "Upload a file instead", and on a phone without `MediaRecorder` the native camera through a file input). Never a blank screen. After a denial is fixed in the browser, "Try again" works without reloading the app.
- **AC-6** (length and usage): recording stops by itself at the shorter of 10 minutes (`MEDIA_LIMITS.maxDurationMs`) and the seconds left in the monthly allowance when the limit is enforced (spec 0014). A timer is always visible, and a warning appears and is announced 60 seconds before the stop. With nothing left, Record shows the used up message and cannot start. A refused create (403 `limit_exceeded`, with `durationHintMs` as the browser's own recorded length) keeps the recording in the review step with the dated message and never discards it.
- **AC-7** (no lost takes): a failed upload keeps the file with "Try again" and "Save to your device". Leaving the page while recording, reviewing or uploading asks for confirmation. If the browser stops the recording because the page went to the background, what was captured goes to the review step with a note. The screen is kept awake while recording where `navigator.wakeLock` exists.
- **AC-8** (script storage): the script travels with the upload create, is stored on the take (`take.script`), shows on the take's Details tab, and is deleted with the take and with the account. It is not removed when the video expires (same as the transcript). It never appears in logs, Sentry, analytics, job payloads, error messages or URLs. A browser only draft is kept on the device and cleared once the take is created.
- **AC-9** (accessibility, WCAG AA): the recorder is operable by keyboard alone with visible focus, 44 px targets, AA contrast on the dark stage, no keyboard trap, shortcuts that never fire while a text field has focus, polite announcements for recording started, stopped and the warning (never every second), a text alternative for the level meter, and a reduced motion mode that steps line by line with a highlight and no smooth scroll. axe passes on every state.
- **AC-10** (phone and desktop): works on iPhone Safari (MP4), Android Chrome, desktop Chrome, Safari and Firefox. A portrait phone gives a portrait file. At phone width there is no sideways scroll and the controls stay in reach of a thumb.
- **AC-11** (legal): the pull request that first stores a script updates `src/lib/legal-facts.ts`, the Privacy and Terms copy and `LEGAL_VERSION`; so does the one that sends live audio to Deepgram and the one that sends the script to Anthropic (`src/lib/AGENTS.md` checklist). `pnpm legal:drift` is clean in each.
- **AC-12** (voice following, step 2): with "Follow my voice" on, the prompter moves to where the creator is in the script, ignores ad libs and skipped lines, and falls back to timed scrolling (with a visible note) when nothing matches for 5 seconds or the connection drops. It is off until the creator turns it on, and the first time shows what is sent and to whom. We store no audio. The cost per recording is bounded by the recording cap.
- **AC-13** (script aware cuts, step 3): when a take has a script, the AI edit request includes it, and for a line spoken more than once the AI keeps the best attempt and cuts the others as `false_start` with a readable reason. A take with no script behaves exactly as today. Every spec 0012 invariant still holds (fallback to rules cuts, validation, 120 second deadline, no logging of content). The cut quality set (spec 0017) gains script cases with floors.
- **AC-14** (same as an upload): a recorded take gets the transcript, cuts, backgrounds, captions, downloads, delete and expiry exactly like an uploaded one, and counts against the usage limit the same way.

## Decision

**Chosen option**: Option 1: record in the browser with `getUserMedia` and `MediaRecorder`, hold the recording until the creator confirms, then reuse the existing upload and pipeline unchanged.

Build it in three steps, thin end to end first (Tracer Bullet): (1) recorder and timed teleprompter into the normal pipeline, (2) voice following with Deepgram streaming, (3) script aware cuts in the existing AI step. Reasoning and options: see [rationale.md](rationale.md).

**Implementation skills**: `nextjs-on-cloudflare` (`cloudflare/skills`, `.claude/skills/nextjs-on-cloudflare/`) · `speech-to-text` (`deepgram/skills`, `.claude/skills/speech-to-text/`, step 2) · `vercel-react-best-practices` (`vercel-labs/agent-skills`, `.claude/skills/vercel-react-best-practices/`) · `web-design-guidelines` (`vercel-labs/agent-skills`, `.claude/skills/web-design-guidelines/`) · `trigger-tasks` (`triggerdotdev/skills`, `.claude/skills/trigger-tasks/`, step 1 probe change)

## Feature design

**Data model sketch** (one migration in task 1, one more only if step 3 needs it, which it does not):

| Change | Shape | Notes |
|---|---|---|
| `take.source` | text NOT NULL default `'file'`, CHECK in (`file`, `recording`) | set at upload create; lets /insights count recorded takes from our own database, so no new analytics event |
| `take.script` | text NULL, CHECK `char_length <= 20000` | trimmed, line breaks kept; deleted with the take row, so take delete and account delete cover it with no extra code |
| `CONTAINERS` (`src/lib/processing.ts`) | add `webm` | the probe normalises matroska,webm to `webm`; `checkUpload` accepts it |
| `RECORDER` config (`src/lib/recorder-rules.ts`, new, pure) | `{ mimePreference: [...], videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 128_000, timesliceMs: 1000, countdownSeconds: 3, warnSecondsLeft: 60, minDurationMs: 1000 }` | the numbers live in one place |
| `TELEPROMPTER` config (`src/lib/teleprompter.ts`, new, pure) | `{ wpmMin: 60, wpmMax: 260, wpmStep: 10, wpmDefault: 140, sizes: [28, 36, 44, 54, 64], sizeDefault: 44, scriptMaxChars: 20000, followFallbackMs: 5000 }` | |
| Browser storage | `localStorage` keys `ts.prompter` (speed, size, follow on) and `ts.scriptDraft` (the draft text) | per device only, wrapped in try and catch; the draft is cleared when the take is created |

**State transitions** (the recorder, a pure reducer in `src/lib/recorder-state.ts`, never persisted):
`idle → requesting → (denied | unavailable | in_use | unsupported | ready) → countdown → recording → review → uploading → (done | upload_failed)`; `recording → review` also on auto stop (length or allowance) and on a background interruption; `upload_failed → uploading` on retry; `review → countdown` on "Record again". The take itself uses the existing states (spec 0002).

**API surface** (no new route carries file bytes):

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/uploads` | POST | adds optional `source: "file" \| "recording"` (default `file`), optional `script: string` (trimmed, max 20000), optional `durationHintMs` as today | as today | creator session, `Origin` check | 403 `limit_exceeded` as today, 422 script too long |
| `/api/takes/[id]` | GET | id | adds `source`, `script` (string or null) | creator session | 404 not owner |
| `/api/realtime/token` (step 2 only) | POST | none | `{ token, expiresInSeconds }`, a short lived Deepgram token | creator session, `Origin` check, 10 a hour per creator | 401, 403 bad origin, 429, 503 provider down |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Start | chosen MIME type | first match of `RECORDER.mimePreference` in `MediaRecorder.isTypeSupported` |
| Start | resolution and frame rate asked for | `getUserMedia` constraints: ideal 1920 long side and 1080 short side matching the screen orientation, 30 fps, from `RECORDER` |
| Record | recording length limit | `min(MEDIA_LIMITS.maxDurationMs, usage.remainingSeconds * 1000)`; `remainingSeconds` from `GET /api/usage` when `enforced`, else the 10 minute cap |
| Record | timer and `durationHintMs` | the recorder's own clock (`performance.now` deltas minus paused time, none exist as recording is not pausable); the server never trusts it, the probe measures |
| Teleprompter | scroll position | `positionAt(lines, elapsedMs, wpm)`, a pure function of the script's word count and the speed; paused time does not advance it |
| Teleprompter (follow) | scroll target | `followScript(scriptWords, heardWords, lastMatchIndex)`, pure, forward matching in a window ahead of the last match |
| Upload | file name and take title | `Recording 2026-11-14 13.48.mp4` (or `.webm`) from the device clock; the existing title clean up turns it into the title |
| Upload | `source`, `script` | the recorder (`recording`), the textarea (trimmed; empty means null) |
| Upload | file bytes | the stopped recording as one `Blob` of the collected chunks, sent by `upload-client.ts` |
| Take page | script on Details | `take.script` through the take GET |
| Probe | container, duration, width, height | ffprobe of the stored file; for `webm` duration comes from the last packet time (a browser WebM often has no duration header) |
| AI edit (step 3) | script text in the request | `take.script` |
| Usage limit | charge | unchanged: first run of the take, `ceil(duration_ms / 1000)` (spec 0014) |

**Key invariants**:
- The recording never leaves the device until the creator presses "Use this take", and it is never uploaded in pieces during recording (v1).
- The mirrored preview is display only; the recorded file is never mirrored.
- Pausing the prompter, changing speed or size, and voice following can never stop or alter the recording.
- The server does not trust `source`, `script` length claims or `durationHintMs` for anything but UI and the early refusal; the probe is the authority.
- A script is personal data: never logged, never in an error report, analytics event, job payload, URL or the Deepgram or Claude request except where AC-12 and AC-13 say so.
- Deleting a take deletes its script; expiring its video does not.
- Web code never imports job internals or heavy SDKs: the recorder uses browser APIs and the existing client code only (ESLint boundary).

**Security model**: only a signed in creator can open `/record` and create takes (existing session rules); the script is read only through creator scoped functions (`src/server`), 404 for another creator's take. Create keeps the `Origin` check and ownership rules of spec 0004. The realtime token route (step 2) mints a Deepgram token that expires in seconds, is scoped to listening, never returns the real key, and is rate limited. Camera and microphone permission is the browser's, asked on a click, never at page load. Compliance scope: the privacy copy (spec 0015) and its launch gate; the script and live audio are new facts to state.

**Configuration required**:
- Step 2 only: `DEEPGRAM_API_KEY` becomes a Worker secret (today it lives only in Trigger.dev), parsed by the web env schema. It is an env change, so it goes in `legal-facts` `PROCESSORS.envNames` in that PR.

**Critical test scenarios** (each maps to an AC):
- Happy path: a fake `getUserMedia` stream and a fake `MediaRecorder` in Playwright (Chromium's fake device flags) record 5 seconds with a script, stop, review, use the take, and land on a take page with `source = recording` and the script on Details, verifies **AC-1**, **AC-2**, **AC-3**, **AC-8**.
- Pure rules: `positionAt` (speed changes, never goes backwards, clamps at the end), `pickMimeType` over fake support tables (Safari with MP4 only, Chrome with both, none), `recordingLimitMs` (usage remaining against the cap), the reducer's allowed moves, `followScript` (ad libs, skipped line, repeated line, no match), verifies **AC-2**, **AC-4**, **AC-6**, **AC-12**.
- Failure: `NotAllowedError`, `NotFoundError`, `NotReadableError`, no `MediaRecorder` and an insecure context each show their message and "Upload a file instead", verifies **AC-5**.
- Failure: 403 `limit_exceeded` on create keeps the file in review with the dated message; a network error then "Try again" succeeds; "Save to your device" gives the blob, verifies **AC-6**, **AC-7**.
- Pipeline: a real 10 second WebM from Chromium and a real MP4 from an iPhone go through the probe (duration measured, `webm` accepted) and render, verifies **AC-4**, **AC-14**.
- Privacy: a test scans logs and the Sentry capture for the script text on create, probe and AI runs; take delete and account delete leave no script, verifies **AC-8**.
- Accessibility: axe on every recorder state in light and dark; keyboard run through setup, record, review; reduced motion steps by line; a Pixel 7 run with no sideways scroll and 44 px targets, verifies **AC-9**, **AC-10**.
- Voice following (step 2): a fake socket feeds heard words; the prompter follows, falls back after 5 seconds, and shows the note; the token route refuses a bad origin, verifies **AC-12**.
- Script cuts (step 3): fake Claude answers over a script take with a line said three times: the best attempt is kept, the others stored as `false_start` with reasons; no script gives today's request byte for byte; the cut quality set scores the new cases, verifies **AC-13**.
- Legal: `pnpm legal:drift` and the legal copy hash test pass in each PR that changes a legal fact, verifies **AC-11**.

## Build plan

Tracer Bullet: task 1 is a thin real thread, camera to a processed take, with a plain scrolling script and nothing else; every later task thickens one segment and ships end to end. Tasks are one PR each. Frontend work is Dwight's, backend Jim's, as in earlier specs.

1. **Thread: record, review, upload** (Dwight, with a small backend part by Jim): migration for `take.source` and `take.script`; `CONTAINERS` gets `webm` and the probe measures a WebM's duration from packets (Jim); `POST /api/uploads` takes `source` and `script`, take GET returns them; `recorder-rules.ts` and `recorder-state.ts` (pure, tested); `/record` page with setup, a plain timed script scroll, countdown, record, stop, review and the normal upload; Record button in the upload area; the recording cap by 10 minutes only. Includes a spike on a real iPhone MP4 and a Chromium WebM before the rest is built, satisfies **AC-1**, **AC-3**, **AC-4**, **AC-8** (storage and Details), **AC-14**.
2. **Teleprompter controls** (Dwight): `teleprompter.ts` (`positionAt`, line splitting), pause and resume, speed and size with buttons and keys, settings remembered, script draft on the device, the prompter placed near the lens on laptop and at the top of a phone screen, reduced motion line stepping, satisfies **AC-2**, **AC-9** (prompter part).
3. **Permissions, devices and phone behaviour** (Dwight): every failure message and path (AC-5 list), camera and microphone pickers, flip camera, level meter with a text alternative, wake lock, background interruption and leave confirmation, native camera fallback through a file input, "Save to your device", satisfies **AC-5**, **AC-7**, **AC-10**.
4. **Length and usage** (Dwight): read `GET /api/usage`, `recordingLimitMs`, visible timer, 60 second warning with announcement, auto stop, used up state, keep the file on 403 `limit_exceeded`, satisfies **AC-6**.
5. **Accessibility and phone polish pass** (Dwight): axe on every state in both themes, keyboard run, Pixel 7 layout, `/design` gallery entry for the prompter and recorder controls, satisfies **AC-9**, **AC-10**.
6. **Legal for stored scripts** (Dwight or Jim, whoever has the PR): `legal-facts.ts` (`COLLECTED` gets the script and the device draft), Privacy and Terms copy, `LEGAL_VERSION`, `legal-text-hashes.ts` line, `pnpm legal:drift` clean; can land with task 1 or right before it goes live, but not after, satisfies **AC-11**.
7. **Voice following: token route and Worker secret** (Jim): `POST /api/realtime/token` (Deepgram short lived token through `POST /v1/auth/grant`, rate limit, Origin check), `DEEPGRAM_API_KEY` Worker secret, env schema, satisfies **AC-12**.
8. **Voice following: the follower** (Dwight): `followScript` (pure, tested), an `AudioWorklet` that turns the same microphone stream into 16 kHz mono frames for the socket, the Deepgram streaming client with interim results and keep alive, the "Follow my voice" toggle with its first time disclosure, timed fallback with a visible note, satisfies **AC-12**, **AC-9**.
9. **Legal for live audio** (whoever has task 7 or 8): `PROCESSORS` entry for Deepgram browser streaming and the new secret, Privacy copy, `LEGAL_VERSION`, hash line, before step 2 is switched on, satisfies **AC-11**.
10. **Script aware cuts** (Jim): `take.script` into the AI request (`src/lib/ai-edit.ts`), prompt lines for repeated lines (keep the best attempt, cut the others as `false_start`, readable reason), a higher word cut share for takes with a script (start at 65 percent, to be set by the measurement in task 11), no change without a script, satisfies **AC-13**.
11. **Cut quality cases for scripts** (Jim): add script takes to `tests/cut-quality/` (a line said twice, three times, a fluffed line then a clean one, ad lib, a skipped line) with known right cuts and floors in `baseline.json`; Toyin's `ai-eval` run confirms the share, satisfies **AC-13**.
12. **Legal for the script sent to Anthropic** (whoever has task 10): `legal-facts.ts` (what Anthropic receives), Privacy copy, `LEGAL_VERSION`, hash line, satisfies **AC-11**.
13. **Verify and test** (`/check verify`, `/test`): every AC on real devices where possible (a real iPhone and an Android phone, written down), satisfies **AC-1** to **AC-14**.

Tasks 2 to 5 can run in any order after task 1 and in parallel with Jim's tasks. Task 7 can start any time after task 1; task 10 needs task 1 (the `script` column) and can run before step 2.

## Consequences

**Positive**:
- Creators skip the export and upload step; a script and a lens in one place is the strongest reason to open the app.
- Every existing feature works on recorded takes, because the pipeline does not change.
- Pure rules (position, MIME choice, limits, state, following) are cheap to test with no browser.
- The script makes the AI cuts better exactly where they were weakest: repeated and fluffed lines.

**Negative / tradeoffs**:
- Recording lives in browser memory until upload, so a tab crash loses the take; a 4 Mbps cap keeps 10 minutes near 300 MB, and "Save to your device" is the safety net. Live part upload during recording is a follow up.
- Browser recordings are WebM on Chrome and Firefox: the pipeline now accepts `webm`, and "Download original" for those takes gives a WebM.
- iPhone Safari limits the page: recording can stop when the screen locks or the page is hidden; we keep what was captured and warn.
- Step 2 sends live microphone audio to Deepgram from the browser, a new privacy fact that needs Toyin's attention and a new Worker secret.
- Script heavy takes can have most of their words cut, so the word cut share goes above the 40 and 60 percent Toyin set (C-42); it stays undoable cut by cut.

**Neutral**:
- One migration (two columns) and one new accepted container.
- The legal copy changes three times (script stored, live audio, script to Anthropic), each in the PR that causes it.
- No new analytics event: recorded takes are counted from `take.source`.

## Follow-up

- [ ] Flag for Michael (real product points, recommended options are in this spec): (1) voice following sends live audio to Deepgram, so Toyin should know before step 2 ships; (2) the word cut share for script takes starts at 65 percent and needs her measurement run; (3) a script is kept after the video expires, like the transcript.
- [ ] Check at build whether `legal-facts` `COOKIES` must list the device only `localStorage` keys (`ts.prompter`, `ts.scriptDraft`).
- [ ] Later: upload parts while recording so a crash loses nothing; use the script's rare words as Deepgram keyterms for the transcript (sends script words to Deepgram, needs its own legal line); a "Remove script" action on the take; the on device speech option if Deepgram cost or privacy objections appear.
- [ ] Real iPhone and Android checks cannot run in CI; record the results in the verify report.
- [ ] Confirm Deepgram's current streaming price and how a browser WebSocket passes the short lived token before task 7 (the `speech-to-text` skill says prices change).
- [ ] The task asked for spec 0021; 0020 is unused on main at the time of writing, left for whoever reserved it.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
