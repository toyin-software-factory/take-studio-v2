import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test, type Page } from "@playwright/test";
import { signIn } from "./support/session";

// App shell on the signed in home (spec 0003, AC-4, AC-6).
let cleanup: (() => Promise<void>) | undefined;

test.beforeEach(async ({ context, baseURL }) => {
  ({ cleanup } = await signIn(context, baseURL!));
});

test.afterEach(async () => {
  await cleanup?.();
});

async function expectNoSeriousAxeIssues(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

test("desktop shell: skip link, landmarks, sidebar and active item", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Your takes" })).toBeVisible();
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();

  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#content")).toBeFocused();

  const sidebar = page.getByRole("banner");
  expect((await sidebar.boundingBox())!.width).toBe(240);
  const active = page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Takes" });
  await expect(active).toHaveAttribute("aria-current", "page");
  await expect(active).toHaveCSS("border-left-width", "3px");
  await expect(active).toHaveCSS("border-left-color", "rgb(193, 18, 31)");
  // Nav items are a menu, not running text: no link underline.
  await expect(active).toHaveCSS("text-decoration-line", "none");
});

test("signed in home passes axe", async ({ page }) => {
  await page.goto("/");
  await expectNoSeriousAxeIssues(page);
});

test("sign out from the user menu returns to the signed out page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
});

test.describe("on a phone", () => {
  const { viewport, deviceScaleFactor } = devices["Pixel 7"];
  test.use({ viewport, deviceScaleFactor, isMobile: true, hasTouch: true });

  test("top bar menu opens the nav in a sheet and traps focus", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
    const menu = page.getByRole("button", { name: "Open menu" });
    await menu.click();
    const sheet = page.getByRole("dialog", { name: "Take Studio" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Takes" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press("Tab");
      expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await expectNoSeriousAxeIssues(page);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(menu).toBeFocused();
  });

  test("signs out from the account menu inside the sheet", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    const sheet = page.getByRole("dialog", { name: "Take Studio" });
    await sheet.getByRole("button", { name: /Account menu/ }).click();
    const signOut = page.getByRole("menuitem", { name: "Sign out" });
    // The menu must sit above the sheet, not hidden behind it.
    await expect(signOut).toBeVisible();
    await signOut.click();
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  });

  test("signed in home passes axe on a phone", async ({ page }) => {
    await page.goto("/");
    await expectNoSeriousAxeIssues(page);
  });
});
