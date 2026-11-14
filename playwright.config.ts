import { defineConfig, devices } from "@playwright/test";

// Smoke tests run against the built Worker (`pnpm build:worker` first), served by
// `opennextjs-cloudflare preview` on workerd, the same runtime as production.
const host = "127.0.0.1";
const port = 8787;
// Preview builds opt in to the /design gallery (spec 0003, AC-7). Set E2E_PRODUCTION=1 to serve
// the Worker as production does (no gallery) and check that /design is not found.
const production = process.env.E2E_PRODUCTION === "1";
const galleryVar = production ? "" : " --var DESIGN_GALLERY:1";

const USAGE_SPECS = [/usage\.spec\.ts$/, /record-a11y\.spec\.ts$/, /record-limits\.spec\.ts$/];

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://${host}:${port}`,
    trace: "retain-on-failure",
  },
  // The suites that write the shared monthly usage settings (tests/support/usage.ts) run one
  // after the other, after everything else, so no other test sees limits switched on or off and
  // no test waits on the usage lock inside its own timeout.
  projects: [
    { name: "chromium", testIgnore: USAGE_SPECS, use: { ...devices["Desktop Chrome"] } },
    {
      name: "usage",
      testMatch: /usage\.spec\.ts$/,
      dependencies: ["chromium"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "record-a11y",
      testMatch: /record-a11y\.spec\.ts$/,
      dependencies: ["usage"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "record-limits",
      testMatch: /record-limits\.spec\.ts$/,
      dependencies: ["record-a11y"],
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
    timeout: 120_000,
  },
});
