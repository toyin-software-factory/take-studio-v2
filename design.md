# Take Studio design (v2)

The design system every screen follows. Toyin's v2 design, decided in spec 0009 (`docs/specs/0009-design-system-v2/index.md`), which replaces spec 0003. The homepage is built from spec 0010 (`docs/specs/0010-landing-page.md`). Before building or changing any screen, read this file and pull fresh Mobbin references for the pattern you are building (team rule); link them in the PR.

Reference drafts (open them in a browser): `docs/design/home-v2.html` (homepage, Toyin's draft; its images and videos are approved for publishing) and `docs/design/take-page-v2.html` (take page; personal content replaced with placeholders, so the grey boxes stand for video frames and studio images).

## 0. Take Studio decisions (read first; they override anything below)

- **Moving content can be stopped.** The hero fan loop and any other motion that runs longer than 5 seconds next to content has a visible pause and play toggle (WCAG 2.2.2), as well as honouring reduced motion.
- **The HTML drafts in `docs/design/` are visual references, not code to copy.** Their scripts have known accessibility gaps (CodeRabbit on PR #121: icon buttons without names, `aria-hidden` over buttons, the drawer focus trap). Build to the rules in this file and the specs.
- **One look, two levels of motion.** The tokens, type, buttons, links, focus rings and form rules in §2, §3 and §5 apply to the whole app (signed in screens included). The spectacle (fan loop, reel expansion, particle field, giant words, cursor follower, edge blur, Lenis smooth scroll, GSAP) is for the homepage only. Signed in screens use plain CSS transitions from the §6 tokens and never load `gsap`, `lenis` or `three`.
- **Stack.** Keep Next.js, Tailwind CSS v4 and shadcn/ui (spec 0001, spec 0003's toolkit). The §2 tokens become CSS variables mapped into the Tailwind `@theme` and shadcn's names; no screen uses a raw hex value. Fonts load with `next/font` (Inter Tight 300, 400, 500, self hosted at build time), not hand placed woff2 files. Add `gsap`, `lenis` and `three` as pinned dependencies, imported only from homepage client components (`three` dynamically).
- **Homepage sections** follow `docs/design/home-v2.html`, not the generic page map in the original draft: see the reconciled table in §4.
- **Copy describes only what works today.** A line about a feature that isn't built (the cut review timeline, undoing a single cut, AI agents choosing cuts, the monthly limit) is reworded to today's behaviour and updated when its slice ships. "Coming soon" stays only where the draft already says it (the API and MCP server).
- **No form on the homepage.** The draft's "Early access" section becomes the closing call to action: "Upload your first take" (to sign in) plus "Questions? hello@takestudio.app" (a `mailto:` link). Sign up stays open; there is no invite list.
- **Signed in screens show only built features.** Parts of the take page draft that belong to later slices (monthly minutes meter, "API and agents", Backgrounds page, Settings, Copy link, playback speed) are left out until their slice ships, and then built into this layout. The cut timeline and the pending changes bar are built (spec 0011, S4C-T03). No disabled "Soon" placeholders in the app.
- **Status colours** (from v1, checked on white): success `#2E6B3F` (6.4:1), warning `#8A5A00` (5.9:1), error `#9B0D18` (8.5:1). Small labels and icons only, always an icon plus a label, never colour alone.
- **No dark mode** for the app. The dark stage (player panel, homepage studio floor, footer) is part of the one theme.
- The `/design` component gallery (spec 0003 AC-7) stays, restyled with the v2 tokens.

## 1. Direction

Take studio v2 should feel like a calm Swiss product shell that opens onto an electric "studio floor". The top of the page is white, typographic and quiet. As you scroll, a convex dark arc rises into a black stage where a scroll-driven particle field changes shape behind frosted glass. The one big idea is **light shell, dark stage**. Restraint above the fold earns the spectacle below it, and colour comes only from product content (fan cards, video) and the WebGL light, never from UI chrome. Avoid gradients on UI, multiple accent colours, bouncy or overshooting easing, and centred body copy beyond the hero. Do not copy any reference's head model, wordmark or headline.

> Original note (now resolved in §0 and §4): the page map was written without the repo; §4 below is reconciled with the routes.

## 2. Design tokens

```css
:root {
  /* ---------- Colour: light shell (Source: WAMA) ---------- */
  --color-bg: #ffffff;
  --color-surface: #f6f6f6; /* fan panel bg (inferred from screenshot) */
  --color-ink: #030303; /* primary text, primary buttons */
  --color-ink-soft: #252528; /* button hover, dark secondary surface */
  --color-text-muted: #4f4f4f; /* first (muted) half of two-tone headlines, body on white */
  --color-line: #d2cdd8; /* hairlines, input underlines, chip borders */
  --color-line-strong: #767676; /* form borders needing 3:1 */
  --color-hairline: rgba(0, 0, 0, 0.08);

  /* ---------- Colour: dark stage (Source: Vexel, Redstone) ---------- */
  --color-dark: #010101;
  --color-dark-2: #0f0f0f; /* tiles, footer panels */
  --color-on-dark: #ffffff;
  --color-on-dark-75: rgba(255, 255, 255, 0.75); /* body on dark */
  --color-on-dark-60: rgba(255, 255, 255, 0.6); /* meta on dark */
  --color-on-dark-20: rgba(255, 255, 255, 0.2); /* unfilled text, strong borders */
  --color-line-dark: rgba(255, 255, 255, 0.1);
  --color-ring-dark: rgba(255, 255, 255, 0.15);
  --color-glass: rgba(0, 0, 0, 0.3);
  --color-nav-glass-light: rgba(255, 255, 255, 0.72);
  --color-nav-glass-dark: rgba(0, 0, 0, 0.6);

  /* ---------- Accent: UI only, never text on white (Source: WAMA footer) ---------- */
  --color-accent: #cdff59;

  /* ---------- WebGL light only, never used in UI (Source: Vexel) ---------- */
  --color-field-1: #47a7ca;
  --color-field-2: #074868;
  --color-field-3: #011836;

  /* ---------- Content card palette for fan cards (chosen, inferred) ---------- */
  --card-red: #e5392c;
  --card-green: #1d9a4a;
  --card-orange: #ff9a1f;
  --card-paper: #efefef;
  --card-blue: #2f6bff;
  --card-black: #111111;

  /* ---------- Type ---------- */
  --font-sans:
    "Inter Tight", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --fw-light: 300;
  --fw-regular: 400;
  --fw-medium: 500;

  --fs-display-xl: clamp(
    4.125rem,
    -4.8224rem + 18.6404vw,
    14.5rem
  ); /* giant single words (Redstone --caption-l) */
  --fs-display: clamp(3.5rem, 2.571rem + 3.81vw, 6rem); /* 56 → 96, stats */
  --fs-h1: clamp(2.75rem, 2.471rem + 1.143vw, 3.5rem); /* 44 → 56 */
  --fs-h2: clamp(2.25rem, 1.786rem + 1.905vw, 3.5rem); /* 36 → 56 */
  --fs-h3: clamp(1.5rem, 1.314rem + 0.762vw, 2rem); /* 24 → 32 */
  --fs-h4: clamp(1.25rem, 1.111rem + 0.571vw, 1.625rem); /* 20 → 26 */
  --fs-lead: clamp(1.125rem, 1.079rem + 0.19vw, 1.25rem); /* 18 → 20 */
  --fs-nav: 1.25rem; /* 20 */
  --fs-body: 1rem; /* 16 */
  --fs-small: 0.875rem; /* 14 */
  --fs-micro: 0.75rem; /* 12 */

  --lh-display: 0.9;
  --lh-h1: 1.1;
  --lh-heading: 1.2;
  --lh-body: 1.5;
  --lh-tight: 1;

  --ls-display: -0.04em;
  --ls-heading: -0.01em; /* -0.56px @56, -0.32px @32 */
  --ls-body: 0.01em; /* 0.16px @16, 0.14px @14, 0.2px @20 */
  --ls-eyebrow: 0.05em; /* 0.8px @16 */

  /* ---------- Spacing ---------- */
  --space-1: 4px;
  --space-2: 6px;
  --space-3: 8px;
  --space-4: 10px;
  --space-5: 16px;
  --space-6: 24px;
  --space-7: 32px;
  --space-8: 48px;
  --space-9: 64px;
  --space-10: 96px;
  --space-11: 160px;
  --section-y: clamp(5rem, 3.143rem + 7.619vw, 10rem); /* 80 → 160 */
  --container-max: 1400px;
  --container-pad: clamp(1.25rem, 5vw, 4.5rem); /* 20 → 72 */
  --gutter: 24px;
  --nav-h: 80px;
  --nav-h-float: 56px;

  /* ---------- Radius ---------- */
  --radius-0: 0;
  --radius-xs: 5px;
  --radius-sm: 8px;
  --radius-md: 10px; /* images, fan cards, panels */
  --radius-lg: 12px; /* glass cards */
  --radius-xl: 42px;
  --radius-pill: 999px;
  --radius-round: 50%;

  /* ---------- Elevation & effects ---------- */
  --shadow-fan: -28px 8px 40px 0 rgba(0, 0, 0, 0.35);
  --shadow-lift: 0 16px 36px -10px rgba(0, 0, 0, 0.45), 0 2px 6px 0 rgba(0, 0, 0, 0.2);
  --ring-light: 0 0 0 1px rgba(0, 0, 0, 0.08);
  --ring-dark: 0 0 0 1px rgba(255, 255, 255, 0.15);
  --blur-nav: blur(16px) saturate(1.6);
  --blur-glass: blur(10px);

  /* ---------- Z-index ---------- */
  --z-field: 0;
  --z-base: 1;
  --z-raised: 10;
  --z-edge-blur: 50;
  --z-nav: 100;
  --z-menu: 200;
  --z-cursor: 900;
  --z-modal: 1000;

  /* ---------- Motion: easing (GSAP equivalent in comment) ---------- */
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1); /* power4.out (quint), media hover, reveals */
  --ease-enter: cubic-bezier(0.22, 0.61, 0.36, 1); /* CustomEase "enter", staggered entrances */
  --ease-reveal: cubic-bezier(0.33, 1, 0.68, 1); /* power2.out, headline word reveal */
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1); /* power2.inOut, buttons, accordion height */
  --ease-ui: cubic-bezier(0.44, 0, 0.56, 1); /* CSS only, colour/shadow/opacity UI */
  --ease-loop: cubic-bezier(0.37, 0, 0.63, 1); /* sine.inOut, fan loop */
  --ease-snap: cubic-bezier(0.35, 0, 0, 1); /* CustomEase "snap", fan spread on load */
  --ease-settle: cubic-bezier(0.215, 0.61, 0.355, 1); /* power2.out, accordion content */

  /* ---------- Motion: durations ---------- */
  --dur-instant: 100ms;
  --dur-fast: 150ms;
  --dur-ui: 200ms;
  --dur-hover: 300ms;
  --dur-color: 400ms;
  --dur-fade: 460ms;
  --dur-swap: 500ms;
  --dur-media: 600ms;
  --dur-enter: 700ms;
  --dur-spread: 800ms;
  --dur-reveal: 1500ms;
  --dur-loop: 4000ms;
  --stagger: 70ms;
  --stagger-word: 40ms; /* inferred */
}
```

## 3. Typography

**Family.** Use one grotesk family for everything (Swiss rule, Source: WAMA).

- Ship **Inter Tight** (free, Google Fonts, variable). Load weights 300, 400 and 500 only, as woff2 with Latin subset.
- The licensable upgrade is **TWK Lausanne** (Weltkern), which is what WAMA uses. If it is licensed, map 200 to `--fw-light` and 400 to `--fw-regular`. Change no other values.
- Do not add a display or serif face. Giant statements use the same family at `--fs-display-xl`.
- Numbers in counters and stats use `font-variant-numeric: tabular-nums`.

| Token             | Desktop (1440) | Mobile (390) | clamp()                                            | Weight | Line-height | Letter-spacing | Use                                                |
| ----------------- | -------------- | ------------ | -------------------------------------------------- | ------ | ----------- | -------------- | -------------------------------------------------- |
| `--fs-display-xl` | 232px          | 66px         | `clamp(4.125rem, -4.8224rem + 18.6404vw, 14.5rem)` | 400    | 0.9         | -0.04em        | One giant word per screen on dark, footer wordmark |
| `--fs-display`    | 96px           | 56px         | `clamp(3.5rem, 2.571rem + 3.81vw, 6rem)`           | 400    | 1           | -0.02em        | Stats numbers                                      |
| `--fs-h1`         | 56px           | 44px         | `clamp(2.75rem, 2.471rem + 1.143vw, 3.5rem)`       | 400    | 1.1         | -0.01em        | Hero two-tone headline                             |
| `--fs-h2`         | 56px           | 36px         | `clamp(2.25rem, 1.786rem + 1.905vw, 3.5rem)`       | 400    | 1.2         | -0.01em        | Section headings                                   |
| `--fs-h3`         | 32px           | 24px         | `clamp(1.5rem, 1.314rem + 0.762vw, 2rem)`          | 400    | 1.2         | -0.01em        | Card/project titles, service titles                |
| `--fs-h4`         | 26px           | 20px         | `clamp(1.25rem, 1.111rem + 0.571vw, 1.625rem)`     | 400    | 1.25        | -0.01em        | FAQ questions, glass card titles                   |
| `--fs-lead`       | 20px           | 18px         | `clamp(1.125rem, 1.079rem + 0.19vw, 1.25rem)`      | 300    | 1.5         | 0.01em         | Hero sub, intro paragraphs                         |
| `--fs-nav`        | 20px           | 20px         | fixed                                              | 400    | 1.2         | 0.01em         | Nav links (lowercase)                              |
| `--fs-body`       | 16px           | 16px         | fixed                                              | 300    | 1.5         | 0.01em         | Body                                               |
| `--fs-small`      | 14px           | 14px         | fixed                                              | 400    | 1.43        | 0.01em         | Captions, meta, buttons in nav                     |
| eyebrow           | 16px           | 14px         | `clamp(0.875rem, 0.829rem + 0.19vw, 1rem)`         | 400    | 1.2         | 0.05em         | Section eyebrows (UPPERCASE)                       |
| `--fs-micro`      | 12px           | 12px         | fixed                                              | 400    | 1.33        | 0.05em         | Footer labels (UPPERCASE), chips                   |

**Casing rules**

- Nav links are lowercase (Source: WAMA).
- Eyebrows and footer column labels are UPPERCASE with 0.05em tracking.
- Headlines use sentence case. Never uppercase a sentence-length headline. Only single giant words may be set huge, and they stay in sentence case.

**Two-tone headline rule.** Hero and key section headlines are two sentences at the same size. Sentence 1 is `--color-text-muted` (#4f4f4f) and sentence 2 is `--color-ink`. On dark, use `--color-on-dark-60` then `--color-on-dark`. (Source: WAMA)

**Weight rule.** Weight 300 is allowed only at ≥16px. On white it must be at least `#4f4f4f`; on dark it must be at least `rgba(255,255,255,.75)`. Headings stay 400. Never use bold above 500.

**Measure.** Body copy max-width is 64ch. The hero sub max-width is 560px (inferred) and is centred only in the hero.

## 4. Layout and grid

**Container**

```css
.container {
  width: 100%;
  max-width: calc(var(--container-max) + 2 * var(--container-pad));
  margin-inline: auto;
  padding-inline: var(--container-pad);
}
```

At 1440px wide, this gives a 1296px content area with 72px side padding, matching WAMA's 72→1368 alignment.

**Columns and gutters**

- Desktop (≥1200): 12 columns, 24px gutter.
- Tablet (810–1199): 8 columns, 24px gutter.
- Mobile (<810): 4 columns, 16px gutter.

**Breakpoints**

- `480px`: small phone (Source: Vexel).
- `810px`: tablet/phone split (Source: WAMA).
- `1200px`: desktop (Source: WAMA).

Media queries are written mobile-first: `min-width: 480px`, `min-width: 810px`, `min-width: 1200px`.

**Section rhythm**

- Every section uses `padding-block: var(--section-y)` (160px desktop, 80px mobile; Source: WAMA measured 160/160).
- Eyebrow → heading gap is 16px.
- Heading block → content gap is 64px (inferred).
- Theme changes (light ↔ dark) happen only via the arc divider (entering dark) or a straight cut (leaving dark into the footer).

**Page map (reconciled with the repo and `docs/design/home-v2.html`)**

The homepage is `src/app/page.tsx` for signed out visitors (`/`). Signed in visitors keep going to their takes (current behaviour).

| #   | Section                | Theme              | Key pattern                                                                                                |
| --- | ---------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| 1   | Nav                    | light, floats      | Logo, links (how it works, studios, features, faq), sign in, "Upload a take" pill                          |
| 2   | Hero                   | light              | Two tone h1 "Film one take. Get it back ready to post." + lead, full width fan of product cards            |
| 3   | Reel                   | light → full bleed | "One take in. A finished video out." Corner thumbnail scroll expands (7.5)                                 |
| 4   | Made for solo creators | light              | Eyebrow + h2 + two drifting rows: platforms, then formats and limits chips (7.12)                          |
| 5   | The studio floor       | dark (arc top)     | Particle field, giant words "Trim. Key. Caption.", glass bento of the jobs, scroll fill lines (7.6 to 7.8) |
| 6   | What it does           | light              | Four uneven video tiles: Pauses out, Studio in, Transcript, Built for agents (coming soon)                 |
| 7   | The limits             | light              | 10 min, 2 GB, 1080p, 30 days with flip counters (7.12). True product limits only                           |
| 8   | Questions              | light              | Numbered FAQ accordion (7.11), answers true today                                                          |
| 9   | Your next take         | light              | Closing call to action (no form): "Upload your first take" + hello@takestudio.app                          |
| 10  | Footer                 | dark               | 4 columns (Product, Account, For agents, Legal), lime labels, giant blurred wordmark                       |

**Hero composition (Source: WAMA)**

- The nav occupies the top 80px.
- The h1 block starts 80px below the nav (headline top ≈160px from viewport top). It is centred with max-width 960px.
- The lead sits 24px below the h1, centred, max-width 560px. There are no buttons in the hero; the nav CTA is the only CTA above the fold.
- The fan panel starts 64px below the lead. It spans the container width, height `clamp(360px, 42vw, 640px)`, background `--color-surface`, radius `--radius-md` on the top corners and 0 on the bottom, `overflow: hidden`.
- Cards fan from a pivot below the panel, so the arc's crown sits about 64px from the panel top.
- Below 810px the panel goes full-bleed (negative margin-inline equal to `--container-pad`) and the h1 and lead become left-aligned.

**Capabilities grid (Source: WAMA services)**

- Columns: `grid-template-columns: 1fr 1.55fr 1fr 1.55fr; gap: 24px` (measured 240 / 372 / 240 / 372 at 1296).
- Tile heights are deliberately uneven: tile 1 is 1:1, tile 2 is 3:4 (tall), tile 3 is 1:1, tile 4 is 5:4.
- Captions sit beneath each tile and the grid aligns to start (`align-items: start`).

**Bento on dark (Source: Vexel)**

- `grid-template-columns: 2fr 1fr; gap: 20px`.
- Second row is `1fr 2fr`.
- Testimonials or quotes go in a 3-up row with `gap: 24px`.

## 4b. App screens (signed in)

Built from `docs/design/take-page-v2.html`. The same tokens as the homepage, no spectacle.

**App shell**

- At 1024px and wider: a 264px sticky left sidebar (white, 1px `--color-hairline` right border, padding 20px 16px) and the main column. Under 1024px the sidebar hides and a menu button in the top bar opens it as a sheet (focus trapped, Esc closes, `role="dialog"`).
- Sidebar, top to bottom: logo, primary "Upload a take" pill (full width), nav (Takes; later slices add their own items), "Recent takes" (title plus status and duration, the current take marked with `aria-current="page"`), and the user menu at the bottom (initials avatar, name, sign out).
- Top bar: sticky, min height 72px, nav glass (`--color-nav-glass-light` with `--blur-nav`), breadcrumb "Takes / <take title>", status chip, and the page actions on the right.
- Page gutters: `clamp(16px, 2.4vw, 32px)`.

**Take page**

- Workspace grid: the dark stage panel on the left, the inspector on the right (about 1fr 380px at 1200px and up; stacked under 1200px, inspector below the stage).
- Stage panel: `--color-dark` background, radius `--radius-lg`, grain at 4%, padding `clamp(12px, 1.6vw, 20px)`. Inside: the player (16:9, black, radius `--radius-md`, max height 62dvh) with a status badge top left, and a glass transport bar (play, time `0:00 / 0:10` in tabular nums, captions toggle, volume, fullscreen).
- Below the stage: one line summary ("Removed 0:02 of pauses") on the left, "Download" (primary pill) and "Download original" (ghost pill) on the right.
- Inspector: white card with pill tabs (Export, Background, Transcript, Details). Export lists the files (edited video, captions SRT, transcript TXT, original) with a type badge and a save action (file sizes are shown when the take data carries them), plus the retention line ("Video expires in N days"). Background shows the studio swatches (3 per row, 16:9, radius `--radius-sm`), the preview flow from spec 0008 and "Your own image". Transcript shows timestamped lines (tap to seek) and the two downloads ("Download text", "Download captions (SRT)"); "Copy text" is later. Background and Transcript stay mounted while another tab shows (hidden), so a studio preview on the stage and the transcript polling keep working. Details shows the title, status, upload date, length, format, retention and the ready email toggle. "Delete this take" (also in the header menu) opens a confirm dialog and cannot be undone (spec 0013); resolution and file size arrive later and are not shown yet.
- Under 810px: stage full width, inspector tabs become a bottom sheet or stacked sections; every target at least 44px.
- Library, upload and sign in screens use the same shell, cards and buttons; Dwight pulls Mobbin references for each when they are restyled.

## 5. Components

### Nav

**Default state (at top, light)**

- Layout: `position: fixed; inset: 0 0 auto; height: 80px`. It contains a 3-column grid of logo (left, 24px tall), links (centred, gap 32px) and actions (right).
- Links: 20px, weight 400, lowercase, `--color-ink`.
- CTA: primary pill, 40px tall, padding 0 24px, 16px label.
- Locale or secondary control sits left of the CTA, separated by a 1×24px `--color-line` divider.

**Floating state (scrollY > 202px; Source: Redstone `header.scrolled` at 202)**

- The nav detaches into a pill: `top: 12px`, `width: min(100% - 2 * var(--container-pad), 1296px)`, `height: 56px`, `border-radius: var(--radius-pill)`.
- Surface: `background: var(--color-nav-glass-light)`, `backdrop-filter: var(--blur-nav)`, `box-shadow: var(--ring-light)`.
- Transitions: background-color 200ms ease (WAMA measured); width, top and height 500ms `--ease-in-out`.

**Dark variant (while a `[data-theme="dark"]` section is under the nav; Source: WAMA nav variant switch)**

- `background: var(--color-nav-glass-dark)`, white links, `box-shadow: var(--ring-dark)`.
- The CTA inverts to a white pill with ink text.

**Link hover and focus**

- Underline: `text-decoration: underline 1px transparent; text-underline-offset: 6px`. On hover, `text-decoration-color: currentColor; text-underline-offset: 3px`.
- Transition: color, text-decoration-color, text-decoration-thickness and text-underline-offset, all 400ms `--ease-ui` (WAMA measured).
- The active route keeps the underline.

**Mobile (<810)**

- Shows logo, a short CTA pill and a two-line burger (40×14px box, two 2px bars).
- The burger opens a full-screen `--color-dark` sheet. Links are set at `--fs-h2`, white, and enter with recipe 7.3. The sheet has `role="dialog"`, `aria-modal="true"` and a focus trap; Esc closes it.

### Buttons and links

| Variant                                    | Spec                                                                                               | Hover                                                                           | Active             | Focus-visible                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------- |
| Primary pill                               | bg `--color-ink`, text #fff, 16px/1, padding 0 24px, height 40px (nav) or 48px (body), radius pill | bg `--color-ink-soft`, transition `background, box-shadow 300ms var(--ease-ui)` | `scale(.98)` 150ms | `outline: 2px solid var(--color-ink); outline-offset: 3px` |
| Primary pill on dark                       | bg #fff, text `--color-ink`                                                                        | bg `#e9e9e9`                                                                    | same               | outline `--color-accent`                                   |
| Split CTA (Source: Redstone + Vexel arrow) | Label pill + detached 48px circle with ↗ icon, 4px gap                                             | See recipe 7.10                                                                 | `scale(.98)`       | outline on wrapper                                         |
| Ghost pill (dark)                          | bg `--color-glass`, `backdrop-filter: var(--blur-glass)`, 1px `--color-line-dark` border           | border `--color-on-dark-20` 300ms                                               | —                  | outline `--color-accent`                                   |
| Text link                                  | inherits colour, underline offset system as in nav                                                 | as nav                                                                          | —                  | outline 2px currentColor offset 2px                        |

### Cards

- **Fan card (Source: WAMA)**
  - Size: width `clamp(180px, 17vw, 250px)`, `aspect-ratio: 5 / 7`, radius `--radius-md`, `box-shadow: var(--shadow-fan)`.
  - Background is one `--card-*` colour. Contents: a product screenshot inside a device frame, offset low-right, plus a 28px label top-left.
  - Cards are decorative in a loop. Each card is a link to its use-case with an `aria-label`.
- **Project card**
  - Image: radius `--radius-md`, `overflow: hidden`.
  - On hover the image scales 1 → 1.04 over 600ms `--ease-out` (WAMA measured `transform 600ms cubic-bezier(0.22,1,0.36,1)` on img).
  - Title `--fs-h3`. Meta 14px `--color-text-muted`. Chips are 12px with a `--color-line` border, radius pill, padding 4px 10px, gap 6px.
- **Glass card (dark; Source: Vexel)**
  - Surface: `background: var(--color-glass); backdrop-filter: var(--blur-glass); border: 1px solid var(--color-line-dark); border-radius: var(--radius-lg); padding: clamp(24px, 3vw, 40px)`.
  - Hover: border goes to `--color-on-dark-20` and background to `rgba(0,0,0,.20)`, 300ms `--ease-ui`.
- **Video tile (Source: WAMA)**
  - bg #000, radius 0. A poster `<img>` sits under a `<video>` with `opacity: 0`.
  - Caption below: `--fs-h3` title, then 16px/300 `--color-text-muted`, max-width 28ch. Behaviour in recipe 7.9.
- **Stat**
  - Number in `--fs-display` with tabular-nums. Label is 14px muted.
  - Separate stats with a 1px `--color-line` top border and 24px padding-top.

### Lists and accordion (FAQ)

- Each row has a 1px `--color-line` bottom border. The trigger is a full-width `<button>`: number "01." (14px muted, tabular), question `--fs-h4`, and a plus icon (16px, two 1.5px bars) on the right.
- Open state: the plus rotates 45° over 500ms `--ease-in-out`, and the panel expands per recipe 7.11. Answer text is 16px/300 muted, max-width 64ch.
- Index-list variant for services: when a row is active, a 24px tick line before the number grows to 48px width over 300ms ease (Source: Redstone service counter line).

### Form (contact)

- Inputs are bottom-border only: 1px `--color-line`. Text is 16px, height 48px, transparent background.
- Focus changes the border to 1px `--color-ink`, plus a 2px focus ring offset below via `box-shadow: 0 1px 0 0 var(--color-ink)`.
- Checkbox chips (budget or topic) are pills with a 1px `--color-line` border. When checked: bg `--color-ink`, text #fff, 200ms ease.
- Labels are 14px muted above each field.

### Footer

- bg `--color-ink`, 4-column grid (2 at <810).
- Column labels: 12px UPPERCASE 0.05em `--color-accent`. Links: 16px `--color-on-dark-75`. On hover, links turn #fff with an accent underline (offset system).
- Bottom bar: 14px `--color-on-dark-60`, 1px `--color-line-dark` top border.
- The footer closes with the giant blurred wordmark (recipe 7.13).

### Cursor (Source: Redstone has a custom cursor)

- Keep the native cursor everywhere. Add a decorative 10px follower dot, white with `mix-blend-mode: difference`.
- Over `[data-cursor="play"]` (reel, video tiles) the dot grows to 72px, turns `--color-accent` and shows a "play" label (12px ink).
- Enabled only when `(pointer: fine)` and motion is allowed. Code is in recipe 7.14.

## 6. Motion system

**Principles**

1. **Three motion classes only.**
   - (a) One-shot entrances (700ms, `--ease-enter`, 70ms stagger).
   - (b) UI feedback (150–400ms, `--ease-ui`).
   - (c) Exactly four scrubbed set-pieces: reel expand, arc flatten, particle morph, text fill. No other scroll-scrubbed effects.
2. Animate only `transform`, `opacity`, `clip-path`, CSS custom properties and WebGL uniforms. Never animate `top`, `left`, `width` or `height` (Redstone did; we use clip-path instead).
3. No overshoot, bounce or elastic easing. Everything decelerates.
4. Entrances run once. Elements do not re-hide on scroll up.
5. Infinite loops (fan, particles) pause when off-screen and stop under reduced motion.

**Easing and duration usage**

| Purpose            | Duration             | Ease            |
| ------------------ | -------------------- | --------------- |
| Colour, underline  | 400ms                | `--ease-ui`     |
| Background, shadow | 300ms                | `--ease-ui`     |
| Nav bg swap        | 200ms                | `ease`          |
| Button gap/padding | 500ms                | `--ease-in-out` |
| Image hover scale  | 600ms                | `--ease-out`    |
| Section entrance   | 700ms + i×70ms       | `--ease-enter`  |
| Fan spread on load | 800ms, delay 200ms   | `--ease-snap`   |
| Headline words     | 1500ms, 40ms stagger | `--ease-reveal` |
| Fan loop step      | 4000ms, infinite     | `--ease-loop`   |
| Nav initial fade   | 460ms                | `linear`        |

**GSAP ease map (single source)**

```js
// src/motion/eases.js
import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";
gsap.registerPlugin(CustomEase);
export const EASE = {
  out: "power4.out", // cubic-bezier(0.22,1,0.36,1)
  reveal: "power2.out", // cubic-bezier(0.33,1,0.68,1)
  inOut: "power2.inOut", // cubic-bezier(0.65,0,0.35,1)
  loop: "sine.inOut", // cubic-bezier(0.37,0,0.63,1)
  enter: CustomEase.create("enter", "0.22,0.61,0.36,1"),
  snap: CustomEase.create("snap", "0.35,0,0,1"),
};
export const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
```

**Smooth scroll: Lenis + ScrollTrigger (Source: Vexel used Lenis)**

```js
// src/motion/scroll.js
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { REDUCED } from "./eases";
gsap.registerPlugin(ScrollTrigger);

export const lenis = REDUCED
  ? null
  : new Lenis({ lerp: 0.1, smoothWheel: true, wheelMultiplier: 1 }); // lerp inferred
if (lenis) {
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}
// Anchor links
document.querySelectorAll('a[href^="#"]').forEach((a) =>
  a.addEventListener("click", (e) => {
    const t = document.querySelector(a.getAttribute("href"));
    if (!t) return;
    e.preventDefault();
    lenis ? lenis.scrollTo(t, { offset: -80 }) : t.scrollIntoView();
    t.setAttribute("tabindex", "-1");
    t.focus({ preventScroll: true });
  }),
);
```

Add the Lenis CSS: `html.lenis, html.lenis body { height: auto; } .lenis.lenis-smooth { scroll-behavior: auto !important; }`. Lenis is disabled on touch by default; keep that default.

**Page load sequence (no preloader)**
There is no preloader. The h1 must be visible for LCP, so it never starts at `opacity: 0`; words only translate inside masks.

| t (ms) | Element             | Animation                                                                                                      |
| ------ | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| 0      | Nav                 | opacity 0→1, 460ms linear (Source: Vexel)                                                                      |
| 100    | h1 sentence 1 words | yPercent 105→0, 1500ms `power2.out`, stagger 40ms                                                              |
| 300    | h1 sentence 2 words | same                                                                                                           |
| 600    | Lead                | `take-enter` (translate 20px + fade), 700ms                                                                    |
| 700    | Fan panel           | translate 40px→0, no fade, 700ms `--ease-enter` (Source: WAMA `wama-entra-sem-fade`)                           |
| 900    | Fan cards           | rotate from 0° (stacked) to fan angles, 800ms `snap` (Source: WAMA 800ms delay 200 `cubic-bezier(0.35,0,0,1)`) |
| 1700   | Fan loop            | starts (recipe 7.2)                                                                                            |

```js
// src/motion/intro.js
import { gsap } from "gsap";
import { EASE, REDUCED } from "./eases";
import { splitWords } from "./split";
export function intro() {
  if (REDUCED) return;
  const tl = gsap.timeline();
  tl.from(".nav", { opacity: 0, duration: 0.46, ease: "none" }, 0);
  document.querySelectorAll(".hero__title [data-line]").forEach((line, i) => {
    tl.from(
      splitWords(line),
      { yPercent: 105, duration: 1.5, ease: EASE.reveal, stagger: 0.04 },
      0.1 + i * 0.2,
    );
  });
  tl.from(".hero__lead", { y: 20, opacity: 0, duration: 0.7, ease: EASE.enter }, 0.6);
  tl.from(".fan", { y: 40, duration: 0.7, ease: EASE.enter }, 0.7);
  tl.from(
    ".fan__card",
    { rotation: 0, duration: 0.8, ease: EASE.snap, stagger: { each: 0.03, from: "center" } },
    0.9,
  );
  return tl;
}
```

## 7. Animation and effect recipes

### 7.1 Two-tone headline word reveal

- **Trigger:** page load for the hero h1 (see §6). For section h2s, when the top of the h2 crosses 85% of the viewport, once.
- **Parameters:** words yPercent 105→0, 1500ms, `cubic-bezier(0.33,1,0.68,1)` (`power2.out`), stagger 40ms. Each word sits in an `overflow:hidden` mask. Sentence 1 is `--color-text-muted`, sentence 2 is `--color-ink`.
- **Implementation:**

```html
<h1 class="hero__title">
  <span data-line class="tone-muted">[Statement one.]</span><br />
  <span data-line>[Statement two.]</span>
</h1>
```

```css
.tone-muted {
  color: var(--color-text-muted);
}
.w-mask {
  display: inline-block;
  overflow: hidden;
  vertical-align: top;
  padding-bottom: 0.08em;
  margin-bottom: -0.08em;
}
.w {
  display: inline-block;
  will-change: transform;
}
```

```js
// src/motion/split.js
export function splitWords(root) {
  if (root.dataset.split) return root.querySelectorAll(".w");
  const heading = root.closest("h1,h2,h3");
  if (heading && !heading.hasAttribute("aria-label"))
    heading.setAttribute("aria-label", heading.textContent.trim().replace(/\s+/g, " "));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((n) => {
    const frag = document.createDocumentFragment();
    n.textContent.split(/(\s+)/).forEach((part) => {
      if (!part) return;
      if (/^\s+$/.test(part)) return frag.append(" ");
      const m = document.createElement("span");
      m.className = "w-mask";
      m.setAttribute("aria-hidden", "true");
      const w = document.createElement("span");
      w.className = "w";
      w.textContent = part;
      m.append(w);
      frag.append(m);
    });
    n.replaceWith(frag);
  });
  root.dataset.split = "1";
  return root.querySelectorAll(".w");
}
// Section headings
import { gsap } from "gsap";
import { EASE, REDUCED } from "./eases";
if (!REDUCED)
  gsap.utils.toArray("[data-reveal-words]").forEach((h) => {
    gsap.from(splitWords(h), {
      yPercent: 105,
      duration: 1.5,
      ease: EASE.reveal,
      stagger: 0.04,
      scrollTrigger: { trigger: h, start: "top 85%", once: true },
    });
  });
```

- **Reduced motion:** do not split; text renders static.
- **Source:** WAMA (two-tone), Redstone (word-by-word slide-up, 1500ms `cubic-bezier(0.33,1,0.68,1)`).

### 7.2 Fan / arc card loop (hero)

- **Trigger:** starts after the intro (t≈1700ms). Pauses when `.fan` leaves the viewport and when the tab is hidden.
- **Parameters:**
  - 9–11 cards. Angle step 13°. Pivot `transform-origin: 50% 1100px` (inferred from about 240px cards on a roughly 1100px radius).
  - Each loop step rotates every card +13° over 4000ms `sine.inOut` (WAMA measured 4000ms infinite `cubic-bezier(0.37,0,0.63,1)`). Rotation wraps within ±(n/2)×13°.
  - z-index follows rotation so the right-most card is on top.
- **Implementation:**

```css
.fan {
  position: relative;
  height: clamp(360px, 42vw, 640px);
  background: var(--color-surface);
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  overflow: hidden;
}
.fan__card {
  position: absolute;
  left: 50%;
  top: clamp(40px, 4.5vw, 64px);
  width: clamp(180px, 17vw, 250px);
  aspect-ratio: 5/7;
  translate: -50% 0;
  transform-origin: 50% 1100px;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-fan);
  overflow: hidden;
}
```

```js
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { EASE, REDUCED } from "./eases";
export function fan() {
  const cards = gsap.utils.toArray(".fan__card"),
    n = cards.length,
    step = 13;
  const mid = Math.floor(n / 2),
    lim = (n / 2) * step;
  const wrap = gsap.utils.wrap(-lim, lim);
  cards.forEach((c, i) => gsap.set(c, { rotation: (i - mid) * step, zIndex: 100 + (i - mid) }));
  if (REDUCED) return;
  const tl = gsap.timeline({
    repeat: -1,
    delay: 1.7,
    onUpdate: () =>
      cards.forEach((c) => (c.style.zIndex = 100 + Math.round(gsap.getProperty(c, "rotation")))),
  });
  tl.to(cards, {
    rotation: `+=${step}`,
    duration: 4,
    ease: EASE.loop,
    modifiers: { rotation: gsap.utils.unitize(wrap) },
  });
  ScrollTrigger.create({
    trigger: ".fan",
    start: "top bottom",
    end: "bottom top",
    onToggle: (s) => (s.isActive ? tl.play() : tl.pause()),
  });
  document.addEventListener("visibilitychange", () => (document.hidden ? tl.pause() : tl.play()));
}
```

Keep the outermost cards beyond the panel edges (±65° or more) so the wrap jump is never visible.

- **Reduced motion:** static fan at the initial angles, no loop. Cards remain links.
- **Source:** WAMA.

### 7.3 Staggered entrance (`take-enter`)

- **Trigger:** IntersectionObserver, element 15% visible, once.
- **Parameters:** opacity 0→1, translate 0 20px → 0 0, 700ms `--ease-enter`. Delay is `index × 70ms` within a `[data-enter-group]`. Vexel used 20px; WAMA used 700ms, 70ms and `cubic-bezier(0.22,0.61,0.36,1)`.
- **Implementation:**

```css
@keyframes take-enter {
  from {
    opacity: 0;
    translate: 0 20px;
  }
  to {
    opacity: 1;
    translate: 0 0;
  }
}
.js [data-enter] {
  opacity: 0;
}
.js [data-enter].is-in {
  animation: take-enter var(--dur-enter) var(--ease-enter) both;
  animation-delay: calc(var(--i, 0) * var(--stagger));
}
```

```js
document.documentElement.classList.add("js");
const io = new IntersectionObserver(
  (entries) =>
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add("is-in");
      io.unobserve(e.target);
    }),
  { threshold: 0.15 },
);
document
  .querySelectorAll("[data-enter-group]")
  .forEach((g) =>
    g.querySelectorAll("[data-enter]").forEach((el, i) => el.style.setProperty("--i", i)),
  );
document.querySelectorAll("[data-enter]").forEach((el) => io.observe(el));
```

- **Reduced motion:** `@media (prefers-reduced-motion: reduce){ .js [data-enter]{opacity:1} .js [data-enter].is-in{animation:none} }`.
- **Source:** WAMA (`wama-entra`), Vexel (fade-up 20px).

### 7.4 Nav: float on scroll + theme by section

- **Trigger:** scrollY > 202px switches to floating. Any `[data-theme="dark"]` section spanning y = 40px switches to the dark variant.
- **Parameters:** background-color 200ms ease; geometry 500ms `--ease-in-out`; `backdrop-filter: blur(16px) saturate(1.6)`.
- **Implementation:**

```css
.nav {
  position: fixed;
  top: 0;
  left: 50%;
  translate: -50% 0;
  width: 100%;
  height: var(--nav-h);
  z-index: var(--z-nav);
  transition:
    background-color var(--dur-ui) ease,
    top var(--dur-swap) var(--ease-in-out),
    width var(--dur-swap) var(--ease-in-out),
    height var(--dur-swap) var(--ease-in-out),
    border-radius var(--dur-swap) var(--ease-in-out);
}
.nav.is-float {
  top: 12px;
  width: min(100% - 2 * var(--container-pad), 1296px);
  height: var(--nav-h-float);
  border-radius: var(--radius-pill);
  background: var(--color-nav-glass-light);
  backdrop-filter: var(--blur-nav);
  -webkit-backdrop-filter: var(--blur-nav);
  box-shadow: var(--ring-light);
}
.nav.is-dark {
  color: #fff;
}
.nav.is-float.is-dark {
  background: var(--color-nav-glass-dark);
  box-shadow: var(--ring-dark);
}
```

Width and height transitions run on a single fixed element and are acceptable here. Do not copy this pattern to content elements.

```js
const nav = document.querySelector(".nav");
ScrollTrigger.create({
  start: 202,
  end: "max",
  onToggle: (s) => nav.classList.toggle("is-float", s.isActive),
});
document.querySelectorAll('[data-theme="dark"]').forEach((sec) =>
  ScrollTrigger.create({
    trigger: sec,
    start: "top 40px",
    end: "bottom 40px",
    onToggle: (s) => nav.classList.toggle("is-dark", s.isActive),
  }),
);
```

- **Reduced motion:** keep the state changes and set transitions to 0ms.
- **Source:** Redstone (floating pill at 202px), WAMA (variant switch, 200ms bg), Vexel (dark glass pill).

### 7.5 Reel: corner thumbnail expands to full-bleed

- **Trigger:** scrubbed. The section top hits the viewport top; the effect runs over 806px of scroll, then holds full-bleed for 400px.
- **Parameters:** `clip-path: inset()` goes from the thumbnail slot rect (radius 10px) to `inset(0 round 0)`. Inner video scale 1.15→1. Heading opacity 1→0 over the first 40%. Ease `none` (scrub). The 806px distance is Redstone's measured 202→1008.
- **Implementation:**

```html
<section class="reel" data-cursor="play">
  <div class="reel__sticky">
    <div class="reel__head container">
      <h2 class="reel__title">[Statement]</h2>
      <div class="reel__slot"></div>
    </div>
    <div class="reel__media">
      <video muted loop playsinline preload="metadata" poster="/reel.jpg" src="/reel.mp4"></video>
    </div>
  </div>
</section>
```

```css
.reel {
  height: calc(100vh + 1206px);
}
.reel__sticky {
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: hidden;
}
.reel__head {
  position: relative;
  z-index: 2;
  display: flex;
  justify-content: space-between;
  align-items: start;
  padding-top: calc(var(--nav-h) + 24px);
}
.reel__slot {
  width: clamp(280px, 34vw, 496px);
  aspect-ratio: 5/3;
}
.reel__media {
  position: absolute;
  inset: 0;
  z-index: 1;
}
.reel__media video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
```

```js
const sticky = document.querySelector(".reel__sticky"),
  slot = document.querySelector(".reel__slot"),
  media = document.querySelector(".reel__media");
const fromInset = () => {
  const s = slot.getBoundingClientRect(),
    b = sticky.getBoundingClientRect();
  return `inset(${s.top - b.top}px ${b.right - s.right}px ${b.bottom - s.bottom}px ${s.left - b.left}px round 10px)`;
};
if (!REDUCED && matchMedia("(min-width: 810px)").matches) {
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: ".reel",
      start: "top top",
      end: "+=806",
      scrub: true,
      invalidateOnRefresh: true,
    },
  });
  tl.fromTo(
    media,
    { clipPath: fromInset },
    { clipPath: "inset(0px 0px 0px 0px round 0px)", ease: "none" },
    0,
  )
    .fromTo(".reel__media video", { scale: 1.15 }, { scale: 1, ease: "none" }, 0)
    .to(".reel__title", { opacity: 0, ease: "none", duration: 0.4 }, 0);
}
ScrollTrigger.create({
  trigger: ".reel",
  start: "top bottom",
  end: "bottom top",
  onToggle: (s) => {
    const v = media.querySelector("video");
    s.isActive && !REDUCED ? v.play().catch(() => {}) : v.pause();
  },
});
```

- **Reduced motion / <810px:** `.reel { height: auto }`, the sticky becomes static, and the video sits in normal flow at 16:9 with radius 10px. It does not autoplay; a play button toggles it.
- **Source:** Redstone.

### 7.6 Convex arc entry into the dark stage

- **Trigger:** scrubbed while the dark section's top travels from the viewport bottom to 30% from the top.
- **Parameters:** a pseudo-element above the section, `border-radius: 50% 50% 0 0 / 100% 100% 0 0`. Its height is `clamp(48px, 10vw, 160px) × --arc-k`, with `--arc-k` going 1→0.25. That flattening is an inferred enhancement; WAMA's arc is static.
- **Implementation:**

```css
.arc {
  position: relative;
  background: var(--color-dark);
  color: #fff;
  --arc-k: 1;
}
.arc::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% - 1px);
  height: calc(clamp(48px, 10vw, 160px) * var(--arc-k));
  background: inherit;
  border-radius: 50% 50% 0 0 / 100% 100% 0 0;
}
```

```js
if (!REDUCED)
  gsap.fromTo(
    ".arc",
    { "--arc-k": 1 },
    {
      "--arc-k": 0.25,
      ease: "none",
      scrollTrigger: { trigger: ".arc", start: "top bottom", end: "top 30%", scrub: true },
    },
  );
```

- **Reduced motion:** static arc at `--arc-k: 1`.
- **Source:** WAMA.

### 7.7 Particle field morph + giant word sequence (dark stage)

- **Trigger:** the Three.js module is dynamically imported when `.studio` is within one viewport of entering. Stage morph is scrubbed across the word-sequence block (`scrub: 1`). Rendering runs only while `.studio` is in view.
- **Parameters:**
  - Particle count: 24,000 desktop, 8,000 under 810px. DPR capped at 1.5.
  - Points render as horizontal dashes in an additive blend, coloured `#074868`→`#47a7ca` by depth. The fragment shader writes the colour as it is, without three's `colorspace_fragment` include (the draft has none): with it the dashes come out much brighter and whiter.
  - Three procedural shapes: beam → ring → wave. `uStage` goes 0→2.
  - Idle drift: y ± 0.03 at 0.6 rad/s.
  - Giant words: 3 words, one per 100vh, set in `--fs-display-xl`. Each word enters with yPercent 100→0 over 700ms `enter` when its third of the block begins (triggered, not scrubbed; inferred from WAMA's 4950px word section).
- **Clip:** the section's content (heading, canvas, words, cards) lives in a wrapper (`.studio__clip`: `position:relative; overflow:clip`) and the canvas sits in the flow right after the heading, so the field opens below the heading and never over it, and no particle is ever drawn outside the dark stage. Use `overflow: clip`, never `hidden` (a scroll container breaks `sticky`), and do not clip `.studio` itself (the arc `::before` sits above it). Do not lay the canvas over the whole section from its top (`absolute; inset:0`): the funnel then shows at the very top of the arc and runs through the heading (DV0-T17). The heading is two lines: the muted sentence, then the white one on its own line.
- **Implementation:**

```html
<section class="studio arc" data-theme="dark">
  <div class="studio__clip">
    <div class="container studio__intro">…eyebrow and heading…</div>
    <canvas class="studio__field" aria-hidden="true"></canvas>
    <div class="studio__words" style="height:300vh">
      <div class="studio__word-stage">
        <span class="studio__word">[Word 1]</span><span class="studio__word">[Word 2]</span
        ><span class="studio__word">[Word 3]</span>
      </div>
    </div>
    <div class="container studio__bento">…glass cards…</div>
  </div>
</section>
```

```css
.studio__field {
  position: sticky;
  top: 0;
  display: block;
  width: 100%;
  height: 100vh;
  margin-bottom: -100vh;
  z-index: var(--z-field);
  background: radial-gradient(
    60% 50% at 50% 60%,
    rgba(71, 167, 202, 0.25),
    rgba(7, 72, 104, 0.12) 40%,
    transparent 70%
  );
}
.studio__words,
.studio__bento {
  position: relative;
  z-index: var(--z-base);
}
.studio__word-stage {
  position: sticky;
  top: 0;
  height: 100vh;
  display: grid;
  place-items: center;
  overflow: hidden;
}
.studio__word {
  grid-area: 1/1;
  font-size: var(--fs-display-xl);
  line-height: var(--lh-display);
  letter-spacing: var(--ls-display);
}
```

```js
// src/webgl/field.js (dynamically imported)
import * as THREE from "three";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { REDUCED } from "../motion/eases";
const canvas = document.querySelector(".studio__field");
const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: false,
  powerPreference: "high-performance",
});
const PR = Math.min(devicePixelRatio, 1.5);
renderer.setPixelRatio(PR);
const scene = new THREE.Scene(),
  camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.z = 9;
const N = innerWidth < 810 ? 8000 : 24000,
  R = (a, b) => a + Math.random() * (b - a),
  q = (v) => Math.round(v * 14) / 14;
const make = (fn) => {
  const a = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) a.set(fn(), i * 3);
  return a;
};
const beam = () => {
  const y = q(R(-3, 3)),
    r = 0.2 + Math.pow((y + 3) / 6, 3) * 2.4,
    t = R(0, 6.283);
  return [Math.cos(t) * r, y, Math.sin(t) * r];
};
const ring = () => {
  const u = R(0, 6.283),
    v = R(0, 6.283),
    k = 2.2 + 0.35 * Math.cos(v);
  return [k * Math.cos(u), q(k * Math.sin(u)), 0.35 * Math.sin(v)];
};
const wave = () => {
  const x = R(-5, 5),
    z = R(-3, 3);
  return [x, q(Math.sin(x * 0.9) * 0.4 + Math.cos(z * 1.3) * 0.3 - 1.5), z];
};
const geo = new THREE.BufferGeometry();
geo.setAttribute("position", new THREE.BufferAttribute(make(beam), 3));
geo.setAttribute("aB", new THREE.BufferAttribute(make(ring), 3));
geo.setAttribute("aC", new THREE.BufferAttribute(make(wave), 3));
geo.setAttribute(
  "aRand",
  new THREE.BufferAttribute(Float32Array.from({ length: N }, Math.random), 1),
);
const mat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uStage: { value: 0 },
    uTime: { value: 0 },
    uSize: { value: 70 },
    uPR: { value: PR },
    uC1: { value: new THREE.Color("#47a7ca") },
    uC2: { value: new THREE.Color("#074868") },
  },
  vertexShader: `attribute vec3 aB; attribute vec3 aC; attribute float aRand;
    uniform float uStage, uTime, uSize, uPR; varying float vDepth;
    void main(){
      vec3 p = uStage < 1.0 ? mix(position, aB, smoothstep(0.,1.,uStage)) : mix(aB, aC, smoothstep(0.,1.,uStage-1.));
      p.y += sin(uTime*0.6 + aRand*6.2831)*0.03;
      vec4 mv = modelViewMatrix*vec4(p,1.);
      gl_Position = projectionMatrix*mv;
      gl_PointSize = uSize*uPR/(-mv.z);
      vDepth = clamp((p.z+2.5)/5.,0.,1.);
    }`,
  fragmentShader: `uniform vec3 uC1, uC2; varying float vDepth;
    void main(){
      vec2 uv = gl_PointCoord - .5;
      if (abs(uv.y) > .14 || abs(uv.x) > .46) discard;   // horizontal dash
      gl_FragColor = vec4(mix(uC2, uC1, vDepth), .85);
    }`,
});
scene.add(new THREE.Points(geo, mat));
const resize = () => {
  const w = canvas.clientWidth,
    h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
};
resize();
addEventListener("resize", resize);
let active = false;
const render = (t) => {
  if (!active) return;
  mat.uniforms.uTime.value = t;
  renderer.render(scene, camera);
};
if (REDUCED) {
  renderer.render(scene, camera);
} else {
  gsap.ticker.add(render);
  ScrollTrigger.create({
    trigger: ".studio",
    start: "top bottom",
    end: "bottom top",
    onToggle: (s) => (active = s.isActive),
  });
  gsap.to(mat.uniforms.uStage, {
    value: 2,
    ease: "none",
    scrollTrigger: { trigger: ".studio__words", start: "top top", end: "bottom bottom", scrub: 1 },
  });
}
// Word sequence
const words = gsap.utils.toArray(".studio__word");
gsap.set(words, { yPercent: 100, opacity: 0 });
gsap.set(words[0], { yPercent: 0, opacity: 1 });
words.forEach(
  (w, i) =>
    i &&
    ScrollTrigger.create({
      trigger: ".studio__words",
      start: `top+=${(i / words.length) * 100}% top`,
      onEnter: () => {
        gsap.to(words[i - 1], {
          yPercent: -100,
          opacity: 0,
          duration: REDUCED ? 0 : 0.7,
          ease: "enter",
        });
        gsap.to(w, { yPercent: 0, opacity: 1, duration: REDUCED ? 0 : 0.7, ease: "enter" });
      },
      onLeaveBack: () => {
        gsap.to(w, { yPercent: 100, opacity: 0, duration: REDUCED ? 0 : 0.7, ease: "enter" });
        gsap.to(words[i - 1], {
          yPercent: 0,
          opacity: 1,
          duration: REDUCED ? 0 : 0.7,
          ease: "enter",
        });
      },
    }),
);
```

```js
// Lazy-load hook in main.js
ScrollTrigger.create({
  trigger: ".studio",
  start: "top bottom+=100%",
  once: true,
  onEnter: () => import("./webgl/field.js"),
});
```

- **Reduced motion:** a single static frame of the beam shape (no ticker). Words swap with 0ms duration. If WebGL is unavailable or `navigator.connection?.saveData` is set, skip the import and keep the CSS radial-gradient glow already on the canvas element.
- **Source:** Vexel (Three.js point cloud reshaping per section, Lenis), WAMA (giant single words on dark).

### 7.8 Scroll-fill statement lines

- **Trigger:** scrubbed. Each line starts filling when its top crosses 80% of the viewport and completes 403px later (Redstone measured about 403px per line).
- **Parameters:** `--fill-progress` 0%→100%. Filled colour #fff; unfilled `--color-on-dark-20`. The lines are set in `--fs-h2`, stacked, on dark.
- **Implementation:**

```css
[data-fill] {
  background: linear-gradient(
    90deg,
    #fff var(--fill-progress, 0%),
    var(--color-on-dark-20) var(--fill-progress, 0%)
  );
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
```

```js
gsap.utils.toArray("[data-fill]").forEach((el) =>
  ScrollTrigger.create({
    trigger: el,
    start: "top 80%",
    end: "+=403",
    scrub: true,
    onUpdate: (s) => el.style.setProperty("--fill-progress", `${(s.progress * 100).toFixed(2)}%`),
  }),
);
```

- **Reduced motion:** set `--fill-progress: 100%` and do not create triggers.
- **Source:** Redstone (`--fill-progress`).

### 7.9 Hover-play video tiles

- **Trigger:** `pointerenter` / `focusin` on the tile (pointer-fine devices). On touch, plays when 60% in view.
- **Parameters:** video opacity 0→1 over 300ms `--ease-ui`; poster scale 1→1.04 over 600ms `--ease-out`. The video `src` is attached on first intent.
- **Implementation:**

```css
.tile {
  position: relative;
  background: #000;
  overflow: hidden;
}
.tile img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform var(--dur-media) var(--ease-out);
}
.tile video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity var(--dur-hover) var(--ease-ui);
}
.tile.is-playing video {
  opacity: 1;
}
.tile.is-playing img {
  transform: scale(1.04);
}
```

```js
const fine = matchMedia("(pointer: fine)").matches;
document.querySelectorAll("[data-hover-video]").forEach((tile) => {
  const v = tile.querySelector("video");
  const play = () => {
    if (REDUCED) return;
    if (!v.src) v.src = v.dataset.src;
    v.play().catch(() => {});
    tile.classList.add("is-playing");
  };
  const stop = () => {
    v.pause();
    tile.classList.remove("is-playing");
  };
  if (fine) {
    tile.addEventListener("pointerenter", play);
    tile.addEventListener("pointerleave", stop);
    tile.addEventListener("focusin", play);
    tile.addEventListener("focusout", stop);
  } else
    new IntersectionObserver(([e]) => (e.intersectionRatio > 0.6 ? play() : stop()), {
      threshold: [0, 0.6],
    }).observe(tile);
});
```

- **Reduced motion:** never play; the poster stays static and there is no scale.
- **Source:** WAMA (hover-play service videos, 300ms opacity, 600ms image scale).

### 7.10 Split CTA hover

- **Trigger:** `:hover` and `:focus-visible`.
- **Parameters:**
  - Label padding-inline goes from 24px/24px to 32px/16px.
  - The arrow circle translates −4px on x and the icon rotates from −45° (↗) to 0° (→).
  - Both use 500ms `--ease-in-out`. Label colour changes in 100ms ease.
- **Implementation:**

```html
<a class="btn-split" href="/contact"
  ><span class="btn-split__label">[Label]</span
  ><span class="btn-split__icon" aria-hidden="true"
    ><svg width="18" height="18" viewBox="0 0 18 18">
      <path
        d="M3 9h12M10 4l5 5-5 5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      /></svg></span
></a>
```

```css
.btn-split {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  text-decoration: none;
}
.btn-split__label {
  display: inline-flex;
  align-items: center;
  height: 48px;
  padding-inline: 24px;
  border-radius: var(--radius-pill);
  background: var(--color-ink);
  color: #fff;
  font-size: var(--fs-body);
  text-transform: none;
  transition:
    padding-inline var(--dur-swap) var(--ease-in-out),
    color var(--dur-instant) ease;
}
.btn-split__icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-round);
  background: var(--color-ink);
  color: #fff;
  transition: transform var(--dur-swap) var(--ease-in-out);
}
.btn-split__icon svg {
  transform: rotate(-45deg);
  transition: transform var(--dur-swap) var(--ease-in-out);
}
.btn-split:hover .btn-split__label,
.btn-split:focus-visible .btn-split__label {
  padding-inline: 32px 16px;
}
.btn-split:hover .btn-split__icon,
.btn-split:focus-visible .btn-split__icon {
  transform: translateX(-4px);
}
.btn-split:hover svg,
.btn-split:focus-visible svg {
  transform: rotate(0);
}
[data-theme="dark"] .btn-split__label,
[data-theme="dark"] .btn-split__icon {
  background: #fff;
  color: var(--color-ink);
}
```

- **Reduced motion:** `transition-duration: 0ms`. The state change remains.
- **Source:** Redstone (detached circle, 500ms `cubic-bezier(0.65,0,0.35,1)` padding animation), Vexel (↗ arrow).

### 7.11 Accordion (FAQ)

- **Trigger:** click or Enter/Space on the trigger button.
- **Parameters:** `grid-template-rows` 0fr→1fr over 500ms `--ease-in-out`. Inner content opacity 0→1 and translateY −8px→0 over 800ms `--ease-settle`. The plus icon rotates 45° over 500ms.
- **Implementation:**

```css
.acc__panel {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--dur-swap) var(--ease-in-out);
}
.acc__inner {
  overflow: hidden;
  opacity: 0;
  transform: translateY(-8px);
  transition:
    opacity var(--dur-spread) var(--ease-settle),
    transform var(--dur-spread) var(--ease-settle);
}
.acc__item.is-open .acc__panel {
  grid-template-rows: 1fr;
}
.acc__item.is-open .acc__inner {
  opacity: 1;
  transform: none;
}
.acc__icon {
  transition: transform var(--dur-swap) var(--ease-in-out);
}
.acc__item.is-open .acc__icon {
  transform: rotate(45deg);
}
```

```js
document.querySelectorAll(".acc__item").forEach((item) => {
  const btn = item.querySelector(".acc__trigger"),
    panel = item.querySelector(".acc__panel");
  panel.inert = true;
  btn.addEventListener("click", () => {
    const open = !item.classList.contains("is-open");
    item.classList.toggle("is-open", open);
    btn.setAttribute("aria-expanded", open);
    panel.inert = !open;
    requestAnimationFrame(() => ScrollTrigger.refresh());
  });
});
```

- **Reduced motion:** all transition durations are 0ms.
- **Source:** Redstone (measured `grid-template-rows 0.5s cubic-bezier(0.65,0,0.35,1)`, `opacity/transform 0.8s cubic-bezier(0.215,0.61,0.355,1)`).

### 7.12 Scroll-drift logo rows and flip counters

- **Logo rows**
  - **Trigger:** scrubbed while each row crosses the viewport.
  - **Parameters:** alternate rows drift xPercent 0→−7.04% and 0→+7.04% (Redstone's measured total `--x` drift). Each row is 116% wide with `margin-left: -8%` so no edge gap shows. Logos are monochrome, 40% opacity, 100% on hover over 300ms.
- **Flip counters**
  - **Trigger:** the stat enters at 85%, once.
  - **Parameters:** each digit is a 0–9 column; it translates to yPercent −digit×10 over 600ms `power4.out` with an 80ms stagger per digit (duration inferred).
- **Implementation:**

```js
gsap.utils.toArray("[data-drift]").forEach(
  (row, i) =>
    !REDUCED &&
    gsap.fromTo(
      row,
      { xPercent: 0 },
      {
        xPercent: (i % 2 ? 1 : -1) * 7.04,
        ease: "none",
        scrollTrigger: { trigger: row, start: "top bottom", end: "bottom top", scrub: true },
      },
    ),
);

document.querySelectorAll("[data-flip]").forEach((el) => {
  const value = el.dataset.flip;
  el.setAttribute("aria-label", value);
  el.textContent = "";
  const cols = [...value]
    .map((ch) => {
      const cell = document.createElement("span");
      cell.className = "flip__cell";
      cell.setAttribute("aria-hidden", "true");
      if (!/\d/.test(ch)) {
        cell.textContent = ch;
        el.append(cell);
        return null;
      }
      const col = document.createElement("span");
      col.className = "flip__col";
      col.innerHTML = [...Array(10).keys()].map((d) => `<span>${d}</span>`).join("");
      cell.append(col);
      el.append(cell);
      return { col, d: +ch };
    })
    .filter(Boolean);
  const run = () =>
    cols.forEach(({ col, d }, i) =>
      gsap.to(col, {
        yPercent: -d * 10,
        duration: REDUCED ? 0 : 0.6,
        ease: "power4.out",
        delay: REDUCED ? 0 : i * 0.08,
      }),
    );
  ScrollTrigger.create({ trigger: el, start: "top 85%", once: true, onEnter: run });
});
```

```css
.flip__cell {
  display: inline-block;
  height: 1em;
  overflow: hidden;
  line-height: 1;
  vertical-align: top;
  font-variant-numeric: tabular-nums;
}
.flip__col {
  display: flex;
  flex-direction: column;
}
.flip__col > span {
  height: 1em;
}
```

- **Reduced motion:** rows stay at 0; counters jump to the final value (duration 0).
- **Source:** Redstone (`--x` marquee, flipping digit counters).

### 7.13 Progressive edge blur + footer wordmark

- **Trigger:** the edge blur is visible only while a `[data-theme="dark"]` section covers the viewport bottom, desktop (≥810px) only. The wordmark is static.
- **Parameters:**
  - Edge blur: 12vh tall, four stacked layers at blur 1, 2, 4 and 8px (Redstone measured 1/2/4/8px), each masked to a successive band. Fades in and out over 300ms.
  - Wordmark: `--fs-display-xl`, `filter: blur(6px)`, masked to transparent at the bottom, sitting on a lime radial glow `rgba(205,255,89,.18)` (replaces Redstone's red glow).
- **Implementation:**

```html
<div class="edge-blur" aria-hidden="true">
  <i style="--b:1px;--s:0%;--e:40%"></i><i style="--b:2px;--s:25%;--e:65%"></i
  ><i style="--b:4px;--s:50%;--e:85%"></i><i style="--b:8px;--s:75%;--e:100%"></i>
</div>
```

```css
.edge-blur {
  position: fixed;
  inset: auto 0 0;
  height: 12vh;
  pointer-events: none;
  z-index: var(--z-edge-blur);
  opacity: 0;
  transition: opacity var(--dur-hover) var(--ease-ui);
}
.edge-blur.is-on {
  opacity: 1;
}
.edge-blur > i {
  position: absolute;
  inset: 0;
  backdrop-filter: blur(var(--b));
  -webkit-backdrop-filter: blur(var(--b));
  mask-image: linear-gradient(to bottom, transparent var(--s), #000 var(--e));
  -webkit-mask-image: linear-gradient(to bottom, transparent var(--s), #000 var(--e));
}
@media (max-width: 809px) {
  .edge-blur {
    display: none;
  }
}
.footer {
  position: relative;
  overflow: hidden;
  background: var(--color-ink);
}
.footer::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: -30%;
  width: 80vw;
  height: 60vh;
  translate: -50% 0;
  background: radial-gradient(closest-side, rgba(205, 255, 89, 0.18), transparent);
  pointer-events: none;
}
.footer__mark {
  font-size: var(--fs-display-xl);
  line-height: 0.8;
  letter-spacing: var(--ls-display);
  color: #fff;
  text-align: center;
  filter: blur(6px);
  mask-image: linear-gradient(#000 30%, transparent);
  -webkit-mask-image: linear-gradient(#000 30%, transparent);
  user-select: none;
}
```

```js
const edge = document.querySelector(".edge-blur");
document.querySelectorAll('[data-theme="dark"]').forEach((s) =>
  ScrollTrigger.create({
    trigger: s,
    start: "top bottom",
    end: "bottom bottom",
    onToggle: (st) => edge.classList.toggle("is-on", st.isActive),
  }),
);
```

The wordmark element gets `aria-hidden="true"`; the real brand name lives in the logo link.

- **Reduced motion:** the blur may remain (it is not motion), but fades are instant.
- **Source:** Redstone.

### 7.14 Cursor follower

- **Trigger:** `pointermove`, only when `(pointer: fine)` and motion is allowed.
- **Parameters:** 10px dot following with `gsap.quickTo`, 350ms `power3.out`. Over `[data-cursor="play"]` it grows to 72px, fills `--color-accent`, drops the blend mode and shows a "play" label. Size changes over 300ms `--ease-ui`.
- **Implementation:**

```css
.cursor {
  position: fixed;
  top: 0;
  left: 0;
  width: 10px;
  height: 10px;
  margin: -5px 0 0 -5px;
  border-radius: 50%;
  background: #fff;
  mix-blend-mode: difference;
  pointer-events: none;
  z-index: var(--z-cursor);
  display: grid;
  place-items: center;
  font-size: 12px;
  color: var(--color-ink);
  transition:
    width var(--dur-hover) var(--ease-ui),
    height var(--dur-hover) var(--ease-ui),
    margin var(--dur-hover) var(--ease-ui),
    background-color var(--dur-hover) var(--ease-ui);
}
.cursor.is-play {
  width: 72px;
  height: 72px;
  margin: -36px 0 0 -36px;
  background: var(--color-accent);
  mix-blend-mode: normal;
}
.cursor.is-play::after {
  content: "play";
}
```

```js
if (matchMedia("(pointer: fine)").matches && !REDUCED) {
  const dot = Object.assign(document.createElement("div"), { className: "cursor" });
  dot.setAttribute("aria-hidden", "true");
  document.body.append(dot);
  const xTo = gsap.quickTo(dot, "x", { duration: 0.35, ease: "power3.out" }),
    yTo = gsap.quickTo(dot, "y", { duration: 0.35, ease: "power3.out" });
  addEventListener("pointermove", (e) => {
    xTo(e.clientX);
    yTo(e.clientY);
  });
  document.querySelectorAll('[data-cursor="play"]').forEach((el) => {
    el.addEventListener("pointerenter", () => dot.classList.add("is-play"));
    el.addEventListener("pointerleave", () => dot.classList.remove("is-play"));
  });
}
```

- **Reduced motion:** not created; only the native cursor is used.
- **Source:** Redstone (custom cursor present). Behaviour details are inferred.

## 8. Imagery, texture and 3D

**Imagery rules**

- **Saturated colour comes only from content.** Product screenshots sit inside device frames (laptop, phone or tablet) on fan cards, each with one flat `--card-*` background. Use the real Take studio UI; do not use stock photography. (Source: WAMA)
- **Project and case visuals:**
  - Light grey `--color-surface` stage, device mockup rotated −12° to −20°, soft contact shadow.
  - Images use radius 10px.
  - Formats: AVIF with WebP fallback, `srcset` at 480/960/1440/1920w.
- **Video tiles:**
  - Short loops (4–8s), black backgrounds, 3D object or UI micro-motion centred.
  - Encoding: H.264 MP4 plus WebM, 720p, ≤2.5MB each, no audio track, `muted playsinline loop preload="none"`, with a poster frame.
- **Reel:** 1080p, ≤8MB, with a poster. Attach a `<track>` captions file if it contains speech.

**WebGL approach (dark stage only)**

- Three.js `Points` with a custom `ShaderMaterial` (recipe 7.7). The geometry is procedural (beam, ring, wave), so there is no model download.
- One canvas, sticky within `.studio`. It never renders outside that section.
- Lightweight path:
  1. Import `three` dynamically (≈150KB gz) only when `.studio` is within one viewport.
  2. Cap DPR at 1.5 and use 8k points on mobile.
  3. Skip WebGL entirely when `saveData` is set, when `WebGLRenderingContext` is missing, or when `deviceMemory < 4`. The CSS radial-gradient glow on the canvas stays as the fallback.
  4. Dispose geometry and material on route change: `geo.dispose(); mat.dispose(); renderer.dispose();`.

**Glass over light** (Source: Vexel)

- Glass cards placed over the field use `backdrop-filter: blur(10px)`, so the particle light bleeds through.
- Never put glass on the white shell; there it is only used for the floating nav.

**Grain (inferred addition, dark only)**

- A 4% opacity noise overlay on `.studio` and `.footer` hides gradient banding in the glow:

```css
.studio::after,
.footer::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.04;
  z-index: var(--z-base);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
```

- Never apply grain to the white shell.

## 9. Responsive and mobile behaviour

| Area              | ≥1200                                  | 810–1199           | <810                                   | <480                                     |
| ----------------- | -------------------------------------- | ------------------ | -------------------------------------- | ---------------------------------------- |
| Nav               | Full links centred, floats after 202px | Links gap 24px     | Logo + CTA + burger, sheet menu        | CTA label shortens, 36px tall            |
| Hero              | Centred h1/lead                        | Centred            | Left-aligned h1/lead, fan full-bleed   | Same; fan height 300px, card width 160px |
| Fan loop          | On                                     | On                 | On (8 cards)                           | On; paused if `saveData`                 |
| Reel              | Clip-path expand (7.5)                 | Expand             | Inline 16:9 video, tap to play         | Same                                     |
| Arc               | `clamp(48px,10vw,160px)`               | Same               | Same (≈48px)                           | Same                                     |
| Particle field    | 24k points                             | 24k, DPR 1.5       | 8k, DPR 1.5                            | 8k; skip if `deviceMemory < 4`           |
| Giant words       | Sticky sequence                        | Same               | Same, `--fs-display-xl` floors at 66px | Same                                     |
| Bento             | 2fr/1fr rows                           | 1fr 1fr            | Single column                          | Single column                            |
| Capabilities grid | 4 uneven columns                       | 2 columns          | 2 columns                              | 1 column                                 |
| Video tiles       | Hover-play                             | Hover-play         | In-view play                           | In-view play                             |
| Edge blur         | On                                     | On                 | Off                                    | Off                                      |
| Cursor            | On (pointer fine)                      | On if pointer fine | Off                                    | Off                                      |
| Footer            | 4 columns                              | 4 columns          | 2 columns                              | 1 column, accordion-free stacked lists   |

**General mobile rules**

- Touch targets are at least 44×44px.
- Use `100svh` instead of `100vh` for sticky stages on iOS: write `height: 100vh; height: 100svh;`.
- Lenis does not smooth touch scrolling, so native momentum is kept.
- Horizontal overflow is clipped at `.fan`, `[data-drift]` parents and `body { overflow-x: clip; }`.

## 10. Accessibility and performance guardrails

**Contrast (verified pairs)**

- `#030303` on `#ffffff`: 20.6:1.
- `#4f4f4f` on `#ffffff`: 8.0:1. This is the floor for muted text on white.
- White @0.75 on `#010101` ≈ 11:1. White @0.60 ≈ 7:1. White @0.20 is decorative only (unfilled fill-text and borders); the text content must still be present at full contrast once filled or via its accessible name.
- `--color-accent` `#cdff59` is **never used as text on white** (1.1:1). It is allowed on dark backgrounds (≈17:1) and as a fill behind ink text.
- Do not place text over the particle field without a glass card or a ≥0.6 black scrim behind it.

**Focus**

- Every interactive element gets `:focus-visible { outline: 2px solid var(--color-ink); outline-offset: 3px; }` on light and `outline-color: var(--color-accent)` on dark.
- Never remove an outline without replacing it.
- Add a skip link to `#main` as the first focusable element.

**Reduced motion (global)**

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}
```

- In JS, every recipe checks `REDUCED`: Lenis off, no scrubs, no loops, WebGL renders a single static frame, no cursor.

**Semantics**

- Split headings keep an `aria-label` on the heading, and their word spans are `aria-hidden`.
- The fan is a `<ul>` of links.
- Accordion triggers are `<button aria-expanded>` and closed panels are `inert`.
- Decorative canvas, wordmark and cursor are `aria-hidden`.
- Every video has no audio or has captions; tiles never autoplay sound.
- The mobile menu traps focus and closes on Esc.

**Loading**

- Preload the two Inter Tight woff2 files (300, 400) with `font-display: swap`. Subset to Latin plus the punctuation in use.
- The hero fan uses its first 5 visible card images with `fetchpriority="high"` on the centre card only. All other images use `loading="lazy" decoding="async"` with explicit `width`/`height`.
- Videos use `preload="none"` except the reel (`metadata`). Sources are attached on intent or in-view.
- Three.js is dynamically imported (§8). GSAP plugins load only where used (CustomEase, ScrollTrigger).

**Budgets**

| Metric                           | Budget                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| LCP (hero h1 or centre fan card) | ≤ 2.0s on 4G mid-tier                                                                      |
| CLS                              | ≤ 0.02                                                                                     |
| INP                              | ≤ 200ms                                                                                    |
| Initial JS (gz, excl. three)     | ≤ 90KB added over the `/sign-in` baseline (see spec 0010 AC-10)                            |
| Deferred JS (three + field)      | ≤ 170KB gz                                                                                 |
| Fonts                            | ≤ 70KB total                                                                               |
| Above-fold images                | ≤ 450KB                                                                                    |
| Per video tile                   | ≤ 2.5MB                                                                                    |
| WebGL frame time                 | ≤ 6ms at 1440p on integrated GPU; drop to 12k points if exceeded (measure first 60 frames) |

## 11. Build checklist

1. **Audit the repo** (`take-studio-v2`). List existing routes, framework and component files. Map them to the §4 page map. Keep the repo's framework and add only `gsap`, `lenis` and `three`.
2. **Tokens.** Add the §2 `:root` block as `styles/tokens.css`. Add a base reset, `body { font: var(--fw-light) var(--fs-body)/var(--lh-body) var(--font-sans); letter-spacing: var(--ls-body); color: var(--color-ink); background: var(--color-bg); }` and the `.container` rule.
3. **Fonts.** Self-host the Inter Tight 300/400/500 woff2 files, preload 300 and 400, and set up the type utilities from the §3 table (`.t-h1`, `.t-h2`, `.t-eyebrow`, and so on).
4. **Static build of all sections** with real semantics and no motion: nav, hero (two-tone h1, lead, static fan), reel (inline), proof, studio (dark, arc, CSS glow fallback, words stacked, bento of glass cards, fill lines at 100%), capabilities grid, numbers, FAQ, contact form, footer with wordmark.
5. **Components and states.** Build buttons (primary, split, ghost), link underline system, focus rings, form fields, chips, accordion (7.11), and the mobile menu with focus trap.
6. **Motion core.** Add `eases.js` (EASE map + `REDUCED`) and `scroll.js` (Lenis + ScrollTrigger), and add the `js` class to `<html>`.
7. **Entrances.** Implement 7.3 `take-enter` across sections and 7.1 word reveals on section h2s.
8. **Nav behaviour.** Implement 7.4 (float at 202px, dark variant via `[data-theme="dark"]`).
9. **Hero.** Implement the intro timeline (§6) and the fan loop (7.2) with off-screen pause.
10. **Reel.** Implement 7.5 for ≥810px, with the inline fallback below that.
11. **Dark stage.** Implement the arc (7.6), the lazy-loaded particle field and word sequence (7.7), and the fill lines (7.8).
12. **Light details.** Implement video tiles (7.9), split CTA (7.10), logo drift and flip counters (7.12), edge blur and footer wordmark (7.13), and the cursor (7.14).
13. **Reduced-motion pass.** Toggle the OS setting and verify every recipe's fallback. There must be no hidden content, no loops and no WebGL ticker.
14. **Responsive pass.** Check 390, 480, 810, 1200 and 1440 widths against the §9 table, and check the `100svh` sticky stages on iOS Safari.
15. **A11y pass.** Keyboard-only run-through, screen reader check of split headings, contrast spot checks, and confirm the skip link works.
16. **Performance pass.** Lighthouse mobile ≥90. Check bundle sizes against §10, WebGL frame time, and that videos load on intent only.
17. **Clean-up.** Call `ScrollTrigger.refresh()` after fonts load (`document.fonts.ready`) and after accordion toggles. Kill triggers and dispose WebGL on route change.

## 12. References

| Site              | URL                                                                      | What was taken                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WAMA              | https://wama.com.br/en (Awwwards: https://www.awwwards.com/sites/wama-2) | Light Swiss shell and monochrome palette (#ffffff, #030303, #252528, #4f4f4f, #d2cdd8); acid-lime accent #cdff59; single-family grotesk system with light body weight; type sizes 56/32/20/16/14/12 and tracking (-0.01em headings, +0.01em body, 0.05em eyebrows); 1400px max-width, 160px section padding, 24px gutter; two-tone hero headline; radial fan of cards with -28px 8px 40px shadow and 4000ms `cubic-bezier(0.37,0,0.63,1)` loop; `wama-entra` entrance (700ms, `cubic-bezier(0.22,0.61,0.36,1)`, 70ms delay); 800ms `cubic-bezier(0.35,0,0,1)` spread; image hover 600ms `cubic-bezier(0.22,1,0.36,1)`; UI transitions 300/400ms `cubic-bezier(0.44,0,0.56,1)`; nav variant switch with 200ms bg; nav glass `blur(16px) saturate(1.6)` over white @0.72; convex dark-section arc; uneven video services grid; breakpoints 810/1200. |
| Vexel AI          | https://tranquil-495tmg.peachworlds.com/                                 | Dark stage concept (#010101 base); Three.js point cloud as a sticky scroll-driven backdrop that reshapes per section (our shapes are procedural, not their head model); WebGL-only blue ramp #47a7ca / #074868 / #011836; Lenis smooth scroll; fade-up 20px reveals; 460ms linear nav fade; glass cards (black @0.30, blur 10px, 1px white @0.10 border, 12px radius); dark glass pill nav (black @0.60); ↗ arrow-in-circle buttons; tight display tracking (-0.045em → -0.04em); breakpoint 480.                                                                                                                                                                                                                                                                                                                                                  |
| REDSTONE software | https://redstone.software/                                               | Corner thumbnail → full-viewport reel expansion over 806px of scroll (re-implemented with clip-path); header turning into a floating pill at 202px; word-by-word headline reveal (1500ms `cubic-bezier(0.33,1,0.68,1)`); split pill + detached circle CTA (500ms `cubic-bezier(0.65,0,0.35,1)`); scroll-linked `--x` drift (±7.04%) and `--fill-progress` text fill (about 403px per line); flipping digit counters; accordion timing (`grid-template-rows` 500ms + content 800ms `cubic-bezier(0.215,0.61,0.355,1)`); layered progressive bottom blur (1/2/4/8px); giant blurred footer wordmark with glow (recoloured to lime); fluid `clamp()` scale for display-xl; custom cursor presence.                                                                                                                                                    |

**Mobbin references (team rule; add more per screen in each PR)**

| Pattern                                                                           | Reference                                                                                                                                                                                                                                                                                                                                      | What to take                                                                                                                                               |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Light hero with big headline for a video tool                                     | [Descript hero](https://mobbin.com/sites/sections/a97e8cac-2b30-4766-981a-9f542df9524a)                                                                                                                                                                                                                                                        | Calm white shell, one dark pill CTA, product imagery as the colour                                                                                         |
| Dark section with product UI inside                                               | [Descript dark feature section](https://mobbin.com/sites/sections/1a5cd1d5-1cbe-4256-88cd-515a00412a10)                                                                                                                                                                                                                                        | Light to dark shift, product screenshot on the dark panel                                                                                                  |
| Video product hero with timeline motif                                            | [VEED hero](https://mobbin.com/sites/sections/b8cc9a0e-0fde-47d8-a726-a2a42e863c5a)                                                                                                                                                                                                                                                            | Video plus a timeline strip as proof of the product                                                                                                        |
| FAQ accordion, divider rows                                                       | [monday.com FAQs](https://mobbin.com/sites/sections/3f750e1f-9291-4fd7-a27d-331f750a57ac)                                                                                                                                                                                                                                                      | Full width rows, hairline dividers, chevron or plus on the right                                                                                           |
| FAQ on dark                                                                       | [Origin FAQ](https://mobbin.com/sites/sections/1f1caf97-2f02-4668-bc84-05c7f760d6d2)                                                                                                                                                                                                                                                           | Plus icon rotating to close, heading left, rows right                                                                                                      |
| Video editor: player above a timeline                                             | [Canva video editor](https://mobbin.com/screens/95c87b38-b0f6-4cf0-8ac8-2be5cd7c95c0)                                                                                                                                                                                                                                                          | Centred player, transport under it, timeline below (slice 4)                                                                                               |
| Editor with a right side panel                                                    | [Jitter editor](https://mobbin.com/screens/17629e26-aaab-4170-b7c7-3374a5e0330c)                                                                                                                                                                                                                                                               | Canvas left, inspector right, timeline at the bottom                                                                                                       |
| Right inspector with settings and a primary action                                | [Recraft editor](https://mobbin.com/screens/adbfa3f1-a61d-4831-8d40-39e5e8f54f8c)                                                                                                                                                                                                                                                              | Inspector sections and a full width primary action at the bottom                                                                                           |
| Dialog with a pill primary and a ghost cancel                                     | [Canva remove dialog](https://mobbin.com/screens/8a14835c-2a0d-41ab-a1ef-03e00a70674f)                                                                                                                                                                                                                                                         | Short title, one sentence, ghost pill beside a filled pill                                                                                                 |
| Dialog with a full width primary action                                           | [Meetup cancel event](https://mobbin.com/screens/bd48b511-e4cc-4d58-a333-dd02689f4400)                                                                                                                                                                                                                                                         | Dark full width pill, close icon top right, dimmed page behind                                                                                             |
| Destructive confirm, cancel left                                                  | [Luma delete skill](https://mobbin.com/screens/85fe1291-5464-4bd2-8d5c-8f8ad3a0245c)                                                                                                                                                                                                                                                           | Cancel as a quiet pill, destructive action as the filled pill                                                                                              |
| Settings tabs                                                                     | [Sprig settings](https://mobbin.com/screens/8ccdba1a-c492-4739-90c7-8db6d1ff552d)                                                                                                                                                                                                                                                              | Small tab group above a panel, active tab filled                                                                                                           |
| Form fields, chips and a toggle                                                   | [Buy Me a Coffee edit page](https://mobbin.com/screens/ec767bb6-6afc-4afc-8e36-bc2b16a48ab0)                                                                                                                                                                                                                                                   | Label above, helper under, chips as pills, switch on the right                                                                                             |
| App sidebar: primary action, nav, recents, user                                   | [Base44 home](https://mobbin.com/screens/24b57a20-f280-489a-9497-699a77e8f0dd)                                                                                                                                                                                                                                                                 | Logo, nav, short Recents list, user row pinned at the bottom                                                                                               |
| Sidebar with a clear active item                                                  | [Luma recents](https://mobbin.com/screens/a389ce44-b241-4565-829a-9f2e51d971bd)                                                                                                                                                                                                                                                                | One filled row marks where you are                                                                                                                         |
| Sidebar beside a quiet content column                                             | [Plane home](https://mobbin.com/screens/87fdc65c-84be-4415-9540-ca272a499f4f)                                                                                                                                                                                                                                                                  | Hairline between sidebar and page, breadcrumb style header                                                                                                 |
| Sidebar with a Recents section                                                    | [Tally home](https://mobbin.com/screens/68a9c184-c4cd-4784-a7f1-0fb71c8fb9e7)                                                                                                                                                                                                                                                                  | Section label in small caps, then rows                                                                                                                     |
| Mobile nav drawer with recents                                                    | [ChatGPT drawer](https://mobbin.com/screens/fe939291-d13d-4014-8bb5-dd937d035a93)                                                                                                                                                                                                                                                              | Left drawer over the page, nav then Recents, action at the bottom                                                                                          |
| Mobile nav drawer, dimmed page behind                                             | [Bevel drawer](https://mobbin.com/screens/3e60096b-5f5e-49d6-a942-12bc0fe6cbe8)                                                                                                                                                                                                                                                                | Drawer width leaves a strip of the page visible                                                                                                            |
| Dark editor with a tabbed side panel                                              | [Canva Studio effects](https://mobbin.com/screens/64f4870c-03d0-49cf-875a-67617eb4483a)                                                                                                                                                                                                                                                        | Dark surround, two tabs on top of the panel, preview centred                                                                                               |
| Video preview with a transport bar and Export                                     | [Luma final video](https://mobbin.com/screens/5a4782b2-8a9c-41ba-8d06-a0f23b409fe8)                                                                                                                                                                                                                                                            | Transport sits right under the video, one Export action                                                                                                    |
| Inspector panel next to the canvas                                                | [Subframe editor](https://mobbin.com/screens/ab152242-64fa-4274-8837-937b92459c37)                                                                                                                                                                                                                                                             | Sectioned inspector on the right, hairlines between sections                                                                                               |
| Video editor timeline with trim segments                                          | [VEED editor](https://mobbin.com/screens/7b23c07d-8202-4a67-a768-7d05bd891f05)                                                                                                                                                                                                                                                                 | Segment blocks on one track under the player (S4C-T03)                                                                                                     |
| Editor timeline with a waveform                                                   | [Descript editor](https://mobbin.com/screens/6de64982-0039-4273-912a-3be08ffee934)                                                                                                                                                                                                                                                             | Loudness drawn behind the blocks (S4C-T03)                                                                                                                 |
| Unsaved changes bar                                                               | [Shopify unsaved changes](https://mobbin.com/screens/cbe5200e-30c4-4f3e-bd4e-62ff2f44341c)                                                                                                                                                                                                                                                     | Sticky bar, Discard as the quiet action, one primary (S4C-T03)                                                                                             |
| Pending changes with a list of what changes                                       | [Productboard](https://mobbin.com/screens/5db2cf9e-41e9-432a-9dee-3704be875050)                                                                                                                                                                                                                                                                | The changes named in the bar, not only counted (S4C-T03)                                                                                                   |
| Timeline with a quiet caption line under it (cut reasons)                         | [Canva editor timeline](https://mobbin.com/screens/c83042ea-10aa-4cdf-a671-e7c47b5258d0)                                                                                                                                                                                                                                                       | One muted line says what the focused item is, nothing over the footage                                                                                     |
| Plain inline not available notice (AI edit wasn't available)                      | [Stripe Identity not available](https://mobbin.com/screens/6002db5a-995f-419f-acb8-6fb5dad77d78)                                                                                                                                                                                                                                               | A calm sentence in the content area, no alarm colour, nothing to dismiss                                                                                   |
| Homepage hero, headline over product visual (DV0-T05)                             | [Descript hero](https://mobbin.com/sites/sections/558619f3-0361-45d7-8111-c587d18244c7), [VEED hero](https://mobbin.com/sites/sections/b8cc9a0e-0fde-47d8-a726-a2a42e863c5a)                                                                                                                                                                   | Big headline, one sentence lead, product imagery carries the page                                                                                          |
| Homepage FAQ accordion (DV0-T05)                                                  | [Teak](https://mobbin.com/sites/sections/71b84103-e862-4f0f-adaf-a6260f899849), [Miro](https://mobbin.com/sites/sections/8fef486c-9277-409a-9ac4-4050e169beb2), [Linktree](https://mobbin.com/sites/sections/5465a90b-d01d-46c5-bd93-e9d3f33be990)                                                                                             | Heading left, rows right, plus icon, one answer open                                                                                                       |
| Homepage dark footer (DV0-T05)                                                    | [Linear](https://mobbin.com/sites/sections/4643c95a-5a5b-46cf-999c-bb3f328fd281), [Monologue](https://mobbin.com/sites/sections/bd6f7404-a506-44ad-ae32-b3ac1991252b), [Squarespace](https://mobbin.com/sites/sections/10f3b92c-1829-4e60-8f75-265bf7919ec1)                                                                                   | Quiet link columns, small legal row under them                                                                                                             |
| Video tiles: poster, play on hover or in view (DV0-T08)                           | [Framer Videos](https://mobbin.com/sites/sections/5ca74586-38a0-4400-88de-4c7988259e45), [Clay](https://mobbin.com/sites/sections/f5a2805f-121a-4be0-a265-de14efb24122), [Rox](https://mobbin.com/sites/sections/ca9828f3-7212-47f5-a90f-bb66a0307d60), [Miro](https://mobbin.com/sites/sections/3d3c12b3-7878-4424-8a0f-ab3e71922a9b)         | Poster tiles with a clear play affordance on the picture; the video replaces the poster, a play or pause button stays                                      |
| Homepage FAQ accordion motion (DV0-T08)                                           | [Mixpanel](https://mobbin.com/sites/sections/67d59fad-c6e5-43b0-814b-469bcf735e79), [Lattice](https://mobbin.com/sites/sections/1c9412fe-a762-483c-9993-125a46164b6b), [Relume](https://mobbin.com/sites/sections/46c35afd-06bf-41fc-bb0b-83cb1494e5ef), [Harvest](https://mobbin.com/sites/sections/0c073171-fb09-4b13-b140-937acb761f2c)     | Plus turns to a cross on open, hairline rows, the open row stands out, one answer open                                                                     |
| Limits counters, flipping digits (DV0-T08)                                        | [Railway](https://mobbin.com/sites/sections/fdccd8a8-b0fc-4cf4-ac07-75a7775ee4e3), [Shopify](https://mobbin.com/sites/sections/4e11a98c-102b-43a7-a408-2b17f444124d), [Loom](https://mobbin.com/sites/sections/06e75d33-6677-4bcb-a50f-aff8b11b4b7f), [Mixpanel stats](https://mobbin.com/sites/sections/78a46ec2-49e2-45e9-a0bd-33d65bc69ff2) | Big numerals with a small caption, digits roll in cells once when the section arrives                                                                      |
| Split arrow CTA (DV0-T08)                                                         | [Dropbox](https://mobbin.com/sites/sections/75e0be6b-4ee4-41e6-abeb-2e05928cc348), [Tailscale](https://mobbin.com/sites/sections/006c2f50-0fba-47fa-b693-4516bac44838), [TravelPerk](https://mobbin.com/sites/sections/649623d8-b4b8-4fc5-b14e-581becd2a230), [Mews](https://mobbin.com/sites/sections/447e78cf-85b9-4a91-87d7-5c90928efe37)   | Pill label plus a detached arrow circle; the arrow straightens and the pair closes up on hover                                                             |
| Footer giant wordmark (DV0-T08)                                                   | [Feather](https://mobbin.com/sites/sections/8b7c16ff-9fcf-414a-90d1-3eb469c45ade), [Cosmos](https://mobbin.com/sites/sections/277145c1-b152-4185-ba3a-5568988cc33a), [Zellerfeld](https://mobbin.com/sites/sections/18df6730-6569-49da-9c23-3bee32fbe638)                                                                                      | Huge low contrast wordmark cut by the bottom edge, decorative only                                                                                         |
| Custom cursor with a label (DV0-T08)                                              | [Framer Custom Cursors](https://mobbin.com/sites/sections/e6098968-5b01-4b77-87f9-a8ab11f1c92c), [Opacity](https://mobbin.com/sites/sections/aa78df4e-e768-4c84-956a-35bf1072f469), [Spline Follow](https://mobbin.com/sites/sections/e5bd695a-b697-4248-9dae-7dad1a2ae0c4)                                                                    | Closest Mobbin has (few cursor sections): a small dot that follows and grows into a labelled pill over media                                               |
| Library: grid of project cards                                                    | [Jitter drafts](https://mobbin.com/screens/bbfd6027-a13d-4f46-9566-f00ab5d27c86)                                                                                                                                                                                                                                                               | Big page title, create action on top, thumbnails with quiet text below                                                                                     |
| Library: cards on a calm page                                                     | [Replit projects](https://mobbin.com/screens/80883fe0-caf8-4ef3-89d3-71b315f45e0b)                                                                                                                                                                                                                                                             | Even grid, small meta line under each title                                                                                                                |
| Library with recents and a list                                                   | [Canva all projects](https://mobbin.com/screens/bbe90d62-327b-42ab-9455-e6fda54637d2)                                                                                                                                                                                                                                                          | Sidebar plus a main column with sections                                                                                                                   |
| Sign in: one card, Google and email                                               | [Spellbook sign in](https://mobbin.com/screens/12ed60fb-67fe-42e0-8fbb-18bdba273210)                                                                                                                                                                                                                                                           | Logo, short title, email field and button, then "or" and Google                                                                                            |
| Sign in: plain page with Google first                                             | [Searchable sign in](https://mobbin.com/screens/d56b974a-2a8c-4522-8c2a-7092dcabcd1a)                                                                                                                                                                                                                                                          | Calm page, one headline, wide options                                                                                                                      |
| Not found and error: short, with one action                                       | [Calendly closing page](https://mobbin.com/screens/73551411-b7ce-4fec-a2de-41b89196caa9)                                                                                                                                                                                                                                                       | Logo, one sentence, one pill button                                                                                                                        |
| Error with an icon and Retry                                                      | [Snowflake error](https://mobbin.com/screens/936ca155-0804-4431-978b-ecc2e053294c)                                                                                                                                                                                                                                                             | Icon, title, one line, primary action next to a quiet Retry                                                                                                |
| Floating glass pill navigation (DV0-T06)                                          | [Analogue Agency](https://mobbin.com/sites/sections/2897fc9c-97a9-48e6-9b96-ea02583b012d), [T1 Energy](https://mobbin.com/sites/sections/08b1da0a-e784-4a8c-8d23-0359ff00b023)                                                                                                                                                                 | Detached pill over the page, logo left, links and one light CTA right                                                                                      |
| Full bleed video showcase with a quiet menu control (DV0-T06)                     | [Freshman](https://mobbin.com/sites/sections/1a15a6d9-be03-4761-9a3a-30ec06495846)                                                                                                                                                                                                                                                             | Video fills the screen, the page chrome stays minimal over it                                                                                              |
| Dark section with a particle field and a centred headline (DV0-T07)               | [Squarespace](https://mobbin.com/sites/sections/c89f9f86-b4f8-4d83-ae11-71ba2fb6f5f3)                                                                                                                                                                                                                                                          | Points as the only decoration, one short line of type in the middle                                                                                        |
| Giant centred statement on dark (DV0-T07)                                         | [Phantom](https://mobbin.com/sites/sections/91667ea8-0891-4eae-a102-8925a108f6f2)                                                                                                                                                                                                                                                              | Large light type centred on a flat dark ground, nothing else competing                                                                                     |
| Inline fixes list with undo (S5A-T05)                                             | [Grammarly review suggestions](https://mobbin.com/screens/82d0d01f-8aa2-4fe4-a658-1498c92fb1ae), [WRITER suggestions](https://mobbin.com/screens/86be1a0d-c6a7-4ab1-a1e9-8dba97522a53), [Descript](https://mobbin.com/screens/dcb7a1b2-20ed-4014-a6d8-724463114e70)                                                                            | Old struck to new on one line with the reason, the changed word marked in the text, one action per row                                                     |
| Delete confirm dialog: title, consequence line, Cancel and a red Delete (B2-T07)  | [Canva](https://mobbin.com/screens/7ef0021b-0262-44d8-9217-54483d23b08b), [Shopify](https://mobbin.com/screens/78cb9e34-8dc7-4880-a70b-e53194cea6dd), [Luma](https://mobbin.com/screens/ee41384f-43ea-4784-be2d-2eb270d99a68), [SoundCloud](https://mobbin.com/screens/c9564f1f-aa8a-4d58-a171-713302fe7901)                                   | Names the item, says what goes and that it can't be undone; destructive button on the right, plain cancel beside it                                        |
| Card overflow menu with a destructive item last (B2-T07)                          | [Canva card menu](https://mobbin.com/screens/f6be1873-e1d1-4600-b5a2-a18f91d1ec2b), [Gemini Notebook cards](https://mobbin.com/screens/28a7dce6-6824-4906-9d4b-0fe5273e652d)                                                                                                                                                                   | Three-dot button top right of the card, separate from the card link; Delete sits last in the menu                                                          |
| Expired take page: what is gone, what is kept, and the download (B2-T17)          | [Voicenotes transcript](https://mobbin.com/screens/bb1cfa26-6afa-4f76-88d5-4efd9c028267), [Descript transcript](https://mobbin.com/screens/2b3c08f5-223b-4296-b17b-50a945120b33), [Mistral AI speech to text](https://mobbin.com/screens/e437de43-5a95-43bd-8f7d-7e391f3e1c39)                                                                 | Transcript stays readable as the main content, downloads sit beside it in one menu or row of links, one quiet line says what was removed                   |
| Expiry countdown wording in a file list (B2-T17)                                  | [Dropbox Dash](https://mobbin.com/screens/06e1ed84-a58d-4436-897c-a172cd55fc99)                                                                                                                                                                                                                                                                | Short plain note under the title, only shown when the date is near                                                                                         |
| Usage meter: thin bar with used of allowed and the reset date (spec 0014, B2-T23) | [SoundCloud upload](https://mobbin.com/screens/768e3355-763b-4926-95de-f165d59d638b), [Base44 credit usage](https://mobbin.com/screens/214cd277-2b79-4f21-917f-1f4e225f07ed)                                                                                                                                                                   | A quiet strip above the drop zone: a short bar, plain text for what is used, and when it renews. No chart, no upsell button                                |
| Limit reached: a plain notice with the reset date (spec 0014, B2-T23)             | [Sprig usage](https://mobbin.com/screens/83f67504-08a2-499e-823d-03a52c3f28a3)                                                                                                                                                                                                                                                                 | Say what happened and `Resets on <date>` in one calm line; the drop zone keeps its shape and turns off instead of disappearing                             |
| List of cuts, each with its reason and its own Undo or Redo (B2-T25)              | [Rocket Money transactions](https://mobbin.com/screens/6a30f4ff-59fe-4dae-b402-4edd71ff5516), [Confluence versions](https://mobbin.com/screens/b405410d-7a2d-4bd6-b44d-4efa934e0dec)                                                                                                                                                           | One row per item with its facts in plain columns and the row action (Undo, Restore) at the right end of the same row; we put the reason under the row text |
| Undo as a plain labelled button, not hidden behind a gesture (B2-T25)             | [Netflix removed from My List](https://mobbin.com/screens/5211d5f6-c653-4210-aead-047adec26c9a), [Zoom column updated](https://mobbin.com/screens/3975bc50-be6e-41d6-9bf6-eb7b8d3eaea3)                                                                                                                                                        | Undo is a visible text button next to what changed; selecting a row to read it never triggers it                                                           |
| Delete account confirm dialog (B2-T33)                                            | Mobbin unavailable (2026-11-14), built from design.md tokens and the existing take delete dialog in this app                                                                                                                                                                                                                                   | Short title, one sentence naming what is lost, secondary "Keep my account" beside the destructive pill                                                     |
