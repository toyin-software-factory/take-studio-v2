import { describe, expect, it } from "vitest";
import { creditOverlayFilters, creditPlacement } from "./credit-filter";
import { renderFilterScript } from "./trim";

describe("creditPlacement (AC-2)", () => {
  it("landscape: 40% of the shorter side, 5% insets, last 4 s", () => {
    expect(creditPlacement({ width: 1920, height: 1080, durationSeconds: 30 })).toEqual({
      width: 432,
      x: 96,
      y: 54,
      startSeconds: 26,
    });
  });
  it("portrait: 10% top inset", () => {
    const p = creditPlacement({ width: 1080, height: 1920, durationSeconds: 30 });
    expect(p.y).toBe(192);
    expect(p.width).toBe(432);
  });
  it("short video shows the last half", () => {
    expect(creditPlacement({ width: 1920, height: 1080, durationSeconds: 6 }).startSeconds).toBe(3);
  });
  it("min 160, cap 90% of the width wins, never past 1000", () => {
    expect(creditPlacement({ width: 300, height: 300, durationSeconds: 20 }).width).toBe(160);
    expect(creditPlacement({ width: 160, height: 160, durationSeconds: 20 }).width).toBe(144);
    expect(creditPlacement({ width: 8000, height: 6000, durationSeconds: 20 }).width).toBe(1000);
  });
});

describe("creditOverlayFilters and the render graph", () => {
  const placement = { width: 432, x: 96, y: 54, startSeconds: 26 };
  it("scales the PNG and overlays it with no fade", () => {
    const [scale, overlay] = creditOverlayFilters(1, "vpre", "vout", placement);
    expect(scale).toBe("[1:v]scale=432:-1[credit];");
    expect(overlay).toContain("overlay=96:54:enable='gte(t,26)':eof_action=repeat");
    expect(overlay).toMatch(/format=yuv420p\[vout\]$/);
    expect(overlay).not.toContain("fade");
  });
  it("a plain render with a credit ends in the overlay; without one it is unchanged", () => {
    const keep = [{ startMs: 0, endMs: 1_000 }];
    const plain = renderFilterScript(keep, { hdr: null });
    const credited = renderFilterScript(keep, { hdr: null, credit: placement });
    expect(plain).toContain("[vc]format=yuv420p[vout]");
    expect(credited).toContain("[vpre]");
    expect(credited).toContain("[1:v]scale=432:-1[credit];");
    expect(credited.trim().endsWith("[vout]")).toBe(true);
  });
});
