# 0003. Design system and UI foundation

**Date**: 2026-11-10
**Status**: Proposed

## Summary

Take Studio looks like a calm, warm, light workspace with a dark "stage" for the video player and cut timeline, using Toyin's palette (Papaya Whip background, Deep Space Blue text, Brick Red actions, Steel Blue on the stage). Type is Inter with JetBrains Mono for timestamps, corners are soft and spacing roomy, and components are built with Tailwind CSS and shadcn/ui so accessibility comes built in. The full rules and Mobbin references live in `design.md`; this spec records the decision and what scope feature 4 builds: the tokens, fonts, base components and app shell every later screen uses.

## Context

Every screen in slices 1 to 7 (upload, progress, take library, player, cut review timeline, transcript, background picker, landing page) needs one consistent look and the same accessible building blocks. Without a decided system, each builder would invent colours, spacing and components, and accessibility (WCAG AA, a team rule) would be checked screen by screen.

The product shows video of people on studio backgrounds, so the video area must show colours faithfully, while the rest of the app is reading heavy (transcript, lists, settings). The team builds in Next.js on Cloudflare Workers, where bundle size matters (spec 0001).

Decided with Toyin: design source is a direction proposed from Mobbin; direction 3 (light app, dark stage); Toyin's five colour palette in the roles in `design.md`; Inter plus JetBrains Mono; Tailwind CSS with shadcn/ui; soft corners and roomy spacing; no dark mode for now; built in studio backgrounds generated and approved by Toyin. After an independent cross check (all contrast numbers confirmed, about 25 gaps fixed in `design.md`), Toyin added status colours (green `#2E6B3F`, amber `#8A5A00`, error red `#9B0D18`, for small labels and icons only) and limited the `/design` gallery to development and preview builds.

## Requirements

**User stories**:
- As a creator, I want a calm, readable app where my video looks true to colour, so I can judge the result.
- As a creator who uses a keyboard or screen reader, I want every control usable and announced.
- As a builder, I want ready tokens and components so every screen looks the same without guessing.

**Acceptance criteria**:
- **AC-1**: All colour, type, spacing, radius, shadow and motion tokens from `design.md` exist as CSS variables wired into the Tailwind theme; no screen uses raw hex values or ad hoc spacing.
- **AC-2**: Inter and JetBrains Mono load via `next/font` with no layout shift; timestamps use tabular mono numbers.
- **AC-3**: The base components listed in `design.md` exist in `src/components/ui/`, themed with the tokens, with every state listed there (Button variants and sizes with hover, pressed, focus, disabled and loading; input error and helper states; toast and alert variants; light and stage skeletons; Sheet and dialog sizes).
- **AC-4**: An app shell exists per `design.md`: 240 px left sidebar (active item tint plus left bar, user menu with sign out) collapsing under 768 px to a top bar with a menu sheet, a "Skip to content" link and landmarks, page gutters, and a `Stage` container that applies the stage tokens including the cream focus ring.
- **AC-5**: Every component is keyboard operable with a visible 2 px focus ring (Brick Red on light, cream inside the `Stage`); dialogs trap and restore focus; icon only buttons have accessible names; touch targets are at least 44 px under `pointer: coarse`.
- **AC-6**: Every text colour pair used meets WCAG AA (4.5:1, or 3:1 for large text and UI controls); Steel Blue is never text on the light app, Brick Red never text or focus ring on the stage; status always shows an icon plus a label; links in text are underlined.
- **AC-7**: A component gallery page (`/design`) shows every base component and state on both the light app and the stage; it is served only when `NODE_ENV` is development or the Worker has the runtime var `DESIGN_GALLERY=1` (set by the Playwright web server and `pnpm preview`, never on the live Worker), otherwise returns not found; it has no sign in gate and is `noindex`; automated axe checks on it pass with no serious or critical issues.
- **AC-8**: Animations respect `prefers-reduced-motion`.

## Options considered

### Option 1: Dark studio everywhere
Dark UI throughout with one bright accent (Riverside, Suno). **Pros**: pro feel, video pops. **Cons**: long transcript reading is harder; AA contrast is harder across many muted greys; Toyin's warm palette is cream led.

### Option 2: Calm light workspace only
Light everywhere, including the player (Descript, Loom). **Pros**: simplest, very readable. **Cons**: video and studio backgrounds are judged against cream, which skews colour perception.

### Option 3: Light app, dark stage (chosen)
Light workspace with a dark panel for the player and timeline (Vimeo, Arcade, VEED editors). **Pros**: readable text and faithful video in one layout most creators know. **Cons**: two sets of surface tokens and contrast rules to maintain.

Component toolkit: shadcn/ui on Radix (chosen) over hand built Tailwind (more work, accessibility risk) and Mantine or Chakra (heavier on Workers, harder to theme to the palette).

## Decision

**Chosen option**: Option 3: light app, dark stage, built with Tailwind CSS and shadcn/ui, tokens and rules in `design.md`.

**Implementation skills**: `vercel-react-best-practices` (`vercel-labs/agent-skills`, `.claude/skills/vercel-react-best-practices/`) · `vercel-composition-patterns` (`vercel-labs/agent-skills`, `.claude/skills/vercel-composition-patterns/`) · `web-design-guidelines` (`vercel-labs/agent-skills`, `.claude/skills/web-design-guidelines/`)

## Rationale

The stage split answers the product's central tension: creators judge colour on their video (a dark neutral stage helps) but spend most time reading transcripts and lists (light, high contrast helps). Toyin's palette fits it naturally: cream and deep blue for the app, deep blue as the stage, Brick Red for action, Steel Blue as the stage accent. The contrast check shaped the roles (Steel Blue fails on cream, Brick Red fails on the stage), and those limits are written as rules so builders don't rediscover them. shadcn/ui gives accessible primitives without a heavy runtime, and since the code is copied in, the custom player and timeline stay fully ours. Dark mode is deferred because it doubles every colour check and screenshot; tokens keep it cheap to add later.

## Build plan

1. Tailwind CSS v4 (CSS first `@theme`) and shadcn/ui setup with pinned versions; tokens from `design.md` as CSS variables mapped to shadcn's names; Inter and JetBrains Mono via `next/font/google` (build time, self hosted); reduced motion handling; confirm the OpenNext build stays green, satisfies **AC-1**, **AC-2**, **AC-8**.
2. Base components in `src/components/ui/` themed with the tokens, with focus rings and accessible names, satisfies **AC-3**, **AC-5**, **AC-6**.
3. App shell (sidebar collapsing to top bar, page gutters) and the `Stage` container, applied to the existing placeholder pages, satisfies **AC-4**, **AC-6**.
4. `/design` gallery page (no sign in gate) with every component and state on light and stage; Playwright axe check on it, satisfies **AC-7**, **AC-5**.

## Consequences

**Positive**:
- Every later screen starts from the same tokens and accessible components.
- Contrast limits are decided once and written down.

**Negative / tradeoffs**:
- Two surface sets (light and stage) to keep consistent.
- shadcn/ui components are copied in, so upstream fixes need manual updates.
- No dark mode until a later decision.

**Neutral**:
- Product components (dropzone, player, timeline, transcript, background picker) are built in their slices, following `design.md`.

## Follow-up

- [ ] Slice 3: generate about six studio backdrops (1920×1080) matched to the palette and get Toyin's approval for each before shipping.
- [ ] Landing page (scope feature 15): one generated hero image plus real product screenshots.
- [ ] A dark mode is a separate future decision.
