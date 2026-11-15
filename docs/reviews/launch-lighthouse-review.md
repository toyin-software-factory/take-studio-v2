# Launch Lighthouse review: accessibility, best practices and SEO

Written for B2-T111. The Lighthouse job from B2-T106 now also scores accessibility, best practices and SEO on the same five pages, and lists every audit that did not pass in the job summary.

## What was measured

- The CI job `Lighthouse mobile` (run 43657403322 on PR #312): Lighthouse 12 on the built Worker, mobile profile, 3 runs per page, the median score shown. The take page is a seeded synthetic take. No production sign in, no real data.
- Report only. A score never fails the job. It fails only when a page does not load. A quality score that Lighthouse cannot compute shows as `n/a`, it is not treated as a failed load.
- The job summary has a table of the three scores and a "Failed audits" list (audit id, category, how many items). It never prints the items themselves, only counts. The full HTML and JSON are in the `lighthouse-reports` artifact.

## Scores (before and after)

Nothing real needed fixing, so before and after are the same. Everything that did not score 100 is explained below.

| Page | Accessibility | Best practices | SEO |
|---|---|---|---|
| Landing `/` | 100 | 100 | 92 |
| Sign in `/sign-in` | 100 | 100 | 63 |
| Library `/library` | 100 | 96 | 63 |
| Take page `/takes/:id` | 100 | 96 | 63 |
| Record `/record` | 100 | 100 | 63 |

## Every failed audit, and what we did

| Page | Audit | Verdict |
|---|---|---|
| Sign in, library, take page, record | `is-crawlable` (SEO), "Page is blocked from indexing" | **Intended, not changed.** These pages are private or have nothing to index. They send `noindex` on purpose (and are listed in `PRIVATE_PATHS` in `src/lib/site.ts`, which `robots.ts` also keeps out of the sitemap). The SEO score of 63 on these four pages is only this one audit. Making them indexable would be wrong. |
| Library | `errors-in-console` (best practices), 1 item | **Test setup, not a product bug.** The seeded take has no files in the CI bucket, so its thumbnail request answers 503. Real takes have thumbnails. Nothing to fix in the app. |
| Take page | `errors-in-console` (best practices), 3 items | **Same cause.** The thumbnail and the play file of the seeded take answer 503 (the page already shows its own "unavailable" state). The three items are those requests. |
| Landing | `link-text` (SEO), 1 item | **Real, but a visual change, so listed and not changed.** On a phone width the header button shows only "Start" (the long label "Upload a take" is hidden by CSS at phone width, `h-cta-short` in `home.css`). Lighthouse's list of vague link texts includes "start", and it reads the visible text, so an `aria-label` would not clear it. See the recommendation below. |

### Recommendation for Michael (not done, needs a design decision)

Change the short header button label on `/` from "Start" to "Upload" (`src/components/home/nav.tsx`, the `h-cta-short` span). It is one word, fits the same space, says what the button does, and is not on Lighthouse's vague list. That would take the landing SEO score to 100. It is a visible copy change on the landing page, so it needs your yes first (the reference is the landing design draft). I did not change it.

## Where Lighthouse and axe disagree

They do not disagree on anything today. Lighthouse accessibility is 100 on all five pages, and the Playwright axe checks (`tests/pages-v2.spec.ts` and the page specs) are also clean. Two differences to know about:

- Lighthouse's accessibility score runs a smaller axe rule set than our Playwright runs, so a 100 here is weaker proof than the axe specs. Keep the axe specs as the gate.
- Lighthouse looks at the page as loaded, once. It does not open the menu, a dialog or the delete confirm, which our specs do.

## What was not checked

Tap target size (our 44 px rule): Lighthouse reports no failure on any page, and the 44 px rule stays covered by our own specs. Image aspect ratios, deprecated APIs and the meta description, title and canonical on the landing page showed no failed audit. Contrast passed on all five pages in the default state only, not in hover, focus or error states.
