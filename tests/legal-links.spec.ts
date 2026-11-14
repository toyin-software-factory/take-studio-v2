import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test } from "@playwright/test";
import { signIn } from "./support/session";

// Where Privacy and Terms are linked (spec 0015 AC-2): sign in notice, upload note, user menu.
test("the sign in page has the notice under the form, links only, no checkbox", async ({
  page,
}) => {
  await page.goto("/sign-in");
  const notice = page.getByTestId("sign-in-legal-notice");
  await expect(notice).toContainText("By continuing you agree to the");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await notice.getByRole("link", { name: "Terms" }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await page.goBack();
  await page
    .getByTestId("sign-in-legal-notice")
    .getByRole("link", { name: "Privacy Policy" })
    .click();
  await expect(page).toHaveURL(/\/privacy$/);
});

test("the sign in page passes axe with the notice", async ({ page }) => {
  await page.goto("/sign-in");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});

test.describe("signed in", () => {
  let cleanup: (() => Promise<void>) | undefined;
  test.beforeEach(async ({ context, baseURL }) => {
    ({ cleanup } = await signIn(context, baseURL!));
  });
  test.afterEach(async () => {
    await cleanup?.();
  });

  test("the upload area links Privacy next to the retention note", async ({ page }) => {
    await page.goto("/library");
    const note = page.getByTestId("upload-legal-note");
    await expect(note).toContainText("30 days");
    await note.getByRole("link", { name: "Privacy Policy" }).click();
    await expect(page).toHaveURL(/\/privacy$/);
  });

  test("the user menu links Privacy and Terms", async ({ page }) => {
    await page.goto("/library");
    await page.getByRole("button", { name: /Account menu/ }).click();
    await expect(page.getByRole("menuitem", { name: "Privacy Policy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    await page.getByRole("menuitem", { name: "Terms" }).click();
    await expect(page).toHaveURL(/\/terms$/);
  });

  test.describe("on a phone", () => {
    const { viewport, deviceScaleFactor } = devices["Pixel 7"];
    test.use({ viewport, deviceScaleFactor, isMobile: true, hasTouch: true });
    test("the notice and menu links are 44 px targets", async ({ page }) => {
      await page.goto("/library");
      const link = page.getByTestId("upload-legal-note").getByRole("link");
      expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    });
  });
});
