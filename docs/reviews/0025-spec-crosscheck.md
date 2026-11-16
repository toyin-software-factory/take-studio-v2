# Cross check of spec 0025 (Before and after on the homepage), B2-T168, 2026-11-16

**Read by**: Dwight (sonnet), as the builder would, step by step through the 9 step build plan
**Scope**: `docs/specs/0025-before-and-after-homepage.md` against the code it will touch: `src/components/home/*` (`reel-video.tsx`, `tile-video.tsx`, `motion.tsx`, `motion/start.ts`, `home-page.tsx`, the tests next to them), `src/app/page.tsx`, `src/app/robots.ts`, `src/lib/{r2,site,storage-lifecycle,take-media,transcript-timeline}.ts`, `src/server/media/index.ts` and `src/app/api/takes/[id]/media/route.ts`, `src/trigger/cleanup.ts`, `scripts/{lighthouse-ci,lighthouse-gate}.ts`, `tests/fixtures/*`, `docs/design/home-v2.html`
**Question asked**: for every action in the build plan, is the source of each value it must produce named? Where it is not, the builder would invent it.

## Summary

The spec is sound on the idea (real pipeline output, versioned files, a slider over two videos) and on the numbers. It is thin on the plain plumbing around the media. I found **32 gaps** (G1 to G32). Each has one clearly right answer, because the code already settles it or the spec's own rules force it, so all are folded into the spec in this PR (marked **Folded**). Separately, **6 real choices** (C1 to C6) have no single right answer and are listed for Toyin at the end, each with a recommendation. The numbers (6 KB gzip, 3 MB per file, 60 KB poster, 0.15 s sync, Lighthouse 90, CLS 0.02) are untouched, and the status stays Proposed.

Six gaps would have caused a real bug or a failed gate if built as written:

1. **G13**: the homepage is `force-dynamic`. Reading `manifest.json` from R2 on every visit adds a network call to the page's first byte, and in CI, preview and the sandbox the bucket is a placeholder, so the section (and the page) would fail there. Folded: the manifest for each version is committed, only the media lives in R2.
2. **G14**: a `poster` attribute on a `<video>` downloads at page load even with `preload="none"`. Two posters would load on every visit, ahead of the section, against AC-6's "no video bytes until near the viewport". Folded: lazy `<img>` layers.
3. **G15**: in CI the poster and media requests would 404, which writes console errors, and the Lighthouse gate holds best practices at 100. Folded: CI serves synthetic fixtures like it already does for the take page.
4. **G6**: the R2 helper has no ranged GET, and the existing media route returns a presigned link, not bytes. The route is new code in `r2.ts`, not a reuse.
5. **G19**: the phone recording carries location, device and time metadata. Without an explicit strip, a real person's place would go on the public site.
6. **G26**: "Arrow keys move 5" cannot be done with a native range input at `step="1"`. It needs a key handler, and the spoken value then needs updating by script too.

## How to read the tables

Each gap shows **where it bites** (build step, AC), **what is missing**, and the **answer**. **Folded** means the answer is now in the spec. Step numbers are the spec's build plan.

## Gaps

### The clip, the release and the run

**G1. What the script and the frame may contain.** Step 1, AC-8. The spec says "a scripted 30 second take" but not what it may say or show. The words become public twice: in the captions and in the transcript.
Answer (**Folded**): the script is ours and says nothing about a real person, a company, a price or a result number. The frame shows no name, screen, document, badge or logo. The recorder reads the final transcript before publish and confirms in the release record that no name, employer, email, phone, handle or place is in it.

**G2. What the release says and where it lives.** Step 1, AC-8. "A written release kept outside the repo" has no content, owner or withdrawal path.
Answer (**Folded**): one page, in plain words: consent to use of face, voice and words on the homepage, worldwide, with no end date, and a right to ask for removal that we honour by publishing a new version and removing the old folder within 7 days. It is held by Toyin in her own storage. The step 1 hand off records only "release on file" and its date, never the name. Who records is C1.

**G3. How the raw and the finished are made the same way every time.** Step 1, AC-4. "AI cuts accepted as proposed, the default studio background, no hand editing" leaves open the look of the finished video: which studio, whether captions are burned in, whether smooth cuts (spec 0020) are on, and what the raw looks like if the keying needs a green backdrop.
Answer (**Folded**): the render uses the creator defaults a new account gets (smooth cuts as shipped, no manual range changes). The studio and the burned in captions are C2. The raw is shot against whatever backdrop that studio needs, and the page says nothing more than "Raw" for it: a green backdrop is the true "before".

**G4. Bad pipeline output and honest selection.** Step 1, AC-4. The AI step is not deterministic. If a run cuts mid word, does the team rerun until it looks good?
Answer (**Folded**): up to three runs of the same raw, publish the first that meets a written bar (no cut inside a word, at least 5 seconds saved, no failed step). The run count is written in the private publish log. Whether that is acceptable is C3.

**G5. Republishing after the take is gone.** Step 2, AC-13. Takes expire after 30 days and `originals/` has a 35 day backstop (spec 0013), so "republish from a take" works only for a month.
Answer (**Folded**): the raw master file (the phone original, not the web encode) is kept by Toyin next to the release. A later refresh uploads that file again as a new take on the staff account, runs the pipeline, and publishes `v2`. The publish command takes a take id and works inside its 30 days; after that the master is re uploaded first. The staff take is removed after publish (the normal 30 day expiry is fine).

### The publish script and the files

**G6. The R2 helper has no ranged read.** Step 3, AC-7. `createR2` in `src/lib/r2.ts` has head, presign, put and multipart, but no `getObject`. The existing media route (`src/server/media/index.ts`) returns a presigned link as JSON. The new route must stream bytes with `Range`, so it needs a new helper.
Answer (**Folded**): add `getObject(key, { range?, signal })` to `createR2`, returning the `Response` (status, `Content-Range`, `Content-Length`, body stream) with a 15 s timeout and no retry on a ranged read. The route builds its client the way `mediaHttpDeps` does. The helper has a unit test with a fake fetch.

**G7. Route behaviour at the edges.** Step 3, AC-7. "Range, 206, immutable, content type" leaves HEAD, suffix ranges, bad ranges, multiple ranges, other methods and errors undefined.
Answer (**Folded**): GET and HEAD only (other methods 405 with `Allow`). `Accept-Ranges: bytes` on every answer. A single range (`bytes=a-b`, `a-`, `-n`) answers 206 with `Content-Range`. A range past the end answers 416 with `Content-Range: bytes */size`. A multi range request is answered as a plain 200 of the whole file (files are 3 MB or less). R2 errors answer 502 with an empty body and no key in any log. The content type comes from a fixed map by extension in `src/lib/showcase.ts` (`mp4` `video/mp4`, `webm` `video/webm`, `webp` `image/webp`, `vtt` `text/vtt; charset=utf-8`, `json` `application/json`), never from R2's stored value. Every answer carries `X-Content-Type-Options: nosniff` and `Cross-Origin-Resource-Policy: same-origin`.

**G8. Route path, version and validation.** Step 3, AC-7. The spec writes `/showcase/v1/[file]` and also `/showcase/v2/[file]`. A route per version cannot exist.
Answer (**Folded**): one route, `src/app/showcase/[version]/[file]/route.ts`, `dynamic = "force-dynamic"`. `version` must match `^v[1-9][0-9]{0,2}$` and be a key of the committed table (G13); `file` must be in that version's file list. Anything else is 404 with the same empty body. It is unauthenticated and sets no cookie.

**G9. Edge caching.** Step 3, AC-7. `Cache-Control: immutable` caches in the browser. A Worker response is not cached by Cloudflare's CDN just because of that header, so every first visit by every browser reads R2.
Answer (**Folded**): browser caching only. No Cache API for media (ranges and 3 MB bodies do not fit it well). R2 reads over S3 cost operations, not egress, and at 3 MB or less per file this is cheap. Revisit only if the Cloudflare request count (E1) shows a problem.

**G10. Half published folders and overwrites.** Step 2, AC-13. A crash after three of nine uploads leaves a folder that looks real.
Answer (**Folded**): the script writes `manifest.json` last. It refuses to start if `showcase/<version>/manifest.json` already exists (a `HEAD`), takes the version explicitly (`--version v2`), and `--dry-run` is the default (it prints the plan and the manifest and writes nothing; `--write` is the flag that uploads). Since the route serves only versions in the committed table (G13), a half folder is never reachable.

**G11. Who runs the publish and with which keys.** Step 2, AC-13. Agent sandboxes carry no R2 write keys (and no database URL, per AGENTS.md).
Answer (**Folded**): a person runs it (Michael or Jim) on a machine with the production R2 keys, guarded like `db-guard.ts`: it refuses unless `SHOWCASE_PUBLISH_TARGET=prod` is set, and refuses any key not matching `showcase/v<N>/<fixed name>`. The agent's job is the code and its tests (with a fake R2 and a fixture clip), not the production run.

**G12. Encoding settings and the 3 MB ceiling.** Step 2, AC-7. "720p, H.264 and VP9, each file 3 MB or less" is a target, not a recipe. At 30 seconds, 3 MB is about 800 kbps for video and audio together.
Answer (**Folded**): 1280 by 720, 30 fps, `yuv420p`. MP4 is H.264 Main with `-movflags +faststart` (so the first bytes carry the index and a ranged start works) and AAC 64 kbps. WebM is VP9 constant quality with `-row-mt 1` and Opus 48 kbps. The script starts at a quality setting and raises the CRF in steps until a file is 3 MB or less, up to a fixed limit, then fails with the sizes. It never trims the video to fit. Keyframes every 2 seconds. The ffmpeg used is the pinned version in `src/trigger/AGENTS.md`, checked with `ffmpeg -version` and refused if it differs.

**G13. The manifest and the homepage.** Step 4, AC-1, AC-5, AC-6. The spec says the manifest is in R2 and "read" with zod. `src/app/page.tsx` is `force-dynamic`, so the page would call R2 on every visit (slower first byte, a new failure path), and CI, preview and the sandbox have a placeholder bucket, so the section, its tests and the Lighthouse run would break.
Answer (**Folded**): each version's manifest is also committed as a small typed constant in `src/lib/showcase-manifests.ts` (numbers, file names, the transcript text, no name, no take id, no date). The publish command prints the exact text to paste, and the PR that switches `SHOWCASE_VERSION` commits it. The page and the route read the committed table, zod checked at build and in a test. The R2 `manifest.json` stays as the record and as the `--verify` target. At publish, `--verify` compares the R2 manifest with the manifest text the publish command printed (that target exists then). After the launch PR commits the entry, step 9 runs `--verify` again against the committed table. Old versions stay in the table, so a cached page that names `v1` keeps working. This also means `SHOWCASE_VERSION` can be `null` before the first publish: the section is omitted, so steps 3 to 7 can merge before the clip exists. This is a design change to the spec's "manifest validated on read", flagged for Michael in the PR.

**G14. Posters load at page load.** Step 5, AC-6. A `<video poster>` is fetched immediately even with `preload="none"`. Two 60 KB posters would compete with the hero image on a phone.
Answer (**Folded**): no `poster` attribute in the stage. Each side has an `<img loading="lazy" decoding="async" width height alt="">` layer under its video, in WebP only (a `poster` attribute cannot use `<picture>`, and an image of 60 KB or less gains little from AVIF). Keys become `poster-raw.webp` and `poster-finished.webp` (two stills at the same second, so the wipe works before play). The videos keep `aria-label`s so the empty `alt` is right. The AVIF files are dropped from the list.

**G15. CI, Lighthouse and tests have no clip.** Step 4, 8, 9, AC-6. `scripts/lighthouse-ci.ts` already answers the take page's media with fixtures (`serveSyntheticMedia`). The new section's images would 404 there, write console errors, and fail the best practices gate (100).
Answer (**Folded**): committed synthetic fixtures in `tests/fixtures/showcase/` (made by a small ffmpeg script like `make-media.sh`: a test pattern and a tone, two clips at least 3 s apart such as 8 s and 4 s (the manifest rule needs finished at least 3 s shorter, so the test only `v0` entry passes the same zod check), each under 40 KB, no people), served by `context.route("**/showcase/**")` in Playwright and in `serveSyntheticMedia`. The e2e and Lighthouse runs use a fixture manifest version (`v0`, present in the committed table only under test) so the section renders. A repo scan (AC-7) allows media files only under `public/home/`, `tests/fixtures/` and `assets/`.

**G16. Which durations are "real".** Step 2, AC-4, AC-5. The manifest has `rawMs` and `finishedMs`, but the raw and the finished each exist in four forms (original, render, MP4, WebM), whose lengths differ by tens of milliseconds, and CI cannot read the real files.
Answer (**Folded**): `ffprobe` runs on the four encoded files inside the publish script. They must agree within 100 ms per video, else the script stops. The manifest takes the MP4 values. The numbers are rounded to whole seconds by the pure function in G24, and the rounded whole seconds must also be identical for MP4 and WebM (a 31.49 against 31.51 split fails the publish), so the page number is right for either format. The CI test covers the pure parts (rounding, zod, name list). The real check is `--verify`, which re downloads and probes, run at publish and in step 9.

**G17. Proof that both come from the same take.** Step 2, AC-4. The manifest has no take id, so nothing records it.
Answer (**Folded**): the script is given one take id and builds both source keys from it with the app's own key helpers, so mixing two takes is not possible. The take id, the render id and the run count are written to the private publish log kept with the release, not to the manifest and not to the repo.

**G18. Captions: who writes them and how.** Step 2, AC-3, AC-8. "Writes captions" has no source. The take page already exports captions (`src/lib/transcript-timeline.ts`, spec 0007) from the Deepgram words and the cuts.
Answer (**Folded**): the script converts the take's own exported SRT (the finished timeline for `finished.vtt`, the uncut words for `raw.vtt`) with a small pure SRT to WebVTT function. The recorder proofreads both before publish and may fix spelling in the file; they may not change meaning. The finished render has no burned in captions (C2 asks if Toyin wants them), so the tracks are not doubled.

**G19. Metadata in the phone file.** Step 2, AC-8. A phone recording carries creation time, device, and often GPS. The encode must not.
Answer (**Folded**): every ffmpeg call uses `-map_metadata -1 -map_chapters -1` with `-fflags +bitexact` (no encoder tag), and the script then runs `ffprobe` and fails on any location, device, creation time, comment or `com.apple.*` tag, allowing only the fixed `handler_name` and `language`. The stills come from the encoded file, not the original. The script also scans the caption and transcript text for emails, phone numbers, `@handles` and URLs and refuses on a hit, and takes an optional `--forbid "Name,Name"` list typed at run time so real names never sit in the repo.

**G20. Manifest content and shape.** Step 2, 4. The spec lists fields but not types and limits, and the page needs a transcript for AC-1.
Answer (**Folded**): strict zod object, `version` (`v<N>`), `rawMs` and `finishedMs` (integers, 1 to 600000, `finishedMs` less than `rawMs` by at least 3000), `cuts` (integer, recorded only, not shown), `width` 1280, `height` 720, `files` (the fixed nine names), `transcript` (the finished words as plain text, 2000 characters or less). Unknown keys fail.

### The route, the page and its failure modes

**G21. The page when media fails.** Step 5, AC-6, AC-12. "The poster shows" is the only behaviour named for a missing video.
Answer (**Folded**): a failed video (the `error` event, or a `play()` rejection that is not an autoplay block) leaves that side's still image in place and shows one plain line under the stage, "This video could not load. Try again.", with a Try again button (44 px) that reloads the sources. Both videos fail together or alone, the slider and the time saved text stay. If the still images fail too, the box keeps its `aspect-ratio` and a surface colour, so there is no layout shift. A manifest problem cannot happen at run time (G13), so the section never half renders.

**G22. No script and the stage markup.** Step 5, AC-12. The spec says both "the same markup stacks with controls" and "videos in `<noscript>`". Two mechanisms, and a `controls` attribute removed by script flashes the browser's bar over the stage.
Answer (**Folded**): one mechanism. The stage has no `controls`. A `<noscript>` block holds the two stacked `<video controls preload="metadata">` with their `src`, labels and `track`s. `@media (scripting: none)` hides the stage and its slider (the repo already uses `scripting` queries in `motion-fan.css`). Nothing in `<noscript>` is fetched when scripts run.

**G23. What the "transcript link" is.** Step 4, AC-1. There is no transcript page and a caption file served as `text/vtt` downloads in most browsers.
Answer (**Folded**): a native `<details>` ("Read the transcript") under the time saved line, filled on the server from the manifest's `transcript` (the finished words). It is in the HTML before any script. The AC wording "transcript link" is read as this disclosure.

**G24. Time saved: rounding and wording.** Step 4, AC-5. Rounding each number separately can show 0:32 raw, 0:19 finished and "12 seconds saved" (32 minus 19 is 13).
Answer (**Folded**): a pure `savedLine(rawMs, finishedMs)` rounds raw and finished to whole seconds first, then takes the difference of the rounded values, so the three numbers always add up. `m:ss` with a leading zero on seconds, singular "1 second saved", and the function throws (in the publish script's check, not at page time) when the difference is under 3 seconds. Tested with the 32, 19 case and the singular case.

**G25. Which way the slider points.** Step 4, AC-2. The spec says the clip is `inset(0 X% 0 0)` and the spoken value is "Showing 40 percent finished". With that inset, moving the handle right would mean less finished, which is backwards for a range input.
Answer (**Folded**): the value is the handle's position from the left, which is the share of the stage that shows Raw. `clip-path: inset(0 calc(100% - var(--pos)) 0 0)` on the raw layer with `--pos` set to the value. Default 50. Right arrow raises it. `aria-valuetext` reads "Raw 60 percent, finished 40 percent". The AC's example wording is updated to match.

**G26. Arrow step, valuetext and the knob.** Step 4, AC-2. A native range input at `step="1"` moves 1 per arrow key, not 5. `aria-valuetext` is not updated by the browser. The 44 px thumb and a visible line over a video cannot rely on the native thumb alone.
Answer (**Folded**): `step="1"` stays (so drag is smooth). A `keydown` handler moves arrow keys by 5 (and `preventDefault`s them), and Home and End stay native. The script sets `aria-valuetext` on every `input`. The input fills the whole stage with a transparent track, so a click or touch anywhere jumps the handle there, and `touch-action: pan-y` lets a vertical swipe still scroll the page on a phone. The visible line and knob are a separate decorative element positioned by `--pos`, and `input:focus-visible + .knob` draws the focus ring. The pills and the knob use token pairs listed in `src/app/design/contrast-table.ts` with a reason (a pill with a solid surface fill, so contrast does not depend on the frame under it).

**G27. Play, pause and the sync loop.** Step 5, AC-3. "A small loop keeps the finished within 0.15 s" does not say how, what happens on a stall, or what "mostly in view" means.
Answer (**Folded**): the raw video is the clock. While playing, a `requestAnimationFrame` loop compares `currentTime` of the two and, when the difference is over 0.15 s, sets the finished one's `currentTime` to the raw one's. It stops correcting once the finished one has ended (it holds its last frame). If either fires `waiting`, the other pauses until both can play. There is no seek bar, so there are no seeks. When the raw one ends both go back to 0 and stop, with the Play button showing (no loop). "Mostly in view" is an `IntersectionObserver` ratio of 0.6 (the `IN_VIEW_RATIO` already used in `tile-video.tsx`). Leaving the view pauses, coming back resumes unless the visitor paused (the `data-user-paused` pattern in `reel-video.tsx`). A rejected `play()` (low power mode) leaves the button on Play. The button is named "Play both videos" or "Pause both videos", at least 44 px, using the shared `h-media-toggle` class.

**G28. Sound and captions on two stacked videos.** Step 5, AC-3. "Sound plays the side the handle favors" has no tie rule, and two caption tracks in the same box overlap (the raw one is clipped, the finished one is under it).
Answer (**Folded**): both videos stay muted until the visitor presses Sound (a button with `aria-pressed`, "Sound on" or "Sound off"). It unmutes the side with the larger share, ties go to Finished, and moving the handle across 50 swaps which side is muted (never both unmuted). Captions follow the same side: that side's track is `showing` and the other is `hidden`, so only one line of text ever shows.

**G29. What loads and what runs before the section is in view.** Step 5, 8, AC-6. The spec has a server markup with a 6 KB budget, but the home page already ships its interactive code lazily (`motion.tsx` imports `motion/start` after hydration) and a React island would count in the first load.
Answer (**Folded**): the same pattern. The section is a server component. A tiny client component `ShowcaseEnhance` (renders nothing) uses an `IntersectionObserver` with a large `rootMargin` (about one screen) and then does `import("./showcase/start")`, a plain TypeScript module with no React and no animation library (`imports.test.ts` already forbids `gsap`, `lenis` and `three` outside `motion/`). That module sets `preload="metadata"`, wires the slider, the shared button, the sync loop and the sound button. A test in the style of `field-bundle.test.ts` bundles it with esbuild, minified, and asserts 6 KB gzip or less; the loader is counted too. No new global listener runs before the section is near.

**G30. Performance numbers that nothing measures.** Step 8, AC-6. `scripts/lighthouse-gate.ts` gates accessibility, best practices and SEO only. "Performance is not here on purpose" (it is noisy). So "Lighthouse 90 or more" has no check in CI, and CLS 0.02 is not measured either.
Answer (**Folded**): the spec's wording stays (it is measured on production after merge, as in spec 0010 AC-6), and step 8 states it plainly: the CI gates that apply are the 100s for accessibility, best practices and SEO on `/` with the section present, the bundle test, and a Playwright check that no `/showcase/*.mp4` or `.webm` request starts before the section is near the viewport and that the layout box of the section does not change height after load (CLS 0 by measurement). The production Lighthouse number is recorded in the task, not asserted in CI.

### Placement, copy and the rest

**G31. The section's place and the things that count the sections.** Step 4, 7, AC-1. `home-page.tsx` documents ten sections, the reel is a pinned scroll section at 810 px and up, and the page has anchors and skip links.
Answer (**Folded**): `HomeShowcase` goes in `home-page.tsx` right after `HomeReel` and before `HomeProof`, with `id="before-after"`, an `<h2>` and `aria-labelledby`. The nav is not changed. The comment in `home-page.tsx`, the spec 0010 note and `docs/feature-map.md` change in the same PR as the section. `src/app/robots.ts` disallows `/showcase/` (the route is media, not pages), no sitemap entry, no `VideoObject` in `json-ld.tsx` (no SEO claim is made for the clip). The heading may carry the existing `data-reveal-words` attribute but the section adds no motion code (no `gsap` outside `motion/`). It has no handle animation at all, which is what AC-3 means by reduced motion for the slider.

**G32. No reference design, and the copy list.** Step 6, AC-9. Step 6 says to design check against `docs/design/home-v2.html`. That draft has no such section (a search finds no before and after block), so there is nothing to compare against. The spec also gives the heading, the time saved line and the button, but not the eyebrow, the alt text, the error line or the button labels. Copy on this site is held in `src/components/home/content.ts`, with length limits checked by tests.
Answer (**Folded**): step 6 builds to `design.md`, the Mobbin references in the spec and the existing section styles, and records screenshots at 390 and 1440 px for Toyin (C4), in place of a design check against a draft that does not exist. All copy is one block in `content.ts`, proposed in the spec for Toyin to approve: eyebrow "Before and after", heading "Same take. Raw, then finished.", labels "Raw" and "Finished", "Play both videos", "Pause both videos", "Sound on", "Sound off", "Read the transcript", "Try it on yours", the failure line in G21, and "One sample take. Your results will differ."

## AC to test coverage

| AC | Test that proves it | Step | Status |
| --- | --- | --- | --- |
| AC-1 | Server render test: section, heading, labels, time saved line and `<details>` transcript are in the HTML string; signed in still redirects | 4 | **Added**: the render test and the redirect check are named in the spec |
| AC-2 | Playwright keyboard, pointer and touch on the slider, valuetext text, 44 px thumb, focus ring | 4 | **Added**: arrow by 5, Home, End, valuetext and `touch-action` |
| AC-3 | Playwright with fixture clips: shared button, start in view, reduced motion, drift of 0.15 s or less sampled five times only while both play (the first 4 s of the fixtures), then a separate check that the finished video holds its last frame while the raw one finishes, rewind, sound swap | 5 | **Added**: the sync and sound cases, using the WebM fixture because headless Chromium lacks H.264 |
| AC-4 | Publish script test (fake R2, fixture clip): durations agree within 100 ms, one take id, metadata stripped; `--verify` on the real files at publish | 2 | **Added**: CI covers the script logic, the real files are checked by `--verify` |
| AC-5 | Unit test of `savedLine` including the 32 and 19 rounding case | 4 | **Added** |
| AC-6 | Bundle test (6 KB gzip), no media request before near view, no height change after load, Lighthouse CI gates on `/`, production Lighthouse recorded | 5, 8 | **Added**: the production number is recorded, not asserted |
| AC-7 | Route tests (206, 416, HEAD, 405, 404, headers, content types) with a fake R2; repo scan for media files outside the allowlist | 3 | **Added** |
| AC-8 | Publish script refuses names, emails, phones, handles and URLs, strips metadata; manifest is a strict zod object; release record is a human check in step 1 | 1, 2 | **Added**: names cannot be tested in general, so the test covers patterns and fixed lists |
| AC-9 | Playwright at 390 px: no horizontal scroll, controls 44 px | 6 | Covered by the spec's scenario |
| AC-10 | Test that the button's `href` is `/sign-in` (and later focuses the drop zone) | 7 | Covered |
| AC-11 | `pnpm legal:drift` clean, no cookie header on the route and the section, no event call | 9 | Covered; the route test asserts no `Set-Cookie` |
| AC-12 | Playwright with JavaScript off: `<noscript>` videos with controls, labels, same text | 5 | **Added**: the `scripting` media query hides the stage |
| AC-13 | `storage-lifecycle.test.ts`: `showcase/` is not a lifecycle prefix; publish refuses an existing manifest; `--dry-run` is the default | 2 | **Added**: same shape as the existing `backgrounds/` test |

## Choices for Toyin

These have no single right answer. Each has a recommendation. None blocks the spec text: a build step stops only at the step it belongs to.

**C1. Who records the clip.** Options: (a) Toyin herself, (b) a team member, (c) a friend, with the release in each case. Recommended (a) or (b): the owner is the person most able to decide later to take it down, and the release is simplest when the signer is also the owner of the product. Needed before step 1 (human).

**C2. How the finished video looks.** Which built in studio background it uses, and whether captions are burned into the picture. Recommended: the first built in studio in the catalog, and no burned in captions (the page shows captions as tracks, so burning them in would double them and cannot be turned off). If Toyin wants burned in captions, the finished video gets them and the page shows the raw side's track only.

**C3. Choosing among reruns.** May the team rerun the pipeline on the same raw (up to three times) and publish the first result that meets the written bar in G4? Recommended: yes, with the run count in the private log. The page already says "One sample take", and the alternative is that one unlucky AI cut sits on the homepage for months. The strict alternative is one run only, whatever comes out.

**C4. Approval gate before launch.** Toyin watches the final raw and finished videos, reads both caption files and the transcript, and approves the copy list in G32 and the 390 and 1440 px screenshots, before the PR that sets `SHOWCASE_VERSION` merges. Recommended: yes. It costs a day and is the only point where a real face goes public.

**C5. A line in the Privacy notice.** The featured person is not a user, and their release covers consent, but a lawyer may want a line in the notice that a person appears on the homepage with consent. Recommended: ask the lawyer once; the spec keeps AC-11 (no copy change) true by default and the line becomes a follow up if the answer is yes.

**C6. Play counts.** Keep E1 (no new event) or add the server written count (E2) later. Recommended: keep E1 for now, as in the spec. The numbers would count requests, not people.

For Michael (technical, not for Toyin): G13 changes the spec to commit each version's manifest. The alternative is to keep reading `manifest.json` from R2 at render time with a short in memory cache and omit the section on failure. Recommended: the committed manifest, because it keeps R2 out of the page's critical path, makes the section testable in CI, and lets the section ship dark (`SHOWCASE_VERSION` null) before the clip exists.

## What is not a gap

- The numbers (6 KB gzip, 3 MB per file, 60 KB poster, 0.15 s sync, Lighthouse 90, CLS 0.02) are stated and untouched.
- Analytics: E1 is a decision, and spec 0016 already says no page view tracking.
- Abuse of the public route: files are 3 MB or less and the route is read only, so a rate limit is not needed at this size. Cloudflare's own rules cover a flood.
- Two decoders on a weak phone is a stated trade off (D1). Step 8 checks it on a real phone, as the launch device pass (B2-T164) did for recording.
- The `showcase/` prefix and the lifecycle rules: the sweep deletes by database key, not by listing a prefix, so it cannot reach `showcase/`. The lifecycle rules list their prefixes (`LIFECYCLE_PREFIXES`) and `showcase/` is deliberately absent, the same as `backgrounds/`. The test in AC-13 locks that in.
