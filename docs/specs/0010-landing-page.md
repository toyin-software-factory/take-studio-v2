# 0010. Landing page and SEO

**Date**: 2026-11-12
**Status**: In Progress

## Summary

The public homepage (`/` for signed out visitors) is built from Toyin's v2 homepage draft: a calm white top, a dark "studio floor" with a moving particle field, short honest sections and a clear way to start. Every line describes what Take Studio does today. The page is server rendered for search and sharing, and the motion loads on top only where the device can afford it. Tokens and components come from spec 0009 and `design.md`.

## Context

Scope feature 15 asked for a simple public page that explains the product, leads to sign up, carries title, description and share preview metadata, and meets WCAG AA. Toyin's v2 draft (`docs/design/home-v2.html`, approved for publishing with its images and videos) goes further with a GSAP, Lenis and Three.js motion system. The design system decision itself is spec 0009; this spec is the page.

Toyin decided (Slack, 2026-11-12): keep "Made for solo creators" and "The limits" as drafted; turn "Early access" into a closing call to action without a form; contact is `hello@takestudio.app`; copy describes only what works today.

## Requirements

**User stories**:
- As a creator who lands on the site, I want to understand in seconds what Take Studio does and start with one click.
- As a creator on a phone, slow connection or with reduced motion, I want the same content without the heavy effects.
- As Toyin, I want the page to be found and to look right when shared.

**Acceptance criteria**:
- **AC-1**: A signed out visit to `/` renders the ten sections in `design.md` §4 in order (nav, hero, reel, made for solo creators, the studio floor, what it does, the limits, questions, closing call to action, footer). A signed in visit keeps the current behaviour (goes to the takes library).
- **AC-2**: All copy is true today: no line claims the cut review timeline, undoing single cuts, AI agents choosing cuts or a monthly limit before those ship; "coming soon" appears only for the public API and MCP server. Calls to action go to sign in ("Upload a take", "Upload your first take"); "Questions?" is a `mailto:hello@takestudio.app` link. There is no form.
- **AC-3**: The page HTML is server rendered with all text present before any script runs. It has a title, meta description, canonical URL, Open Graph and Twitter card tags with a 1200×630 share image, `SoftwareApplication` JSON-LD, and `robots.txt` plus `sitemap.xml` that list `/` and keep `/takes`, `/design` and API routes out.
- **AC-4**: Nav: fixed, turns into the floating glass pill after 202px of scroll, switches to its dark variant over dark sections, and under 810px shows logo, short call to action and a menu button that opens a full screen dialog (focus trapped, Esc closes).
- **AC-5**: Hero fan loop (7.2) pauses when it is out of view and has a visible pause and play toggle (keyboard operable, labelled, at least 44px) so anyone can stop it (WCAG 2.2.2); the choice holds for the visit; the reel expands from the corner thumbnail at 810px and up and is an inline 16:9 video below; the four capability tiles play on hover (pointer) or when in view (touch), muted, never with sound. Every video that starts on its own (the reel once it plays on scroll, tiles that play when in view) has a visible, labelled, keyboard operable pause and play control of at least 44px (WCAG 2.2.2); scroll driven effects that stop when scrolling stops need none.
- **AC-6**: The studio floor: convex arc entry, sticky particle field with the giant word sequence and glass bento, scroll fill lines. `three` is imported dynamically only when the section is within one viewport, rendering is skipped (CSS glow fallback) when `saveData` is set, WebGL is missing or `deviceMemory < 4`, and geometry, material and renderer are disposed when leaving the page.
- **AC-7**: The limits show 10 min, 2 GB, 1080p and 30 days with flip counters; the FAQ is an accordion of `<button aria-expanded>` triggers with closed panels `inert`, answers true today; the footer has Product, Account, For agents and Legal columns (Privacy and Terms appear once feature 16 ships; until then Legal holds the email link) and the blurred wordmark.
- **AC-8**: With `prefers-reduced-motion`, nothing loops, nothing scrubs, Lenis is off, WebGL draws at most one static frame and every piece of content is visible.
- **AC-9**: Accessibility: skip link first, one `h1`, split headings keep an `aria-label` with word spans `aria-hidden`, decorative canvas, wordmark and cursor `aria-hidden`, every target at least 44px, focus visible on light and dark, and axe reports no serious or critical issues.
- **AC-10**: Performance on mobile: Lighthouse performance 90 or more, measured on the live site (production, PageSpeed Insights mobile) after the merge because sandbox CPUs score even `/sign-in` near 60; CLS 0.02 or less; the homepage adds 90KB gzip or less of initial JS over the `/sign-in` baseline, excluding `three` and the signed in library code that `/` preloads while the library shares the `/` route; deferred `three` plus the field 170KB gzip or less. _Amended 2026-11-13 (Toyin chose option 1): the app wide baseline (React, Sentry, Next client, Better Auth) was already 216KB on `/sign-in`, so a whole page 90KB budget was never reachable. Moving the signed in library to its own route and trimming the baseline are separate tasks._
- **AC-11**: Media come from `docs/design/home-v2.html` as real files, not base64: images as AVIF with WebP fallback at 480, 960, 1440 and 1920 widths, stopping at the source width (never upscaled; the draft's media are 500 to 1280px wide) via `next/image` or `srcset`, videos as MP4 plus WebM, no audio, each tile 2.5MB or less, the reel 8MB or less with a poster; tile videos load on intent or in view.

## Decision

**Chosen option**: Build the v2 homepage as server rendered sections with progressive client motion (GSAP, ScrollTrigger, CustomEase, Lenis; Three.js lazy for the studio floor), honest copy, no forms.

**Implementation skills**: `vercel-react-best-practices` (`vercel-labs/agent-skills`, `.claude/skills/vercel-react-best-practices/`) · `web-design-guidelines` (`vercel-labs/agent-skills`, `.claude/skills/web-design-guidelines/`) · `nextjs-on-cloudflare` (`cloudflare/skills`, `.claude/skills/nextjs-on-cloudflare/`; OpenNext wins over vinext per AGENTS.md)

## Feature design

**Data model**: none.

**Value sourcing**:
| Section | Value | Source |
|---|---|---|
| Limits | 10 min, 2 GB, 1080p, 30 days | the existing constants in `src/lib/upload-rules.ts` (upload limits) and `src/lib/take-rules.ts` (retention), not typed by hand |
| Calls to action | sign in URL | the existing sign in route |
| Contact | `hello@takestudio.app` | Toyin, 2026-11-12 (one constant) |
| Share metadata | site URL | `BETTER_AUTH_URL` (the site origin already in `src/lib/env.ts`) |
| Fan cards, reel, tiles | images and videos | extracted from `docs/design/home-v2.html` (approved to publish) into `public/` |

**Dependencies**: `gsap`, `lenis`, `three` (exact pinned versions, current stable at build time), imported only from homepage client components.

**Security model**: public page, no data read except whether a session exists; no forms, no new routes beyond `robots.txt` and `sitemap.xml`.

**Critical test scenarios**:
- Signed out `/` shows all sections and the CTAs reach sign in; signed in `/` goes to takes, verifies **AC-1**, **AC-2**.
- Page source contains the copy, metadata and JSON-LD with JS disabled, verifies **AC-3**.
- Reduced motion emulated in Playwright: no running animations, all text visible, verifies **AC-8**.
- axe and keyboard run (skip link, menu dialog, FAQ, pause controls on the fan, reel and tiles), verifies **AC-9**, **AC-4**, **AC-5**, **AC-7**.
- Initial JS gzip from the build as PR proof: the `/` and `/sign-in` totals, then each chunk on `/` that `/sign-in` does not load with its gzip size, marked as homepage code or signed in library code (a chunk counts as library code when the library imports it and no `src/components/home/` module does). The homepage code chunks must sum to 90KB or less. Once the library has its own route, the library list is empty and `/` minus `/sign-in` is the number. Lighthouse mobile (PageSpeed Insights) runs on production after the merge. Verifies **AC-10**.

## Build plan

Builds after spec 0009 task 1 (tokens and components).

1. Static page: all ten sections with real semantics and no motion, true copy, extracted media, metadata, JSON-LD, robots and sitemap, signed in redirect kept, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-7**, **AC-9**, **AC-11**.
2. Motion core and the light top: eases and reduced motion helper, Lenis with ScrollTrigger, entrances and word reveals, nav float and dark variant plus the mobile menu dialog, hero intro and fan loop, reel expansion, satisfies **AC-4**, **AC-5**, **AC-8**.
3. The studio floor: arc, lazy Three.js particle field with fallbacks and disposal, giant words, glass bento, fill lines, satisfies **AC-6**, **AC-8**, **AC-10**.
4. Details and passes: video tiles, split CTA, drift rows and flip counters, FAQ motion, edge blur, footer wordmark, cursor; then the reduced motion, responsive (390 to 1440), accessibility and performance passes, satisfies **AC-5**, **AC-7**, **AC-8**, **AC-9**, **AC-10**.

Each task: Mobbin references in the PR, proof (screenshots at desktop and phone width, a short video for motion), `/sync`.

## Consequences

**Positive**: a page that shows the product's quality and stays honest; search and share ready.

**Negative / tradeoffs**: three new client libraries and a WebGL effect to maintain; homepage copy must be updated as slices 4 to 7 ship.

**Neutral**: privacy and terms links appear when scope feature 16 ships.

## Follow-up

- [ ] When slices 4, 5 and 6 ship, update the hero and FAQ lines they unlock (review timeline, AI agents, monthly limit).
- [ ] Feature 16: add Privacy and Terms to the footer.
- [ ] Product analytics (feature 17) may later count homepage CTA clicks.

## References

- `design.md` §0, §4, §6 to §10 and the Mobbin references in §12; Toyin's draft `docs/design/home-v2.html`.
