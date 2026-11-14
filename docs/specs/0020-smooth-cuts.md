# 0020. Smooth cuts

**Date**: 2026-11-14
**Status**: Proposed

## Summary

Toyin heard from a viewer that our cuts feel too sharp, "obvious and not smooth". Today every cut is a plain hard cut in both sound and picture, and word cuts sit exactly on Deepgram's approximate word times. This spec makes cuts smoother in three small, pure steps inside the render graph and the cut list: short audio fades at every join, word cut edges moved into the quiet gap between words, and a gentle alternating zoom on kept pieces so the picture jump looks intentional. No new service, no new data, no UI change.

## Context

- `renderFilterScript` in `src/lib/trim.ts` builds one `trim`/`atrim` pair per keep range and one `concat`. Nothing fades the audio, so a join can click or cut a breath in half.
- AI word cuts (`mergeCuts` in `src/lib/ai-edit.ts`) take their edges straight from Deepgram word times. Those times are approximate (often 20 to 60 ms off), so a cut can clip the start or end of a neighbouring kept word.
- The picture jumps from one frame to the next with no change in framing: a classic jump cut. Creator tools hide it by alternating a slight punch in zoom between pieces. A cross dissolve on a talking head shows two faces at once for a moment, so we don't use one.
- Toyin agreed the plan (C-45, thread 1794662376.947499) and takes recommended options (C-30).

## Requirements

- As a creator, I want the finished video to sound and look natural at every cut, so viewers don't notice the edit.

## Decision

1. **Audio fades.** Every keep segment gets `afade=t=in` at its start and `afade=t=out` at its end, `SMOOTH.audioFadeMs` = 30 ms each, but only on edges that touch a cut (not the very start or end of the take). A segment shorter than twice the fade gets fades of half its length.
2. **Word cut edges in the gaps.** After the AI word cuts are merged (`mergeCuts`), each word cut edge that borders a kept word moves into the gap between the words: the start becomes the midpoint between the previous kept word's end and the cut's start, and the end becomes the midpoint between the cut's end and the next kept word's start. Each move is limited to `SMOOTH.wordEdgeMaxMs` = 80 ms, and an edge never moves into a kept word. Edges that border a pause cut or the take's start or end don't move. This is a pure function in `src/lib/ai-edit.ts`, which has the word list.
3. **Alternating zoom.** In the render graph, kept pieces alternate between 100% and `SMOOTH.zoomScale` = 1.08 (centre crop then scale back to the source size, even dimensions). Pieces shorter than `SMOOTH.zoomMinPieceMs` = 1000 ms keep the zoom of the piece before them, so short pieces don't flicker. The zoom applies per segment before `concat`, so with a background (spec 0008) only the keyed person zooms, not the background. The first piece is always 100%.
4. **Slow push (second PR).** Toyin approved this on top of step 3 (2026-11-14). Each kept piece of at least `SMOOTH.zoomMinPieceMs` that follows a cut zooms in smoothly and linearly from its base scale (1.00 or 1.08) to base plus `SMOOTH.pushScale` = 0.04 over the piece's length, centred, output size unchanged, per frame (`eval=frame`). Shorter pieces and a take with no cuts get no push. A short piece that follows a pushed piece holds that piece's final scale (base plus `SMOOTH.pushScale`) for its whole length, so there is no scale jump back to the base; other short pieces keep the previous piece's zoom as in step 3. Like the zoom, it applies per segment before `concat`, so a background stays still.
5. Settings live in one exported `SMOOTH` constant in `src/lib/trim.ts`, next to `TRIM`.

## Acceptance criteria

- **AC-1**: `renderFilterScript` adds an `afade` in and out of `SMOOTH.audioFadeMs` on every segment edge that touches a cut, none at the take's start or end, and shorter fades on short segments. Unit tests.
- **AC-2**: A word cut edge next to a kept word moves into the gap, by at most 80 ms, never into a kept word; pause and take edges don't move. Unit tests, including back to back words with no gap (edge stays).
- **AC-3**: Kept pieces alternate 100% and 108% zoom with the 1000 ms rule, first piece 100%, output size unchanged, with and without a background. Unit tests on the filter script plus the existing render tests stay green.
- **AC-4**: A take with no cuts renders exactly as before (no fades, no zoom).
- **AC-5**: Audio and video stay in sync after the change (the existing frame alignment in `alignToFrames` still runs last on the keep ranges). Frame alignment never trims a kept word: a keep range's start snaps down to a frame and its end snaps up (instead of to the nearest frame), so a kept word that ends between frames, with no gap before the cut, is kept whole. Aligned ranges that then touch or overlap are merged into one range, so the render never repeats media. Because both edges snap outward, a cut survives only if it covers at least one whole frame (from one frame boundary to the next); a cut that does not is dropped rather than trimming a kept word, and that can be a cut up to almost two frames long (at 30 fps, a 40 ms cut from 1010 to 1050 ms is dropped). A take with no cuts has one keep range `[0, durationMs]`; its end may snap up past the last frame, and the trim then simply stops at the end of the media, so the whole take renders unchanged and AC-4 holds (no clamp is needed, and none is added). Unit tests: at 30 fps a keep range ending at 1010 ms ends at 1033.3 ms, not 1000 ms; `[0, 1010]` with `[1020, 2000]` becomes one range `[0, 2000]`; and `[0, 1010]` with `[1050, 2000]` also becomes one range `[0, 2000]` (both edges snap to 1033.3 ms, so the 40 ms cut is dropped).
- **AC-7**: Slow push: pieces of 1000 ms or more after a cut scale linearly from their base to base + 0.04 across the piece, centred, output size unchanged; shorter pieces and uncut takes have none. A short piece right after a pushed piece holds the pushed piece's final scale (unit test on the filter script). Unit tests on the filter script, plus a render test that the output dimensions and duration match, and a render time check on a 60 s test take noted in the PR.
- **AC-6**: The cut-quality scorer (spec 0017) still passes; its baseline is updated only if moved edges change the scores, with the reason noted.

## Build plan

1. First PR: Decision steps 1, 2 and 3 with their tests (AC-1 to AC-6).
2. Second PR: Decision step 4, the slow push (AC-7).
3. A real render check on a test take after deploy, then Toyin tries a take.

## Consequences

- Cuts save slightly less time (up to 160 ms per word cut).
- The zoom is on for every take. If creators dislike it, a per take "Zoom on cuts" switch is the follow up.

## Follow-up

- A per take "Cut style" choice: Natural (sound fades only), Two camera (zoom), Dynamic (zoom plus slow push), as offered to Toyin.
- Caption pop at cuts, once burned in captions exist.
- Retune the three numbers with Toyin after the first real takes.
