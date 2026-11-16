# 0022 rationale: Style toolkit

## Context

- Spec 0020 made cuts smoother with fixed numbers (`SMOOTH`) and listed a per take "Cut style" choice as a follow up. Toyin's plan (C-47) is a ready made style toolkit, with a later reference clip recipe that copies the look of a clip she likes.
- The renderer is one ffmpeg filter graph in a Trigger.dev job on `large-1x`. A style can only be things that graph does cheaply in the same pass: audio fades, zoom, push and simple colour filters.
- Creators already change a background by picking it and pressing Render (spec 0011). A style should feel the same.
- Captions are not burned into the video yet, and a music bed needs a licence source nobody has chosen. Pace changes which cuts exist, and those are decided in the first run and reviewed by the creator.

## Options considered

### Option 1: One switch per effect

Add "Zoom on cuts", "Slow push", "Colour" as separate toggles.

**Pros**: Simplest storage idea, full control.
**Cons**: Many choices for a creator who wants one click; the reference clip feature would need to set many toggles; hard to keep the combinations looking good.

### Option 2: Named recipes in a code registry (chosen)

A small set of styles, each one checked recipe of numbers. The take stores only the id.

**Pros**: One click; new styles need no migration; one format the reference clip feature can output; each recipe can be tested and tuned as a whole.
**Cons**: Less control; the recipe set is a taste decision.

### Option 3: Recipes stored in the database

A `style` table, editable by us without a deploy.

**Pros**: Add and tune styles without shipping.
**Cons**: A table, an editor and permissions before we know what people choose. Not needed for four styles.

## Rationale

Option 2 fits the forces: the render already has the numbers in one place (`SMOOTH`), creators think in looks not switches, and a checked JSON shaped recipe is exactly what a reference clip feature can fill in later. The database table (Option 3) can come when custom recipes arrive, and the registry function `resolveStyle` is the only place that changes. Keeping `natural` identical to today's output removes the risk for current takes, and the golden test makes that checkable.

Pace, captions and music are left out on purpose. Pace changes the cut list, so putting it in the renderer would make the review timeline disagree with the video. Captions wait for burned in captions. Music needs a licence decision and a legal facts update.

## Recommended options taken (C-30)

Each is Toyin's to override.
1. Four starting styles: Natural (default, today's look), Calm, Punchy, Warm.
2. Pace, caption styles and a music bed are follow ups, not in step 1.
3. The style is picked on the take page and joins the pending changes with Render, like a background.
4. Stored as `take.style_id` (default `natural`) plus a snapshot on each render; recipes live in code, not a table.
5. The colour look applies to the whole picture after the background is added, so person and background match; zoom and push still move only the person.
6. Render time limit: at most 25% above Natural on a 60 s take, and never a second pass.
7. No analytics event for style picks in step 1 (it would change the legal facts).
8. Public API and MCP get the style list and `styleId` (parity).

## Design references (Mobbin)

- Descript, "Styles" dialog: a grid of named tiles with a preview each (`269a9302-ac48-4f2a-9425-3d8603bf0665`).
- Magnific, Speed Ramp presets: small named preset tiles with a Preview and an Apply (`7c698173-6ed8-4be5-96e9-0a07f932c700`).
- ElevenLabs, captions list: a "None" choice first, then named styles with a sample each (`ae778f1f-aca5-4b29-95ee-a7fcba43fa17`).
- Artlist, LUTs: look tiles on one sample shot with short tags (`5b68fb42-f7ce-451c-ab2b-63e8bbc66789`).
- TikTok Studio, video templates: pick on the left, live preview on the right (`b0d627d9-48b3-4bb4-89e6-54fe07b0cb5d`).

What we take from them: a small grid of named tiles on the take's own poster, one tag line each, the current style marked, a preview before commit. What we skip: stock galleries, search and filters (four styles do not need them).

## References

**Project sources**:
- Spec 0020 (smooth cuts), spec 0011 (pending changes and Render), spec 0008 (background), spec 0004 (job limits), `src/lib/trim.ts`, `src/lib/deadline.ts`, `src/lib/failure-codes.ts` (open set pattern).
- Scope: Deferred "Burned in captions"; Growth ideas "One tap presets".
