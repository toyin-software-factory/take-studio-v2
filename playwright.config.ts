import { existsSync } from "node:fs";
import { defineConfig, devices, firefox, webkit, type BrowserType } from "@playwright/test";

// Smoke tests run against the built Worker (`pnpm build:worker` first), served by
// `opennextjs-cloudflare preview` on workerd, the same runtime as production.
const host = "127.0.0.1";
const port = 8787;
// Preview builds opt in to the /design gallery (spec 0003, AC-7). Set E2E_PRODUCTION=1 to serve
// the Worker as production does (no gallery) and check that /design is not found.
const production = process.env.E2E_PRODUCTION === "1";
const galleryVar = production ? "" : " --var DESIGN_GALLERY:1";

// The key flows also run in Safari's and Firefox's engines (B2-T102); only this file does.
const CROSS_BROWSER_SPEC = /cross-browser\.spec\.ts$/;
const USAGE_SPECS = [/usage\.spec\.ts$/, /record-a11y\.spec\.ts$/, /record-limits\.spec\.ts$/];

/**
 * Safari's and Firefox's engines run in CI (the Playwright image has them). A local run includes
 * one only when its browser is installed (`pnpm exec playwright install webkit firefox`), so a
 * sandbox with Chromium alone is not red for browsers it never had (B2-T140).
 */
const engine = (type: BrowserType): boolean =>
  !!process.env.CI || existsSync(type.executablePath());

/** The run order between the usage suites (see the note on `projects`). */
const chain = (names: string[]): string[] => (process.env.E2E_SPLIT ? [] : names);

export default defineConfig({
  testDir: "./tests",
  // Stops the run with the cause when the Worker does not accept the test session (B2-T137).
  globalSetup: "./tests/support/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? undefined : 2,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://${host}:${port}`,
    trace: "retain-on-failure",
  },
  // The suites that write the shared monthly usage settings (tests/support/usage.ts) run one
  // after the other, after everything else, so no other test sees limits switched on or off and
  // no test waits on the usage lock inside its own timeout.
  //
  // Sharding (B2-T100): Playwright runs a project's `dependencies` in full in every shard and
  // shards only the top level projects, so the chain below cannot be split. CI sets E2E_SPLIT=1,
  // which drops the chain: the `chromium` project is sharded over parallel jobs, and one more job
  // runs `usage`, `record-a11y` and `record-limits` one after another, each as its own command.
  // Without E2E_SPLIT (a local `pnpm test:e2e`) the chain keeps them in that order.
  projects: [
    ...(engine(webkit)
      ? [{ name: "webkit", testMatch: CROSS_BROWSER_SPEC, use: { ...devices["Desktop Safari"] } }]
      : []),
    ...(engine(firefox)
      ? [{ name: "firefox", testMatch: CROSS_BROWSER_SPEC, use: { ...devices["Desktop Firefox"] } }]
      : []),
    { name: "chromium", testIgnore: USAGE_SPECS, use: { ...devices["Desktop Chrome"] } },
    {
      name: "usage",
      testMatch: /usage\.spec\.ts$/,
      dependencies: chain(["chromium"]),
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "record-a11y",
      testMatch: /record-a11y\.spec\.ts$/,
      dependencies: chain(["usage"]),
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "record-limits",
      testMatch: /record-limits\.spec\.ts$/,
      dependencies: chain(["record-a11y"]),
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm exec opennextjs-cloudflare preview --ip ${host} --port ${port}${galleryVar}`,
    url: `http://${host}:${port}`,
    // Show the Worker logs in CI so a slow or failed start is visible.
    stdout: "pipe",
    stderr: "pipe",
    reuseExistingServer: !process.env.CI,
    // The preview's esbuild (Go) kept 1.2 GB after bundling the Worker and the whole server passed
    // 3.5 GB over a full run, which starved a 6 GB sandbox at two workers (B2-T165). A soft limit
    // makes it collect and give memory back; nothing about the build changes. The same goes for
    // wrangler's Node heap, which reached 1.3 GB.
    env: { GOMEMLIMIT: "300MiB", NODE_OPTIONS: "--max-old-space-size=768" },
    timeout: 120_000,
  },
});
