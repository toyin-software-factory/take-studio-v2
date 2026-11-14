import { devices, expect as baseExpect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { INSIGHTS_TEST_VIEWER_ID, setting, signIn } from "./support/session";

// B2-T99 (from the launch UI review): /insights for the viewer and for everyone else, and the app
// error page. The CI `.env` names a made up user as INSIGHTS_VIEWER_USER_ID; a local `.env` may
// not, so the viewer tests skip there (and fail in CI, so they can never skip quietly).
const expect = baseExpect.configure({ timeout: 20_000 });

const viewerConfigured = setting("INSIGHTS_VIEWER_USER_ID") === INSIGHTS_TEST_VIEWER_ID;
const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("/insights", () => {
  // Both viewer tests insert the same made up user id, so they must not run at the same time
  // (fullyParallel would give a primary key clash). Default mode keeps them in order on one worker.
  test.describe.configure({ mode: "default" });
  test.beforeEach(() => {
    if (process.env.CI)
      expect(viewerConfigured, "CI .env must set INSIGHTS_VIEWER_USER_ID").toBe(true);
    else test.skip(!viewerConfigured, "INSIGHTS_VIEWER_USER_ID is not the test viewer id in .env");
  });

  test("the viewer sees the page: title, one h1, phone width", async ({ page, baseURL }) => {
    const { cleanup } = await signIn(
      page.context(),
      baseURL ?? "",
      "Insights Viewer",
      INSIGHTS_TEST_VIEWER_ID,
    );
    try {
      await page.setViewportSize({ width: 360, height: 740 });
      const response = await page.goto("/insights");
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle("Insights · Take Studio");
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    } finally {
      await cleanup();
    }
  });

  test("passes axe in the light and dark themes", async ({ page, baseURL }) => {
    const { cleanup } = await signIn(
      page.context(),
      baseURL ?? "",
      "Insights Viewer",
      INSIGHTS_TEST_VIEWER_ID,
    );
    try {
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.goto("/insights");
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoSeriousAxeIssues(page);
      }
    } finally {
      await cleanup();
    }
  });

  test("a signed in creator who is not the viewer gets the not found page", async ({
    page,
    baseURL,
  }) => {
    const { cleanup } = await signIn(page.context(), baseURL ?? "");
    try {
      const response = await page.goto("/insights");
      expect(response?.status()).toBe(404);
      await expect(
        page.getByRole("heading", { level: 1, name: /couldn.t find that page/i }),
      ).toBeVisible();
    } finally {
      await cleanup();
    }
  });
});

test("signed out, /insights is not found too", async ({ page }) => {
  const response = await page.goto("/insights");
  expect(response?.status()).toBe(404);
});

// The app error page (src/app/error.tsx), reached through /design/error, which throws while
// rendering and exists only where the /design gallery does (404 in production).
test.describe("the app error page", () => {
  test("heading, Retry by keyboard recovers, 44 px target", async ({ browser }) => {
    const context = await browser.newContext({ ...devices["Pixel 7"] });
    const page = await context.newPage();
    try {
      await page.goto("/design/error");
      await expect(
        page.getByRole("heading", { level: 1, name: "Something went wrong" }),
      ).toBeVisible();
      const retry = page.getByRole("button", { name: "Retry" });
      const box = await retry.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      await context.setExtraHTTPHeaders({ "x-error-check-ok": "1" });
      await retry.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { level: 1, name: "Recovered" })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("passes axe in the light and dark themes", async ({ page }) => {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto("/design/error");
      await expect(
        page.getByRole("heading", { level: 1, name: "Something went wrong" }),
      ).toBeVisible();
      await expectNoSeriousAxeIssues(page);
    }
  });
});
