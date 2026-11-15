import { describe, expect, it } from "vitest";
import {
  KEYING,
  compositeFilters,
  detectGreenScreen,
  detectInFrame,
  erasesSubject,
  frameAlphaArgs,
  isKeyable,
  keyChroma,
  keySettings,
  transparentShare,
} from "./keying";
import { frame } from "./keying-test-helpers";

describe("adaptive key settings (S3S-T10)", () => {
  const DEEP = { r: 0, g: 177, b: 64 };
  const LIME = { r: 125, g: 245, b: 75 };
  const MINT = { r: 170, g: 230, b: 190 };

  it("measures a key's distance from neutral in the units chromakey's similarity uses", () => {
    expect(keyChroma({ r: 128, g: 128, b: 128 })).toBeCloseTo(0, 2);
    expect(keyChroma(DEEP)).toBeCloseTo(0.4, 1);
    expect(keyChroma(LIME)).toBeCloseTo(0.39, 1);
    expect(keyChroma(MINT)).toBeCloseTo(0.14, 1);
  });

  it("keeps the old settings for a saturated green and scales them down for a pale one", () => {
    expect(keySettings(DEEP)).toEqual({ similarity: KEYING.similarity, blend: KEYING.blend });
    // Lime is a little closer to neutral: the blend is at its ceiling, similarity just under.
    expect(keySettings(LIME).blend).toBe(KEYING.blend);
    expect(keySettings(LIME).similarity).toBeLessThan(KEYING.similarity);
    const mint = keySettings(MINT);
    expect(mint.similarity).toBeCloseTo(0.3 * keyChroma(MINT), 3);
    expect(mint.blend).toBeCloseTo(0.22 * keyChroma(MINT), 3);
    // Whatever the green, similarity plus blend stays well inside the distance to grey.
    for (const key of [DEEP, LIME, MINT, { r: 40, g: 110, b: 55 }]) {
      const { similarity, blend } = keySettings(key);
      expect(similarity + blend).toBeLessThan(0.6 * keyChroma(key));
    }
  });

  it("refuses a key too close to neutral to tell from grey, skin and dark clothing", () => {
    expect(isKeyable(DEEP)).toBe(true);
    expect(isKeyable(MINT)).toBe(true);
    expect(isKeyable({ r: 150, g: 165, b: 155 })).toBe(false);
    // Even when the border looks green to the hue rule, a key that cannot be used is no screen.
    const grayGreen = frame({ r: 150, g: 165, b: 155 });
    const frames = [grayGreen, grayGreen, grayGreen, grayGreen, grayGreen];
    expect(detectGreenScreen(frames).usable).toBe(false);
    expect(detectInFrame(grayGreen).usable).toBe(false);
  });

  it("writes the scaled settings into the filter chain", () => {
    const filters = compositeFilters({ keyColor: "#aae6be", width: 1280, height: 720 });
    const { similarity, blend } = keySettings(MINT);
    expect(filters[0]).toContain(`chromakey=0xaae6be:${similarity}:${blend}`);
  });

  it("counts the transparent share of an alpha plane and refuses a key that erases the subject", () => {
    expect(transparentShare(new Uint8Array([0, 0, 255, 255]))).toBe(0.5);
    expect(transparentShare(new Uint8Array([127, 128]))).toBe(0.5);
    expect(transparentShare(new Uint8Array(0))).toBe(1);
    expect(erasesSubject(0.5)).toBe(false);
    expect(erasesSubject(0.85)).toBe(false);
    expect(erasesSubject(0.86)).toBe(true);
    expect(erasesSubject(1)).toBe(true);
  });

  it("builds the alpha probe on the same tone map and key as the render", () => {
    const args = frameAlphaArgs(
      "in.mp4",
      2500,
      { width: 320, height: 180 },
      "tonemap=hable",
      "#00b140",
    );
    const vf = args[args.indexOf("-vf") + 1]!;
    expect(vf).toBe(
      "tonemap=hable,scale=320:180,format=yuva444p,chromakey=0x00b140:0.12:0.08,alphaextract,format=gray",
    );
    expect(args).toContain("2.500");
    expect(args.slice(-3)).toEqual(["-f", "rawvideo", "-"]);
  });
});
