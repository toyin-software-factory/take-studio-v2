import { devices, test } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { seedTakes } from "./support/takes";
import {
  cleanups,
  expect,
  expectFocusTrapped,
  seeds,
  signedIn,
  stubDelete,
} from "./fixtures/delete-take";

test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups.length = 0;
});

test.describe("take page", () => {
  const processing = [{ title: "Gamma take", status: "processing" }] as const;

  test("network failure is unknown; a retry that gets 404 counts as done", async ({
    page,
    baseURL,
  }) => {
    const user = await signedIn(page, baseURL!);
    const [id] = await seedTakes(user.id, processing);
    const calls = await stubDelete(page, ["abort", 404]);
    await page.goto(`/takes/${id}`);
    await page.getByRole("button", { name: "Delete Gamma take" }).click();
    await page.getByRole("button", { name: "Delete take" }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toHaveText("We couldn't confirm the delete. Try again to check.");
    await expect(page.getByRole("button", { name: "Delete take" })).toBeEnabled();
    await page.getByRole("button", { name: "Delete take" }).click();
    await expect(page).toHaveURL(/\/library/);
    await expect(page.getByRole("heading", { level: 1, name: "Your takes" })).toBeFocused();
    await expect(page.getByRole("status").filter({ hasText: "Take deleted." })).toHaveCount(1);
    expect(calls).toHaveLength(2);
    // The flag leaves the address, so a reload does not repeat the message.
    expect(new URL(page.url()).search).toBe("");
  });

  test("the Delete button in Details is keyboard reachable; trap, Keep it returns focus", async ({
    page,
    baseURL,
  }) => {
    const user = await signedIn(page, baseURL!);
    const [id] = await seedTakes(user.id, processing);
    await page.goto(`/takes/${id}`);
    const button = page.getByRole("button", { name: "Delete Gamma take" });
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectFocusTrapped(page);
    await page.getByRole("button", { name: "Keep it" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(button).toBeFocused();
  });

  test("the header menu opens the same dialog and Escape returns focus to it", async ({
    page,
    baseURL,
  }) => {
    const user = await signedIn(page, baseURL!);
    const [id] = await seedTakes(user.id, processing);
    await page.goto(`/takes/${id}`);
    const menu = page.getByRole("button", { name: "More actions for this take" });
    await menu.click();
    await page.getByRole("menuitem", { name: "Delete Gamma take" }).click();
    await expect(page.getByRole("dialog")).toContainText("Gamma take");
    await expectNoSeriousAxeIssues(page);
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
  });
});

test.describe("phone width", () => {
  // `defaultBrowserType` cannot be set inside a describe group, so it is left out.
  const pixel: Record<string, unknown> = { ...devices["Pixel 7"] };
  delete pixel.defaultBrowserType;
  test.use(pixel);

  test("the card menu and dialog fit with no sideways scroll and 44 px targets", async ({
    page,
    baseURL,
  }) => {
    const user = await signedIn(page, baseURL!);
    await seedTakes(user.id, seeds);
    await page.goto("/library");
    const menu = page.getByRole("button", { name: "Actions for Alpha take" });
    const box = (await menu.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await menu.click();
    await page.getByRole("menuitem", { name: "Delete Alpha take" }).click();
    for (const name of ["Keep it", "Delete take"]) {
      const b = (await page.getByRole("button", { name }).boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expectNoSeriousAxeIssues(page);
  });

  test("the take page and its dialog fit with no sideways scroll and 44 px targets", async ({
    page,
    baseURL,
  }) => {
    const user = await signedIn(page, baseURL!);
    const [id] = await seedTakes(user.id, [{ title: "Gamma take", status: "processing" }]);
    await page.goto(`/takes/${id}`);
    const sideways = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    expect(await sideways()).toBeLessThanOrEqual(0);
    const del = page.getByRole("button", { name: "Delete Gamma take" });
    expect((await del.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await del.click();
    for (const name of ["Keep it", "Delete take"]) {
      const b = (await page.getByRole("button", { name }).boundingBox())!;
      expect(Math.round(b.height)).toBeGreaterThanOrEqual(44);
    }
    expect(await sideways()).toBeLessThanOrEqual(0);
    await expectNoSeriousAxeIssues(page);
  });
});
