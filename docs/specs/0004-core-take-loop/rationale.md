# 0004. Core take loop: rationale

## Context

Slice 1 is the walking skeleton: the first time a real creator's video flows through every layer (browser, Workers, R2, Neon, Trigger.dev, ffmpeg) and comes back useful. The data model (spec 0002) and design system (spec 0003) exist; the stack (spec 0001) fixes the tools. What remains is how the pieces connect for one narrow path, and the product behaviour around it.

Forces: files are up to 2 GB, so they must go straight from the browser to storage and survive flaky connections; processing takes minutes, so it must run in the background with visible progress; the free allowance is charged when processing starts, so starting must be explicit and atomic; videos are personal data, so every link is short lived and owner checked.

Decided with Toyin: processing starts automatically after upload; Natural trimming (cut silence longer than 0.7 seconds, keep 0.25 seconds each side); Google sign in only for this slice, magic link right after; in app notification only (live progress, card status, tab title), email later; download a high quality MP4 at the original resolution plus the original file; two screens (library with upload on top, and a take page).

## Options considered

### Option 1: Direct multipart upload, server confirmed, background pipeline, polling (chosen)
Browser uploads parts straight to R2 with presigned links; server confirms; Trigger.dev tasks probe, trim and render; the page polls status.
**Pros**: no file bytes through Workers; resumable parts; simple, robust progress. **Cons**: a few polling requests; several round trips to start an upload.

### Option 2: Single presigned PUT upload
**Pros**: simplest client. **Cons**: a 2 GB upload restarts from zero on any network drop (Toyin chose chunked uploads in spec 0001).

### Option 3: Realtime progress (Trigger.dev realtime or websockets)
**Pros**: instant updates, no polling. **Cons**: extra moving parts and auth tokens for a screen that updates every few seconds anyway; can be added later without changing the data.

## Rationale

Option 1 is the thinnest thread that still respects every earlier decision: it uses the spec 0002 functions exactly (create, attach upload, mark uploaded, start, finish), keeps the Worker light (spec 0001), and makes progress visible with nothing more than the `job_step` rows. ffprobe reads only the start of the file through a ranged request, so a bad file fails fast without downloading 2 GB. Rendering with explicit trim and concat filters keeps audio and video in sync at every cut; CRF 18 is visually lossless at sensible file sizes. Polling every 2 seconds is cheap at this scale and needs no new infrastructure.
