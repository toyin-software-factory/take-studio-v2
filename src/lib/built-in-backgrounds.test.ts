import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeWithFfmpeg } from "@/test/ffmpeg";
import { BACKGROUND_IMAGE } from "./background-rules";
import { BUILT_IN_BACKGROUNDS, studiosToInstall } from "./built-in-backgrounds";

/** Spec 0008, AC-7 (S3S-T08): Toyin's six approved studios are the built ins, and only they reach production. */
const SIX = [
  ["warm-podcast", "Warm podcast studio"],
  ["bright-minimal", "Bright minimal studio"],
  ["bookshelf-office", "Bookshelf office"],
  ["palette-gradient", "Soft blue gradient"],
  ["dark-stage", "Dark stage"],
  ["plant-corner", "Plant corner"],
] as const;

describe("the six built in studios", () => {
  it("has all six, with their names, in the order the picker shows them", () => {
    const real = BUILT_IN_BACKGROUNDS.filter((b) => b.testOnly !== true);
    expect(real.map((b) => [b.slug, b.name])).toEqual(SIX.map(([slug, name]) => [slug, name]));
    // Fixed IDs that sort in that order (the library lists built ins by creation time, then ID).
    expect(real.map((b) => b.id)).toEqual([...real.map((b) => b.id)].sort());
  });

  it("gives each one plain alt text that describes the scene", () => {
    for (const b of BUILT_IN_BACKGROUNDS) {
      // A short sentence that starts with a capital (the six also end with a full stop).
      expect(b.alt, b.slug).toMatch(/^[A-Z]/);
      if (b.testOnly !== true) expect(b.alt, b.slug).toMatch(/[.]$/);
      expect(b.alt.length, b.slug).toBeGreaterThan(30);
      expect(b.alt.length, b.slug).toBeLessThanOrEqual(250);
      // Not a file name or the studio's own name repeated.
      expect(b.alt, b.slug).not.toMatch(/\.(jpe?g|png|webp)\b/i);
      expect(b.alt.toLowerCase(), b.slug).not.toBe(b.name.toLowerCase());
    }
    // The podcast studio keeps its lit ON AIR sign (Toyin's choice).
    expect(BUILT_IN_BACKGROUNDS.find((b) => b.slug === "warm-podcast")?.alt).toContain("ON AIR");
  });

  it("keeps the placeholder out of the production list", () => {
    const placeholder = BUILT_IN_BACKGROUNDS.find((b) => b.slug === "studio-placeholder");
    expect(placeholder?.testOnly).toBe(true);
    const production = studiosToInstall(false);
    expect(production.map((b) => b.slug)).toEqual(SIX.map(([slug]) => slug));
    expect(production.some((b) => b.testOnly === true)).toBe(false);
    // Locally everything is installed: the six and the placeholder.
    expect(studiosToInstall(true)).toHaveLength(SIX.length + 1);
  });

  it("has an image and a thumbnail on disk for every studio", () => {
    for (const b of BUILT_IN_BACKGROUNDS) {
      expect(existsSync(`assets/backgrounds/${b.slug}.jpg`), `${b.slug}.jpg`).toBe(true);
      expect(existsSync(`assets/backgrounds/${b.slug}.webp`), `${b.slug}.webp`).toBe(true);
    }
    for (const [slug] of SIX) {
      expect(existsSync(`assets/backgrounds/source/${slug}.png`), `${slug} source`).toBe(true);
    }
  });
});

/** width,height of the first video stream (an image) as ffprobe reads it. */
function size(path: string): readonly [number, number] {
  const run = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      path,
    ],
    { encoding: "utf8" },
  );
  const [w, h] = run.stdout.trim().split(",").map(Number);
  return [w ?? 0, h ?? 0];
}

describeWithFfmpeg("the studio files match the list (real ffprobe)", () => {
  it("has each image at the size the list says, within the ingest limits, and a 480 by 270 thumbnail", () => {
    const { maxWidth, maxHeight, minWidth, minHeight, thumbWidth, thumbHeight } = BACKGROUND_IMAGE;
    for (const b of BUILT_IN_BACKGROUNDS) {
      const [w, h] = size(`assets/backgrounds/${b.slug}.jpg`);
      expect([w, h], `${b.slug} image`).toEqual([b.width, b.height]);
      expect(w, b.slug).toBeLessThanOrEqual(maxWidth);
      expect(h, b.slug).toBeLessThanOrEqual(maxHeight);
      expect(w, b.slug).toBeGreaterThanOrEqual(minWidth);
      expect(h, b.slug).toBeGreaterThanOrEqual(minHeight);
      expect(size(`assets/backgrounds/${b.slug}.webp`), `${b.slug} thumb`).toEqual([
        thumbWidth,
        thumbHeight,
      ]);
    }
  });
});
