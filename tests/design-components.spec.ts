import { devices, expect, test } from "@playwright/test";

// Base components on /design (spec 0003, AC-3, AC-5). Preview builds only.
test.skip(process.env.E2E_PRODUCTION === "1", "The gallery is not served in production mode.");

const light = (page: import("@playwright/test").Page) =>
  page.locator("#components-light").locator("..");

test("dialog traps focus and returns it to the trigger", async ({ page }) => {
  await page.goto("/design");
  const trigger = light(page).locator('[aria-haspopup="dialog"]', { hasText: "Delete take" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Delete this take?" });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("menu opens and moves by keyboard", async ({ page }) => {
  await page.goto("/design");
  await light(page).getByRole("button", { name: "More actions" }).focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Download" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
});

test("toasts use status or alert and errors stay", async ({ page }) => {
  await page.clock.install();
  await page.goto("/design");
  await light(page).getByRole("button", { name: "Info toast" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Rendering started" })).toBeVisible();
  await light(page).getByRole("button", { name: "Error toast" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Upload failed" })).toBeVisible();
  await page.mouse.move(0, 0);
  await page.clock.runFor(6000);
  await expect(page.getByText("Rendering started")).toBeHidden();
  await expect(page.getByRole("alert").filter({ hasText: "Upload failed" })).toBeVisible();
});

test("every control shows a solid 2 px ring: Brick Red on light, cream on the stage", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/design");
  for (const [section, colour] of [
    ["components-light", "rgb(193, 18, 31)"],
    ["components-stage", "rgb(253, 240, 213)"],
  ] as const) {
    // Start just before the section, then tab through its first controls.
    await page.locator(`#${section}`).evaluate((el) => {
      el.setAttribute("tabindex", "-1");
      el.focus();
    });
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press("Tab");
      const focused = page.locator(":focus");
      const name = await focused.evaluate(
        (el) => el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? el.tagName,
      );
      // toHaveCSS retries, so a colour transition that is still running doesn't flake.
      await expect(focused, `${section}: ${name}`).toHaveCSS("outline-style", "solid");
      await expect(focused, `${section}: ${name}`).toHaveCSS("outline-width", "2px");
      await expect(focused, `${section}: ${name}`).toHaveCSS("outline-color", colour);
    }
  }
});

test.describe("on a phone", () => {
  // Context options only (a full device preset would switch the browser type).
  const { viewport, deviceScaleFactor } = devices["Pixel 7"];
  test.use({ viewport, deviceScaleFactor, isMobile: true, hasTouch: true });

  test("targets are at least 44 px and dialogs open as bottom sheets", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/design");
    const button = light(page).getByRole("button", { name: "Default", exact: true });
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await light(page).getByRole("button", { name: "Open md dialog" }).click();
    const box = (await page.getByRole("dialog").boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(Math.round(box.y + box.height)).toBe(viewport.height);
    expect(Math.round(box.width)).toBe(viewport.width);
  });
});
