import { describe, expect, it } from "vitest";
import {
  originalToOutput,
  outputToOriginal,
  pendingTotalMs,
  playEnd,
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
