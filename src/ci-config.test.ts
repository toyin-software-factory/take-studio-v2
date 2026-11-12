import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * CI guards (S1C-T22): the runners are pinned (`ubuntu-latest` moved to a newer Ubuntu whose
 * apt mirrors were unreachable), the e2e job must not depend on apt at run time, and the
 * Playwright container image must be the exact version of @playwright/test in package.json
 * (the browsers in the image only work with that client version).
 */
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  devDependencies: Record<string, string>;
};

/** The one runner image every job is pinned to (bump deliberately, in one PR, with the docs). */
const RUNNER = "ubuntu-24.04";

/** A workflow without its full line comments, so notes about apt don't trip the guards. */
function withoutComments(text: string): string {
  return text.replace(/^\s*#.*$/gm, "");
}

/** The text of one step: from its `- name:` line to the next step. */
function step(name: string): string {
  const start = ci.indexOf(`- name: ${name}`);
  expect(start, `step "${name}" exists`).toBeGreaterThan(-1);
  const next = ci.indexOf("\n      - ", start + 1);
  return ci.slice(start, next === -1 ? undefined : next);
}

describe("CI runs on main, which gates the deploy (HRF-T04)", () => {
  it("is named CI and runs on every push to main and on pull requests", () => {
    const code = withoutComments(ci);
    expect(code).toMatch(/^name: CI\s*$/m);
    expect(code).toMatch(/^on:\s*\n\s+pull_request:\s*\n\s+push:\s*\n\s+branches: \[main\]/m);
    // The deploy waits for this exact name.
    expect(readFileSync(".github/workflows/deploy.yml", "utf8")).toContain("workflows: [CI]");
  });
});

describe("CI installs the pinned ffmpeg (HRF-T06)", () => {
  const config = readFileSync("trigger.config.ts", "utf8");
  const fromConfig = (name: string) => new RegExp(`${name}: "([^"]+)"`).exec(config)?.[1] ?? "";

  it("uses the same URL and SHA 256 as the jobs' build, with the hash checked", () => {
    expect(fromConfig("url")).toMatch(/BtbN\/FFmpeg-Builds/);
    const code = withoutComments(ci);
    expect(code).toContain(`FFMPEG_URL: ${fromConfig("url")}`);
    expect(code).toContain(`FFMPEG_SHA256: ${fromConfig("sha256")}`);
    expect(code).toMatch(/sha256sum -c -/);
    expect(code).toMatch(/GITHUB_PATH/);
  });

  it("installs it before the unit tests that need it, and checks the suites were not skipped", () => {
    const install = ci.indexOf("- name: Install the pinned ffmpeg");
    const onPath = ci.indexOf("- name: Put the pinned ffmpeg on the PATH");
    const unit = ci.indexOf("- name: Unit tests");
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(onPath);
    expect(onPath).toBeLessThan(unit);
    expect(ci).toContain("- name: The ffmpeg suites ran");
    expect(withoutComments(ci)).toMatch(/Tests \.\*skipped/);
    // Colour is off and stripped: Vitest dims the "Tests" label when CI is set, which an
    // anchored match on the plain text would miss.
    expect(withoutComments(ci)).toContain("vitest run --no-color");
    expect(withoutComments(ci)).toContain("sed 's/\\x1b\\[[0-9;]*m//g'");
  });
});

describe("CI runs the production mode e2e check (HRF-T11)", () => {
  const code = withoutComments(ci);
  const start = code.indexOf("- name: E2E production mode");
  const production = start === -1 ? "" : code.slice(start, code.indexOf("\n      - uses:", start));

  it("has a step after the normal e2e that sets E2E_PRODUCTION=1 and runs only that spec", () => {
    expect(start, "the step exists").toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(code.indexOf("- name: E2E smoke"));
    expect(production).toContain("-e E2E_PRODUCTION=1");
    expect(production).toContain("tests/design.spec.ts");
    expect(production).toContain('-g "design gallery \\(production\\)"');
    // The same Playwright image and mounts as the normal run, and no gallery switch of its own.
    expect(production).toContain('"$PLAYWRIGHT_IMAGE"');
    expect(production).not.toMatch(/DESIGN_GALLERY/);
  });

  it("fails on any skipped test and requires exactly 1 passed", () => {
    expect(production).toContain("set -o pipefail");
    expect(production).toMatch(/\^\\s\*\[0-9\]\+ skipped/);
    expect(production).toMatch(/\^\\s\*1 passed/);
    expect(production).toContain("exit 1");
  });

  it("matches the spec: that describe exists and is the one that needs E2E_PRODUCTION", () => {
    const spec = readFileSync("tests/design.spec.ts", "utf8");
    expect(spec).toContain('test.describe("design gallery (production)"');
    expect(spec).toContain('test.skip(!production, "Run with E2E_PRODUCTION=1');
  });
});

describe("CI workflows", () => {
  it("pin every job's runner to ubuntu-24.04, never ubuntu-latest", () => {
    const files = readdirSync(".github/workflows").filter((f) => /\.ya?ml$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = withoutComments(readFileSync(`.github/workflows/${file}`, "utf8"));
      // The whole value of every runs-on line, inline comment removed. A bare `runs-on:` (a
      // list or a block) or any key that is not parsed below makes the counts differ and fails.
      const runners = [...text.matchAll(/^\s*runs-on:[ \t]*(.+?)[ \t]*$/gm)].map((m) =>
        m[1]!.replace(/\s+#.*$/, ""),
      );
      expect(runners.length, `${file} has at least one job`).toBeGreaterThan(0);
      expect(runners.length, `${file}: every runs-on must be a single value`).toBe(
        (text.match(/^\s*runs-on:/gm) ?? []).length,
      );
      // Every job, not just one: any other value, matrix expression or list fails.
      expect(runners, file).toEqual(runners.map(() => RUNNER));
      expect(text, file).not.toMatch(/ubuntu-latest/);
    }
  });

  it("pins @playwright/test to an exact version", () => {
    expect(pkg.devDependencies["@playwright/test"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("names a Playwright image whose tag equals the @playwright/test version", () => {
    const tag =
      /PLAYWRIGHT_IMAGE:\s*mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-[a-z]+\s*$/m.exec(ci);
    expect(
      tag,
      "PLAYWRIGHT_IMAGE must be mcr.microsoft.com/playwright:v<version>-<distro>",
    ).not.toBeNull();
    expect(tag![1]).toBe(pkg.devDependencies["@playwright/test"]);
  });

  it("pulls and runs that image (and only that one) in the pull and e2e steps", () => {
    for (const name of ["Pull the Playwright image", "E2E smoke"]) {
      const block = withoutComments(step(name));
      expect(block, name).toContain('"$PLAYWRIGHT_IMAGE"');
      expect(block, `${name} must not name another image`).not.toMatch(
        /mcr\.microsoft\.com|docker\.io|ghcr\.io/,
      );
    }
  });

  it("runs the e2e tests on the runner's Node, not the image's", () => {
    const block = withoutComments(step("E2E smoke"));
    expect(block).toContain("-e NODE_DIR=");
    expect(block).toMatch(/PATH="\$NODE_DIR\/bin:/);
  });

  it("makes no apt or system dependency install at run time, whatever the options", () => {
    const text = withoutComments(ci);
    expect(text).not.toMatch(/\bapt(-get|-cache|itude)?\b|\bdpkg\b|install-deps|--with-deps/);
  });

  it("puts a timeout on the image pull and on the e2e step", () => {
    for (const name of ["Pull the Playwright image", "E2E smoke"]) {
      expect(step(name), name).toMatch(/timeout-minutes:\s*\d+/);
    }
  });
});
