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
  // Radix learns that a menu was opened from the keyboard from a document listener it adds in an
  // effect. Until the page's effects have run, Enter opens the menu but focus stays on the menu
  // instead of the first item. The gallery sets this attribute after those effects (no sleeps).
  await expect(light(page).locator("[data-overlays-ready='true']")).toBeAttached();
  const trigger = light(page).getByRole("button", { name: "More actions" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Download" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
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

test.describe("touch targets on a phone (AC-5)", () => {
  const { viewport, deviceScaleFactor } = devices["Pixel 7"];
  test.use({ viewport, deviceScaleFactor, isMobile: true, hasTouch: true });

  // A control passes when a 44 px square around its centre still lands on it or its label, even when the
  // visible box is smaller (checkbox and switch extend their hit area with a pseudo element).
  test("every control has a 44 px hit area", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/design");
    const failures = await page.evaluate(() => {
      const controls = document.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([type=hidden]):not([disabled]), textarea:not([disabled]), [role=checkbox]:not([disabled]), [role=switch]:not([disabled]), [role=tab], [role=combobox], [role=slider]",
      );
      const bad: string[] = [];
      for (const el of controls) {
        const r = el.getBoundingClientRect();
        // Visually hidden helpers (a native input behind a custom control) are not targets.
        if (r.width <= 1 || r.height <= 1 || el.closest("[aria-hidden=true]")) continue;
        if (el.matches("input[type=checkbox]") && el.closest("[data-slot]")) continue;
        el.scrollIntoView({ block: "center" });
        const box = el.getBoundingClientRect();
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height / 2;
        // Its own label is part of the target: pressing it toggles the control.
        const reaches = (dx: number, dy: number) => {
          const hit = document.elementFromPoint(cx + dx, cy + dy);
          return (
            hit !== null && (hit === el || el.contains(hit) || hit.closest("label")?.control === el)
          );
        };
        const lands = [
          [-21, -21],
          [21, -21],
          [-21, 21],
          [21, 21],
        ].every(([dx, dy]) => reaches(dx!, dy!));
        // A box that is already 44 px passes only if something else is not covering it.
        const tall = box.height >= 43.5 && box.width >= 43.5 && reaches(0, 0);
        if (!lands && !tall) {
          bad.push(
            `${el.tagName.toLowerCase()} ${el.getAttribute("role") ?? ""} ${Math.round(box.width)}x${Math.round(box.height)}`,
          );
        }
      }
      return bad;
    });
    expect(failures).toEqual([]);
  });
});

test("Stage container gives its controls the cream focus ring", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/design");
  const play = page
    .getByRole("region", { name: "Stage example" })
    .getByRole("button", { name: "Play" });
  await play.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(play).toBeFocused();
  await expect(play).toHaveCSS("outline-style", "solid");
  await expect(play).toHaveCSS("outline-color", "rgb(253, 240, 213)");
});

test("link buttons size to their text on light and stage", async ({ page }) => {
  await page.goto("/design");
  for (const section of ["components-light", "components-stage"]) {
    const link = page.locator(`#${section}`).locator("..").locator('[data-variant="link"]').first();
    await expect(link).toHaveCSS("padding-left", "0px");
    expect((await link.boundingBox())!.height).toBeLessThan(32);
  }
});
