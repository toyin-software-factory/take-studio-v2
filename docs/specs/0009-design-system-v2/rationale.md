# 0009. Rationale

## Context

On 2026-11-12 Toyin shared a new design: a v2 `design.md` (tokens, type, components, motion recipes for a marketing homepage) and two HTML drafts (homepage and take page). It replaces the v1 look from spec 0003 (warm cream, deep blue, brick red, Inter). The draft design.md was written without looking at the repo, so its page map and stack advice had to be reconciled with Next.js, Tailwind CSS v4 and shadcn/ui (spec 0001, 0003).

The take page draft also shows parts from later slices (cut review timeline, usage meter, API). Building those as placeholders would show controls that do nothing.

## Options considered

### Option 1: Homepage only
The homepage gets v2, the app keeps the v1 look until a later pass. **Pros**: least work now. **Cons**: two looks; the creator lands in a different product after sign in.

### Option 2: v2 tokens app wide, spectacle homepage only (chosen)
**Pros**: one product look; the app stays light (no GSAP, Lenis or Three.js after sign in). **Cons**: every screen is touched once.

### Option 3: Everything everywhere, motion inside the app too
**Pros**: closest to the drafts. **Cons**: heavy bundles and distracting motion where creators read transcripts and judge video.

## Rationale

Toyin chose Option 2 (Slack, 2026-11-12), and also chose: only built features on the take page (later slice parts arrive with their slice), copy true today, and no forms. Option 2 keeps the reading heavy app calm and fast while sharing one visual language with the homepage. Keeping Tailwind CSS v4 and shadcn/ui means only tokens and component styles change, not the component toolkit or its accessibility behaviour. `next/font` replaces hand placed woff2 files because it already self hosts at build time under OpenNext (spec 0003).

## References

- Toyin's v2 design and drafts: `design.md`, `docs/design/home-v2.html`, `docs/design/take-page-v2.html`.
- Inspiration named by the draft: WAMA, Vexel AI, REDSTONE (design.md §12), plus the Mobbin references listed there.
