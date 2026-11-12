import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

/**
 * The deferred chunk (spec 0010, AC-10): `three` plus the field is at most 170 KB gzip. It is
 * bundled here the way a bundler would for the browser (minified, tree shaken), with `gsap`
 * left out because the rest of the homepage motion already loads it.
 */
const BUDGET_BYTES = 170 * 1024;

describe("the deferred particle field bundle", () => {
  it("is at most 170 KB gzip, and really contains three", async () => {
    const result = await build({
      entryPoints: [join(process.cwd(), "src/components/home/motion/field.ts")],
      bundle: true,
      minify: true,
      format: "esm",
      platform: "browser",
      target: "es2020",
      write: false,
      external: ["gsap", "gsap/*"],
    });
    const output = result.outputFiles[0]!;
    expect(output.text).toContain("WebGLRenderer");
    expect(gzipSync(output.contents).length).toBeLessThanOrEqual(BUDGET_BYTES);
  }, 60_000);
});
