# 0009. Design system v2: light Swiss shell, dark stage

**Date**: 2026-11-12
**Status**: In Progress

Supersedes [0003](../0003-design-system.md).

## Summary

Take Studio moves to Toyin's v2 look: a white, typographic shell (Inter Tight, near black ink, one lime accent) with dark "stage" panels for video. The new tokens, type, buttons, links and focus rules apply to the whole app, so every screen looks like one product. The big motion (particles, card fan, reel, smooth scroll) belongs to the homepage only (spec 0010), so the signed in app stays fast and calm. The full rules live in `design.md`; this spec records the decision and what gets rebuilt.

## Requirements

**User stories**:
- As a creator, I want the app to look like the product I saw on the homepage, so it feels like one trustworthy tool.
- As a creator on a phone or with a keyboard or screen reader, I want every control usable, visible and announced.
- As a builder, I want ready tokens and restyled components, so every screen gets the new look without guessing.

**Acceptance criteria**:
- **AC-1**: Every colour, type, spacing, radius, shadow, blur, motion and z index token in `design.md` §2 exists as a CSS variable mapped into the Tailwind `@theme` and shadcn's names. The v1 palette (Papaya Whip, Deep Space Blue, Brick Red, Steel Blue, Molten Lava) is gone from the code; no component uses a raw hex value.
- **AC-2**: Inter Tight 300, 400 and 500 load through `next/font` (self hosted, `display: swap`, latin) with no layout shift; JetBrains Mono is removed; times, durations and sizes use `tabular-nums`.
- **AC-3**: The base components in `src/components/ui/` are restyled per `design.md` §5 with every state: primary pill (40 and 48px), primary on dark, ghost pill on dark, text link underline system, inputs (bottom border), chips, pill tabs, dialog and sheet, toast and alert, skeleton on light and dark. Hover, pressed (`scale(.98)`), focus, disabled and loading states all exist.
- **AC-4**: The app shell matches `design.md` §4b: 264px sticky sidebar at 1024px and wider (logo, "Upload a take", Takes, recent takes with the current one marked `aria-current`, user menu with sign out), a sheet menu under 1024px (focus trapped, Esc closes), a sticky glass top bar with breadcrumb and status, skip link to `#main`.
- **AC-5**: The take page matches `design.md` §4b with only built features: dark stage panel with the player and glass transport, summary line with "Download" and "Download original", inspector tabs Export, Background, Transcript, Details. Every existing behaviour (studio preview and change from spec 0008, transcript seek and downloads from spec 0007, ready email toggle, processing and failed states) works as before and its existing tests pass. Nothing from later slices appears (no cut timeline, minutes meter, API item, Backgrounds page, Settings, Copy link, speed control).
- **AC-6**: The library, upload, sign in, error and not found pages use the v2 shell, type and components.
- **AC-7**: Focus is a visible 2px ring with 3px offset: ink on light, lime accent on dark. Every control works by keyboard, dialogs trap and restore focus, icon only buttons have accessible names, touch targets are at least 44px.
- **AC-8**: Contrast meets WCAG AA for every text pair used: the lime accent is never text on white, muted text is never lighter than `#4f4f4f` on white or white at 75% on dark, weight 300 only at 16px and up, status is always an icon plus a label.
- **AC-9**: Signed in pages load no `gsap`, `lenis` or `three` code (checked in the build output), and all motion respects `prefers-reduced-motion`.
- **AC-10**: The `/design` gallery shows every v2 component and state on light and dark, keeps its access rule from spec 0003 (development and preview builds only, `noindex`), and automated axe checks on it and on the restyled app pages report no serious or critical issues.

## Decision

**Chosen option**: Option 2: v2 tokens and components app wide, spectacle on the homepage only.

**Implementation skills**: `vercel-react-best-practices` (`vercel-labs/agent-skills`, `.claude/skills/vercel-react-best-practices/`) · `vercel-composition-patterns` (`vercel-labs/agent-skills`, `.claude/skills/vercel-composition-patterns/`) · `web-design-guidelines` (`vercel-labs/agent-skills`, `.claude/skills/web-design-guidelines/`)

**Design source**: Toyin's v2 design: `design.md` (rules and tokens), `docs/design/home-v2.html` and `docs/design/take-page-v2.html` (drafts to open in a browser). Mobbin references in `design.md` §12; each PR adds the ones it used.

## Feature design

**Data model**: none. No schema change.

**Value sourcing**:
| Screen | Value shown | Source |
|---|---|---|
| Sidebar recent takes | title, status, duration | the existing takes list query for the signed in creator (newest first, at most 5) |
| Top bar | breadcrumb title and status chip | the take already loaded by the take page |
| Export tab | file sizes, durations, retention days | the existing take, render and transcript fields (spec 0004, 0007); retention from the existing `isVideoExpired` rule |
| Background tab | studios, preview state | spec 0008 routes, unchanged |
| User menu | initials and name | the Better Auth session user |

**Key invariants**: no raw hex in components; no homepage motion library in the signed in bundle; no later slice control rendered.

**Security model**: unchanged. Pages keep their sign in and ownership checks (spec 0004, `src/server/AGENTS.md`).

**Critical test scenarios**:
- The existing Playwright flows (upload to ready, studio preview and change, transcript) pass on the restyled pages, verifies **AC-5**, **AC-6**.
- Keyboard only run through the shell and the take page, sheet menu traps focus and Esc closes it, verifies **AC-4**, **AC-7**.
- axe on `/design`, the library and a ready take, verifies **AC-8**, **AC-10**.
- Build output check: no `gsap`, `lenis` or `three` chunk on `/takes` routes, verifies **AC-9**.

## Build plan

Tracer Bullet: the new look runs through one real page first (tokens to take page), then spreads.

1. Tokens, Tailwind `@theme` and shadcn mapping, Inter Tight through `next/font`, remove the v1 palette and JetBrains Mono, restyle the base components and the `/design` gallery, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-8**, **AC-10**.
2. App shell (sidebar, sheet menu, glass top bar, skip link), satisfies **AC-4**, **AC-7**.
3. Take page: stage panel, transport, summary row, inspector tabs, with only built features and all existing tests green, satisfies **AC-5**, **AC-7**, **AC-9**.
4. Library, upload, sign in, error and not found pages, plus the axe and build output checks, satisfies **AC-6**, **AC-8**, **AC-9**, **AC-10**.

Each task: Mobbin references in the PR, proof screenshots at desktop and phone width, `/sync`.

## Consequences

**Positive**: one product look from homepage to take page; fewer colours and one font to keep consistent.

**Negative / tradeoffs**: every screen and screenshot changes once; v1 contrast notes are replaced by v2 ones; the lime accent can't be used for text on white, which limits where it shows.

**Neutral**: later slices (cut review, usage limit, API) build their parts straight into the §4b layout.

## Follow-up

- [ ] Slice 4 (cut review): build the tap to restore timeline and pending changes bar into the stage panel per `docs/design/take-page-v2.html`.
- [ ] Slice 6: the minutes meter in the sidebar.
- [ ] TWK Lausanne is an optional paid upgrade for Inter Tight (`design.md` §3); a Toyin decision if ever wanted.

## Rationale

See [rationale.md](rationale.md).
