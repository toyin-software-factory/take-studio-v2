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
| 1 | Stack & architecture | Foundation | done |
| 2 | Coding standards & tooling | Foundation | done |
| 3 | Data model | Foundation | done |
| 4 | Design system & UI foundation | Foundation | done |
| 5 | Core take loop | Slice 1 | done |
| 6 | Error monitoring | Slice 1 | done |
| 7 | Transcript | Slice 2 | done |
| 8 | Studio background swap | Slice 3 | done |
| 9 | Cut review timeline | Slice 4 | in-progress |
| 10 | AI editing agents | Slice 5 | planned |
| 11 | Take library, delete & retention | Slice 6 | planned |
| 12 | Monthly usage limit | Slice 6 | planned |
| 13 | Public API | Slice 7 | planned |
| 14 | MCP server for AI agents | Slice 7 | planned |
| 15 | Landing page & SEO | Launch | done |
| 16 | Privacy & terms pages | Launch | planned |
| 17 | Product analytics | Launch | planned |
| 18 | Email sign in and take ready email | Slice 1 | done |

## Foundations

### 1. Stack & architecture · done
Decide the stack (web app, auth, storage for large video files, background processing jobs, video processing, speech to text, AI agent runtime, hosting) and scaffold a runnable project with CI.
**Done when:** the stack is recorded in a spec, and the empty scaffold boots locally and passes lint, typecheck, test and build in CI.
- [x] Decide the stack (spec): `/architect stack & architecture`
- [x] Scaffold from the decision: `/develop stack & architecture` (PRs #3, #4; live at https://take-studio.jnr4u2.workers.dev)
- [x] Verify it: `/check verify stack & architecture`
- [x] Test it: `/test stack & architecture`
Spec [0001](../specs/0001-stack-architecture/index.md)

### 2. Coding standards & tooling · done
Capture conventions and tooling from the real scaffolded project into root `AGENTS.md`, then install anything the scaffold did not.
**Done when:** root `AGENTS.md` reflects the real stack, and lint, format and typecheck run clean locally and in CI.
- [x] Capture conventions + tooling choices: `/audit` (PR #6)
- [x] Install the tooling: `/develop tooling` (pre commit hook: format and lint staged files, PR #8)

### 3. Data model · done
Core entities every slice builds on: creators, takes, processing jobs and their steps, cuts, backgrounds, transcripts, usage.
**Done when:** the entities support every later slice (review, retention, usage limit, API access) without a breaking migration, and each creator can only reach their own data.
- [x] Design it (spec): `/architect data model`
- [x] Build it: `/develop data model`
   - [x] Shared helpers, registries and slice 1 migration (AC-1, AC-4, AC-7, AC-8, AC-10, AC-13, AC-16)
   - [x] Takes and jobs data functions, atomic start and finish (AC-2, AC-3, AC-5, AC-6, AC-11, AC-12, AC-13)
   - [x] Cuts and renders data functions (AC-8, AC-9, AC-10)
   - [x] Deletion queue, account deletion hook, cleanup schedule (AC-17, AC-18)
- [x] Verify it: `/check verify data model`
- [x] Test it: `/test data model`
Spec [0002](../specs/0002-data-model/index.md) · code in `src/db/`, `src/lib/`, `src/server/{takes,jobs,cuts,renders,account}/`, `src/trigger/`

### 4. Design system & UI foundation · done
Visual language, layout and base components (upload, progress, video player, timeline, download), with Mobbin references in `design.md`.
**Done when:** `design.md` covers type, color, spacing and components with Mobbin references, and base components meet WCAG AA (keyboard, focus, contrast).
- [x] Design it (spec): `/architect design system & UI foundation`
- [x] Build it: `/develop design system & UI foundation`
   - [x] Tailwind v4 + shadcn/ui setup, tokens and fonts (AC-1, AC-2, AC-8) (FDS-T01; `/design` token gallery shell included)
   - [x] Base components with every state (AC-3, AC-5, AC-6) (FDS-T02)
   - [x] App shell and Stage container (AC-4, AC-6) (FDS-T03)
   - [x] `/design` gallery with axe checks (AC-5, AC-7) (FDS-T01, FDS-T02)
- [x] Verify it: `/check verify design system & UI foundation`
- [x] Test it: `/test design system & UI foundation`
- [x] Redesign v2 (Toyin, 2026-11-12): `/develop design system v2`
   - [x] Tokens, Inter Tight, base components and `/design` gallery (AC-1, AC-2, AC-3, AC-8, AC-10)
   - [x] App shell: sidebar, sheet menu, glass top bar (AC-4, AC-7)
   - [x] Take page restyle, built features only (AC-5, AC-7, AC-9)
   - [x] Library, upload, sign in and error pages, axe and bundle checks (AC-6, AC-8, AC-9, AC-10)
Spec [0009](../specs/0009-design-system-v2/index.md) (supersedes [0003](../specs/0003-design-system.md)) · rules in [design.md](../../design.md) · code in `src/app/globals.css`, `src/components/ui/`, `src/components/shell/`, `src/components/stage.tsx`, `src/app/design/`

## Slice 1: Core take loop

### 5. Core take loop · done
The walking skeleton: sign in, upload a take, pauses are trimmed automatically in the background, see progress, download the trimmed video. A plain list of your takes so you can find it again. No transcript, background or review yet.
**Done when:** a signed in creator uploads an MP4 or MOV within the limits (10 min, 2 GB, 1080p), sees processing progress, and downloads a video with long pauses removed; uploads over the limits are refused with a clear message; a failed job shows an error and can be retried.
- [x] Design it (spec): `/architect core take loop`
- [x] Build it: `/develop core take loop`
   - [x] R2 helpers, CORS and upload routes, render timing spike (AC-3, AC-4, AC-12)
   - [x] Pinned ffmpeg and the probe task (AC-4)
   - [x] The process-take task: trim, render, edge cases (AC-5, AC-6, AC-7, AC-10)
   - [x] Take routes and media links; library and take pages (AC-1, AC-2, AC-8, AC-9, AC-11, AC-12, AC-13) (S1C-T04: take routes and media links, with the `thumb` kind; S1C-T05: library and take pages, upload client, browser e2e)
   - [x] End to end tests with fixtures (AC-2, AC-4, AC-6, AC-7, AC-11, AC-13) (API level: S1C-T07, `pnpm test:pipeline`; browser level and axe: `tests/takes.spec.ts`)
- [x] Verify it: `/check verify core take loop` (report: [docs/reviews/0004-core-take-loop-verify.md](../reviews/0004-core-take-loop-verify.md), all 13 criteria met)
- [x] Test it: `/test core take loop`
Spec [0004](../specs/0004-core-take-loop/index.md) · code in `src/server/uploads/`, `src/app/api/uploads/`, `src/server/takes/`, `src/server/media/`, `src/app/api/takes/`, `src/lib/r2*.ts`, `src/lib/take-media.ts`, `src/trigger/`

### 6. Error monitoring · done
Catch errors in the app and in processing jobs so failed takes are seen before creators report them.
**Done when:** an error in the web app or a failed processing job is reported with enough context to debug, and no video content or secrets are sent.
- [x] Design it (spec): `/architect error monitoring`
- [x] Build it: `/develop error monitoring`
   - [x] Scrubbing module with tests (AC-4) (S1C-T06)
   - [x] Web and browser reporting with source maps (AC-1, AC-2, AC-5, AC-6, AC-8) (S1C-T06, S1C-T11, S1C-T14: proven in production, see `docs/reviews/0005-error-monitoring-verify.md`)
   - [x] Job failure reporting with source maps (AC-3, AC-5, AC-6) (S1C-T06, S1C-T12, S1C-T14: proven in production, see the verify report)
   - [x] Alert rules and a production check (AC-7) (first seen and spike rules enabled; production checks done for web, browser and jobs; weekly report on and the first seen email received, both confirmed by Toyin on 2026-11-11)
- [x] Verify it: `/check verify error monitoring` (`docs/reviews/0005-error-monitoring-verify.md`: all of AC-1 to AC-8 pass)
- [x] Test it: `/test error monitoring`
Spec [0005](../specs/0005-error-monitoring.md) · code in `src/lib/sentry-*.ts`, `src/worker.ts`, `src/instrumentation*.ts`, `src/trigger/init.ts`, `src/trigger/sentry-check.ts`

### 18. Email sign in and take ready email · done
Follow up to the core take loop (from spec 0004): sign in with a one time email link alongside Google, and an email when a take is ready or failed, with one click opt out.
**Done when:** a creator can sign in by email link (once, 15 minutes), Google and email are one account, and each finished run sends one ready or failed email that can be turned off.
- [x] Design it (spec): `/architect email sign in and take ready email`
- [x] Build it: `/develop email sign in and take ready email`
   - [x] Resend client and email templates (AC-7) (templates and sender tested; SPF and DKIM pass on a real email from mail.vowmory.com, confirmed by Toyin on #64)
   - [x] Magic link sign in with linking and rate limits (AC-1, AC-2, AC-3, AC-4, AC-8) (merged in #64; SPF and DKIM checked on a real email; a real sign in link was used once on production, see the verify report)
   - [x] Take emails with opt out (AC-5, AC-6, AC-8) (S1C-T08 part 2 PR: notify task, turn off link, take page switch, tested)
- [x] Verify it: `/check verify email sign in and take ready email` (`docs/reviews/0006-email-sign-in-and-ready-email-verify.md`: all of AC-1 to AC-8 pass)
- [x] Test it: `/test email sign in and take ready email` (`src/server/auth.test.ts`, `src/trigger/email/notify.test.ts`, `src/lib/email/templates.test.ts`, `src/lib/email/send.test.ts`, `src/app/emails/off/route.test.ts`, `src/server/email/turn-off.test.ts`, `tests/sign-in.spec.ts`)
Spec [0006](../specs/0006-email-sign-in-and-ready-email.md)

## Slice 2: Transcript

### 7. Transcript · done
Every processed take gets an English transcript, shown in the app with timestamps and timed to the trimmed video.
**Done when:** the transcript appears beside the video with timestamps, and downloads as plain text and as SRT captions that line up with the trimmed video.
- [x] Design it (spec): `/architect transcript`
- [x] Build it: `/develop transcript`
   - [x] Job groundwork: transcript table, `transcribe` job kind that never moves the take, no emails, stale and expiry rules (AC-1, AC-8, AC-9, AC-10)
   - [x] First thread: the `transcribe-take` task with Deepgram, started after the video, shown as plain paragraphs (AC-1, AC-6, AC-7, AC-11)
   - [x] Trimmed timeline, captions and downloads, then failures, retry and Make transcript (AC-2, AC-3, AC-4, AC-8, AC-9, AC-10, AC-11)
   - [x] Take page transcript panel and player CC, then end to end tests with real Deepgram (AC-1, AC-2, AC-3, AC-5, AC-6, AC-7, AC-10, AC-12)
- [x] Verify it: `/check verify transcript` (`docs/reviews/0007-transcript-verify.md`: all of AC-1 to AC-12 pass)
- [x] Test it: `/test transcript` (`src/lib/transcript-timeline.test.ts`, `src/lib/transcript-download.test.ts`, `src/lib/deepgram.test.ts`, `src/trigger/transcribe-take.test.ts`, `src/server/transcripts/*.test.ts`, `src/db/data/transcribe-jobs.test.ts`, `tests/transcript.spec.ts`, `tests/pipeline/transcript.ts`)
Spec [0007](../specs/0007-transcript.md) · code in `src/trigger/transcribe-take.ts`, `src/lib/transcript-timeline.ts`, `src/db/data/jobs/`, `src/app/api/takes/[id]/transcript/`, `src/components/takes/`

## Slice 3: Studio background

### 8. Studio background swap · done
Replace the green screen with a studio background: pick one of a few built in studios or upload your own image.
**Done when:** a creator picks a preset or uploads an image (format and size checked), and the finished video shows the subject cleanly on that background with no visible green edges in normal lighting.
- [x] Design it (spec): `/architect studio background swap`
- [x] Build it: `/develop studio background swap`
   - [x] First thread: keying in the video job, detection, always render with a background (AC-2, AC-3)
   - [x] Choose at upload and change later: upload choice and default, background re-renders that keep the take Ready (AC-1, AC-5, AC-6) (re render and its route done in S3S-T03; upload choice in S3S-T02)
   - [x] Previews and uploaded backgrounds: preview stills, upload, ingest, library, delete (AC-4, AC-8, AC-9, AC-10)
   - [x] Picker, tips and the six studios, then end to end tests (AC-4, AC-7, AC-11, AC-12, AC-2, AC-5)
- [x] Verify it: `/check verify studio background swap` (`docs/reviews/0008-studio-background-verify.md`: closed, all twelve criteria met, AC-2 and AC-4 re verified on real footage, S3S-T11 re-run)
- [x] Test it: `/test studio background swap`
Spec [0008](../specs/0008-studio-background.md) · code in `src/lib/keying.ts`, `src/trigger/process-take.ts`, `src/trigger/preview-background.ts`, `src/trigger/ingest-background.ts`, `src/db/data/jobs/`, `src/app/api/backgrounds/`, `src/components/takes/`

## Slice 4: Review the cuts

### 9. Cut review timeline · in-progress
After automatic trimming, show every cut on a timeline; the creator can undo any cut, then render the final video.
**Done when:** each cut is visible and playable, undoing a cut restores that part, and the final render and transcript reflect exactly the kept cuts; the timeline works by keyboard.
- [x] Design it (spec): `/architect cut review timeline`
- [x] Build it: `/develop cut review timeline`
   - [x] Change job: `POST /changes` with cut plan and background in one free render, flags written on success, refusals and the shared limit (AC-6, AC-7, AC-8, AC-9)
   - [x] Waveform: computed in the video job, served once per page, pipeline check of a cut change render (AC-11, AC-7)
   - [x] Timeline and pending bar: cut blocks, preview on the original with skips, Discard and Render, Background tab feeding the bar, keyboard and phone width (AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-10, AC-11)
- [x] Verify it: `/check verify cut review timeline` (PASS with three gaps, see `docs/reviews/0011-cut-review-timeline-verify.md`; AC-7 pipeline run 24 of 24)
- [ ] Test it: `/test cut review timeline`
Spec [0011](../specs/0011-cut-review-timeline.md)

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

### 15. Landing page & SEO · done
A public page that explains Take Studio and leads to sign up, built from Toyin's v2 homepage design (2026-11-12).
**Done when:** the landing page shows what the product does with copy true today and a sign up call to action, has title, description and social share preview metadata, and meets WCAG AA.
- [x] Design it (spec): `/architect landing page & SEO`
- [x] Build it: `/develop landing page & SEO`
   - [x] Static page, true copy, media, metadata, robots and sitemap (AC-1, AC-2, AC-3, AC-7, AC-9, AC-11)
   - [x] Motion core, nav, hero fan and reel (AC-4, AC-5, AC-8)
   - [x] The studio floor with lazy Three.js (AC-6, AC-8, AC-10)
   - [x] Details, then reduced motion, responsive, a11y and performance passes (AC-5, AC-7, AC-8, AC-9, AC-10)
   - [x] Library on its own route `/library`, signed in `/` redirects there, so the library code is off the signed out homepage (AC-1, AC-10) (DV0-T09)
   - [x] Homepage speed: no layout shift (the fan's box is reserved from the first paint) and the above the fold text in the first paint, Lighthouse CLS 0.374 to 0 (AC-10) (DV0-T13; PageSpeed Insights mobile on production 2026-11-13: performance 99, accessibility 100, best practices 100, SEO 92)
- [x] Verify it: `/check verify landing page & SEO`
Spec [0010](../specs/0010-landing-page.md) · rules in [design.md](../../design.md) · code in `src/app/page.tsx`, `src/app/library/`, `src/components/home/`

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
- **Own render servers (cost step 2)**: when the Trigger.dev render bill is steadily above about $150 to $300 a month, move only the ffmpeg render to one or two rented Hetzner servers; Trigger.dev cloud stays the coordinator (the render step pauses, unbilled, while our server renders), with automatic fallback to the cloud machine when our servers are full or down · needs a decision
- **k3s render cluster (cost step 3)**: when more than about 3 render servers or automatic scaling are needed, combine Hetzner machines into a k3s cluster that runs each render as a Kubernetes job (the step 2 render service runs inside it); a dedicated infrastructure agent joins the team to set up, run and look after the servers and the cluster · needs a decision · after Own render servers

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
