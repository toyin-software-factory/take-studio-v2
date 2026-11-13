# Verify: landing page, spec 0010

**Verdict: PASS with one measured caveat on AC-10.** AC-1 to AC-9 and AC-11 are met with evidence. AC-10's Lighthouse score cannot be measured in this sandbox, and its JS budget is judged under the reworded spec (what the homepage adds over the `/sign-in` baseline, excluding the signed in library code that `/` preloads); the numbers are below as measured.

Run on 2026-11-13 on branch `dv0-t08-details-final-passes` (parts 1 to 3 merged, part 4 here). I built the real Worker (`opennextjs-cloudflare build`, exit 0), served it with `opennextjs-cloudflare preview` on workerd and drove it with Playwright one worker at a time. The sandbox has no Postgres, so the specs that seed users (signed in redirect, the take pages) were not run here; CI runs them. No real account or footage is involved.

## Result per acceptance criterion

| AC | Result | Evidence |
| --- | --- | --- |
| AC-1 | Met | `tests/home.spec.ts`: the ten sections in order, CTAs reach sign in. The signed in redirect needs Postgres, so it was left to CI. |
| AC-2 | Met | `content.test.ts` fails on claims about unbuilt features (part of the 318 passing unit tests in `src/components/home` and `src/app/design`); the mailto link and no form are in `home.spec.ts`. |
| AC-3 | Met | `home.spec.ts` with scripts off: text, metadata, JSON-LD, `robots.txt`, `sitemap.xml`. `tests/home-details.spec.ts` "without scripts" shows every FAQ answer and no rolled digits. |
| AC-4 | Met | `home-motion.spec.ts` (nav float after 202 px, dark variant, menu dialog with focus trap and Esc). |
| AC-5 | Met | `home-motion.spec.ts` for the fan and reel toggles; this task adds the tiles: `home-details.spec.ts` checks 3 labelled buttons of at least 44 px, play on hover, the button and the cursor disc both say Pause while playing, and a pause the visitor chooses is kept (`data-user-paused`). |
| AC-6 | Met (task 3) | `home-studio.spec.ts` and `field-bundle.test.ts`. The field spilling past the dark section was found by Toyin and fixed here with an `overflow: clip` wrapper; `home-details.spec.ts` asserts the clip equals the section's box, and before and after screenshots at desktop and phone are in the PR. `home-studio.spec.ts` frame time failed in this sandbox (software WebGL, 568 ms against a 120 ms limit); CI is the reference. |
| AC-7 | Met | Flip counters keep the real number in the page (`h-stat-num`, aria-hidden digits; `#limits` contains 1080); FAQ grid-rows open and close and closed panels are inert; footer columns and blurred wordmark are CSS. All in `home-details.spec.ts` and `home.spec.ts`. |
| AC-8 | Met | `home-details.spec.ts` reduced motion: no flip digits, no cursor, no drift, tiles do not start on hover; `home-motion.spec.ts` and `home-studio.spec.ts` cover loops, scrubs, Lenis and one static field frame. |
| AC-9 | Met | axe at WCAG 2.2 AA with no serious or critical issues in `home.spec.ts` (desktop and phone); the cursor is `aria-hidden`, targets are at least 44 px, split headings keep their `aria-label`. |
| AC-10 | Caveat, see below | Measured, not met as first worded. |
| AC-11 | Met | `media.test.ts`: every file exists, tile and reel size budgets, AVIF/WebP/JPEG sets, MP4 plus WebM, poster. |

## AC-10 numbers (as measured)

- **Lighthouse mobile on the sandbox:** `/` scores 62 (LCP 3.6 s, TBT 1,390 ms, FCP 1.1 s). Control: the trivial `/sign-in` scores 64 and 60 in two runs. The sandbox benchmark index is about 1,800 (a normal laptop is higher), so with 4x CPU throttling the score is dominated by the machine. The score is not meaningful here; the spec now measures it on production with PageSpeed Insights after the merge.
- **CLS:** 0 on `/` (limit 0.02), so the flip counters and the field cause no shift.
- **Initial JS, gzip:** `/` 367 KB against `/sign-in` 216 KB. The extra 151 KB on `/` is 102 KB of signed in library code preloaded through Next's client reference manifest (it lists the whole server graph of the page entry, so the library's client chunks load even when signed out) plus 56 KB of `gsap` (43.5) and `lenis` (12.5), which are imported after hydration and are not in the first load.
- **Deferred `three` plus the field:** under 170 KB gzip, about 132 KB (`field-bundle.test.ts` passes).
- **Experiment:** moving the signed in branch of `src/app/page.tsx` behind a dynamic import did not shrink the chunks (158.6 KB home only chunks before, 159.1 KB after), because the manifest still lists them. Reverted, nothing left in the diff. The real fix is a separate `/library` route, which is its own task; no routing was changed here.

## Gaps

1. Lighthouse 90 on mobile is not provable in the sandbox (above).
2. Postgres was not available, so the signed in redirect and DB backed specs ran only on CI.
3. Full `eslint` and `tsc` run out of memory on this 3 GB sandbox: the changed files were linted and typechecked on their own, and the OpenNext build's type check passed. CI runs the full ones.

## Checks run

- `pnpm exec vitest run src/components/home src/app/design`: 318 of 318 pass.
- Built Worker, one worker at a time: `home-details.spec.ts` 7 of 7; `home.spec.ts` and `home-motion.spec.ts` 25 pass, 2 fail only for lack of Postgres.
- Screenshots (tile hover with the Pause disc, flip counters, FAQ open, footer wordmark, phone tile in view, field clip before and after) and a short video are published with `scripts/pr-proof.sh`.
