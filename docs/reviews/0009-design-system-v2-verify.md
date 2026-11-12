# Verify: design system v2, spec 0009

**Verdict: pending the browser run for AC-4 to AC-7 and AC-10.** AC-1, AC-2, AC-3, AC-8 and AC-9 are met with evidence recorded below.

Run on 2026-11-12 against main at `2c49e0f` (parts 1 to 3 merged) plus the part 4 branch (PR #134). I built the real Worker (`pnpm build:worker`, the same build CI makes), served it with `opennextjs-cloudflare preview` on workerd, used a local Postgres, and drove it with Playwright one worker at a time. Users and takes are seeded test data and the media is a synthetic clip, so no real account, footage or personal detail is involved or kept here.

## Result per acceptance criterion

| AC | What it asks | Result | Evidence |
| --- | --- | --- | --- |
| AC-1 | Every `design.md` §2 token is a CSS variable mapped into the Tailwind `@theme` and shadcn's names; the v1 palette is gone; no component uses a raw hex value | Met | In the browser, all 114 custom properties named in design.md §2 resolve to a value on `:root` (0 missing). The two built CSS files contain none of the v1 values (`780000`, `c1121f`, `fdf0d5`, `003049`, `669bbc`) and no "JetBrains". Unit: `src/app/design/tokens.test.ts` compares every §2 token with `globals.css` (canonical values), and fails on a hex colour in any `.tsx`, on any v1 value in `src`, and if the v1 appendix returns. |
| AC-2 | Inter Tight 300, 400 and 500 through `next/font` (self hosted, swap, latin), no layout shift, no JetBrains Mono, tabular numbers for times | Met | Page `/sign-in` on the built Worker: font faces Inter Tight 300, 400 and 500 all declared with `display: swap` and loaded; the only host contacted is the app's own origin (no Google); cumulative layout shift 0; body font is "Inter Tight" at weight 300; no JetBrains face exists. `tests/design.spec.ts` checks tabular numbers on the `mono` utility and no layout shift on `/design`. |
| AC-3 | Base components restyled with every state: primary pill 40 and 48 px, primary on dark, ghost pill on dark, text link, inputs with a bottom border, chips, pill tabs, dialog and sheet, toast and alert, skeleton on light and dark; hover, pressed (`scale(.98)`), focus, disabled and loading all exist | Met | On the built `/design` gallery: default button 40 px and large button 48 px, corner radius is full pill; while the mouse is down the button's `scale` is 0.98; an input has borders 0, 0, 1, 0 px (bottom only) and is 48 px tall; a tab has a full pill radius; the pressed chip is ink with white text (`aria-pressed="true"`); the dialog radius is 12 px. The gallery shows hover, pressed, focus, disabled and loading samples for buttons, the stage variants (white pill, glass ghost pill), inputs, alerts, toasts and skeletons on light and inside the dark stage (see AC-10 for the gallery tests). |
| AC-4 | App shell: 264 px sticky sidebar from 1024 px, sheet menu below, sticky glass top bar, skip link | Pending the run | |
| AC-5 | Take page: dark stage with player and glass transport, summary line, inspector tabs, every existing behaviour works, nothing from later slices | Pending the run | |
| AC-6 | Library, upload, sign in, error and not found pages on the v2 shell, type and components | Pending the run | |
| AC-7 | Focus is a visible 2 px ring with a 3 px offset (ink on light, lime on dark), keyboard use, dialogs trap and restore focus, icon only buttons named, targets at least 44 px | Pending the run | |
| AC-8 | Contrast meets WCAG AA for every text pair used: lime never text on white, muted never lighter than `#4f4f4f` on white or white at 75 % on dark, weight 300 only at 16 px and up, status always an icon plus a label | Met | Unit: `tokens.test.ts` computes the contrast of every pair design.md relies on (translucent colours flattened over their background), keeps the lime accent failing as text on white (1.1 to 1) and muted text on white at 8 to 1. Browser, on the built Worker: a scan of every visible text node for weight at or below 300 under 16 px, and for any text coloured lime on a light surface, found 0 problems across 41 texts on the library, 57, 47, 47 and 60 on the take page tabs (Export, Background, Transcript, Details), 779 on `/design`, 5 on the not found page, 8 on sign in and 9 on link expired. Status badges and recent take lines carry an icon with the label (`status-badge.tsx`, `recent-takes.tsx`). axe is part of AC-10. |
| AC-9 | Signed in pages load no `gsap`, `lenis` or `three` code (checked in the build output); all motion respects reduced motion | Met | Build output: the 27 client scripts in `.open-next/assets` carry none of the markers for GreenSock, `gsap.registerPlugin`, WebGLRenderer, `THREE.REVISION` or Lenis class names. `tests/pages-v2.spec.ts` also checks that only `src/components/home/` may import the three libraries and that the scripts a signed in `/` and take page really load contain none of the markers. Reduced motion: `tests/design.spec.ts` "stops every running animation under reduced motion" (the global rule sets durations to 1 ms). None of the three is a dependency yet, so today this guards the homepage work. |
| AC-10 | The `/design` gallery shows every v2 component and state on light and dark, keeps its access rule (development and preview only, noindex), axe on it and on the restyled pages reports no serious or critical issues | Pending the run | |

## Specced surfaces

Pending the run.

## Gaps found, and how they were closed

Pending the run.

## Checks run

- Build: `pnpm build:worker` succeeded (two earlier attempts in this sandbox failed at the Next type check for a reason I could not reproduce with `tsc` or a direct `next build`, both clean; the third attempt, with nothing else running, built).
- Measurements for AC-1, AC-2, AC-3, AC-8 and AC-9: a throwaway Playwright spec (not committed) against the built preview.

## Worth knowing

- Neither `gsap`, `lenis` nor `three` is installed yet, so AC-9's build check proves their absence today and will start to bite when the homepage adds them.
- The breadcrumb publish, tab behaviour and tab hydration helpers are described in `src/components/AGENTS.md` and `src/components/takes/AGENTS.md`.
