import { describe, expect, it } from "vitest";
import {
  DETECTION,
  KEYING,
  type RawFrame,
  type Rgb,
  compositeFilters,
  detectGreenScreen,
  detectInFrame,
  frameSampleArgs,
  fromHex,
  isGreen,
  patchRects,
  rgbToHsv,
  sampleFrameSize,
  sampleTimesMs,
  toHex,
} from "./keying";

const W = 320;
const H = 180;

/** A frame of one colour, with optional rectangles (fractions of the frame) of other colours. */
function frame(
  base: Rgb,
  boxes: ReadonlyArray<{ x0: number; y0: number; x1: number; y1: number; color: Rgb }> = [],
  size = { width: W, height: H },
): RawFrame {
  const data = new Uint8Array(size.width * size.height * 3);
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const fx = x / size.width;
      const fy = y / size.height;
      const box = boxes.find((b) => fx >= b.x0 && fx < b.x1 && fy >= b.y0 && fy < b.y1);
      const c = box?.color ?? base;
      const i = (y * size.width + x) * 3;
      data[i] = c.r;
      data[i + 1] = c.g;
      data[i + 2] = c.b;
    }
  }
  return { width: size.width, height: size.height, data };
}

const GREEN: Rgb = { r: 0, g: 177, b: 64 }; // #00b140, the usual chroma key green
const SKIN: Rgb = { r: 222, g: 160, b: 130 };
const GRAY: Rgb = { r: 90, g: 90, b: 95 };
const person = [{ x0: 0.3, y0: 0.15, x1: 0.7, y1: 1, color: SKIN }];

describe("patch geometry", () => {
  it("has 16 patches of 4 % by 4 %, along the left, right and top edges, none overlapping", () => {
    const patches = patchRects(W, H);
    expect(patches).toHaveLength(16);
    const w = Math.round(W * 0.04);
    const h = Math.round(H * 0.04);
    for (const p of patches) {
      expect([p.w, p.h]).toEqual([w, h]);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + p.w).toBeLessThanOrEqual(W);
      expect(p.y + p.h).toBeLessThanOrEqual(H);
    }
    expect(patches.filter((p) => p.x === 0)).toHaveLength(5);
    expect(patches.filter((p) => p.x === W - w)).toHaveLength(5);
    expect(patches.filter((p) => p.y === 0 && p.x > 0 && p.x < W - w)).toHaveLength(6);
    for (let i = 0; i < patches.length; i++) {
      for (let j = i + 1; j < patches.length; j++) {
        const a = patches[i]!;
        const b = patches[j]!;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        // The top row's first and last patch sit in the corners next to the side patches.
        if (overlap) expect([a.y, b.y]).toContain(0);
      }
    }
  });

  it("works for any frame size, including portrait", () => {
    expect(patchRects(180, 320)).toHaveLength(16);
    expect(patchRects(20, 20).every((p) => p.w >= 1 && p.h >= 1)).toBe(true);
  });
});

describe("colour rules", () => {
  it("converts RGB to HSV", () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 1, v: 1 });
    const g = rgbToHsv(GREEN);
    expect(Math.round(g.h)).toBe(142);
    expect(g.s).toBeCloseTo(1, 2);
  });

  it("calls a colour green by hue 80 to 160, saturation at least 0.30, value at least 0.25", () => {
    expect(isGreen(GREEN)).toBe(true);
    expect(isGreen({ r: 60, g: 200, b: 60 })).toBe(true);
    // Edges of each range.
    expect(isGreen({ r: 128, g: 255, b: 0 })).toBe(true); // hue 90
    expect(isGreen({ r: 255, g: 255, b: 0 })).toBe(false); // hue 60: yellow
    expect(isGreen({ r: 0, g: 200, b: 255 })).toBe(false); // hue 190: cyan
    expect(isGreen({ r: 150, g: 180, b: 150 })).toBe(false); // saturation 0.17: grey green
    expect(isGreen({ r: 0, g: 50, b: 15 })).toBe(false); // value 0.20: too dark
    expect(isGreen(GRAY)).toBe(false);
  });
});

describe("detectGreenScreen", () => {
  const frames = (f: RawFrame) => [f, f, f, f, f];

  it("finds an evenly lit green screen and returns its median colour", () => {
    const result = detectGreenScreen(frames(frame(GREEN, person)));
    expect(result.usable).toBe(true);
    if (result.usable) {
      expect(result.keyColor).toEqual(GREEN);
      expect(result.greenFrames).toBe(5);
    }
  });

  it("takes the median over uneven green, ignoring a stray shade", () => {
    const uneven = frame(GREEN, [
      ...person,
      { x0: 0, y0: 0, x1: 0.08, y1: 1, color: { r: 10, g: 150, b: 60 } },
    ]);
    const result = detectGreenScreen(frames(uneven));
    expect(result.usable).toBe(true);
    if (result.usable) {
      expect(Math.abs(result.keyColor.g - 177)).toBeLessThanOrEqual(30);
      expect(result.keyColor.r).toBeLessThanOrEqual(15);
    }
  });

  it("finds the green after the HDR to SDR tone map, which dulls it", () => {
    // A tone mapped PQ green: lower value and saturation than the studio green, hue the same.
    const dull: Rgb = { r: 52, g: 140, b: 80 };
    expect(isGreen(dull)).toBe(true);
    const result = detectGreenScreen(frames(frame(dull, person)));
    expect(result.usable).toBe(true);
    if (result.usable) expect(result.keyColor).toEqual(dull);
  });

  it("needs at least 10 of 16 patches: a backdrop only 9 patches wide is not usable", () => {
    // Green on the left edge and across the top, but not the right side (5 + 6 = 11 would
    // pass; remove the top and keep one side 5 + a few).
    const narrow = frame(GRAY, [
      { x0: 0, y0: 0, x1: 0.15, y1: 1, color: GREEN }, // left side: 5 patches
      { x0: 0, y0: 0, x1: 0.65, y1: 0.07, color: GREEN }, // top: 4 of 6 patches (9 in all)
    ]);
    const patchesGreen = patchRects(W, H).filter((p) => {
      const cx = (p.x + p.w / 2) / W;
      const cy = (p.y + p.h / 2) / H;
      return cx < 0.15 || (cy < 0.07 && cx < 0.65);
    }).length;
    expect(patchesGreen).toBe(9);
    expect(detectGreenScreen(frames(narrow)).usable).toBe(false);
  });

  it("is not usable with no green, a green shirt in the middle, or a dark patchy screen", () => {
    expect(detectGreenScreen(frames(frame(GRAY, person))).usable).toBe(false);
    const shirt = frame(GRAY, [{ x0: 0.35, y0: 0.4, x1: 0.65, y1: 1, color: GREEN }]);
    expect(detectGreenScreen(frames(shirt)).usable).toBe(false);
    const dark: Rgb = { r: 0, g: 45, b: 15 };
    expect(detectGreenScreen(frames(frame(dark, person))).usable).toBe(false);
  });

  it("needs the green in at least 3 of the 5 frames", () => {
    const good = frame(GREEN, person);
    const bad = frame(GRAY, person);
    expect(detectGreenScreen([good, good, bad, bad, bad]).usable).toBe(false);
    expect(detectGreenScreen([good, bad, good, bad, good]).usable).toBe(true);
    expect(DETECTION.minGreenFrames).toBe(3);
  });

  it("is not usable with no frames", () => {
    expect(detectGreenScreen([])).toEqual({ usable: false, greenFrames: 0 });
  });

  it("measures a portrait frame the same way", () => {
    const portrait = frame(GREEN, person, { width: 180, height: 320 });
    expect(detectGreenScreen(frames(portrait)).usable).toBe(true);
  });
});

describe("sampling", () => {
  it("samples at 10, 30, 50, 70 and 90 % of the take", () => {
    expect(sampleTimesMs(10_000)).toEqual([1_000, 3_000, 5_000, 7_000, 9_000]);
  });

  it("scales a frame to 320 wide with an even height", () => {
    expect(sampleFrameSize(1920, 1080)).toEqual({ width: 320, height: 180 });
    expect(sampleFrameSize(1080, 1920)).toEqual({ width: 320, height: 568 });
    expect(sampleFrameSize(1000, 1001).height % 2).toBe(0);
  });

  it("builds the ffmpeg arguments, tone mapping HDR before the scale", () => {
    const sdr = frameSampleArgs("in.mp4", 2_500, { width: 320, height: 180 }, null);
    expect(sdr).toEqual([
      "-v",
      "error",
      "-ss",
      "2.500",
      "-i",
      "in.mp4",
      "-frames:v",
      "1",
      "-vf",
      "scale=320:180,format=rgb24",
      "-f",
      "rawvideo",
      "-",
    ]);
    const hdr = frameSampleArgs("in.mp4", 0, { width: 320, height: 180 }, "TONEMAP");
    expect(hdr[hdr.indexOf("-vf") + 1]).toBe("TONEMAP,scale=320:180,format=rgb24");
  });
});

describe("hex colours", () => {
  it("round trips and rejects junk", () => {
    expect(toHex(GREEN)).toBe("#00b140");
    expect(fromHex("#00B140")).toEqual(GREEN);
    expect(fromHex("00b140")).toBeNull();
    expect(fromHex("#00b14")).toBeNull();
  });
});

describe("compositeFilters", () => {
  it("keys, cleans the green spill, covers and crops the background and overlays", () => {
    const lines = compositeFilters({ keyColor: "#00b140", width: 1920, height: 1080 });
    expect(lines.join("\n")).toBe(
      [
        `[base]format=yuva444p,chromakey=0x00b140:${KEYING.similarity}:${KEYING.blend},despill=type=green[fg];`,
        "[1:v]scale=1920:1080:force_original_aspect_ratio=increase:out_range=tv,crop=1920:1080,setsar=1,format=yuv420p[bg];",
        "[bg][fg]overlay=format=auto:shortest=1,format=yuv420p[vout]",
      ].join("\n"),
    );
  });

  it("crops to the take's own shape, so a portrait take gets a portrait crop", () => {
    const text = compositeFilters({ keyColor: "#00b140", width: 1080, height: 1920 }).join("\n");
    expect(text).toContain(
      "scale=1080:1920:force_original_aspect_ratio=increase:out_range=tv,crop=1080:1920",
    );
  });
});

describe("detectInFrame (the preview frame)", () => {
  it("is usable with one green screen frame and returns the key colour", () => {
    const result = detectInFrame(frame(GREEN, person));
    expect(result.usable).toBe(true);
    if (result.usable) expect(result.keyColor).toEqual(GREEN);
  });

  it("is not usable without a green screen, or with only part of the border green", () => {
    expect(detectInFrame(frame(GRAY, person)).usable).toBe(false);
    const narrow = frame(GRAY, [{ x0: 0, y0: 0, x1: 0.15, y1: 1, color: GREEN }]);
    expect(detectInFrame(narrow).usable).toBe(false);
  });
});
