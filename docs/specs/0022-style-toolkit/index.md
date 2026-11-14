# 0022. Style toolkit

**Date**: 2026-11-14
**Status**: Proposed

## Summary

A style is a ready made look for the finished video: how strongly the picture zooms at cuts, how soft the sound is at each join, and a light colour look. The creator picks one on the take page and presses Render, like a background change. Today's look stays the default, called Natural. This spec covers the picture and sound parts that the render can do with plain ffmpeg filters, in one render pass, and leaves captions, a music bed and pace for follow ups. The style is written as one small checked format, so the later "copy the look of a reference clip" feature can produce the same thing.

## Requirements

**User stories**:
- As a creator, I want to pick a ready made style for my video, so it looks edited for my channel without learning an editor.
- As a creator, I want the default to stay as it is today, so nothing changes until I choose.
- As a creator who dislikes movement, I want a style with no zoom, so the video stays steady.
- As an AI agent, I want to list the styles and pick one through the API and MCP, so I can do whatever the web app does.

**Acceptance criteria**:
- **AC-1**: A style is an entry in one registry (`src/lib/styles.ts`) checked by one zod schema, `StyleRecipe`, with bounded numbers. The recipe `natural` produces a filter script identical to today's (spec 0020), proven by a golden test, so an unstyled take renders exactly as before.
- **AC-2**: A take has a `style_id` (default `natural`) and every render records the `style_id` it was made with. An unknown id is refused with a typed error and never reaches the job.
- **AC-3**: `renderFilterScript` takes the recipe and applies it in the same single encode pass: audio fade length, zoom scale, slow push and colour look. No extra pass, no new service.
- **AC-4**: Choosing a style on the take page joins the pending changes (spec 0011) and Render makes the video. Choosing the current style again is no change. A style change alone is a valid reason to render.
- **AC-5**: The picker shows each style with a name, one plain line, and tags for what it includes (zoom, push, colour). It is a radio group, works with the keyboard, has a visible focus, targets of at least 44 px, and the choice never relies on colour alone.
- **AC-6**: The colour look shows on the take page preview as a still of the take poster with the same numbers (CSS filter), labelled as a preview. Preview motion does not animate when the browser asks for reduced motion.
- **AC-7**: `calm` has no zoom and no push (a steady picture). Every style that moves says so on its tile, because the movement is baked into the video and the browser's reduced motion setting cannot change it afterwards.
- **AC-8**: A colour look stays inside the bounds in AC-1 and never makes text on screen harder to read: a unit test checks the bounds, and a render check on a synthetic fixture notes the result.
- **AC-9**: Render time with any style is at most 25% above `natural` on the 60 s synthetic test take, noted in the PR. A style is never allowed to add a second pass over the video.
- **AC-10**: A render with a style keeps audio and video in sync and the output size and duration match the same render without a style (existing frame alignment still runs last).
- **AC-11**: The public API and the MCP server list the styles and accept a `styleId` on a render request, with the same validation (parity with the web app).
- **AC-12**: Nothing personal is stored or sent: only a style id on the take and the render. No new service, cookie, analytics event or env secret, so `src/lib/legal-facts.ts` is unchanged (checked with `pnpm legal:drift`).
- **AC-13**: The recipe format has a `version` and the registry resolves a take's id to a recipe through one function, so a later stored custom recipe (from a reference clip) can be added without changing the job or the filter builder.

## Decision

**Chosen option**: Option 2, a small registry of named recipes applied inside the existing render graph.

**Recipes in step 1** (numbers are the starting values, retuned with Toyin after real takes):

| Id | Name | Audio fade | Zoom (alternate) | Slow push | Colour look |
|---|---|---|---|---|---|
| `natural` | Natural | 30 ms | 1.08 | 0.04 | none |
| `calm` | Calm | 60 ms | none | none | none |
| `punchy` | Punchy | 20 ms | 1.12 | 0.06 | contrast 1.06, saturation 1.10 |
| `warm` | Warm | 30 ms | 1.08 | 0.04 | warm balance, saturation 1.05 |

`natural` is exactly the `SMOOTH` constants of spec 0020, which move into the registry as that recipe's numbers.

**Format** (`StyleRecipe`, zod, `version: 1`):

```ts
{
  version: 1,
  id: string,                    // lower case slug
  name: string, summary: string, // shown on the tile
  audioFadeMs: 0..100,
  zoomScale: 1..1.15,            // 1 means no zoom
  pushScale: 0..0.08,            // 0 means no push
  look: { contrast: 0.9..1.15, saturation: 0.8..1.25, brightness: -0.05..0.05,
          warmth: -0.08..0.08 }  // all optional, neutral when missing
}
```

Fields for later steps (`captions`, `music`, `pace`) are not in version 1. A later version adds them with defaults, so every version 1 recipe stays valid.

**How it works**:
1. **Where it lives**: the registry and schema are pure code in `src/lib/styles.ts` (`resolveStyle(id)` returns a recipe or a typed error). `renderFilterScript(keeps, options, recipe)` in `src/lib/trim.ts` keeps the existing `RenderGraphOptions` (`hdr`, `hasAudio`, `background`, `size`) and reads the numbers from the recipe instead of the `SMOOTH` constant.
2. **Stored**: `take.style_id text not null default 'natural'` and `render.style_id text` (a snapshot, like `background_id`). An open set validated in code, no database CHECK, like failure codes, so adding a style needs no migration.
3. **Job**: the re render request carries `styleId`; the route validates it with the registry and writes it to `render.style_id` before the job starts (when no `styleId` is sent, the take's current `style_id` is written). The job payload carries IDs only, so the job reads the render's `style_id` and resolves the recipe itself (job code imports `src/lib`, never `src/app` or `src/server`). The take's `style_id` changes to the render's value only when that render succeeds, the same rule as `background_id` (spec 0008).
4. **Colour**: applied once after `concat` (and after background compositing, so a background and the person shift together and look like one shot), using `eq` and `colorbalance`. Zoom and push still apply per segment before `concat`, so a background stays still (spec 0020).
5. **Take page**: a Style tab beside Background. The pick joins `Edits` as `style: string | undefined` (undefined means no change) and the pending bar lists it, then Render applies it with any background and cut changes in one render.
6. **Limits**: one encode pass, `large-1x`, the `maxDuration` of spec 0004 and the render deadline (`src/lib/deadline.ts`) stay as they are. Style cost is checked by AC-9.
7. **Reference clip later**: a custom recipe is a row holding the same `StyleRecipe` JSON, and `take.style_id` can hold its id. Only `resolveStyle` changes (AC-13).

## Feature design

**Data model sketch**:
- `take.style_id` text, not null, default `natural`.
- `render.style_id` text, null for renders made before this spec (read as `natural`). It is the input the job reads, written when a render is requested.
- One migration, backfill by the default.

**State transitions**: none new. A style change is a pending change that becomes a render; the existing render states apply.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| existing re render route (spec 0011) | POST | `styleId` (optional) | render started | session, Origin and ownership checks | 422 unknown style, 409 render running |
| styles list (take page, API, MCP) | GET | none | `[{ id, name, summary, tags }]` | session or API key | none |

**Value sourcing**:
| Action | Value produced or displayed | Source |
|---|---|---|
| Pick a style | The tile name, summary and tags | The registry (`src/lib/styles.ts`) |
| Render | The recipe numbers | `resolveStyle(render.style_id)` in the job |
| Render | The style recorded on the render | the validated `styleId` at request time, or the take's `style_id` when none is sent (snapshot) |
| Preview | The CSS filter numbers | The recipe's `look`, the same object the render uses |
| Take page | The current style | `take.style_id`, or the latest render's `style_id` while a render is running |

**Key invariants**:
- `natural` renders exactly as spec 0020 does today.
- A style never adds an encode pass and never changes the output size or duration.
- Unknown ids never reach the job.

**Security model**: a style id is public catalogue data, not personal. The route keeps the Origin and ownership checks of spec 0011. Nothing about a style is sensitive.

**Configuration required**: none.

**Critical test scenarios**:
- Golden: `renderFilterScript(keeps, options, natural)` equals today's script, verifies **AC-1**.
- Schema: out of range numbers and an unknown id are refused, verifies **AC-1**, **AC-2**.
- Calm: no `zoompan` or crop in the script, verifies **AC-7**.
- Colour: the look appears once, after `concat`, verifies **AC-3**, **AC-8**.
- Render: dimensions and duration match the unstyled render on a synthetic fixture, verifies **AC-10**.
- Picker: keyboard choice, pending bar entry, choosing the current style is no change, verifies **AC-4**, **AC-5**.
- Parity: the API and MCP list and accept a style, verifies **AC-11**.

## Build plan

Tracer Bullet: one thin thread through every layer first (registry, storage, job, render), then the picker, then the other recipes.

1. **Jim, thread**: `src/lib/styles.ts` (schema, registry with `natural` only, `resolveStyle`), migration for `take.style_id` and `render.style_id`, `renderFilterScript(keeps, options, recipe)` with the golden test, `SMOOTH` moved into `natural`. Satisfies **AC-1**, **AC-2**, **AC-3**, **AC-13**.
2. **Jim, thread end to end**: add `calm`, accept `styleId` on the re render route, the job resolves and applies it, the render records it, `pnpm test:pipeline` renders a synthetic take in `calm`. Satisfies **AC-2**, **AC-3**, **AC-7**, **AC-10**.
3. **Dwight, picker**: Style tab, tiles, pending bar entry, `Edits.style`, Mobbin references, accessibility and tests. Needs task 2. Satisfies **AC-4**, **AC-5**, **AC-7**.
4. **Jim, more recipes**: `punchy`, `warm`, the colour look, bounds tests, render time check on the 60 s synthetic take. Satisfies **AC-3**, **AC-8**, **AC-9**.
5. **Dwight, look preview and polish**: the CSS filter preview on the poster, reduced motion for previews, a Playwright check of pick, render and result. Needs tasks 3 and 4. Satisfies **AC-6**, **AC-4**.
6. **Jim, parity and checks**: styles list and `styleId` on the public API and the MCP server, then `pnpm legal:drift` clean. Needs task 2 and the API and MCP specs (0018, 0019). Satisfies **AC-11**, **AC-12**.

Tasks 3 and 4 can run in parallel after task 2.

## Consequences

**Positive**:
- A creator gets a different look in one click with no editor to learn.
- The default is untouched, so no surprise for current creators.
- One checked format that the reference clip feature can fill later.

**Negative / tradeoffs**:
- Four starting recipes are a taste decision; the numbers need retuning with real takes.
- Motion is baked into the video, so a viewer's reduced motion setting cannot soften it; `calm` and honest tile tags are the answer.
- Every style change is a full re render (same cost as a background change).

**Neutral**:
- Spec 0020's `SMOOTH` constants become the `natural` recipe, and its "Cut style" follow up is replaced by this spec.

## Rationale

See [rationale.md](./rationale.md).

## Follow-up

- [ ] Caption styles, once burned in captions exist (scope Deferred). Recipes get a `captions` field in version 2, with the colour contrast rule of AA 4.5 to 1 on any background.
- [ ] Music bed: only when a licence source is chosen and written in `legal-facts.ts`; a `music` field in version 2.
- [ ] Pace (how tight the pauses are): it changes which cuts exist, so it belongs to the first cut run and the review timeline, not the renderer. Needs its own spec.
- [ ] Reference clip recipe: derive a `StyleRecipe` from a clip the creator likes and store it as a custom style.
- [ ] Per style analytics (which style is chosen) once Toyin wants it; that adds an event and updates the legal facts.
- [ ] Retune the four recipes with Toyin after the first real takes.
