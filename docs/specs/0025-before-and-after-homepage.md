# 0025. Before and after on the homepage

**Date**: 2026-11-15
**Status**: Proposed

## Summary

The homepage gets one new section that shows a single take twice: the raw recording on one side and the finished version, made by our own pipeline, on the other. A visitor drags a slider (or uses the arrow keys) to wipe between them, and a line of text says how much time the edit saved. The clip is recorded by us, never taken from a creator, the files live in R2 and not in the public repo, and the section adds almost nothing to the page weight until it scrolls into view.

## Context

Today the homepage explains Take Studio with a reel and a fan of sample cards. Those are Toyin's draft media, made in an editor. They show a look, not the product. The growth idea (scope, Growth ideas) is to prove the product with one honest comparison: what you recorded, next to what Take Studio gave back.

Four forces shape it:

- **Honesty.** If the "after" is hand polished, the section is a claim, not proof. It has to be the real output of our own pipeline.
- **Privacy and a public repo.** A real face and voice must never come from a creator's take, and must never be committed to the repo, which is public.
- **Speed.** Spec 0010 holds the page to Lighthouse mobile 90 or more, CLS 0.02 or less, and a JS budget. Two videos must not break that.
- **Different lengths.** Cuts remove time, so the finished video is shorter than the raw one. They cannot be aligned frame to frame, and the design has to make that a feature.

## Requirements

**User stories**:
- As a visitor, I want to see a raw recording next to the finished result, so I can judge the product in seconds.
- As a visitor using only a keyboard or a screen reader, I want to compare the two without a mouse.
- As a visitor on a phone, I want the comparison to be easy to drag and fast to load.
- As the team, I want the "after" to be the real pipeline output and the numbers to be measured, so we never overclaim.
- As the team, I want no real person's face or name in the repo or in the page text.

**Acceptance criteria**:
- **AC-1**: A signed out visit to `/` shows a "Before and after" section after the reel. Its heading, the Raw and Finished labels, the time saved line and a transcript disclosure (a native `<details>`, G23) are in the server rendered HTML before any script runs. A signed in visit still goes to `/library`.
- **AC-2**: The comparison slider is operable by keyboard (arrow keys, Home, End), by pointer and by touch. It is a native range input with an accessible name and a spoken value such as "Raw 60 percent, finished 40 percent". The handle and its hit area are at least 44 px. Focus is visible.
- **AC-3**: One shared Play and Pause button controls both videos. They start together, muted, with captions on, and stay in step. The videos start by themselves only when the section is mostly in view and motion is allowed, and the visible pause control meets WCAG 2.2.2. With reduced motion, nothing starts by itself and the poster shows until the visitor presses Play.
- **AC-4**: The raw video is the unedited original of one take. The finished video is the unmodified render the pipeline produced from that same take, with the AI cuts accepted as proposed, the default studio background, and no hand editing. A test compares the numbers on the page with the real file durations.
- **AC-5**: The time saved line is computed, not typed: the raw duration minus the finished duration, from the manifest. It reads like "On this take: 0:31 raw, 0:19 finished, 12 seconds saved", and says it is one sample.
- **AC-6**: Performance on mobile holds: Lighthouse performance 90 or more (measured on production after the merge, as in spec 0010), CLS 0.02 or less, the LCP element does not change, and the new client code adds 6 KB gzip or less of initial JS. No video bytes load until the section is near the viewport.
- **AC-7**: The media (two videos in MP4 and WebM, two posters, two caption files) live in R2 under a versioned `showcase/` prefix and are served with long immutable caching and working Range requests. No file of the clip, poster or frame is committed to the repo.
- **AC-8**: The clip is recorded by us with a written release from the person on camera, kept outside the repo. No name, handle or photo caption of a person appears in the page, the file names, the alt text or the manifest.
- **AC-9**: At 390 px wide the section has no horizontal scroll, the slider spans the full width, the labels and the time saved sit below the video, and every control is at least 44 px.
- **AC-10**: A "Try it on yours" button follows the section. It goes to the upload entry: the hero drop zone once spec 0023 ships, and `/sign-in` until then.
- **AC-11**: The section adds no cookie, no script vendor, no stored personal field and no analytics event. `pnpm legal:drift` is clean with no copy change.
- **AC-12**: With scripts off, the two videos show one above the other with their native controls and labels. The text is the same.
- **AC-13**: A documented command republishes the clip from a take and writes a new version folder and its manifest (never rewriting a published one), so the section can be refreshed when the pipeline improves, and the `showcase/` files are never deleted by the retention sweep or the R2 lifecycle backstop.

## Options considered

### A. Source of the clip

**Option A1: A person on our team or a friend records it, with a release.** A scripted 30 second take on our own `/record` page, with real hesitations, a long pause and a restart in it.
**Pros**: the raw is real, and so is the product use. The "after" is believable.
**Cons**: needs a willing person and a signed release. A real face is public forever.

**Option A2: A synthetic presenter (an AI generated person).**
**Pros**: no consent to chase, no real person exposed.
**Cons**: an AI "raw" with scripted mistakes is staged, and a faked "before" makes the proof dishonest. Looks different from what a creator's camera gives.

**Option A3: A creator's real take (with permission).**
**Pros**: very real.
**Cons**: rejected by the task. We never use a creator's take, and it would put a customer's face on our homepage.

### B. How the "after" is made

**Option B1: Run the raw take through the production pipeline in the normal app, then copy the files out.** A staff account uploads the raw on `/record` or `/library`, the real AI cuts run, and the render is exported.
**Pros**: honest by construction. Reruns whenever the pipeline improves.
**Cons**: the take lives only 30 days in the library, so the files must be copied out (AC-13).

**Option B2: Edit it by hand in a video editor.**
**Pros**: looks best.
**Cons**: not our pipeline, so not proof.

### C. Where the files live

**Option C1: `public/` in the repo.** Same as the current homepage media.
**Cons**: puts a real face in a public repo (AC-7, AC-8).

**Option C2: A second public R2 bucket on a custom domain.**
**Pros**: simple edge caching.
**Cons**: a new public bucket and a new domain to configure, outside spec 0001 ("one private bucket, no public domain").

**Option C3: The existing private bucket under `showcase/`, streamed by a small Worker route.**
**Pros**: no new bucket, no new domain, nothing in the repo. Versioned names allow immutable caching. Matches the key prefix rule in spec 0001.
**Cons**: one route to write and test for Range requests.

### D. How the two videos are compared

**Option D1: Slider wipe on two stacked videos that play in real time.** The raw runs its full length, the finished one ends sooner and holds its last frame.
**Pros**: the shorter finished video is the time saved, shown, not told. No timeline mapping to build.
**Cons**: two decoders on weak phones.

**Option D2: Align the two by the cut map so both show the same words.**
**Pros**: tidy.
**Cons**: needs the cut list on the page and a complex sync. The raw would have to freeze during cuts, which hides the cost of the pauses.

**Option D3: A Raw and Finished toggle with one player.**
**Pros**: one decoder.
**Cons**: no wipe, so weaker comparison. Kept as the no script fallback only (AC-12).

### E. Measuring it

**Option E1: No new event. Judge it by the existing signup and first upload counts (spec 0016) week by week, plus Cloudflare's own request counts for the media route.**
**Pros**: spec 0016 allows server written events only and no page view tracking, so this changes no legal fact.
**Cons**: coarse.

**Option E2: A server written count when the finished video is first requested.**
**Pros**: a rough "played" number.
**Cons**: counts requests, not people, double counts Range requests, and adds an event, a legal facts check and a copy review.

## Decision

**Chosen options**: A1 (we record it, with a release), B1 (the real pipeline), C3 (R2 `showcase/` through a Worker route), D1 (slider wipe, real time, shorter finished video), E1 (no new event).

**Implementation skills**: `modern-web-guidance` (`.claude/skills/modern-web-guidance/`, layout, animation, accessibility) · `workers-best-practices` (`cloudflare/skills`, `.claude/skills/workers-best-practices/`) · `web-design-guidelines` (`vercel-labs/agent-skills`, `.claude/skills/web-design-guidelines/`)

## Rationale

The product is the proof. A raw take that is really raw and a finished take that came out of the same pipeline every creator uses is the strongest claim we can make, and the only one we can keep making truthfully (A1, B1). A synthetic or hand edited pair would be easier and less honest.

D1 turns the awkward length gap into the message. The finished video ends first while the raw one keeps going, and the time saved line says by how much. It also avoids any sync logic beyond keeping two videos in step.

C3 keeps the repo free of a real person and reuses the bucket, the key prefix rule and the immutable caching idea we already trust. The cost is one Worker route.

E1 follows spec 0016, which promises no cookie, no pixel and no page view tracking. A request count would be a number about requests, not people, and would cost a legal facts update for little.

## Feature design

**Source and release.** Michael asks Toyin who records it (recommended: a team member or a friend, no name used anywhere, a written release saved outside the repo). The script is ours: about 30 seconds on one useful topic, with two ums, one long pause and one restart. The person records on `/record` on a phone, so the raw is a real capture.

**Pipeline run.** A staff account on production uploads the take and lets the normal pipeline run, AI cuts included. Real AI runs on the cloud path (C-29), so this is done in production, not in the sandbox. Nothing is edited by hand. The result is the render the creator would download.

**Manifest** (`showcase/v1/manifest.json` in R2 as the record, and the same object committed in `src/lib/showcase-manifests.ts`, G13). A strict zod object, unknown keys fail:
- `version` (`v<N>`), `rawMs` and `finishedMs` (integers, 1 to 600000, finished shorter by at least 3000), `cuts` (integer, recorded only, not shown), `files` (the fixed nine names), `width` 1280, `height` 720, `transcript` (the finished words as plain text, 2000 characters or less).
- No name, no take id, no date of recording.

**Storage and delivery**:
- Keys: `showcase/v1/raw.mp4`, `raw.webm`, `finished.mp4`, `finished.webm`, `poster-raw.webp` and `poster-finished.webp`, `raw.vtt`, `finished.vtt`, `manifest.json`. **Versions**: a new publish always writes a new folder (`v2`, `v3`), never an overwrite, and the old folder stays in R2 (so a rollback is a one line change). The active version is one constant in code, `SHOWCASE_VERSION` in `src/lib/showcase.ts`; the homepage and the route both read it, so they cannot disagree. Switching is a code change reviewed in a normal PR, deployed by CI, after the publish command prints the new folder. The route serves any version in the committed manifest table, so a cached page that still names `v1` keeps working until it is replaced.
- Route `GET` and `HEAD` `/showcase/[version]/[file]` (`src/app/showcase/[version]/[file]/route.ts`) reads from R2 over the S3 API (`aws4fetch`, as spec 0001), passes the `Range` header, answers 206, and sets `Cache-Control: public, max-age=31536000, immutable` plus the right `Content-Type`. Any version or name not in the committed table answers 404. The body is streamed, never held in memory.
- The R2 lifecycle backstop (35 days, spec 0013) and the cleanup sweep act only on `originals/` and `renders/`. A build task confirms that, and adds a test that no sweep path can reach `showcase/`.

**Encoding** (done by the publish script with the pinned ffmpeg): 720p, H.264 MP4 and VP9 WebM. Audio is kept so the Sound button can work, but both videos start muted. Each file 3 MB or less, each poster 60 KB or less (WebP only).

**The section** (a server component; its interactive code is a lazy plain TypeScript module, not a React island, G29):
- Layout: eyebrow, heading ("Same take. Raw, then finished."), the stage (16:9), a row with the Play and Pause button, the Sound button and the slider, then the time saved line, then "Try it on yours", then the transcript disclosure.
- Stage: the finished video sits under the raw video. The raw video is clipped from the right by the slider position (`clip-path: inset(0 X% 0 0)`), so the left shows Raw, the right shows Finished. The handle is a vertical line with a round 44 px knob, labelled by two corner pills "Raw" and "Finished".
- Slider: a visually present `<input type="range" min="0" max="100" step="1">` over the stage, with `aria-label="Compare raw and finished"` and `aria-valuetext`. Arrow keys move 5, Home and End jump to the ends. The knob is a style of the native thumb, so pointer, touch and keyboard all come free.
- Playback: both videos start together, muted, with captions on. A small loop keeps the finished video within 0.15 s of the raw one while both play, and each stops on its last frame while the other finishes. When the raw video ends, both rewind. Sound plays the side the handle favors.
- Reduced motion: no autoplay and no handle animation. The poster shows, Play starts both.
- Loading: the server markup puts a real `src` on each video with `preload="none"`, which asks the browser not to download until play. `preload` is only a hint, so treat it as best effort: the build task checks the network panel on a phone sized Chrome and Safari and confirms no video request starts before the section is near the screen, and a failure there means the script path moves the `src` into a `data-src` and sets it near the screen, while the no script path keeps real `src` values on `<video>` elements inside `<noscript>` so the controls still play them. When scripts run, an IntersectionObserver sees the section within about one screen and raises it to `preload="metadata"`. This one mechanism serves both the script and no script cases, so there is no second path to conflict. The poster is a normal image with a fixed `aspect-ratio`, so CLS is 0.
- No scripts: the same markup, with its server rendered `src`, shows both videos stacked with `controls`, the Raw and Finished labels above each, and the slider hidden.
- Phone: the stage spans the page margin to margin. Labels, the time saved and the button stack below in one column at 810 px and under.

**Time saved**: a pure function rounds raw and finished to whole seconds first, then takes the difference of the rounded values, so the three numbers always add up (`m:ss`, singular "1 second saved"). Text is "On this take: 0:31 raw, 0:19 finished, 12 seconds saved." The line says "One sample take. Your results will differ." It is rendered on the server from the manifest.

**Fit with Upload first (spec 0023).** The two features are independent. When 0023 ships, the "Try it on yours" button moves focus to the hero drop zone instead of leaving for `/sign-in`, and shows the same drop zone, not a second one. Until then it is a link.

**Security and privacy**: the route serves only manifest files, read only, no user input reaches a key (the file name is checked against a fixed list). No creator data is involved. The release is kept by the team outside the repo, and the repo holds no frame of the clip.

**Configuration required**: none for the app. It uses the existing R2 keys. The publish command needs production R2 write keys on a person's machine (G11).

**Cross check answers** (from `docs/reviews/0025-spec-crosscheck.md`; G numbers point there):
- **Release and script** (G1 to G5). The script names no real person, company, price or result, and the frame shows no name, screen, badge or logo. The release is one page (face, voice, words, worldwide, no end date, removal on request, see Withdrawal below) held by Toyin outside the repo. The render uses the creator defaults a new account gets. Up to three runs of the same raw, publish the first that meets the written bar (no cut inside a word, at least 5 seconds saved, no failed step), run count in the private log. The phone original is kept with the release, so a refresh after 30 days re uploads it as a new take.
- **Publish script** (G10 to G12, G16 to G20). A person runs it with production keys, `SHOWCASE_PUBLISH_TARGET=prod` required, `--version vN` explicit, `--dry-run` by default and `--write` to upload. It refuses if the version's `manifest.json` exists, creates every object with a conditional write (`If-None-Match: *`) so two runs on one version cannot overwrite each other, writes `manifest.json` last, and refuses any key outside `showcase/v<N>/<fixed name>`. Encoding: 1280 by 720, 30 fps, `yuv420p`, MP4 `+faststart` with AAC 64k, WebM VP9 with Opus 48k, keyframe every 2 s, CRF raised until each file is 3 MB or less and never trimmed. Every ffmpeg call strips metadata (`-map_metadata -1 -map_chapters -1`) with `-fflags +bitexact` so ffmpeg writes no encoder tag, and `ffprobe` must find no format or stream tags except the fixed `handler_name` and `language` (checked against the pinned ffmpeg before the script is built); any location, device, creation time, comment or `com.apple.*` tag fails. Durations come from `ffprobe` of the encoded files and must agree within 100 ms, and the rounded whole seconds must be identical for MP4 and WebM. The manifest takes the MP4 values, and the WebM values are checked against them within that tolerance. One take id builds both source keys; the take id, render id and run count go in a private log, never the repo. Captions are the take's own SRT export converted to VTT and proofread. Text is scanned for emails, phones, handles, URLs and a `--forbid` name list typed at run time.
- **R2 read and route** (G6 to G9). `createR2` gets `getObject(key, { range?, signal })` with a 15 s timeout. GET and HEAD only (405 with `Allow`). Single range gives 206 with `Content-Range`, out of range gives 416 with `Content-Range: bytes */size`, multi range gives the whole file with 200. R2 errors give 502 with an empty body. Content type from a fixed map by extension, plus `X-Content-Type-Options: nosniff` and `Cross-Origin-Resource-Policy: same-origin`, no cookie. `version` matches `^v[1-9][0-9]{0,2}$` and the committed table. Browser caching only, no Cache API. `robots.ts` disallows `/showcase/`.
- **Committed manifest** (G13). The page and the route read the committed table, so no R2 read sits on the render path and CI needs no bucket. The publish command prints the text to commit. `SHOWCASE_VERSION` is `string | null`; null omits the section, so steps 3 to 8 can merge before the clip exists. The launch PR sets `v1` after Toyin approves. Old versions stay in the table.
- **Images, not `poster`** (G14). A video `poster` loads at parse time. Each side has a lazy `<img>` layer (`alt=""`, fixed `aspect-ratio`) under its video, and the raw layer is clipped with the raw video.
- **CI** (G15, G30). Synthetic fixtures in `tests/fixtures/showcase/` (two tiny test pattern clips of different lengths and a `.vtt`, no people) are served for `/showcase/**` by Playwright and by `serveSyntheticMedia` in `scripts/lighthouse-ci.ts`, so the best practices gate does not see 404s. Lighthouse performance is not gated in CI; the CI gates are the 100s for accessibility, best practices and SEO on `/`, the bundle test and a Playwright check of no media request before near view and no height change. The production Lighthouse number is recorded in the task.
- **Failure and no script** (G21 to G23). A failed video keeps its still, shows "This video could not load. Try again." with a 44 px button, and the slider and text stay. The stage has no `controls`; a `<noscript>` block holds the stacked `controls` videos, and `@media (scripting: none)` hides the stage. The transcript is a native `<details>` filled from the manifest.
- **Slider** (G25, G26). The value is the handle position from the left, the share showing Raw, default 50, `clip-path: inset(0 calc(100% - var(--pos)) 0 0)` on the raw layer. `step="1"` with a `keydown` handler that moves arrows by 5. The script updates `aria-valuetext` on input. The input fills the stage with a transparent track, `touch-action: pan-y`, and a decorative knob shows the focus ring through `input:focus-visible + .knob`. New pill and knob pairs go in `contrast-table.ts` with a reason.
- **Playback** (G27, G28). The raw video is the clock; a `requestAnimationFrame` loop sets the finished `currentTime` when drift passes 0.15 s, and stops once it has ended. A `waiting` event pauses the partner, and the script resumes both unless `data-user-paused` is set once both have `readyState` of 3 or more. It checks `readyState` on each `canplay` of either video, so a partner that stayed buffered needs no new event (no observer change is needed). When the raw ends both rewind to 0 and stop. Autoplay at an `IntersectionObserver` ratio of 0.6 (`IN_VIEW_RATIO`), pause out of view, resume unless `data-user-paused`, a rejected `play()` leaves the button on Play. Sound is off until pressed (`aria-pressed`), unmutes the larger side with ties to Finished, swaps across 50, never both. Only that side's caption track is active, with its mode `hidden`, and the script draws the active cue text in one unclipped overlay above the stage, so the clip never cuts a caption and the raw layer never covers the finished one.
- **Withdrawal** (G2). On a removal request: publish a new version (or set `SHOWCASE_VERSION` to `null`), then in one PR drop the withdrawn version from the committed table so the route answers 404, and delete that version's R2 folder. Both are done within 7 days. Copies already in a browser cache can persist up to a year (the immutable header), and the release says so. The first publish of a person who may later withdraw uses the same immutable header; Toyin may choose a shorter `max-age` for it (C1).
- **Loading code** (G29). `ShowcaseEnhance` renders nothing, watches the section with an `IntersectionObserver` of about one screen, then `import("./showcase/start")`. A bundle test (esbuild, minified, gzip, like `field-bundle.test.ts`) holds it to 6 KB.
- **Placement and copy** (G31, G32). `HomeShowcase` sits after `HomeReel` and before `HomeProof` with `id="before-after"`. `docs/design/home-v2.html` has no such section, so step 6 builds to `design.md` and the Mobbin references and records 390 and 1440 px screenshots for Toyin. All copy lives in one block in `content.ts`, proposed for Toyin: eyebrow "Before and after", heading "Same take. Raw, then finished.", "Raw", "Finished", "Play both videos", "Pause both videos", "Sound on", "Sound off", "Read the transcript", "Try it on yours", the failure line and "One sample take. Your results will differ."

**Choices for Toyin** (C1 to C6 in the review, with recommendations): who records; the studio background and whether captions are burned in (recommended: the catalog default and no); best of up to three runs; her approval of the final clip, captions, copy and screenshots before the launch PR; whether the lawyer wants a Privacy line about the featured person; play counts later.

**Critical test scenarios**:
- Section is present in the server HTML with the time saved text from the manifest, verifies **AC-1, AC-5**
- Arrow keys, Home and End move the slider and update the spoken value, pointer and touch drag work, verifies **AC-2**
- Play and Pause, start in view, reduced motion shows the poster only, the pair stays within 0.15 s, verifies **AC-3**
- Manifest numbers equal the real durations of the published MP4 files, and the WebM files match within the 100 ms tolerance (`ffprobe` in the publish script test with a fixture clip and a fake R2; `--verify` on the real files at publish against the printed manifest, and again in step 9 against the committed table), verifies **AC-4, AC-5**
- `savedLine` of 31.6 s raw and 19.4 s finished prints 0:32, 0:19 and 13 seconds, and the singular case reads "1 second saved", verifies **AC-5**
- No video request before the section is near the viewport, CLS 0, Lighthouse and the bundle check pass, verifies **AC-6**
- The route answers 206 for a Range request, 416 for a bad one, HEAD, 405 for POST, the immutable header, the fixed content type and no `Set-Cookie`, and 404s an unknown version or name; a scan finds no media files outside `public/home/`, `tests/fixtures/` and `assets/`, verifies **AC-7**
- Page text, alt text and manifest are scanned for names, verifies **AC-8**
- 390 px: no horizontal scroll, controls 44 px or larger, verifies **AC-9**
- The button goes to `/sign-in` (and later focuses the hero drop zone), verifies **AC-10**
- `pnpm legal:drift` is clean and no cookie or event appears, verifies **AC-11**
- Scripts off shows both videos with controls, verifies **AC-12**
- `LIFECYCLE_PREFIXES` never matches `showcase/` (like the `backgrounds/` test), the publish command refuses an existing manifest and defaults to a dry run, verifies **AC-13**
- Drift between the two videos stays at 0.15 s or less while both play (the first 4 s of the 8 s and 4 s WebM fixtures), then the finished video holds its last frame while the raw one finishes, a stall and recovery on one video resumes both, and a failed video shows the retry line, verifies **AC-3, AC-6**

## Build plan

Tracer Bullet: one real thread first (a clip in R2, a route, a section that plays it), then thicken.

1. Record and release (a human task for Toyin and Michael): the raw take on `/record`, the written release kept outside the repo, then a production run through the pipeline. Satisfies **AC-4, AC-8**
2. Publish script `scripts/showcase-publish.ts`: copies the raw and render out of R2 `originals/` and `renders/`, encodes the web files and poster, writes captions and the manifest, and refuses names. Confirms the sweep and lifecycle skip `showcase/`. Satisfies **AC-4, AC-7, AC-13**
3. Media route `GET /showcase/v1/[file]` with Range, caching and a zod checked manifest, with tests. Satisfies **AC-7**
4. Tracer: the server rendered section with two stacked videos, the clip wipe by the native range input and the time saved text, on the homepage. Satisfies **AC-1, AC-2, AC-5**
5. Playback: shared Play and Pause, in view start, keep in step, Sound, captions, reduced motion, lazy loading and the no script fallback. Satisfies **AC-3, AC-6, AC-12**
6. Phone layout, 44 px targets, Mobbin check, and a screenshot review at 390 and 1440 px by Toyin (the draft `docs/design/home-v2.html` has no such section, so there is no design check target). Satisfies **AC-9**
7. The "Try it on yours" button, the spec 0010 note and the "ten sections" comment in `home-page.tsx` (the list grows to eleven). Satisfies **AC-10**
8. Performance pass: bundle check, CLS, Lighthouse on production after merge. Satisfies **AC-6**
9. Playwright, axe, `pnpm legal:drift`, and `/check verify`. Then the launch PR (a human gate): Toyin approves the clip, captions, copy and screenshots, `SHOWCASE_VERSION` is set to `v1` and the manifest committed. Satisfies **AC-1 to AC-13**

## Consequences

**Positive**:
- The homepage shows real proof, not a claim, and the time saved is a measured number.
- No real person in the repo and no new vendor, cookie or event.
- The section can be refreshed whenever the pipeline gets better.

**Negative / tradeoffs**:
- A real person's face and voice become public, so the release matters and the clip should be replaced if they ask.
- The clip goes stale as the product improves, until someone reruns the publish command.
- Two videos on a weak phone use more battery. The section only loads and plays when in view.
- No view or play numbers, by design (E1).

**Neutral**:
- One Worker route and one R2 prefix are added.
- Spec 0010 AC-1 lists ten sections, and this makes eleven (a note, not a rewrite).

## Follow-up

- [ ] Toyin picks who records the clip and signs off the release (needs a human, recommended: a team member or friend, shown without a name).
- [ ] Confirm the clip length (about 30 seconds raw) and the 3 MB per file limit with the first real encode.
- [ ] Add the section to `docs/feature-map.md` when built, and the note to spec 0010.
- [ ] Toyin decides C2 to C6 in `docs/reviews/0025-spec-crosscheck.md` (recommendations are there), and Michael confirms the committed manifest design (G13).
- [ ] Decide later whether to add a server written count (E2) if Toyin wants play numbers.

## References

**Project sources**:
- Specs 0001 (stack, key prefixes), 0004 (pipeline), 0010 (landing page, Lighthouse and JS budget), 0013 (retention and the R2 backstop), 0016 (analytics), 0020 (smooth cuts), 0023 (Upload first, sign in after)
- `design.md` (sections and motion), `docs/design/home-v2.html`
- Commitments C-30, C-24 (coaches and consultants), C-29 (AI runs on the cloud path), C-39 (Mobbin fallback)

**Practices and standards**:
- WCAG 2.2.2 (pause, stop, hide) and the WAI ARIA slider pattern, a native range input as the base
- Immutable, versioned file names for long caching

**Mobbin references (web)**:
- ElevenLabs, "Change Background": Before and After pills in the top corners and one round handle on a vertical line. Shapes our labels and handle.
- Zillow, "Stage this space": the slider line with a round handle and a small status pill ("Virtually Staged"). Shapes the handle and the honest label.
- Customer.io, "Asset Optimizer": a Before, After and Side by side switch beside a "Savings 98%" row. Shapes the toggle fallback and putting the saving right next to the comparison.
- PlayAI, "Output": an Old and New switch above one player with a play button. Shapes the shared Play and Pause control.
