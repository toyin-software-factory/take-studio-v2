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
| LCP, CLS, TBT or INP, long tasks | **Not measured. Needs a CI run or a real phone.** | See "Numbers that need a CI or phone run" at the end. |

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

LCP, CLS and TBT or INP: before and after are both "not measured here" for every page (see the last section). The JS numbers are the proxy: less first load JavaScript is less to download, parse and run on a mid phone, which is what moves TBT and INP.

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
2. **Take page and record page split points.** Things that appear only after a click could load on demand with `next/dynamic`: the delete dialog, the background picker and its preview overlay, the export and transcript download panels. Probably 50 to 100 KB raw off the take page. Not done here: it can change when a dialog appears and would need the full browser suite to prove nothing moved, which this sandbox cannot run.
3. **Shared app frame chunk (154 KB).** Worth a bundle analyser pass in CI (`@next/bundle-analyzer` with Turbopack is not wired up) to see whether Radix select, tooltip and slider or the full sonner toast are needed on every page. Icons are imported by name already.
4. **Sentry** is already after idle and out of the first load. Nothing to do.
5. **Take page polling and the player** need a profile on a real mid phone before anyone changes them.

## Numbers that need a CI or phone run

These cannot come from this sandbox. Recommended, in this order:

1. **Lighthouse mobile in CI.** Add a job in the pinned Playwright image that builds the Worker, starts `pnpm preview` with the synthetic test account, and runs `lighthouse` (mobile profile, simulated slow 4G, 4x CPU slowdown) on `/`, `/sign-in`, `/library`, a seeded ready take and `/record`. It gives LCP, CLS and TBT per page. The signed in pages need the test session the Playwright setup already makes (`tests/support/session.ts`).
2. **A real mid phone** (an Android phone around the Pixel 6a class) for INP and long tasks: `/record` through a recording (the prompter and the level meter), and the take page while it polls and plays. `docs/reviews/launch-device-pass.md` already has the device run; add "note anything that feels slow or janky" to its motion rows.
3. After 1 and 2, compare with the JS numbers above: the landing and sign in pages should already show the effect of this PR in TBT.

## Choices made (C-30)

- **Pattern copy over `zod/mini`** for the email check: bigger saving (106 KB against 21 KB) and a test that pins it to zod.
- **No `next/dynamic` splits and no zod migration in this PR**: both are bigger than "small and safe" and cannot be proven here without a browser.
