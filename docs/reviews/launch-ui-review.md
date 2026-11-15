# Launch UI review (B2-T98)

Written for Michael. Plain words. This review covers every route in `src/app`. Playwright and a browser cannot run in the agent sandbox, so nothing here was checked by eye in a browser. Each row comes from reading the page code and from which Playwright tests already cover it. CI runs the tests, so the new ones are the proof for the pages that had none.

How each page was checked: title, one `h1`, a `main` landmark with a skip link, focus ring classes, 44 px targets (`pointer-coarse:min-h-11`), token colours only, and whether a test already runs axe (light and dark), a phone width check and reduced motion.

| Page | Route | Found | Fixed |
| --- | --- | --- | --- |
| Landing | `/` | Title, skip link and axe in both themes are covered by `home.spec.ts`. Reduced motion is covered by `home-motion.spec.ts`. | Nothing. |
| Sign in | `/sign-in` | Axe, states and the notice covered by `sign-in.spec.ts`. | Nothing. |
| Link expired | `/sign-in/link-expired` | Covered by `sign-in.spec.ts` and `pages-v2.spec.ts`. | Nothing. |
| Library | `/library` | Axe covered by `takes.spec.ts` and `shell.spec.ts`. | Nothing. |
| Take page | `/takes/[id]` | Axe, keyboard and the timeline covered by `cut-review.spec.ts` and the take specs. | Nothing. |
| Record | `/record` | Axe, keyboard and Pixel 7 covered by `record-a11y.spec.ts`. | Nothing. |
| API keys, connected apps, delete account | `/account/api-keys` | Covered by `api-keys.spec.ts`, `connected-apps.spec.ts` and `delete-account.spec.ts`. | Nothing. |
| OAuth consent | `/oauth/consent` | Covered by `oauth-consent.spec.ts`. | Nothing. |
| API docs | `/docs/api` | Axe and phone width covered by `api-docs.spec.ts`. | Nothing. |
| MCP docs | `/docs/mcp` | Axe covered by `mcp-docs.spec.ts`. | Nothing. |
| Privacy and Terms | `/privacy`, `/terms` | Covered by `legal-pages.spec.ts` (axe both themes, one `h1`). | Nothing. |
| Not found | any missing route | Had no test of its own. Page code is sound (title, `h1`, main, 44 px button). | New test in `tests/launch-pages.spec.ts`: title, one `h1`, main, phone width, axe light and dark. |
| Turn off take emails | `/emails/off/confirm` | Had no test. Page code is sound. | Same new tests, for a valid and a bad link. |
| Take emails result | `/emails/off/done` | Had no test. The "Go to Take Studio" link had no 44 px target on a touch screen. | Link now has `pointer-coarse:min-h-11`, and a test checks it on a Pixel 7. |
| Insights | `/insights` | Private page for one viewer. No axe test, because a test needs the viewer id set in the test environment. | Nothing. Listed below. |
| App error and global error | `error.tsx`, `global-error.tsx` | Page code is sound (heading, Retry, 44 px target, token colours). A test needs a thrown render error. | Done: `tests/insights-errors.spec.ts` (B2-T99) covers `error.tsx`; `tests/global-error.spec.ts` (B2-T155) covers `global-error.tsx`. |
| Design gallery | `/design` | Development only, 404 in production. Covered by `design.spec.ts`. | Nothing. |

## Bigger items for you to turn into tasks

1. Insights has no axe or phone test. It needs a test viewer (`INSIGHTS_VIEWER_IDS` style env in the Playwright server) so a signed in test can open it.
2. **Done (B2-T99 and B2-T155).** The two error pages had no test. A small route that throws only when `NODE_ENV` is test, or a Playwright `route` that makes the take API throw during render, would let axe check them.
3. Steps in [launch-manual-pass.md](./launch-manual-pass.md) (B2-T164). A real browser pass by someone with eyes on a phone (iOS Safari and Android Chrome) on the landing page, the record page and the take page. The sandbox cannot do this and axe does not catch it all (reading order, motion that feels too much).
4. Reduced motion has a test only on the landing page, the recorder and the design components (the cut timeline one is in #294). The other pages use the one global CSS rule, so risk is low, but nothing asserts it.
5. Steps in [launch-manual-pass.md](./launch-manual-pass.md) (B2-T164). A screen reader pass (VoiceOver and NVDA) on the cut timeline and the recorder. Automated checks cannot judge how the announcements sound.

## Not done

I did not run the `web-design-guidelines` skill page by page in a browser, and I did not capture screenshots, for the reason at the top. If you want that, it needs a machine where Playwright runs.
