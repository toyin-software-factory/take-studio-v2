import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * CI guards (S1C-T22): the e2e job must not depend on Ubuntu's apt servers at run time, and
 * the Playwright container image must be the exact version of @playwright/test in
 * package.json (the browsers in the image only work with that client version).
 */
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  devDependencies: Record<string, string>;
};

describe("CI workflow", () => {
  it("pins @playwright/test to an exact version", () => {
    expect(pkg.devDependencies["@playwright/test"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("runs e2e in the Playwright image whose tag equals the @playwright/test version", () => {
    const tag =
      /PLAYWRIGHT_IMAGE:\s*mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-[a-z]+\s*$/m.exec(ci);
    expect(
      tag,
      "PLAYWRIGHT_IMAGE must be mcr.microsoft.com/playwright:v<version>-<distro>",
    ).not.toBeNull();
    expect(tag![1]).toBe(pkg.devDependencies["@playwright/test"]);
    expect(ci).toContain('"$PLAYWRIGHT_IMAGE"');
  });

  it("makes no apt or system dependency install at run time", () => {
    expect(ci).not.toMatch(/apt-get|apt install|apt update|install-deps|--with-deps/);
  });

  it("puts a timeout on the image pull and on the e2e step", () => {
    for (const name of ["Pull the Playwright image", "E2E smoke"]) {
      const start = ci.indexOf(`- name: ${name}`);
      expect(start, name).toBeGreaterThan(-1);
      const block = ci.slice(start, ci.indexOf("\n      - ", start + 1));
      expect(block, name).toMatch(/timeout-minutes:\s*\d+/);
    }
  });
});
