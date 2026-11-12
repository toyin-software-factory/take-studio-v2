import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, meetsAA } from "./contrast";
import { isGalleryEnabled } from "./gallery";
import { allColours, lightPairs, pairHexes, stagePairs } from "./tokens";

const srcDir = join(__dirname, "..", "..");
const css = readFileSync(join(srcDir, "app", "globals.css"), "utf8");
const doc = readFileSync(join(srcDir, "..", "design.md"), "utf8");

/** Every `--name: value;` declaration in globals.css, first one wins (all layers). */
const declared = new Map<string, string>();
for (const m of css.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)) {
  if (!declared.has(m[1]!)) declared.set(m[1]!, m[2]!.trim());
}

/** Same value written two ways compares equal: spacing, case and rgb()/rgba() syntax. */
const canon = (value: string): string =>
  value
    .toLowerCase()
    .replace(
      /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%)?)?\s*\)/g,
      (_, r, g, b, a, pct) => {
        const alpha = a === undefined ? "" : `,${pct ? parseFloat(a) / 100 : parseFloat(a)}`;
        return `rgb(${r},${g},${b}${alpha})`;
      },
    )
    .replace(/\s+/g, "");

describe("design tokens", () => {
  it.each(allColours.filter((t) => t.hex))("--$name is $hex in globals.css", (token) => {
    expect(canon(declared.get(`--${token.name}`) ?? "")).toBe(token.hex);
  });

  it.each(allColours.filter((t) => t.rgba))("--$name is $value in globals.css", (token) => {
    expect(canon(declared.get(`--${token.name}`) ?? "")).toBe(canon(token.value));
  });

  it.each([...lightPairs, ...stagePairs])("$fg on $bg meets WCAG AA for $kind", (pair) => {
    const { fg, bg } = pairHexes(pair);
    expect(meetsAA(contrastRatio(fg, bg), pair.kind)).toBe(true);
  });

  it.each([
    ["color-ink", "color-bg", 20.6],
    ["color-text-muted", "color-bg", 8.0],
    ["color-on-dark-75", "color-dark", 11],
    ["color-on-dark-60", "color-dark", 7],
    ["color-accent", "color-dark", 17],
  ] as const)("%s on %s is about the %s:1 design.md quotes", (fg, bg, quoted) => {
    const { fg: f, bg: b } = pairHexes({ fg, bg, kind: "text" });
    expect(Math.abs(contrastRatio(f, b) - quoted)).toBeLessThanOrEqual(1);
  });

  it("keeps the lime accent off white text and muted text at #4f4f4f or darker (AC-8)", () => {
    const lime = pairHexes({ fg: "color-accent", bg: "color-bg", kind: "text" });
    expect(meetsAA(contrastRatio(lime.fg, lime.bg), "text")).toBe(false);
    const muted = pairHexes({ fg: "color-text-muted", bg: "color-bg", kind: "text" });
    expect(contrastRatio(muted.fg, muted.bg)).toBeGreaterThanOrEqual(7.5);
  });
});

describe("design.md §2 and globals.css agree (AC-1)", () => {
  const section = doc.slice(doc.indexOf("## 2. Design tokens"), doc.indexOf("## 3. Typography"));
  const documented = [...section.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)].map(
    (m) => [m[1]!, m[2]!.trim()] as const,
  );
  // Our font stack starts with the next/font variable, so it differs on purpose.
  const comparable = documented.filter(([name]) => name !== "--font-sans");

  it("documents the whole token list (a parse that finds nothing would pass silently)", () => {
    expect(documented.length).toBeGreaterThanOrEqual(100);
  });

  it.each(comparable)("%s has the value design.md §2 gives", (name, value) => {
    expect(declared.has(name), `${name} is missing from globals.css`).toBe(true);
    expect(canon(declared.get(name)!)).toBe(canon(value));
  });

  it("has loaded Inter Tight with a fallback that starts with the next/font variable", () => {
    expect(declared.get("--font-sans")).toMatch(/^var\(--font-inter-tight\), "Inter Tight"/);
  });
});

describe("v1 design is gone (AC-1, AC-2)", () => {
  const v1 = ["780000", "c1121f", "fdf0d5", "003049", "669bbc", "jetbrains", "papaya", "brick red"];
  const files = readdirSync(srcDir, { recursive: true, encoding: "utf8" }).filter((f) =>
    /\.(css|tsx?)$/.test(f),
  );
  it("has no v1 palette value and no JetBrains Mono in src", () => {
    const hits = files.filter((f) => {
      if (f === join("app", "design", "tokens.test.ts")) return false;
      const text = readFileSync(join(srcDir, f), "utf8").toLowerCase();
      return v1.some((needle) => text.includes(needle));
    });
    expect(hits).toEqual([]);
  });

  it("has removed the v1 appendix from design.md", () => {
    expect(doc).not.toContain("Appendix: v1 tokens");
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
