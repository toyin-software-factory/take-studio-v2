# Launch speed review: landing, sign in, library, take page, /record

Written for B2-T105. It looks at the pages a new creator meets first and asks whether they are fast on a mid phone.

## What was measured, and what was not

The sandbox cannot run a browser (no Playwright, no Lighthouse, no Chrome), so this review has real numbers for what a build can show and honest gaps for what only a browser can show.

| Measure | Status | How |
|---|---|---|
| JavaScript per route (first load) | Measured, before and after | `next build` (Turbopack) writes `.next/diagnostics/route-bundle-stats.json`: the chunks each route loads first. Raw size is the file size, gzip is each chunk compressed on its own. Same machine, same code, one change between runs. |
| What is in the shared chunks | Measured | Searched each chunk for library signatures (zod, Sentry, Better Auth, Radix, sonner, lucide). |
| Fonts, images, motion, layout shift setup | Read from the code | Compared with the vercel react best practices guidance. |
| Server data waterfalls | Read from the code, fixed | See "Server waterfalls". |
| LCP, CLS, TBT | Measured in CI (B2-T106), before and after B2-T105 | Lighthouse mobile on the built Worker, median of 3 runs per page. See "Lighthouse numbers". |
| INP, long tasks | **Not measured. Needs a real phone.** | See "Numbers that need a phone run" at the end. |

All build numbers are the production build with `PIPELINE_BUILD=1` (it only skips type errors). Nothing here used production data or a production sign in (C-31).

## Summary

- The homepage and sign in page were shipping the whole zod library (about 105 KB raw, 30 KB gzip) to check one email address. That is fixed: first load JS drops by 106 KB raw (30 KB gzip) on both pages.
- Three signed in pages waited for their own database read before the app frame started its own read. Those reads now run side by side (one round trip less before the first byte). No change to what shows.
- The rest of the first load is the framework, Sentry (already loaded after idle), Better Auth, and the app frame. Nothing else was a safe, no visual change win. The bigger items are listed for Michael.

## Per page

JS is first load JavaScript from `route-bundle-stats.json`, raw KB / gzip KB.

| Page | Before | After | Change |
|---|---|---|---|
| `/` landing | 686 / 212 | 580 / 182 | minus 106 raw, minus 30 gzip |
| `/sign-in` | 680 / 210 | 575 / 180 | minus 105 raw, minus 30 gzip |
| `/library` | 859 / 265 | 812 / 252 | minus 47 raw, minus 13 gzip (B2-T108) |
| `/takes/[id]` | 929 / 288 | 881 / 274 | minus 48 raw, minus 14 gzip (B2-T108) |
| `/record` | 897 / 280 | 851 / 267 | minus 46 raw, minus 13 gzip (B2-T108) |

LCP, CLS and TBT are in "Lighthouse numbers" below. INP and long tasks are not measured. The JS numbers are the proxy: less first load JavaScript is less to download, parse and run on a mid phone, which is what moves TBT and INP.

### Landing (`/`)

- **JS**: 580 KB raw after the fix. The homepage imports no signed in component. `gsap`, `lenis` and `three` are loaded with `import()` after hydration (`home/motion.tsx`), and `three` only when the browser can run the particle field, so none of them is in the first load.
- **Fonts**: `next/font/google` (`src/lib/fonts.ts`), one family (Inter Tight), latin only, weights 300, 400 and 500, `display: "swap"`. It is self hosted and preloaded by Next. Nothing to change.
- **Images**: `Picture` writes AVIF, WebP and JPEG sources with a srcset, a width and a height (so no layout shift from images), and only the hero image is `loading="eager"` with `fetchPriority="high"`. The rest are lazy. Nothing to change.
- **Layout shift**: the code already holds it down on purpose (the intro hides text with a class set before first paint, the fan sets its size in CSS, and `tests/home-details.spec.ts` "first paint" guards CLS 0 in CI). Nothing to change.
- **Changed**: `parseSignInEmail` (used by the closing form) no longer imports zod.

### Sign in (`/sign-in`)

- **JS**: 575 KB raw after the fix. The page is a small form plus the Better Auth client. It had the same zod cost as the homepage because `sign-in-state.ts` imported zod for one email check.
- **Changed**: the same fix. `EMAIL_PATTERN` in `src/lib/sign-in-state.ts` is a copy of zod 4's `z.email()` pattern. A unit test runs 23 sample addresses (dots, quotes, plus signs, hyphens, non ASCII, bad shapes) through both and fails if they ever disagree, so the behaviour is the same and cannot drift quietly. Trying `zod/mini` first only saved 21 KB, because it still carries zod's core, so the pattern copy was the better fix.

### Library (`/library`)

- **JS**: 859 KB raw. 280 KB of that is above the sign in base: the app frame (one 154 KB chunk shared by every signed in page: Radix pieces, sonner, lucide icons, the sidebar and user menu) and the library and upload code. The Better Auth client is already kept out of the frame (it loads on sign out), and Sentry loads after idle.
- **Waterfall (fixed)**: the page awaited the usage read, and only then returned the app frame, which then ran its own recent takes read. Two database round trips in a row before the first byte. Now the usage read starts first and an async child (`UploadWithUsage`) awaits it, so both run together. The takes list was already inside a `Suspense` and streams.
- **Nothing else safe**: the page is a server component; the client parts are the upload area and the take cards, which need to be interactive.

### Take page (`/takes/[id]`)

- **JS**: 929 KB raw, the heaviest page (it has the player, cut timeline, transcript, background picker and export).
- **Waterfall (fixed)**: take lookup, then the email setting read, then the app frame's recent takes read, all in a row. The take lookup has to come first (ownership check, and it feeds the frame's breadcrumb). The email setting read now starts right after it and is awaited in `TakeViewWithEmails`, so it runs beside the frame's read.
- **Long tasks**: not measured. See the bigger items.

### Record (`/record`)

- **JS**: 897 KB raw. The recorder is client code by nature (camera, `MediaRecorder`, wake lock, prompter), and the Deepgram follow my voice code is only reached when the toggle is used.
- **Waterfall (fixed)**: same pattern as the library, same fix (`RecordWithUsage`).
- **Long tasks**: not measured. The prompter keeps its position in a ref and moves one animation frame at a time, so it should not produce long tasks, but that is a reading of the code, not a measurement.

## B2-T108: full zod out of the signed in first load

**Route chosen: move the browser's response parsers to `zod/mini`.** The other route (parse on the server and send checked data) does not work here: the browser reads responses from routes the server owns, so the check at the client boundary would simply go away, and the rule is that every response is still checked there. `zod/mini` keeps the same checks with the same values passing and failing, and it is the same package (zod 4.x already installed), so no new dependency and no change to the legal facts. Server and job code keep full zod. No client schema is imported by server code.

**What changed.** 14 modules that the signed in pages reach: `take-api`, `background-api`, `background-preview-api`, `oauth-screen`, `api-keys-screen`, `prompter-storage`, `realtime-stream`, `site`, `upload-client`, and in `src/components/takes` only the import and schema lines of `email-switch`, `rename-form`, `use-change-render`, `use-usage` and `use-waveform`. The method style changes (`z.nullable(x)`, `z._default(x, v)`, `.check(z.minLength(1))`), nothing else. Local schemas are now exported so a test can reach them.

**Proof the answers did not change.** `src/lib/client-schema-oracle.ts` keeps the old full zod schemas word for word (only the test imports it, so it never reaches the browser). `src/lib/client-schemas.test.ts` runs every fixture, and every variation of it (each field dropped, nulled or given a wrong type or an odd number, an extra key added, arrays emptied or doubled), through the old and the new schema, and fails if the pass or fail answer or the parsed data differs in any case. It also checks the defaults of the take detail, and that `siteOrigin` answers as the old URL check did.

**First load JS, raw KB / gzip KB** (`next build`, Turbopack, same machine and code, one change between runs):

| Route | Before | After | Change |
|---|---|---|---|
| `/library` | 859 / 265 | 812 / 252 | minus 47 / minus 13 |
| `/takes/[id]` | 929 / 288 | 881 / 274 | minus 48 / minus 14 |
| `/record` | 897 / 280 | 851 / 267 | minus 46 / minus 13 |

The zod chunk went from 107,707 bytes (all of zod) to 60,864 bytes (the `zod/mini` core, 17.6 KB gzip). It is still in the first load of all three routes: the core, its checks and its error text are shared by every schema, and a bundler cannot drop them. So the saving is about 47 KB raw and 13 KB gzip per route, less than the 85 KB I hoped for from measuring one small schema alone. Dropping the rest would mean hand written response checks, which is not safe to do in one task.

## Server waterfalls: what changed

Before, on `/library`, `/record` and `/takes/[id]`: page read, then `AppShell`'s read, in a row. After: the page's second read starts first and is awaited in a small child component, with no `Suspense`, so the first paint and the streamed output are the same and the two reads overlap. The gain is one database round trip on every one of these pages (a few tens of ms on Neon through Hyperdrive, more when the database is cold; this is an estimate, not a measurement). `src/app/AGENTS.md` records the pattern so new pages follow it.

## Bigger items for Michael

1. **Done in B2-T108: full zod is out of the signed in first load.** What is left is the small core of `zod/mini` (see the next section). The remaining question is whether that core can go too, by checking the responses without a library.
2. **Done in B2-T154 (smaller than estimated): see "B2-T154" below.** Original note: take page and record page split points. Things that appear only after a click could load on demand with `next/dynamic`: the delete dialog, the background picker and its preview overlay, the export and transcript download panels. Probably 50 to 100 KB raw off the take page. Not done here: it can change when a dialog appears and would need the full browser suite to prove nothing moved, which this sandbox cannot run.
3. **Shared app frame chunk (154 KB).** Done in B2-T109, see "Shared app frame chunk (B2-T109)" below.
4. **Sentry** is already after idle and out of the first load. Nothing to do.
5. **Take page polling and the player** need a profile on a real mid phone before anyone changes them.

## Shared app frame chunk (B2-T109)

Question: what is in the frame chunk every signed in page loads, and what does not need to be there on first load? Rule: measure `/library`, `/takes/[id]` and `/record` before and after each change, and keep only changes that lower first load (B2-T107 showed that a small split can reshuffle the chunk graph and gain nothing).

### What was in it

From `next experimental-analyze` on the production build (modules that only the frame pulls in, raw sizes):

| Piece | About | Verdict |
|---|---|---|
| `sonner` plus the toast card and its icons | 34 KB | Moved out of first load (below). |
| `tailwind-merge` (through `cn`) | 27 KB | Used by every component. Cannot leave. |
| Radix select (`/record` only) | 19 KB | Kept: the device pickers are on screen in the first state of `/record`, so loading them later would make them pop in. |
| Radix menu, tooltip, dialog, dismissable layer, collection, floating UI | 5 to 13 KB each | Kept: the user menu, sidebar sheet and tooltips are in the frame itself, and the dialog is already needed by the sheet. |
| zod, react-dom, next internals | large | Not in scope (zod is B2-T108). |

### What changed

- **Toasts load after hydration.** `src/components/ui/sonner.tsx` is now a thin file: `Toaster` is `next/dynamic` with `ssr: false` and `notify` imports `sonner-impl.tsx` on demand. The impl holds sonner, the toast card and its icons. Behaviour is the same: `notify` waits until the toast region has mounted before it shows a toast, so a toast sent very early is never lost (it was never shown before the region existed either). No caller used the old return value, so `notify` now returns nothing.

### Numbers (first load JavaScript, raw KB / gzip KB, same machine, `next build` with `PIPELINE_BUILD=1`)

| Page | Before | After | Change |
|---|---|---|---|
| `/library` | 859 / 265 | 827 / 256 | minus 32 raw, minus 9 gzip |
| `/takes/[id]` | 929 / 288 | 897 / 278 | minus 32 raw, minus 10 gzip |
| `/record` | 897 / 280 | 866 / 271 | minus 31 raw, minus 9 gzip |

### Tried or weighed and not done

- Radix select on demand: 19 KB on `/record` only, but visible on first paint, so it would flash in. Not done (no visual change allowed).
- Tooltip and slider: the tooltip provider wraps the frame, and the slider is in the player controls, which show as soon as a take is ready. Not worth a split.
- `tailwind-merge`: would need a rewrite of `cn` across the app. Not safe here.

Proof of "no behaviour change" is the full Playwright suite in CI (the toast spec waits for the toast to be visible, and the homepage spec still checks that no toaster code is in its first load).

## Lighthouse numbers (B2-T106)

What was measured: the new CI job (`Lighthouse mobile`) builds the Worker, starts the preview with the synthetic test account and a seeded ready take, and runs Lighthouse 12 with the mobile profile (simulated slow 4G, 4x CPU slowdown). Each page runs 3 times and the median is shown. The "before" leg is the same commit with the four B2-T105 page files put back to their pre B2-T105 versions (`d8e57f5`: the zod email check on the landing and sign in pages, and the serial reads on the library, take and record pages). Both legs ran in the same CI run (43655994721) on shared GitHub runners, so only large gaps mean anything.

| Page | LCP before / after | CLS before / after | TBT before / after |
|---|---|---|---|
| Landing `/` | 3.41 s / 3.13 s | 0.000 / 0.000 | 99 ms / 133 ms |
| Sign in `/sign-in` | 1.39 s / 1.86 s | 0.000 / 0.000 | 35 ms / 44 ms |
| Library `/library` | 2.15 s / 2.58 s | 0.001 / 0.000 | 58 ms / 137 ms |
| Take page `/takes/:id` | 3.68 s / 3.64 s | 0.000 / 0.000 | 148 ms / 173 ms |
| Record `/record` | 2.75 s / 2.49 s | 0.000 / 0.000 | 116 ms / 144 ms |

How to read it:

- **No measurable gain, and the order is not stable.** Some pages look a little better after and some a little worse, in both LCP and TBT. That is the noise of a shared runner, not an effect of the change. The 106 KB of zod gzip (30 KB) removed from the landing and sign in pages is a small share of a page that Lighthouse already loads in about 1 to 3 seconds under simulation, and a single 3 run median cannot show it.
- **The take page is measured in its unavailable state.** The seeded take's video files are not in the CI bucket, so the player shows its own unavailable message. Its LCP and TBT do not include a playing video.
- **CLS is 0 everywhere**, before and after, as the code design intends.
- **What the numbers do give us** is a baseline: the take page is the slowest (LCP about 3.6 s, TBT about 150 to 170 ms), then the landing page (LCP above 3 s, driven by the hero image). Those are the pages to look at first.
- The server waterfall fix (one database round trip less) cannot show here: the CI database is on the same machine, so a round trip costs almost nothing. On Neon through Hyperdrive it is real, but this job cannot measure it.
- To get a trustworthy before and after, the next step is more runs per page or a quieter machine, or the real phone run below. The JS numbers earlier in this file remain the firm result.

## B2-T107: take page split tried, not kept

- **Delete dialog split tried, not kept.** The delete dialog is the only panel on `/takes/[id]` that appears only after a click. Loaded with `next/dynamic` (prefetch on hover and focus of its triggers), its chunk is 2.6 KB and it leaves the first load, but the chunk graph reshuffled and the route went from 929 to 932 KB raw (288 KB gzip both), so there is no gain and it was dropped. The Export panel is the default tab, so it is visible on first paint. The background picker is not on this page (it is in the upload area). The preview overlay and the transcript downloads are tiny. Radix Dialog is already in the shared frame chunk, so only the dialog's own code could move. So bigger item 2 above is mostly closed: nothing on the take page is big enough to be worth a split.

## Numbers that need a phone run

These cannot come from CI. Recommended:

1. **A real mid phone** (an Android phone around the Pixel 6a class) for INP and long tasks: `/record` through a recording (the prompter and the level meter), and the take page while it polls and plays. `docs/reviews/launch-device-pass.md` already has the device run; add "note anything that feels slow or janky" to its motion rows.
2. Compare with the Lighthouse baseline above.

## Choices made (C-30)

- **Pattern copy over `zod/mini`** for the email check: bigger saving (106 KB against 21 KB) and a test that pins it to zod.
- **No `next/dynamic` splits and no zod migration in this PR**: both are bigger than "small and safe" and cannot be proven here without a browser.

## B2-T154: click-only panels on the take page

Measured the same way as above (`PIPELINE_BUILD=1 next build`, `route-bundle-stats.json`, raw plus per chunk gzip), same machine, main at 0f36596 before and the branch after.

| Route | Before raw / gzip | After raw / gzip | Change |
|---|---|---|---|
| `/takes/[id]` | 851.6 / 266.0 KB (16 chunks) | 836.3 / 261.9 KB (17 chunks) | minus 15.3 raw, minus 4.1 gzip |
| `/library` (control) | 781.6 / 244.5 KB | 781.6 / 244.1 KB | no change |

What moved out of the first load (both with `next/dynamic`, `ssr: false`, nothing shown while loading):
- **The Background pane** (`BackgroundChange`: the picker grid, notes and the `use-background*` hooks). It is hidden until its tab is clicked. It starts loading when the browser is idle after first paint, or at once on hover, focus or selection of its tab, so a click rarely waits. It stays mounted (`forceMount`) once loaded, so nothing about the tab behaviour changed.
- **The delete dialog.** It mounts when the page is idle or the moment a delete is requested, so it opens with its focus and return focus as before.

Kept in the first load on purpose: the Export panel (the default tab, visible at first paint, splitting it would flash), the Transcript panel and its downloads (also `forceMount` and tied to the player bridge, and tiny), and the preview overlay (tiny, and the player needs it for the bridge).

The result is about 15 KB raw, well under the 50 to 100 KB estimate, because Radix, the icons and the shared hooks are in the frame chunk already. It is kept because it lowers first load and changes nothing visible. The browser checks (take page, delete, background, cut review, transcript, axe) are in the PR.
