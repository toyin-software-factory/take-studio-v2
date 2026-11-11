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

describe("design.md and globals.css agree (AC-1)", () => {
  // Lines like "- `--bg`: `#FDF0D5` (Papaya Whip), page background"; a line can document several
  // tokens ("`--primary`: `#...`; `--primary-active`: `#...`"), so every match counts. Translucent
  // tokens say "at 6%" instead of a hex, so only opaque tokens are compared.
  const doc = readFileSync(join(srcDir, "..", "design.md"), "utf8");
  const documented = [...doc.matchAll(/`--([a-z-]+)`: `(#[0-9a-f]{6})`(?! at \d+%)/gi)].map(
    (m) => [m[1]!, m[2]!.toLowerCase()] as const,
  );
  const expand = (hex: string) =>
    /^#[0-9a-f]{3}$/i.test(hex) ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex;

  it("documents the opaque palette (a parse that finds nothing would pass silently)", () => {
    expect(documented.length).toBeGreaterThanOrEqual(19);
  });

  it.each(documented)("--%s is %s in globals.css", (name, hex) => {
    expect(expand(cssValue(name)?.toLowerCase() ?? "")).toBe(hex);
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
