import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test, type Page } from "@playwright/test";
import { signIn } from "./support/session";
import { seedTakes } from "./support/takes";

// App shell on the signed in pages (spec 0009, AC-4, AC-7).
let cleanup: (() => Promise<void>) | undefined;
let userId = "";

test.beforeEach(async ({ context, baseURL }) => {
  const signedIn = await signIn(context, baseURL!);
  ({ cleanup } = signedIn);
  userId = signedIn.user.id;
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

  // 264 px sticky sidebar, glass top bar at least 72 px tall.
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  expect((await sidebar.boundingBox())!.width).toBe(264);
  await expect(sidebar).toHaveCSS("position", "sticky");
  const bar = page.getByRole("banner");
  expect((await bar.boundingBox())!.height).toBeGreaterThanOrEqual(72);
  await expect(bar).toHaveCSS("position", "sticky");
  await expect(bar).toHaveCSS("backdrop-filter", /blur\(16px\)/);
  await expect(sidebar.getByRole("link", { name: "Upload a take" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /Account menu/ })).toBeVisible();

  const active = page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Takes" });
  await expect(active).toHaveAttribute("aria-current", "page");
  await expect(active).toHaveCSS("font-weight", "500");
  // Nav items are a menu, not running text: no link underline.
  await expect(active).toHaveCSS("text-decoration-line", "none");
});

test("the sidebar is a sheet below 1024 px and a sidebar from 1024 px", async ({ page }) => {
  await page.setViewportSize({ width: 1023, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("complementary", { name: "Sidebar" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(page.getByRole("complementary", { name: "Sidebar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open menu" })).toBeHidden();
});

test("recent takes: newest first, at most five, the current one marked, breadcrumb and status", async ({
  page,
}) => {
  const seeds = ["Take F", "Take E", "Take D", "Take C", "Take B", "Take A"].map(
    (title, minutesAgo) => ({
      title,
      status: "ready" as const,
      durationMs: 12_000,
      minutesAgo: minutesAgo + 1,
    }),
  );
  const ids = await seedTakes(userId, seeds);
  await page.goto("/");
  const recent = page.getByRole("complementary", { name: "Sidebar" }).getByRole("region", {
    name: "Recent takes",
  });
  const links = recent.getByRole("link");
  await expect(links).toHaveCount(5);
  await expect(links.first()).toContainText("Take F");
  await expect(links.first()).toContainText("Ready · 0:12");
  await expect(recent.getByRole("link", { name: /Take A/ })).toHaveCount(0);
  await expect(recent.locator("[aria-current]")).toHaveCount(0);

  await page.goto(`/takes/${ids[1]}`);
  const current = recent.getByRole("link", { name: /Take E/ });
  await expect(current).toHaveAttribute("aria-current", "page");
  await expect(recent.locator("[aria-current]")).toHaveCount(1);
  const crumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumb.getByRole("link", { name: "Takes" })).toBeVisible();
  await expect(crumb.locator("[aria-current=page]")).toHaveText("Take E");
  await expect(page.getByRole("banner").getByText("Ready")).toBeVisible();
});

test("keyboard: tab order runs skip link, sidebar, top bar, then the page", async ({ page }) => {
  await page.goto("/");
  const order: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press("Tab");
    order.push(
      await page.evaluate(
        () => document.activeElement?.textContent?.trim().slice(0, 20) ?? "(none)",
      ),
    );
  }
  expect(order[0]).toBe("Skip to content");
  expect(order[1]).toBe("Take Studio");
  expect(order[2]).toBe("Upload a take");
  expect(order[3]).toBe("Takes");
  // Every focused control shows a solid 2 px ring with a 3 px offset.
  const focused = page.locator(":focus");
  await expect(focused).toHaveCSS("outline-style", "solid");
  await expect(focused).toHaveCSS("outline-width", "2px");
  await expect(focused).toHaveCSS("outline-offset", "3px");
});

test("signed in home passes axe", async ({ page }) => {
  await page.goto("/");
  await expectNoSeriousAxeIssues(page);
});

test("sign out from the user menu returns to the signed out page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  // The signed out homepage: its top bar has the sign in link.
  const signIn = page.getByRole("banner").getByRole("link", { name: "Sign in" });
  await expect(signIn).toBeVisible();
  await page.reload();
  await expect(signIn).toBeVisible();
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
    await expect(sheet.getByRole("link", { name: "Upload a take" })).toBeVisible();
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
    // The signed out homepage on a phone: the top bar keeps only the short call to action, so the
    // sign in link to look for is the footer's.
    await expect(
      page.getByRole("contentinfo").getByRole("link", { name: "Sign in" }),
    ).toBeVisible();
  });

  test("signed in home passes axe on a phone", async ({ page }) => {
    await page.goto("/");
    await expectNoSeriousAxeIssues(page);
  });
});
