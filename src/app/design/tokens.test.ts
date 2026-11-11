import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, meetsAA } from "./contrast";
import { isGalleryEnabled } from "./gallery";
import { lightColours, lightPairs, stageColours, stagePairs } from "./tokens";

const srcDir = join(__dirname, "..", "..");
const css = readFileSync(join(srcDir, "app", "globals.css"), "utf8");
const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));

/** The value of `--name` in the `:root` block of globals.css. */
const cssValue = (name: string): string | undefined =>
  new RegExp(`--${name}:\\s*([^;]+);`).exec(rootBlock)?.[1]?.trim();

const allColours = [...lightColours, ...stageColours];
const hexOf = (name: string): string => {
  const token = allColours.find((t) => t.name === name);
  if (!token?.value.startsWith("#")) throw new Error(`No opaque token named ${name}`);
  return token.value;
};

describe("design tokens", () => {
  it.each(allColours)("--$name exists in globals.css with the gallery's value", (token) => {
    const value = cssValue(token.name);
    expect(value).toBeDefined();
    if (token.value.startsWith("#")) expect(value).toBe(token.value);
  });

  it.each([...lightPairs, ...stagePairs])(
    "$fg on $bg meets WCAG AA for $kind",
    ({ fg, bg, kind }) => {
      expect(meetsAA(contrastRatio(hexOf(fg), hexOf(bg)), kind)).toBe(true);
    },
  );

  it.each([
    ["text", "bg", 12.3],
    ["primary", "surface", 6.2],
    ["stage-accent", "stage-bg", 4.6],
  ] as const)("%s on %s is about the %s:1 design.md quotes", (fg, bg, quoted) => {
    expect(Math.abs(contrastRatio(hexOf(fg), hexOf(bg)) - quoted)).toBeLessThanOrEqual(0.1);
  });

  it("keeps Steel Blue off light text and Brick Red off the stage (they fail)", () => {
    expect(meetsAA(contrastRatio("#669bbc", hexOf("bg")), "text")).toBe(false);
    expect(meetsAA(contrastRatio(hexOf("primary"), hexOf("stage-bg")), "text")).toBe(false);
  });
});

describe("no raw colours in components (AC-1)", () => {
  const files = readdirSync(srcDir, { recursive: true, encoding: "utf8" }).filter((f) =>
    f.endsWith(".tsx"),
  );
  it.each(files)("%s has no hex colour", (file) => {
    expect(readFileSync(join(srcDir, file), "utf8")).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe("isGalleryEnabled", () => {
  it("is on in development", () =>
    expect(isGalleryEnabled({ NODE_ENV: "development" })).toBe(true));
  it("is on in a preview build with DESIGN_GALLERY=1", () =>
    expect(isGalleryEnabled({ NODE_ENV: "production", DESIGN_GALLERY: "1" })).toBe(true));
  it("is off in production", () =>
    expect(isGalleryEnabled({ NODE_ENV: "production" })).toBe(false));
  it("ignores other values", () =>
    expect(isGalleryEnabled({ NODE_ENV: "production", DESIGN_GALLERY: "true" })).toBe(false));
});
