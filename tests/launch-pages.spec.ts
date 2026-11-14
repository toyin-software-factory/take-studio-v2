import { devices, expect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";

// B2-T98 launch readiness: the pages that had no browser test of their own (the not found page and
// the two take email pages), checked for a title, one h1, a main landmark, no sideways scroll on a
// phone, and axe in the light and dark themes. The app error pages need a thrown render error and
// are listed in docs/reviews/launch-ui-review.md as checked by reading only.

const PAGES = [
  { name: "not found", path: "/no-such-page", title: "Not found · Take Studio" },
  {
    name: "turn off emails, valid link",
    path: "/emails/off/confirm?u=user_xxxx&s=sig_xxxx",
    title: "Turn off take emails · Take Studio",
  },
  {
    name: "turn off emails, bad link",
    path: "/emails/off/confirm",
    title: "Turn off take emails · Take Studio",
  },
  { name: "emails off", path: "/emails/off/done?status=off", title: "Take emails · Take Studio" },
  { name: "emails off, bad link", path: "/emails/off/done", title: "Take emails · Take Studio" },
] as const;

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const { name, path, title } of PAGES) {
  test.describe(name, () => {
    test("has a title, one h1 and a main landmark", async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveTitle(title);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
    });

    test("fits a phone with no sideways scroll", async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });

    test("passes axe in the light and dark themes", async ({ page }) => {
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.goto(path);
        await expectNoSeriousAxeIssues(page);
      }
    });
  });
}

test("the links and buttons are 44 px tall on a touch screen", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await context.newPage();
  try {
    await page.goto("/emails/off/done?status=off");
    const box = await page.getByRole("link", { name: "Go to Take Studio" }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await page.goto("/emails/off/confirm?u=user_xxxx&s=sig_xxxx");
    const button = await page.getByRole("button", { name: "Turn off take emails" }).boundingBox();
    expect(button?.height ?? 0).toBeGreaterThanOrEqual(44);
  } finally {
    await context.close();
  }
});
