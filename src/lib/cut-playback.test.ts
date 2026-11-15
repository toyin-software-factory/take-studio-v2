import { describe, expect, it } from "vitest";
import {
  originalToOutput,
  outputToOriginal,
  pendingTotalMs,
  playEnd,
  renderedRemovedRanges,
  skipTarget,
} from "./cut-playback";

const ranges = [
  { startMs: 1000, endMs: 1500 },
  { startMs: 4000, endMs: 5000 },
];

describe("cut playback maps", () => {
  it("maps output to original", () => {
    expect(outputToOriginal(500, ranges)).toBe(500);
    expect(outputToOriginal(1000, ranges)).toBe(1500);
    expect(outputToOriginal(4000, ranges)).toBe(5500);
  });
  it("maps original to output, a cut maps to its start", () => {
    expect(originalToOutput(500, ranges)).toBe(500);
    expect(originalToOutput(1200, ranges)).toBe(1000);
    expect(originalToOutput(6000, ranges)).toBe(4500);
  });
  it("finds the skip target", () => {
    expect(skipTarget(999, ranges)).toBeNull();
    expect(skipTarget(1000, ranges)).toBe(1500);
    expect(skipTarget(1500, ranges)).toBeNull();
  });
  it("totals and end", () => {
    expect(pendingTotalMs(10000, ranges)).toBe(8500);
    expect(playEnd(ranges, 10000)).toBe(10000);
    expect(playEnd([{ startMs: 9000, endMs: 10000 }], 10000)).toBe(9000);
  });
});

// B2-T156: the switch between the original and the render, over a take with many cuts.
describe("frame aligned resume (B2-T156)", () => {
  const DURATION = 60_000;
  // Cut edges that sit between frames, like silence detection gives them.
  const stored = Array.from({ length: 12 }, (_, i) => ({
    startMs: 3000 + i * 4500 + 13.7 * i,
    endMs: 3000 + i * 4500 + 13.7 * i + 700 + 9.3 * i,
  }));

  for (const fps of [30, 30000 / 1001]) {
    const frame = 1000 / fps;
    // The render's real timeline: keep ranges on the frame grid, so the real removed ranges.
    const real = renderedRemovedRanges(stored, DURATION, fps);
    // A kept moment on the original, on a frame, and where the render really shows it.
    const probes = [1000, 8000, 20_000, 33_000, 45_000, 58_000].map(
      (ms) => Math.round(ms / frame) * frame,
    );
    const kept = probes.filter((ms) => !stored.some((r) => ms >= r.startMs && ms < r.endMs));

    it(`the stored ms ranges drift past half a frame over several cuts at ${fps.toFixed(2)} fps`, () => {
      const worst = Math.max(
        ...kept.map((ms) => Math.abs(originalToOutput(ms, stored) - originalToOutput(ms, real))),
      );
      expect(worst).toBeGreaterThan(frame / 2);
    });

    it(`aligned ranges keep original, render, original within half a frame at ${fps.toFixed(2)} fps`, () => {
      for (const ms of kept) {
        const out = originalToOutput(ms, real);
        expect(Math.abs(outputToOriginal(out, real) - ms)).toBeLessThanOrEqual(frame / 2);
      }
    });

    it(`the aligned ranges total what the render lost, a cut at a time, at ${fps.toFixed(2)} fps`, () => {
      expect(real).toHaveLength(stored.length);
      real.forEach((r, i) => {
        const s = stored[i]!;
        expect(r.startMs).toBeGreaterThanOrEqual(s.startMs - 1e-6);
        expect(r.endMs).toBeLessThanOrEqual(s.endMs + 1e-6);
        expect(s.startMs - r.startMs).toBeGreaterThan(-frame);
        expect(r.startMs / frame).toBeCloseTo(Math.round(r.startMs / frame), 6);
      });
    });
  }

  it("no cuts, unknown fps and a trailing cut", () => {
    expect(renderedRemovedRanges([], DURATION, 30)).toEqual([]);
    const trailing = renderedRemovedRanges([{ startMs: 59_000, endMs: DURATION }], DURATION, null);
    expect(trailing).toHaveLength(1);
    expect(trailing[0]!.endMs).toBe(DURATION);
    expect(trailing[0]!.startMs).toBeGreaterThanOrEqual(59_000);
  });
});
