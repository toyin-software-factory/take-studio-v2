import { test } from "@playwright/test";
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

test.describe("library card menu", () => {
  test("Keep it and Escape return focus to the card menu", async ({ page, baseURL }) => {
    const user = await signedIn(page, baseURL!);
    await seedTakes(user.id, seeds);
    await page.goto("/library");
    const menu = page.getByRole("button", { name: "Actions for Beta take" });
    await menu.click();
    await page.getByRole("menuitem", { name: "Delete Beta take" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Beta take");
    await expect(dialog).toContainText(
      "This removes the video, the original, the transcript and every edit. You can't undo it.",
    );
    await dialog.getByRole("button", { name: "Keep it" }).click();
    await expect(dialog).toBeHidden();
    await expect(menu).toBeFocused();

    await menu.click();
    await page.getByRole("menuitem", { name: "Delete Beta take" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(menu).toBeFocused();
  });

  test("the dialog traps focus and names the action Delete <title>", async ({ page, baseURL }) => {
    const user = await signedIn(page, baseURL!);
    await seedTakes(user.id, seeds);
    await page.goto("/library");
    await page.getByRole("button", { name: "Actions for Beta take" }).click();
    await page.getByRole("menuitem", { name: "Delete Beta take" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectFocusTrapped(page);
  });

  test("deleting removes the card at once, updates the count and moves focus", async ({
    page,
    baseURL,
  }) => {
    const user = await signedIn(page, baseURL!);
    await seedTakes(user.id, seeds);
    const calls = await stubDelete(page, [204]);
    await page.goto("/library");
    await expect(page.getByText("3 takes")).toBeVisible();
    await page.getByRole("button", { name: "Actions for Beta take" }).click();
    await page.getByRole("menuitem", { name: "Delete Beta take" }).click();
    await page.getByRole("button", { name: "Delete take" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    const main = page.getByRole("main");
    await expect(main.getByRole("link", { name: "Beta take" })).toHaveCount(0);
    await expect(page.getByText("2 takes")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Take deleted." })).toHaveCount(1);
    await expect(main.getByRole("link", { name: "Gamma take" })).toBeFocused();
    expect(calls).toHaveLength(1);
  });

  test("focus still lands on the next card when the page runs slowly (B2-T165)", async ({
    page,
    baseURL,
  }) => {
    const user = await signedIn(page, baseURL!);
    await seedTakes(user.id, seeds);
    await stubDelete(page, [204]);
    await page.goto("/library");
    await page.getByRole("button", { name: "Actions for Beta take" }).click();
    await page.getByRole("menuitem", { name: "Delete Beta take" }).click();
    // A slow page is when the dialog finishes closing after the next frame: the focus move must
    // wait for the close, not for one frame, or Radix's own restore overwrites it.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 20 });
    await page.getByRole("button", { name: "Delete take" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await expect(page.getByRole("main").getByRole("link", { name: "Gamma take" })).toBeFocused();
  });

  test("deleting the last take shows the empty state and focuses the upload area", async ({
    page,
    baseURL,
  }) => {
    const user = await signedIn(page, baseURL!);
    await seedTakes(user.id, [seeds[0]]);
    await stubDelete(page, [204]);
    await page.goto("/library");
    await page.getByRole("button", { name: "Actions for Alpha take" }).click();
    await page.getByRole("menuitem", { name: "Delete Alpha take" }).click();
    await page.getByRole("button", { name: "Delete take" }).click();
    await expect(page.getByText("No takes yet. Upload your first video.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose a video" }).first()).toBeFocused();
  });

  test("a server error keeps the dialog open with the message focused", async ({
    page,
    baseURL,
  }) => {
    const user = await signedIn(page, baseURL!);
    await seedTakes(user.id, [seeds[0]]);
    await stubDelete(page, [500, 204]);
    await page.goto("/library");
    await page.getByRole("button", { name: "Actions for Alpha take" }).click();
    await page.getByRole("menuitem", { name: "Delete Alpha take" }).click();
    await page.getByRole("button", { name: "Delete take" }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toHaveText("We couldn't delete this take. Try again.");
    await expect(alert).toBeFocused();
    await expect(page.getByRole("dialog")).toBeVisible();
    // The page behind the dialog is hidden from the accessibility tree, so look past that.
    await expect(
      page.locator("main").getByRole("link", { name: "Alpha take", includeHidden: true }),
    ).toBeVisible();
    await expectNoSeriousAxeIssues(page);
    await page.getByRole("button", { name: "Delete take" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("axe finds nothing serious with the menu open and with the dialog open", async ({
    page,
    baseURL,
  }) => {
    const user = await signedIn(page, baseURL!);
    await seedTakes(user.id, seeds);
    await page.goto("/library");
    await page.getByRole("button", { name: "Actions for Alpha take" }).click();
    await expect(page.getByRole("menuitem", { name: "Delete Alpha take" })).toBeVisible();
    await expectNoSeriousAxeIssues(page);
    await page.getByRole("menuitem", { name: "Delete Alpha take" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoSeriousAxeIssues(page);
  });
});
