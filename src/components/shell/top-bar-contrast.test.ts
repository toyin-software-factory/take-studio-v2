import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** B2-T136: the top bar floats over the dark stage when the page scrolls, so its glass must stay light enough for the green status chip. */
const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: readonly number[]) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const ratio = (a: readonly number[], b: readonly number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const over = (top: readonly number[], alpha: number, under: readonly number[]) =>
  top.map((v, i) => alpha * v + (1 - alpha) * under[i]);

const SUCCESS = [0x2e, 0x6b, 0x3f]; // --color-success
const BLACK = [0, 0, 0]; // the worst thing under the bar: the dark stage
const WHITE = [255, 255, 255];

/** The success chip: 8% success on the bar, which is `alpha` white over the stage. */
const chipRatio = (alpha: number) => ratio(SUCCESS, over(SUCCESS, 0.08, over(WHITE, alpha, BLACK)));

describe("top bar glass over the dark stage", () => {
  it("the old 72% glass failed AA for the success chip, so the check can tell", () => {
    expect(chipRatio(0.72)).toBeLessThan(4.5);
  });
  it("the bar's own opacity keeps the chip at 4.5:1 or more", () => {
    const source = readFileSync("src/components/shell/top-bar.tsx", "utf8");
    const match = /\bbg-background\/(\d+)\b/.exec(source);
    expect(match, "top bar needs an opaque enough bg-background/NN").not.toBeNull();
    expect(chipRatio(Number(match?.[1]) / 100)).toBeGreaterThanOrEqual(4.5);
  });
});
