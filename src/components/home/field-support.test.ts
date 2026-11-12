import { describe, expect, it } from "vitest";
import {
  FIELD_MAX_PIXEL_RATIO,
  FIELD_POINTS,
  fieldPixelRatio,
  fieldPointCount,
  fieldSupport,
} from "./motion/field-support";

describe("fieldSupport (spec 0010, AC-6)", () => {
  const fine = { saveData: false, deviceMemory: 8, webgl: true } as const;

  it("allows the field on a capable browser", () => {
    expect(fieldSupport(fine)).toEqual({ ok: true });
  });
  it("allows it where the browser does not report its memory or the connection", () => {
    expect(fieldSupport({ saveData: undefined, deviceMemory: undefined, webgl: true })).toEqual({
      ok: true,
    });
  });
  it("falls back to the CSS glow when save data is on", () => {
    expect(fieldSupport({ ...fine, saveData: true })).toEqual({ ok: false, reason: "save-data" });
  });
  it("falls back under 4 GB of device memory, and allows exactly 4", () => {
    expect(fieldSupport({ ...fine, deviceMemory: 2 })).toEqual({ ok: false, reason: "low-memory" });
    expect(fieldSupport({ ...fine, deviceMemory: 3.5 })).toEqual({
      ok: false,
      reason: "low-memory",
    });
    expect(fieldSupport({ ...fine, deviceMemory: 4 })).toEqual({ ok: true });
  });
  it("falls back when there is no WebGL", () => {
    expect(fieldSupport({ ...fine, webgl: false })).toEqual({ ok: false, reason: "no-webgl" });
  });
  it("names the first reason when several apply (save data wins, then memory)", () => {
    expect(fieldSupport({ saveData: true, deviceMemory: 1, webgl: false })).toEqual({
      ok: false,
      reason: "save-data",
    });
    expect(fieldSupport({ saveData: false, deviceMemory: 1, webgl: false })).toEqual({
      ok: false,
      reason: "low-memory",
    });
  });
});

describe("the field's size limits", () => {
  it("draws at most 24,000 points on desktop and 8,000 under 810 px", () => {
    expect(FIELD_POINTS).toEqual({ desktop: 24_000, mobile: 8_000 });
    expect(fieldPointCount(1440)).toBe(24_000);
    expect(fieldPointCount(810)).toBe(24_000);
    expect(fieldPointCount(809)).toBe(8_000);
    expect(fieldPointCount(390)).toBe(8_000);
  });
  it("caps the pixel ratio at 1.5", () => {
    expect(FIELD_MAX_PIXEL_RATIO).toBe(1.5);
    expect(fieldPixelRatio(1)).toBe(1);
    expect(fieldPixelRatio(2)).toBe(1.5);
    expect(fieldPixelRatio(3)).toBe(1.5);
  });
});
