import { devices, expect as baseExpect, test } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";

// B2-T155 (launch UI review, item 2): the global error page, shown when the root layout itself
// throws. The Worker's root layout throws on purpose only when the /design gallery is on (this
// preview build) and the request carries the root error header, so production never can.
const expect = baseExpect.configure({ timeout: 20_000 });
const HEADER = "x-root-error-check";

test.describe("the global error page", () => {
  test.beforeEach(async ({ page }) => {
    await page.context().setExtraHTTPHeaders({ [HEADER]: "1" });
  });

  test("its own html and body, a title, one h1, and nothing internal", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(500);
    await expect(
      page.getByRole("heading", { level: 1, name: "Something went wrong" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page).toHaveTitle("Something went wrong · Take Studio");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("body")).toBeVisible();
    const text = await page.locator("html").innerText();
    const source = await page.content();
    for (const leak of [
      /root error check/i,
      /failed on purpose/i,
      /digest/i,
      /\bat .+:\d+/,
      /\.tsx?\b/,
    ]) {
      expect(text).not.toMatch(leak);
    }
    expect(source).not.toMatch(/root error check|failed on purpose/i);
  });

  test("passes axe in the light and dark themes", async ({ page }) => {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto("/");
      await expect(
        page.getByRole("heading", { level: 1, name: "Something went wrong" }),
      ).toBeVisible();
      await expectNoSeriousAxeIssues(page);
    }
  });

  test("the home link and Retry are reached by keyboard, and the home link works", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      ...devices["Pixel 7"],
      extraHTTPHeaders: { [HEADER]: "1" },
    });
    const page = await context.newPage();
    try {
      await page.goto("/");
      await expect(
        page.getByRole("heading", { level: 1, name: "Something went wrong" }),
      ).toBeVisible();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Take Studio" })).toBeFocused();
      await page.keyboard.press("Tab");
      const retry = page.getByRole("button", { name: "Retry" });
      await expect(retry).toBeFocused();
      const box = await retry.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      // Without the header the next request renders normally, so the home link recovers.
      await context.setExtraHTTPHeaders({});
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/$/);
      await expect(
        page.getByRole("heading", { level: 1, name: "Something went wrong" }),
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("without the header the layout renders as usual", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const response = await page.goto("/");
      expect(response?.status()).toBe(200);
    } finally {
      await context.close();
    }
  });
});
