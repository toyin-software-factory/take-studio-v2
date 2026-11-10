# Scope: Take Studio

Take Studio lets solo creators upload a video take and get it back with the pauses trimmed, the green screen swapped for a studio background, and a transcript. Everything the web app does is also usable by AI agents, and AI agents do the editing decisions inside the product.

**Build approach:** Tracer Bullet (prove one real thread through every layer first, then thicken one segment at a time, each end to end).
**Workflow:** Beta (after `/develop`: `/check verify`, then `/test` where it matters; CodeRabbit reviews every PR). The project default level of rigor. `/architect` is the recommended first stop for a feature with a real decision, but skippable when you already know the build. Any feature can carry its own tag (e.g. `· GA`) to do more or less.

_These are recommendations to keep your build orderly, not requirements. Skip anything that does not fit: if you already know how to build a feature, use `/develop` and skip `/architect`. You decide when a feature is `done`._

**Decided with Toyin (scope round 1):**
- Audience: solo creators with accounts; they sign in and come back to past takes.
- Backgrounds: a small set of built in studio backgrounds, plus upload your own image.
- Pause trimming: automatic first, then a review timeline where any cut can be undone before the final render.
- Transcript: shown in the app with timestamps, download as plain text and as SRT captions that match the trimmed video. English only for now.
- Upload limits: up to 10 minutes and about 2 GB per take, MP4 or MOV, up to 1080p.
- Money: free for now, with a monthly processing limit per account. Billing later.
- Retention: original and finished video kept 30 days, then deleted automatically. Transcripts stay until the take is deleted. A creator can delete any take at any time, which removes everything.
- Launch extras: public landing page (basic SEO, social share preview), privacy and terms pages, error monitoring, product analytics (signups, takes uploaded, takes downloaded). Accessibility WCAG AA throughout.
- AI agents, both ways: (1) other AI agents can use Take Studio through a public API and an MCP server, with everything the web app does; (2) the editing decisions inside (which pauses to cut, transcript cleanup, background suggestion) are made by AI agents, not only fixed rules.

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| 1 | Stack & architecture | Foundation | in-progress |
| 2 | Coding standards & tooling | Foundation | planned |
| 3 | Data model | Foundation | planned |
| 4 | Design system & UI foundation | Foundation | planned |
| 5 | Core take loop | Slice 1 | planned |
| 6 | Error monitoring | Slice 1 | planned |
| 7 | Transcript | Slice 2 | planned |
| 8 | Studio background swap | Slice 3 | planned |
| 9 | Cut review timeline | Slice 4 | planned |
| 10 | AI editing agents | Slice 5 | planned |
| 11 | Take library, delete & retention | Slice 6 | planned |
| 12 | Monthly usage limit | Slice 6 | planned |
| 13 | Public API | Slice 7 | planned |
| 14 | MCP server for AI agents | Slice 7 | planned |
| 15 | Landing page & SEO | Launch | planned |
| 16 | Privacy & terms pages | Launch | planned |
| 17 | Product analytics | Launch | planned |

## Foundations

### 1. Stack & architecture · in-progress
Decide the stack (web app, auth, storage for large video files, background processing jobs, video processing, speech to text, AI agent runtime, hosting) and scaffold a runnable project with CI.
**Done when:** the stack is recorded in a spec, and the empty scaffold boots locally and passes lint, typecheck, test and build in CI.
- [x] Decide the stack (spec): `/architect stack & architecture`
- [ ] Scaffold from the decision: `/develop stack & architecture`
- [ ] Verify it: `/check verify stack & architecture`
- [ ] Test it: `/test stack & architecture`
Spec [0001](../specs/0001-stack-architecture/index.md)

### 2. Coding standards & tooling
Capture conventions and tooling from the real scaffolded project into root `AGENTS.md`, then install anything the scaffold did not.
**Done when:** root `AGENTS.md` reflects the real stack, and lint, format and typecheck run clean locally and in CI.
- [ ] Capture conventions + tooling choices: `/audit`

### 3. Data model · needs a decision
Core entities every slice builds on: creators, takes, processing jobs and their steps, cuts, backgrounds, transcripts, usage.
**Done when:** the entities support every later slice (review, retention, usage limit, API access) without a breaking migration, and each creator can only reach their own data.
- [ ] Design it (spec): `/architect data model`

### 4. Design system & UI foundation · needs a decision
Visual language, layout and base components (upload, progress, video player, timeline, download), with Mobbin references in `design.md`.
**Done when:** `design.md` covers type, color, spacing and components with Mobbin references, and base components meet WCAG AA (keyboard, focus, contrast).
- [ ] Design it (spec): `/architect design system & UI foundation`

## Slice 1: Core take loop

### 5. Core take loop · needs a decision
The walking skeleton: sign in, upload a take, pauses are trimmed automatically in the background, see progress, download the trimmed video. A plain list of your takes so you can find it again. No transcript, background or review yet.
**Done when:** a signed in creator uploads an MP4 or MOV within the limits (10 min, 2 GB, 1080p), sees processing progress, and downloads a video with long pauses removed; uploads over the limits are refused with a clear message; a failed job shows an error and can be retried.
- [ ] Design it (spec): `/architect core take loop`

### 6. Error monitoring · needs a decision
Catch errors in the app and in processing jobs so failed takes are seen before creators report them.
**Done when:** an error in the web app or a failed processing job is reported with enough context to debug, and no video content or secrets are sent.
- [ ] Design it (spec): `/architect error monitoring`

## Slice 2: Transcript

### 7. Transcript · needs a decision
Every processed take gets an English transcript, shown in the app with timestamps and timed to the trimmed video.
**Done when:** the transcript appears beside the video with timestamps, and downloads as plain text and as SRT captions that line up with the trimmed video.
- [ ] Design it (spec): `/architect transcript`

## Slice 3: Studio background

### 8. Studio background swap · needs a decision
Replace the green screen with a studio background: pick one of a few built in studios or upload your own image.
**Done when:** a creator picks a preset or uploads an image (format and size checked), and the finished video shows the subject cleanly on that background with no visible green edges in normal lighting.
- [ ] Design it (spec): `/architect studio background swap`

## Slice 4: Review the cuts

### 9. Cut review timeline · needs a decision
After automatic trimming, show every cut on a timeline; the creator can undo any cut, then render the final video.
**Done when:** each cut is visible and playable, undoing a cut restores that part, and the final render and transcript reflect exactly the kept cuts; the timeline works by keyboard.
- [ ] Design it (spec): `/architect cut review timeline`

## Slice 5: AI editing agents

### 10. AI editing agents · needs a decision
AI agents make the editing calls inside the pipeline: which pauses to cut (keeping deliberate pauses, removing false starts and filler), cleaning up the transcript, and suggesting a fitting studio background. The creator still reviews and can undo anything on the timeline.
**Done when:** agent chosen cuts, transcript fixes and background suggestion show up on the review timeline with a short reason each, the creator can undo any of them, and processing still finishes within the agreed time per take.
- [ ] Design it (spec): `/architect AI editing agents`

## Slice 6: Library, retention and limits

### 11. Take library, delete & retention · needs a decision
A proper library of past takes with status and expiry date; delete a take at any time; originals and finished videos auto delete after 30 days, transcripts stay until the take is deleted.
**Done when:** the library shows each take's status and when its video expires; deleting a take removes every stored file and record for it; videos older than 30 days are removed automatically while their transcripts remain.
- [ ] Design it (spec): `/architect take library, delete & retention`

### 12. Monthly usage limit · needs a decision
Free accounts get a monthly allowance of processed minutes, keeping costs safe until billing exists.
**Done when:** the creator sees minutes used and left this month; an upload that would go over the limit is refused with a clear message; the allowance resets monthly.
- [ ] Design it (spec): `/architect monthly usage limit`

## Slice 7: Usable by AI agents

### 13. Public API · needs a decision · GA
A documented API so programs and agents can do everything the web app does for a creator: upload a take, choose a background, run processing, review and undo cuts, fetch the video and transcript, delete a take.
**Done when:** a creator can create and revoke an API key; every web app action has an API equivalent with the same limits and permissions; the API is documented.
- [ ] Design it (spec): `/architect public API`

### 14. MCP server for AI agents · needs a decision · GA
An MCP server so AI assistants (Claude, ChatGPT and agent tools) can use Take Studio directly on a creator's behalf, built on the public API.
**Done when:** an AI assistant connected to the MCP server can upload a take, run it, review the cuts and fetch the results for a signed in creator, and can only reach that creator's takes.
- [ ] Design it (spec): `/architect MCP server for AI agents`

## Launch

### 15. Landing page & SEO · needs a decision
A simple public page that explains Take Studio and leads to sign up.
**Done when:** the landing page shows what the product does and a sign up call to action, has title, description and social share preview metadata, and meets WCAG AA.
- [ ] Design it (spec): `/architect landing page & SEO`

### 16. Privacy & terms pages
Public privacy policy and terms, needed because we store people's videos.
**Done when:** privacy and terms pages are public, linked from the landing page and sign up, and the privacy page states the 30 day video retention and delete anytime promise. Toyin approves the text.
- [ ] Build it: `/develop privacy & terms pages`

### 17. Product analytics · needs a decision
Three events that show whether the core loop works: signup, take uploaded, take downloaded.
**Done when:** the three events are recorded per creator, with no video content or transcript text in the events.
- [ ] Design it (spec): `/architect product analytics`

## Deferred
Out of scope for this build pass, kept so the plan stays honest.
- **Billing & plans**: paid plans beyond the free monthly allowance · needs a decision · GA
- **Chat assistant in the app**: creators give edits in plain words instead of clicking · needs a decision
- **Burned in captions**: captions rendered into the video · needs a decision
- **More languages**: transcripts for languages other than English · needs a decision
- **Teams & agencies**: shared workspaces with several people · needs a decision
- **Longer or 4K takes**: raise the 10 minute, 2 GB, 1080p limits · needs a decision

## Legend

**The decision box.** Every feature carries exactly one, the sub task whose label ends with `(spec)`. Its wording varies (`Design it (spec)` normally, `Decide the stack (spec)` on Stack & architecture), so skills locate it by that `(spec)` suffix, never by an exact label. Every other box is an execution box and `/architect` never ticks one.

**Feature lifecycle**: the scope updates as a feature moves; each row is what it shows and who sets it:

| State | Set by | The feature shows |
|---|---|---|
| `planned` · needs a decision | `/scope` | one box: `Design it (spec): /architect <feature>` |
| `in-progress` (designed) | **`/architect` at spec capture** | `Design it` ticked; spec linked; `Build it: /develop <feature>` + **2 to 5 milestones**; the tier's closing boxes (`Verify it` Alpha+, `Test it` Beta+, `Review it` + `Document it` GA); any surfaced follow up enrolled |
| `in-progress` (building) | `/develop` | milestone sub boxes tick one by one; code pointer filled |
| `in-progress` (verified) | `/check verify` | `Build it` + milestones ticked; `Verify it` ticked |
| `done` | **you, when you decide it is** (any skill sets it when you say so); `/sync` reconciles | boxes you ran ticked, skipped ones marked skipped; the tier's last stage (`Prototype` → after `/develop`; `Alpha` → after `/check verify`; `Beta`/`GA` → after `/test`) is the suggested point to call it done; `/sync` captures conventions |

- **Next step** = the first unticked box (always a command or a tracked milestone).
- **needs a decision** = run `/architect` first; otherwise straight to `/develop` (or `/audit` for standards & tooling). The tag drops once the spec is captured.
- **Atomic build tasks live in the spec's `## Build plan`, not here**: the scope carries only the milestone rollup.
- **Status** `planned` → `in-progress` → `done`, plus `existing` (pre workflow) and `dropped` (de scoped, kept for history).
- **Approach tag** beside a heading (e.g. `· Facade`) overrides the project default for that feature; no tag = inherits it.
- **Workflow tier tag** beside a heading (e.g. `· GA`) sets that one feature's rigor above or below the project default; no tag inherits the default.
- **Workflow** (header line) is the project default, what runs after `/develop`: **Prototype** = nothing; **Alpha** = `/check verify`; **Beta** = `/check verify` then `/test`; **GA** = adds a fresh model `/check review` then `/document`. A feature built on an unratified decision (an `Assumed` spec) stays flagged, but that never blocks `done`.
- **Pointer line** (`spec <n> · code in <path>`): the spec link added by `/architect`, the code path by `/develop`.
