import { devices, test } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "../support/axe";
import {
  Item,
  expect,
  readyItem,
  select,
  signedInWithStudios,
  stubLibrary,
} from "../fixtures/background-picker";

export function registerUpload(): void {
  for (const [name, viewport] of [
    ["desktop", { width: 1280, height: 900 }],
    ["phone", { width: devices["iPhone 13"].viewport.width, height: 800 }],
  ] as const) {
    test(`the select and the open picker have no serious axe issues at ${name}`, async ({
      page,
      baseURL,
    }) => {
      await page.setViewportSize(viewport);
      await signedInWithStudios(page, baseURL!);
      await page.goto("/library");
      // The loading state is transient (the button is disabled while the list loads).
      await expect(select(page)).toBeEnabled();
      await expectNoSeriousAxeIssues(page);
      await select(page).click();
      const dialog = page.getByRole("dialog", { name: "Background" });
      await expect(dialog.getByRole("radio", { name: /Calm studio/ })).toBeVisible();
      await expectNoSeriousAxeIssues(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test.describe("touch targets on a phone", () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } });

    test("the select and each tile are at least 44 px", async ({ page, baseURL }) => {
      await signedInWithStudios(page, baseURL!);
      await page.goto("/library");
      await expect(select(page)).toBeEnabled(); // the list has loaded
      const trigger = await select(page).boundingBox();
      expect(trigger?.height).toBeGreaterThanOrEqual(44);
      await select(page).click();
      for (const name of ["Keep original", /Calm studio/, /Warm studio/]) {
        const tile = page.getByRole("radio", { name }).locator("..");
        const box = await tile.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect(box?.width).toBeGreaterThanOrEqual(44);
      }
    });
  });

  const png = { name: "Office wall.png", mimeType: "image/png", buffer: Buffer.from("png bytes") };

  test("uploads an image: the link, the PUT, complete, then it is ready and selected (AC-8)", async ({
    page,
    baseURL,
  }) => {
    await signedInWithStudios(page, baseURL!);
    const state = { mine: [] as Item[], calls: [] as string[] };
    await stubLibrary(page, state);
    await page.goto("/library");
    await expect(select(page)).toBeEnabled();
    await select(page).click();
    await page.getByLabel("Upload image").setInputFiles(png);
    await expect.poll(() => state.calls.includes("COMPLETE")).toBe(true);
    state.mine = [readyItem("Office wall")]; // ingest finished
    await expect(page.getByRole("radio", { name: /Office wall/ })).toBeChecked({ timeout: 30_000 });
    expect(state.calls[0]).toContain('"name":"Office wall"');
    expect(state.calls[0]).toContain('"contentType":"image/png"');
    expect(state.calls[1]).toBe("PUT image/png");
    await page.getByRole("button", { name: "Done" }).click();
    await expect(select(page)).toContainText("Office wall");
  });

  test("checks the type and size in the browser before asking for a link", async ({
    page,
    baseURL,
  }) => {
    await signedInWithStudios(page, baseURL!);
    const state = { mine: [] as Item[], calls: [] as string[] };
    await stubLibrary(page, state);
    await page.goto("/library");
    await expect(select(page)).toBeEnabled();
    await select(page).click();
    const input = page.getByLabel("Upload image");
    await input.setInputFiles({ name: "x.gif", mimeType: "image/gif", buffer: Buffer.from("gif") });
    await expect(page.getByRole("alert")).toContainText("Choose a JPEG, PNG or WebP image.");
    // A 10 MB file made inside the page, so nothing large crosses the test protocol.
    await input.evaluate((element: HTMLInputElement) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.jpg", { type: "image/jpeg" }),
      );
      element.files = transfer.files;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(page.getByRole("alert")).toContainText("over 10 MB");
    expect(state.calls).toHaveLength(0);
  });

  test("shows the friendly message when processing refuses the image", async ({
    page,
    baseURL,
  }) => {
    await signedInWithStudios(page, baseURL!);
    const state = { mine: [] as Item[], calls: [] as string[] };
    await stubLibrary(page, state);
    await page.goto("/library");
    await expect(select(page)).toBeEnabled();
    await select(page).click();
    await page.getByLabel("Upload image").setInputFiles(png);
    await expect.poll(() => state.calls.includes("COMPLETE")).toBe(true);
    state.mine = [
      { ...readyItem("Office wall"), status: "failed", failureCode: "image_too_small" },
    ];
    await expect(page.getByRole("alert")).toContainText("too small", { timeout: 30_000 });
    await expect(page.getByRole("alert")).toContainText("1280 by 720");
  });

  test("deletes a background, and says In use when a job renders with it (AC-10)", async ({
    page,
    baseURL,
  }) => {
    await signedInWithStudios(page, baseURL!);
    const state = { mine: [readyItem("Office wall")], calls: [] as string[] };
    await stubLibrary(page, state);
    let attempts = 0;
    await page.route("**/api/backgrounds/*", (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      attempts += 1;
      if (attempts === 1) {
        return route.fulfill({
          status: 409,
          json: { error: "in_use", message: "In use, try again in a minute." },
        });
      }
      state.mine = [];
      return route.fulfill({ status: 204 });
    });
    await page.goto("/library");
    await expect(select(page)).toBeEnabled();
    await select(page).click();
    await page.getByRole("button", { name: "Delete Office wall" }).click();
    await expect(page.getByRole("alert")).toContainText("In use, try again in a minute.");
    await page.getByRole("button", { name: "Delete Office wall" }).click();
    await expect(page.getByRole("radio", { name: /Office wall/ })).toHaveCount(0);
  });
}
