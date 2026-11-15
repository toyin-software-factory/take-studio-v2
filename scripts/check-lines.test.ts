import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MAX_LINES, countLines, isChecked, overLimit } from "./check-lines";

const lines = (n: number): string => "x;\n".repeat(n);
const dir = mkdtempSync(join(tmpdir(), "check-lines-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(...files: string[]) {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/check-lines.ts", ...files], {
    encoding: "utf8",
  });
  return { code: result.status, out: result.stdout + result.stderr };
}

describe("countLines (counted like wc -l)", () => {
  it("counts newline characters", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a")).toBe(0);
    expect(countLines("a\n")).toBe(1);
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("a\n\nb")).toBe(2);
  });
});

describe("isChecked", () => {
  it("checks ts, tsx, js, mjs and css", () => {
    for (const path of ["a.ts", "src/a.tsx", "b.js", "c.mjs", "src/app/globals.css"])
      expect(isChecked(path), path).toBe(true);
  });
  it("skips other types, generated files and the exempt tool", () => {
    for (const path of [
      "README.md",
      "pnpm-lock.yaml",
      "drizzle/0001_init.sql",
      "drizzle/meta/0001_snapshot.json",
      "drizzle/meta/x.ts",
      ".next/server/app.js",
      "node_modules/x/index.js",
      "tools/design-check/src/compare.js",
    ])
      expect(isChecked(path), path).toBe(false);
  });
  it("does not exempt the rest of tools/", () => {
    expect(isChecked("tools/other/src/a.js")).toBe(true);
  });
});

describe("overLimit", () => {
  it("passes exactly 250 and flags 251, longest first", () => {
    const found = overLimit([
      { path: "a.ts", lines: MAX_LINES },
      { path: "b.ts", lines: MAX_LINES + 1 },
      { path: "c.ts", lines: 900 },
      { path: "drizzle/big.ts", lines: 900 },
    ]);
    expect(found.map((f) => f.path)).toEqual(["c.ts", "b.ts"]);
  });
});

describe("pnpm check:lines on files", () => {
  it("passes a 250 line test file", () => {
    const file = join(dir, "ok.test.ts");
    writeFileSync(file, lines(250));
    expect(run(file).code).toBe(0);
  });

  it("fails a 251 line test file and names it", () => {
    const file = join(dir, "long.test.ts");
    writeFileSync(file, lines(251));
    const { code, out } = run(file);
    expect(code).toBe(1);
    expect(out).toContain("251");
    expect(out).toContain("long.test.ts");
  });

  it("ignores a missing file (deleted in the commit)", () => {
    expect(run(join(dir, "gone.ts")).code).toBe(0);
  });
});
