# design-check

Checks that a built page matches its reference design. It loads both in Chromium and compares what the browser actually renders, not the source code.

Each round:

1. **Measure.** Both pages load at desktop (1440 px) and phone (390 px). For every element tagged `data-check="…"` it records position, size, font, colour, background, spacing, radius, border, shadow and opacity, plus clipping and overlap. It records motion too: what moves on load, on scroll (CSS animations and transitions, Web Animations, GSAP tweens and ScrollTrigger, scroll-linked style changes) and on hover. One screenshot per tagged section.
2. **Compare in code.** Exact facts are diffed with tolerances (2 px for position and size, colour by perceptual difference, 20 % for motion duration). Positions are measured against the element just above and the tagged parent, so one taller heading does not fail everything below it.
3. **Ask Jev.** Only for sections whose code checks pass but whose screenshots still differ, Jev (TypeSafe's decision model) answers yes/no questions: same visual hierarchy, same arrangement with nothing overlapping or cut off, same image placement and crop. Easing curves written in different systems (a GSAP ease name against a CSS cubic-bezier) go to Jev too.
4. **Verdict.**
   - `approved`: nothing fails and Jev is sure.
   - `needs_fixes`: the builder gets the exact failures, e.g. `[phone] home › s1-top-heading: font-size 40px, design 44px`.
   - `needs_you`: what is left is for Toyin. That is a failure that came back unchanged two rounds in a row, a Jev answer under 80 % confidence, or round 5 reached.

Outputs go to `.design-check/`: `feedback.md` (for the builder), `report.html` (one file with the screenshots side by side, readable on a phone), `result.json` and `state.json` (the round counter).

## Setup in a project

1. The project needs Playwright with Chromium (`pnpm add -D @playwright/test` and `pnpm exec playwright install chromium`). The tool uses the project's own copy.
2. Tag the design once: `node tools/design-check/src/cli.js tag docs/design/home.html`. It writes `home.tagged.html` with `data-check` labels on the header, nav, sections, headings, lead text, buttons, media, lists and the first list item, and prints the labels. You can add or rename labels by hand in the tagged copy.
3. Put the same `data-check` labels on the matching elements in the build.
4. Add `design-check.json` at the repo root:

```json
{
  "pages": [
    {
      "name": "home",
      "design": "docs/design/home-v2.tagged.html",
      "build": "http://localhost:3000/"
    }
  ],
  "viewports": ["desktop", "phone"],
  "watch": ["src"],
  "judge": { "type": "jev" }
}
```

5. Give the Jev key as `TYPESAFE_API_KEY` in the environment (never in the repo).

## Commands

```
node tools/design-check/src/cli.js check            # one round: code checks, screenshots, Jev
node tools/design-check/src/cli.js check --page home
node tools/design-check/src/cli.js watch            # live: re-checks on every save (code checks only)
node tools/design-check/src/cli.js loop --builder "claude -p"   # headless loop: check, hand failures to the builder, repeat
node tools/design-check/src/cli.js reset            # start a new loop at round 1
node tools/design-check/src/cli.js tag <design.html> [--out file]
```

`check` exits 0 when approved, 1 when there is something to fix, 2 when it needs Toyin, and 3 when setup is missing.

**Live feedback while building.** `watch` re-measures after every save and writes `.design-check/live.json`. The Claude Code hook in `.claude/settings.json` runs `design-check hook` after each edit. It passes any new live result to the coder straight away and stays silent otherwise, or when `watch` is not running.

## Options (`design-check.json`)

| Key            | Default                                        | Meaning                                                                                                                                |
| -------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `pages`        | (required)                                     | `{ name, design, build, storageState? }`. `design` is a file or URL; `build` is usually the dev server URL.                            |
| `viewports`    | `["desktop","phone"]`                          | Also `laptop` (1280) and `tablet` (834).                                                                                               |
| `maxRounds`    | `5`                                            | Hard cap. After it, `check` refuses to run until `reset`.                                                                              |
| `repeatLimit`  | `2`                                            | A failure with the same numbers this many rounds in a row is stuck and goes to Toyin.                                                  |
| `confidence`   | `0.8`                                          | Jev answers below this go to Toyin.                                                                                                    |
| `tolerance`    | see `src/config.js`                            | `position`, `size`, `fontSize`, `lineHeight`, `letterSpacing`, `spacing`, `radius`, `color` (delta E), `motionDuration`, `pixelRatio`. |
| `storageState` | none                                           | Playwright storage state file for signed-in pages (build side only).                                                                   |
| `watch`        | `["src","app","components","styles","public"]` | Folders `watch` follows.                                                                                                               |
| `hover`        | `true`                                         | Probe hover states on desktop.                                                                                                         |

## Judge

| `judge`                                                                    | Uses                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ "type": "jev" }`                                                        | TypeSafe's API, `https://api.typesafe.ai/v1/systemone`, key `TYPESAFE_API_KEY`, model `jev-1.14.0`. Each question is a `noul` (probability of yes). pass = p ≥ 0.5, confidence = max(p, 1 − p). Questions on one section share one request, with the measured facts as `state`. |
| `{ "type": "jev", "model": "jev-latest" }`                                 | Unpinned model.                                                                                                                                                                                                                                                                 |
| `{ "type": "jev", "images": true }`                                        | Also sends the two section screenshots as `assets`. Text facts are the default, because they are compact and match what users see.                                                                                                                                              |
| `{ "type": "jev", "provider": "openrouter" }` or `"neon"`                  | Same model through OpenRouter (`OPENROUTER_API_KEY`) or the Neon AI Gateway.                                                                                                                                                                                                    |
| `{ "type": "command", "command": "…" }` / `{ "type": "http", "url": "…" }` | Any judge. It reads `{ questions: [{ id, question, facts, images }] }` and returns `{ answers: [{ id, pass, confidence, reason }] }`.                                                                                                                                           |
| `{ "type": "none" }`                                                       | No judge: every question goes to Toyin.                                                                                                                                                                                                                                         |

## Limits

- Elements are matched only by `data-check` labels, so an untagged element is not checked. `tag` covers the main structure; tag anything else that matters by hand.
- Canvas and WebGL content is only seen in screenshots, so Jev judges it (if `images` is on) or Toyin does.
- Scroll-scrubbed motion is compared by trigger and by which properties move, not frame by frame.
- Reference drafts often hold placeholder content. Text content is not compared. Images that differ only because a placeholder was swapped can make Jev unsure; those go to Toyin rather than to the builder.
