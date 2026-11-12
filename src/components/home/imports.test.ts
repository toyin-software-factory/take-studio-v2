import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The animation libraries belong to the homepage only (spec 0009 AC-9, spec 0010): `gsap` and
 * `lenis` are imported from `src/components/home/motion/` and nowhere else, so a signed in page
 * can never end up loading them.
 */
const src = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const IMPORT = /from\s+["'](gsap|lenis|three)(\/[^"']*)?["']|import\(\s*["'](gsap|lenis|three)/;

describe("animation library imports", () => {
  const importers = sourceFiles(src)
    .filter((file) => IMPORT.test(readFileSync(file, "utf8")))
    .map((file) => relative(src, file));

  it("only the homepage motion folder imports gsap, lenis or three", () => {
    expect(importers.length).toBeGreaterThan(0);
    for (const file of importers) expect(file).toMatch(/^components\/home\/motion\//);
  });

  it("the motion folder is reached only through the dynamic import in motion.tsx", () => {
    const outside = sourceFiles(join(src, "components", "home"))
      .filter((file) => !file.includes(`${join("home", "motion")}`))
      .filter((file) =>
        // `fan-state` is the one static import: a tiny store with no animation library in it.
        /from\s+["']\.\/motion\/(?!fan-state["'])/.test(readFileSync(file, "utf8")),
      );
    expect(outside).toEqual([]);
    const loader = readFileSync(join(src, "components", "home", "motion.tsx"), "utf8");
    expect(loader).toMatch(/import\(\s*["']\.\/motion\/start["']\s*\)/);
  });

  it("only the particle field imports three, and only studio.ts loads the field, dynamically", () => {
    const threeImporters = importers.filter((file) =>
      /from\s+["']three["']/.test(readFileSync(join(src, file), "utf8")),
    );
    expect(threeImporters).toEqual(["components/home/motion/field.ts"]);
    const fieldLoaders = sourceFiles(join(src, "components", "home")).filter((file) =>
      /["']\.\/field["']/.test(readFileSync(file, "utf8")),
    );
    expect(fieldLoaders.map((file) => relative(src, file))).toEqual([
      "components/home/motion/studio.ts",
    ]);
    const studio = readFileSync(join(src, "components", "home", "motion", "studio.ts"), "utf8");
    expect(studio).toMatch(/import\(\s*["']\.\/field["']\s*\)/);
    expect(studio).not.toMatch(/from\s+["']\.\/field["']/);
  });
});
