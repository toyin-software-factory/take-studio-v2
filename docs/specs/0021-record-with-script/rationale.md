# 0021. Record with script: rationale

## Context

Creators told Toyin that the slowest part of making a take is leaving the app: they read a script from another window, record with the phone camera app, export, and come back to upload (C-46, approved). The product already has the hard parts after upload: transcript, AI cuts, backgrounds and downloads. What is missing is the front of the line, where the person speaks.

Three forces shape the design. First, the pipeline only accepts MP4 and MOV, up to 10 minutes, about 2 GB and 1080p, and counts the first run against a monthly allowance (specs 0002, 0014), so a recorder must produce something the probe accepts and respect the same caps before the creator wastes a take. Second, browsers differ most exactly here: Safari records MP4, Chrome and Firefox record WebM, iPhone pages are stopped when hidden, and permission failures are common. Third, a script is the creator's own words and is more personal than a title: it must follow the project's privacy rules (IDs only in logs, copy and legal facts kept in step), and any step that sends it or the live audio to a service is a legal change.

Not deciding means creators keep recording elsewhere, and repeated or fluffed lines (the main reason people re record) keep depending on manual cut review.

## Options considered

### Option 1: Record in the browser, hold it, reuse the upload (recommended)

`getUserMedia` plus `MediaRecorder` on a `/record` page; the recording is kept in memory, shown for review, then sent through the existing multipart upload when the creator confirms.

**Pros**:
- Reuses the upload, probe, usage and pipeline code, so every later feature works with no change.
- A review step stops bad takes from burning the upload rate limit and the monthly allowance.
- Works on phone and laptop with no install.

**Cons**:
- A tab crash loses the recording until live part upload exists.
- Needs `webm` accepted by the probe and a spike for WebM duration.
- Safari on iPhone is stricter about backgrounding.

### Option 2: Native camera through a file input only

An `<input type="file" accept="video/*" capture="user">` opens the phone's own camera app, then the normal upload.

**Pros**:
- No codec or permission work; best file quality on phones.

**Cons**:
- No teleprompter at all, which is the point of the feature; desktop gets a file picker only.

Kept as the fallback when `MediaRecorder` is missing (AC-5).

### Option 3: Stream to R2 while recording

Upload multipart pieces during the recording so nothing is lost on a crash.

**Pros**:
- Strongest against lost takes; the file is ready when the creator stops.

**Cons**:
- Parts must be at least 16 MiB except the last, so the recorder, retries and cleanup of abandoned uploads all get harder; it also uploads takes the creator would discard and creates take rows before the creator agrees.

Rejected for v1, listed in Follow-up.

## Decision record

See Decision in [index.md](index.md): Option 1.

## Rationale

Option 1 is the only one that delivers the teleprompter and reuses everything we already built and verified. The forces in Context point the same way: the caps and the usage check already live on the upload path, so holding the file until the creator confirms means a refusal never costs them the recording, and the review step protects the 10 uploads an hour limit. Option 3 solves a real risk (crash) with a lot of new moving parts before we know how often it happens; at a 4 Mbps cap a 10 minute take is about 300 MB, which an in memory `Blob` handles on current phones, and "Save to your device" covers the worst case. Option 2 becomes the fallback.

**Tracer Bullet order.** Step 1 is split so the first PR already goes camera to processed take with a plain scroll; controls, failures, limits and polish thicken one segment each. Legal tasks sit next to the task that causes the change because the project rule is "same PR".

### Step 2: voice following, the options

| | Cost | Privacy | Works on iPhone | Effort |
|---|---|---|---|---|
| A. Browser speech recognition (Web Speech API) | none from us | audio goes to the browser vendor, inconsistent and not ours to disclose | poor: not reliable beside `MediaRecorder` on iOS | low |
| B. Deepgram streaming from the browser (recommended) | pay per minute of audio, bounded by the 10 minute cap; check the live price | Deepgram is already our transcription processor; live audio from discarded takes is new, so disclose and make it opt in | yes, it is a WebSocket plus an audio worklet | medium |
| C. On device model in WebAssembly | none | best: audio never leaves the phone | heavy: tens of MB to download and a lot of CPU while encoding 1080p, so heat and battery | high |
| D. Voice activity only (scroll while the creator speaks) | none | audio never leaves the device | yes | low |

Recommendation: **B**, with **D** as the fallback behaviour when the socket drops. Reasoning: it works on every browser we support, the accuracy is good enough for position following, the code is small (a token route, a worklet, a pure matcher), and the privacy change is the one the product already makes, stated openly. The runner up is C if Toyin objects to live audio leaving the device or the bill grows; the pure `followScript` matcher is the same either way, so only the audio source changes. A is rejected because it behaves differently per browser and the privacy story is not ours.

Cost control: the token route is rate limited, tokens last seconds, the stream stops with the recording (at most 10 minutes), and the creator turns it on themselves.

### Step 3: script aware cuts

The script goes into the existing AI edit request (spec 0012) and the answer shape does not change: a repeated line is a `false_start` cut over the earlier attempts, with a reason the creator can read. No new cut kind means no migration, no new label and no new review UI, and the creator can still undo each cut (spec 0011) or mark "Missed something?" (spec 0017). The AI, not a string matcher, decides which attempt is best, because the right attempt is often not the last one. A deterministic fallback is not offered: without the AI the take gets the rules cuts as today. The word cut share rises for script takes because three attempts of one line are two thirds redundant; the number is a starting guess to be set by the cut quality cases (spec 0017) and Toyin's `ai-eval` run, so C-42 stays true for takes with no script.

## References

**Project sources**:
- `src/server/uploads/AGENTS.md` (multipart upload, 403 `limit_exceeded`, `durationHintMs`), spec 0014 (monthly usage), spec 0012 (AI edit and its invariants), spec 0017 (cut quality set), spec 0015 and `src/lib/AGENTS.md` (legal change checklist), `src/components/AGENTS.md` (the `/design` gallery, 44 px targets, Stage)
- `.claude/skills/speech-to-text/` (streaming endpoint, short lived token through `POST /v1/auth/grant`, per minute billing)

**Practices & standards**:
- WCAG 2.2 AA; progressive enhancement with a file input fallback; pure functions for logic that is hard to test in a browser (functional style rule in `AGENTS.md`)
