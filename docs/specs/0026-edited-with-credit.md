# 0026. "Edited with Take Studio" credit on rendered videos

**Date**: 2026-11-16
**Status**: Proposed

## Summary

Every finished video made on a free account gets a small "Edited with Take Studio" credit in the top left corner for its last four seconds, drawn into the video by the same ffmpeg pass that already trims it. Free accounts cannot switch it off, because it is what the free plan pays with. A paid Creator account (spec 0024) gets no credit by default and can turn it on or off per take. Takes made before launch are never changed. The credit uses the product name only, no web address.

## Context

Toyin wants every video a creator posts to advertise the app (Slack, 2026-11-16). The finished video is one MP4 per render in R2, made by `process-take` (`encode` in `src/trigger/take-run/render.ts`) and used for both the player and the Download button (spec 0004 AC-12). That file is the only thing that leaves the app, so the credit has to be in its pixels. Burned in captions are deferred, the CC track and the SRT are separate files, and a re render (cuts, background) rebuilds the whole file from the original, so a credit drawn in the render survives edits for free.

Four things limit the design. The credit must not change the length of the video, or the charged seconds, the transcript timestamps and the SRT would drift (spec 0007). It must stay readable on any background, and clear of the places where TikTok, Reels and Shorts draw their own buttons and captions. Spec 0024 says paid plans are different (Toyin: off by default for paid later), but billing is built in month 2, so the credit must work on its own first. And a visible mark on a creator's video is a service term, so the Terms change with it (spec 0015).

## Requirements

**User stories**:
- As Toyin, I want every posted free video to carry a small credit so each one advertises Take Studio.
- As a free creator, I want the credit small and tidy, kept away from my captions and the usual platform buttons, and I want to know before I download that it is there.
- As a paid creator, I want my video clean by default and a switch if I want to help the product.
- As a creator with older takes, I do not want them to change under me.

**Acceptance criteria**:
- **AC-1**: A render shows the credit when `creditFor` says so. The credit is the words "Edited with Take Studio" (product name only, no web address, C-25), white text on a black box at 60% opacity, drawn from one committed PNG. White on the worst case background (a pure white frame under the 60% box) is at least 4.5 to 1, and a unit test computes it and the pair is added to `src/app/design/contrast-table.ts` with a reason.
- **AC-2**: Where and when. Top left, inset 5% of the width from the left edge and 5% of the height from the top for landscape and square video, 10% of the height from the top for portrait video (height greater than width), so it sits clear of the buttons and caption lines that TikTok, Reels and Shorts draw. It is shown for the last 4 seconds of the rendered video. A video shorter than 8 seconds shows it for its last half. The width is 40% of the shorter side, but never below 160 px, and never above 90% of the video width; the minimum wins over the 40% on small videos (a 320 by 240 video gets 160 px, not 96), and a boundary test covers it. The PNG is never scaled up past its own width. The credit can cover part of the picture in the top left corner. That is accepted: placement is fixed and the same on every video (no face detection), and the paid plan is how a creator removes it. No fade, so nothing moves or flashes (WCAG 2.2.2, 2.3.1).
- **AC-3**: The credit never changes the video's length, frame rate, audio, cut plan or charged seconds. The transcript, the SRT and the WebVTT are unchanged and never contain the credit. A test compares the render duration and audio with and without it.
- **AC-4**: `creditFor({ plan, choice, takeCreatedAt, startsAt, now })` is pure and the only decider. Rules in order: `startsAt` empty or in the future gives no credit (this is the launch and kill switch); a `paid` plan gives the credit only when `choice` is `on` (an explicit choice, so it also applies to a take made before `startsAt`); a `free` plan gives the credit unless the take was created before `startsAt` (older takes are never credited on a free account). Free accounts cannot change it.
- **AC-5**: The decision is made once per render, when its row is created (`createRender`), from the account's `effectivePlan` (spec 0024) at that moment. Until spec 0024 is built, every account is `free`. The result is stored on the render row as `credit_applied`, so the take page can say truthfully what the file in storage has.
- **AC-6**: Takes already rendered are not touched. No backfill job, no stamping of stored renders. A re render of a take created before `startsAt` stays clean on a free account (AC-4).
- **AC-7**: A paid creator sees a "Credit in the video" switch on the take page (Details area). Its state shows what the latest stored render has (`render.credit_applied`), so a creator who upgrades with a credited file sees it on, and one change to off removes it. With no render yet it is off. Changing it calls `PATCH /api/takes/{id}/credit` and queues a re render through the existing change path (kind `credit`, charges 0 seconds, same rules and limits as a background change). The switch is disabled while a job runs and says what happens: "Applies when the video is rendered again." A free creator sees no switch, only the plain line from AC-8.
- **AC-8**: Honest and findable. A free creator's take page says, near Download and before they download, "Free videos end with an Edited with Take Studio credit. Paid plans can remove it." (links to the plan page only when billing is on, spec 0024 AC-18). A take whose stored render has no credit (older, as is, or paid) shows no such line. The line is plain text a screen reader reads.
- **AC-9**: Takes handed back as is (no cuts or no audio, spec 0004 AC-7) have no render, so no credit, and "Download original" is never credited. This is stated in the Terms copy.
- **AC-10**: If the credit cannot be drawn (missing PNG, overlay error), the render is retried once without it, shipped, logged with the take ID only and `credit_applied` stays false. A free creator's take is never failed over the credit.
- **AC-11**: The studio background final gate (`outputIsOnlyBackground`, spec 0008 AC-13) must not be fooled by the credit. It samples frames outside the credit window, or the check runs on the frames before the overlay, and a test proves a keyed output that is only background is still caught when the credit is on.
- **AC-12**: Plan changes. On upgrade the stored render keeps its credit until the creator turns it off (AC-7) or edits the take. On downgrade or a lapsed plan the next render gets the credit again (AC-4). Public API and MCP takes follow the same rule through the account plan; they gain no new write field in this spec.
- **AC-13**: Legal. The Terms say that videos made on a free account end with the credit, that paid plans can remove it, and that as is takes and originals carry none. `LEGAL_VERSION` moves in the same PR. `pnpm legal:drift` runs, and the checklist in `src/lib/AGENTS.md` is walked: no new service, dependency, secret, cookie, personal field or analytics event is added, so `legal-facts.ts` `PROCESSORS` and `COLLECTED` are expected to stay unchanged (the build task records the reasoning).
- **AC-14**: Accessibility. The credit is branding text in the picture and carries no information a creator needs; the take page lines (AC-7, AC-8) are real text, the switch is a labelled `<button role="switch">` with `aria-checked`, 44 px, keyboard operable, visible focus, with a polite status message when the re render starts.

## Options considered

### Where and how the credit shows

**Option 1: corner text for the last four seconds, top left (recommended).** Cheapest to draw, no change to length, safe from platform buttons, shows when a viewer is deciding whether to look at the creator's profile, and does not sit on the hook. Con: small, so some viewers never see it.

**Option 2: a 1.5 second end card.** Impossible to miss. Cons: lengthens the video, so duration, the charged seconds, progress and the audio tail change; looks like an ad; creators will hate it.

**Option 3: a corner mark for the whole video.** Most views. Con: sits on the picture the whole time, the likeliest reason free users leave, and collides with platform overlays for longer.

**Runner up: Option 2 only for the free plan's first month.** Not recommended; two looks to build and explain.

### Burned in the render or added only on export

**Option A: burned in during the `process-take` render (recommended).** One extra overlay filter in the pass that already runs, no second encode, no extra job, the player and Download show the same file. Con: removing it later needs a re render (a change job, 0 seconds charged).

**Option B: stamp only when the creator downloads.** The player stays clean and a switch is instant. Cons: a second encode of the whole video on every Download (time, cost, a new job and storage), and the presigned download link model of spec 0004 stops working.

### Drawing method

**Recommended: overlay a committed PNG.** No font file or freetype needed in the pinned ffmpeg image, exact brand look, one more file in `additionalFiles`. **Runner up: `drawtext`**, which needs a font file shipped and tested in the Trigger.dev image and gives a less controlled look.

### Default for free accounts

**Recommended: on, and not switchable.** It is the price of the free plan and the point of the feature (Toyin). **Runner up: on by default but switchable per take for everyone.** Friendlier, and it would most likely switch off for most posted videos, so it gives away the benefit.

### Can a creator switch it off, and where

**Recommended: paid only, per take, on the take page** (AC-7). No account wide setting in this spec, which keeps it to one column and no new settings page (there is none today). **Runner up: an account default** plus a per take override, once there is a settings page.

### Takes already rendered

**Recommended: leave them exactly as they are** (AC-6), created before the launch date means never credited on a free account. **Runner up: credit them on their next re render.** Simple to build, but it surprises a creator who edits a three week old take and finds an ad in it.

### Paid plan and founding members

Off by default for paid, as Toyin said. **Founding members** (spec 0024 AC-14) are free until they subscribe, so they get the credit like any free account. **Runner up: a clean video for founding members as a thank you**, one more rule in `creditFor` if Toyin wants it.

## Decision

**Chosen option**: corner text for the last four seconds, burned in by the render, from a PNG overlay; on and fixed for free accounts, off by default and switchable per take for paid; never applied to takes made before launch.

**Implementation skills**: `trigger-tasks` (`triggerdotdev/skills`, `.claude/skills/trigger-tasks/`) · `web-design-guidelines` (`vercel-labs/agent-skills`, `.claude/skills/web-design-guidelines/`)

## Rationale

The render is the one place every shared video passes through, so a filter there costs almost nothing and cannot be skipped by a download path. Keeping the length unchanged keeps the cut plan, the charged seconds and the captions true (spec 0007), which an end card would break. A PNG avoids a font in the ffmpeg image. Making "free" mean "credited" and "paid" mean "your choice" fits spec 0024 and gives free accounts a plain reason to upgrade, while grandfathering old takes keeps the promise that nothing changes under a creator. The decision lives in one pure function so Toyin can change any rule in one place.

## Feature design

**Data model sketch** (one migration):
- `app_setting` row `credit_starts_at` (timestamp, empty means off for everyone). Same table and read pattern as `usage_limit_enabled` (spec 0014).
- `take.credit_choice` text, nullable, check in (`on`, `off`). Empty means "follow the plan". Written only by the paid switch.
- `render.credit_applied` boolean, not null, default false (snapshot of what the stored file has).
- `processing_job.kind` gains `credit` (a change job like `background`).

**State transitions**: none new. A `credit` job runs `changeRun` (waveform only if missing, the background step, render, no transcript), then the normal finish.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/takes/{id}/credit` | PATCH | `credit: "on" or "off"` (req, zod) | 202 with the new job | session, same Origin, owner | 401, 403 origin, 404 not yours, 409 `plan_required` (free), 409 job running or take expired, 429 |
| `/api/takes/{id}` | GET | none | adds `credit: { applied, canChange, choice }` | session, owner | 404 |

**Value sourcing**:
| Action | Value | Source |
|---|---|---|
| Decide credit | plan | `effectivePlan(subscription, now)` (spec 0024); constant `free` until it exists |
| Decide credit | startsAt | `app_setting.credit_starts_at` |
| Decide credit | takeCreatedAt, choice | `take.created_at`, `take.credit_choice` |
| Place credit | width, height, durationMs | `facts` from the task's own probe (`RunContext.facts`) and `expectedMs` of the kept ranges, not the source length |
| Place credit | x, y, size, start, end | `creditPlacement(width, height, durationMs)` in `src/lib/credit-filter.ts` (AC-2) |
| Take page line | whether the file has the credit | `render.credit_applied` of the latest render |
| Switch | `canChange` | paid `effectivePlan` and no running job |

**Key invariants**: the credit never changes duration, fps, audio or charged seconds; a free account with a post launch take always renders with it; a render's `credit_applied` matches the file it describes; the decision is made once per render.

**Security model**: the PATCH route is owner only with the Origin rule, validates with zod, ignores any plan claimed by the client, and refuses free accounts server side (the hidden switch is not the control). Nothing here is personal data. The PNG is a committed asset, not user input. Logs carry take and render IDs only.

**Configuration required**: no new env var or secret. One committed asset (`assets/credit/edited-with-take-studio.png`, 1000 px wide, transparent corners) shipped with `additionalFiles` in `trigger.config.ts`, and the `credit_starts_at` setting, set by Toyin's go (a database update, like `usage_limit_enabled`).

**Critical test scenarios**:
- Happy path: a free account uploads, the render has the overlay in the last 4 seconds and `credit_applied` is true, same duration as without, verifies **AC-1**, **AC-2**, **AC-3**, **AC-5**.
- Rules table: every row of `creditFor` including `startsAt` empty, a pre launch take, paid with no choice, paid on, lapsed paid, verifies **AC-4**, **AC-6**, **AC-12**.
- Contrast: white on a white frame under the box is at least 4.5 to 1, verifies **AC-1**.
- Failure: the PNG is missing, the render is retried clean and ships, verifies **AC-10**. A keyed output that is only background is still refused with the credit on, verifies **AC-11**.
- Auth and plan: a free account PATCH gets 409, another creator's take gets 404, a cross origin request is refused, verifies **AC-7**.
- Browser: the free line shows before Download, the paid switch is keyboard operable with a polite message, axe clean at phone width, verifies **AC-7**, **AC-8**, **AC-14**. As is takes show no line and no credit, verifies **AC-9**.

## Build plan

Tracer Bullet: one real thread first (a free take rendered with the credit), then the paid switch once billing exists.

1. `src/lib/credit-rules.ts` (`creditFor`) and `src/lib/credit-filter.ts` (`creditPlacement`, the overlay filter text), the PNG asset and `additionalFiles` entry, with unit tests and the contrast pair in `contrast-table.ts`. Satisfies **AC-1**, **AC-2**, **AC-4**.
2. Migration (setting, `take.credit_choice`, `render.credit_applied`, job kind `credit`), `createRender` decides and stores the credit, the filter script takes the optional overlay input, `encode` retries clean on a credit failure, the keyed gate samples outside the window. A pipeline check proves duration, audio and transcript are unchanged. This is the tracer thread. Satisfies **AC-3**, **AC-5**, **AC-6**, **AC-10**, **AC-11**.
3. Take page: the free line near Download and `GET` field. Satisfies **AC-8**, **AC-9**, **AC-14**.
4. Terms copy, `LEGAL_VERSION`, `pnpm legal:drift`, and the legal facts note. Satisfies **AC-13**.
5. After the billing build (spec 0024 task 1 and the plan read): `PATCH /api/takes/{id}/credit`, the `credit` job kind through `changeRun`, the switch on the take page, browser tests. Satisfies **AC-7**, **AC-12**, **AC-14**.
6. Go live in its own small PR or database change: set `credit_starts_at`, and add the line to the runbook (set it empty to switch every credit off). Satisfies **AC-4**, **AC-6**.

Tasks 1 to 4 do not wait for billing. Task 5 waits for spec 0024's plan read. Dwight takes 3 and 5, Jim takes 1, 2 and 6, 4 is shared.

## Consequences

**Positive**:
- Every free video advertises the product at almost no render cost and no change to length or captions.
- One pure rule and one setting give Toyin a kill switch and a clean place to change the policy.
- Paid plans get a real, simple benefit.

**Negative / tradeoffs**:
- Some free creators will dislike it, and a small corner mark can be cropped out or ignored.
- Removing the credit needs a re render, so the paid switch is not instant.
- Takes made before launch never advertise, so early growth gets nothing from them.
- The PNG is one more asset to keep in step with the brand.

**Neutral**:
- The credit is in the player too, so creators see exactly what they will post.
- Spec 0024's `effectivePlan` is read at render time, so a creator who upgrades keeps the credit on the stored file until they edit.

## Follow-up

- [ ] Toyin to confirm, with the recommended default in brackets: free accounts cannot switch it off (yes); last 4 seconds, top left (yes); founding members credited like free (yes); old takes never credited (yes); the Terms sentence in AC-13.
- [ ] A share page with a "Made with Take Studio" mark (Growth ideas) would overlap this; revisit after both are built.
- [ ] If burned in captions are ever built, check their lower third position against this credit (top left, no overlap by design).
- [ ] An account wide default for paid accounts, once a settings page exists.
- [ ] Public API and MCP: a `credit` field for paid keys, if agents ask for it.
- [ ] `/sync` after the build adds the credit rules to `src/lib/AGENTS.md` and `src/trigger/AGENTS.md`.
