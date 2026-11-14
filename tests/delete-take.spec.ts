import { devices, expect as baseExpect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { signIn } from "./support/session";
import { seedTakes } from "./support/takes";

// Delete dialog on the take page and the library cards (spec 0013 AC-4, AC-5, AC-11, AC-12).
// DELETE is stubbed so each answer (204, 500, 404, no answer) is exact; the server side is
// covered by the route tests and the pipeline checks.

const expect = baseExpect.configure({ timeout: 15_000 });

let cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

async function signedIn(page: Page, baseURL: string) {
  const { user, cleanup } = await signIn(page.context(), baseURL);
  cleanups.push(cleanup);
  return user;
}

/** Answers DELETE /api/takes/{id} with each status in turn (the last one repeats). */
async function stubDelete(page: Page, answers: readonly (number | "abort")[]) {
  const calls: string[] = [];
  await page.route(/\/api\/takes\/[^/?]+$/, (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    const answer = answers[Math.min(calls.length, answers.length - 1)]!;
    calls.push(route.request().url());
    if (answer === "abort") return route.abort("failed");
    return route.fulfill({
      status: answer,
      ...(answer === 204 ? {} : { json: { error: "x", message: "x" } }),
    });
  });
  return calls;
}

/** Tab and Shift+Tab many times: focus never leaves the open dialog (AC-12). */
async function expectFocusTrapped(page: Page) {
  const dialog = page.getByRole("dialog");
  for (const key of ["Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
    await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
}

const seeds = [
  { title: "Alpha take", status: "failed", failureCode: "unsupported", minutesAgo: 1 },
  { title: "Beta take", status: "failed", failureCode: "unsupported", minutesAgo: 2 },
  { title: "Gamma take", status: "failed", failureCode: "unsupported", minutesAgo: 3 },
] as const;

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
