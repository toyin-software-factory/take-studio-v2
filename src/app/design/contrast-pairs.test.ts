import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { minimumRatio } from "./contrast";
import { type Rgb, colourTokenNames, over, ratio, tokenColour } from "./contrast-css";
import { type Layer, type Surface, exempt, pairs, surfaces } from "./contrast-table";

/** B2-T139: WCAG contrast for every text or icon token on every surface, translucent layers over the worst thing under them. */
const alphaOf = (layer: Layer): number => {
  if (typeof layer.alpha === "number") return layer.alpha;
  if (layer.alpha) {
    const [file, re] = layer.alpha.fromSource;
    const match = re.exec(readFileSync(file, "utf8"));
    if (!match) throw new Error(`${file} no longer matches ${re}`);
    return Number(match[1]) / 100;
  }
  return tokenColour(layer.token).alpha;
};
const flatten = (surface: Surface, underToken: string): Rgb =>
  surface.stack.reduce<Rgb>(
    (below, layer) => over({ rgb: tokenColour(layer.token).rgb, alpha: alphaOf(layer) }, below),
    tokenColour(underToken).rgb,
  );

/** The lowest ratio of `fg` over every surface variant (a translucent text colour is blended over it too). */
export const worst = (fg: string, surface: Surface): number =>
  Math.min(
    ...surface.under.map((u) => {
      const bg = flatten(surface, u);
      const c = tokenColour(fg);
      return ratio(over(c, bg), bg);
    }),
  );

describe("contrast of every allowed pair (B2-T139)", () => {
  it.each(pairs)("$fg on $on meets AA for $kind: $reason", (pair) => {
    const surface = surfaces[pair.on];
    expect(surface, `no surface ${pair.on}`).toBeDefined();
    expect(worst(pair.fg, surface!)).toBeGreaterThanOrEqual(minimumRatio[pair.kind]);
  });

  it("the old 72% top bar glass would fail for the success chip, so the check can tell", () => {
    const old: Surface = {
      stack: [
        { token: "color-bg", alpha: 0.72 },
        { token: "color-success", alpha: 0.08 },
      ],
      under: ["color-dark"],
    };
    expect(worst("color-success", old)).toBeLessThan(4.5);
  });

  it("every pair has a reason, and every colour token is used or exempt on purpose", () => {
    expect(pairs.every((p) => p.reason.length > 5)).toBe(true);
    expect(Object.values(exempt).every((r) => r.length > 5)).toBe(true);
    const used = new Set([
      ...pairs.map((p) => p.fg),
      ...Object.values(surfaces).flatMap((s) => s.stack.map((l) => l.token)),
      ...Object.values(surfaces).flatMap((s) => s.under),
    ]);
    const loose = colourTokenNames().filter((n) => !used.has(n) && !(n in exempt));
    expect(loose, "add each to a pair or to `exempt` with a reason").toEqual([]);
  });
});
