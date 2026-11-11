# Take pages and upload (src/components/takes)

The library at `/` and the take page at `/takes/[id]`. Specs: [0004 core take loop](../../../docs/specs/0004-core-take-loop/index.md). UI rules: `design.md`.

## How it is split

- Pure rules live in `src/lib`, not here: `take-display.ts` (status badges, mm:ss, expiry notes, weighted progress, tab titles, poll delay), `take-api.ts` (zod shapes for the take routes), `upload-client.ts` (the whole upload flow, with its I/O passed in so tests can fake it), `upload-rules.ts`.
- `browser-io.ts` is the browser side of that I/O: `callApi` (30 second timeout on every call) and `putPart` (XMLHttpRequest, because fetch has no upload progress). Keep new upload calls bounded the same way.
- Components are client components. Polling goes through `use-poll.ts` (pauses while the tab is hidden, backs off on errors). `use-now.ts` is the library's clock, so expiry notes stay true on a page left open.

## Rules worth knowing

- Failure wording: media failures use `src/lib/take-messages.ts` and `src/lib/failure-codes.ts`. Do not copy those into this folder. Our own failures are worded in `take-display.ts`.
- Failed takes: if `take.retryable` show "Try again"; otherwise show "Upload another video", and `failureMessage(take, retryable)` words it to match.
- Expiry: show `effectiveStatus(...)`, not the raw status, so a ready take past its expiry shows as expired. Dates are UTC. Under a day left reads "Video expires in less than a day", never "today" or "tomorrow".
- Thumbnails come from `/api/takes/{id}/media?kind=thumb` and keep the placeholder when there is none. A card re-asks when its status changes.
- Pages read the session through `getSession()` in `src/server/request.ts`.
- Transcript (spec 0007): `transcript-panel.tsx` composes the states (making, ready, no words, skipped with a reason, failed, none); `use-transcript.ts` reads and polls GET `/api/takes/{id}/transcript` and starts the job (a start message stays until a job this page saw making has finished; no "we'll keep trying" after a 401 or 404; a load error shows beside a loaded view); `transcript-paragraphs.tsx` and `transcript-downloads.tsx` are the words and the two download links. The panel and the player share `player-bridge.ts`, a small store (seek, current time, caption track version) read with `useSyncExternalStore`, so a time update re-renders only the panel's paragraph marker. The caption `<track>` comes from the VTT route with `?v={version}` and the CC toggle (`use-captions.ts`) keeps the track `hidden` when off; the video's `poster` is the `thumb` media link (`use-poster.ts`). `seekTo` keeps the time when the duration is still unknown, so a click before the metadata loads still seeks.
- Browser tests: `tests/takes.spec.ts`, with helpers in `tests/support/takes.ts`.

_Drafted by /sync from the introducing change, worth a quick human pass._
