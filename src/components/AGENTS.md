# Components (src/components, except takes/)

shadcn style components on Tailwind v4 tokens. Spec: [0003 design system](../../docs/specs/0003-design-system.md). Rules and references: `design.md`. The take pages have their own file: [takes/AGENTS.md](takes/AGENTS.md).

- Colours live only in `src/app/globals.css` (`:root` tokens). No hex in any `.tsx`: `src/app/design/tokens.test.ts` fails on any `#abc` style text. Change a token in `globals.css`, `design.md` and `src/app/design/tokens.ts` together; tests compare them and the contrast ratios `design.md` quotes.
- The focus ring is global (`:focus-visible` in `globals.css`, colour `--focus`), and the `ui/` components repeat `focus-visible:outline-2 focus-visible:outline-ring`. Menus and selects use an inset offset.
- A 44 px touch target is per component: the class `pointer-coarse:min-h-11` (the checkbox uses an invisible 44 px `after:` square). A new control must add it itself; `tests/design-components.spec.ts` checks it on a phone.
- Reduced motion is one global CSS block. Components need nothing of their own.
- Stage (`stage.tsx`): the `.stage` class rebinds the tokens to the `--stage-*` set, so shared `ui/` components work inside it unchanged. Use `StagePanel` and `StageLetterbox`. Brick Red never appears on the stage, and Steel Blue is not for light text (both fail contrast, and tests assert that).
- The `/design` gallery exists only when `NODE_ENV` is development or the Worker variable `DESIGN_GALLERY` is exactly `1`; production answers 404. `pnpm preview` and Playwright set it.

_Drafted by /sync from a catch up over the merged work, worth a quick human pass._
