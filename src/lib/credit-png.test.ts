import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CREDIT_PNG_PATH, CREDIT_PNG_WIDTH } from "./credit-filter";
import { CREDIT_BOX } from "./credit-rules";
import { decodePng, pixelAt } from "./png-test-helpers";

/** Spec 0026 AC-1: the committed credit image really is white text on a 60% black box. */
const img = decodePng(readFileSync(path.join(process.cwd(), CREDIT_PNG_PATH)));

describe("the credit image (AC-1)", () => {
  it("is 1000 px wide", () => {
    expect(img.width).toBe(CREDIT_PNG_WIDTH);
    expect(img.height).toBe(CREDIT_BOX.height);
  });

  it("has transparent corners", () => {
    for (const [x, y] of [
      [0, 0],
      [CREDIT_PNG_WIDTH - 1, 0],
      [0, CREDIT_BOX.height - 1],
      [CREDIT_PNG_WIDTH - 1, CREDIT_BOX.height - 1],
    ] as const) {
      expect(pixelAt(img, x, y)[3]).toBe(0);
    }
  });

  it("paints the box black at 60% opacity", () => {
    // Away from the corners and the text: the top edge middle and the left edge middle.
    for (const [x, y] of [
      [500, 4],
      [10, 60],
      [990, 60],
    ] as const) {
      const [r, g, b, a] = pixelAt(img, x, y);
      expect([r, g, b]).toEqual([0, 0, 0]);
      expect(Math.abs(a - Math.round(255 * CREDIT_BOX.opacity))).toBeLessThanOrEqual(1);
    }
  });

  it("draws white, fully opaque text in the middle", () => {
    let white = 0;
    for (let y = 30; y < 90; y++) {
      for (let x = 200; x < 800; x++) {
        const [r, g, b, a] = pixelAt(img, x, y);
        if (r === 255 && g === 255 && b === 255 && a === 255) white++;
      }
    }
    expect(white).toBeGreaterThan(300);
  });

  it("holds only box and text pixels, so no stray colour is in the file", () => {
    for (let i = 0; i < img.data.length; i += 4) {
      const [r = 0, g = 0, b = 0] = [img.data[i], img.data[i + 1], img.data[i + 2]];
      // Black box, white text, or an antialiased blend of the two (equal channels).
      expect(r === g && g === b).toBe(true);
    }
  });
});
