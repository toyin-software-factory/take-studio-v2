import { defineConfig, devices } from "@playwright/test";

// Smoke tests run against the built Worker (`pnpm build:worker` first), served by
// `opennextjs-cloudflare preview` on workerd, the same runtime as production.
const host = "127.0.0.1";
const port = 8787;

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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec opennextjs-cloudflare preview --ip ${host} --port ${port}`,
    url: `http://${host}:${port}`,
    // Show the Worker logs in CI so a slow or failed start is visible.
    stdout: "pipe",
    stderr: "pipe",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
