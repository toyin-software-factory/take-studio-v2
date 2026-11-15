import { test } from "@playwright/test";
import { seedBackgrounds, setDefaultBackground } from "../support/backgrounds";
import { expect, select, signedInWithStudios } from "../fixtures/background-picker";

export function registerPicker(): void {
  test("the select starts on Keep original and the picker lists the studios (AC-1)", async ({
    page,
    baseURL,
  }) => {
    await signedInWithStudios(page, baseURL!);
    await page.goto("/library");
    await expect(select(page)).toContainText("Keep original");
    await select(page).click();
    const dialog = page.getByRole("dialog", { name: "Background" });
    await expect(dialog.getByRole("radio", { name: "Keep original" })).toBeChecked();
    await expect(dialog.getByRole("heading", { name: "Studios" })).toBeVisible();
    await expect(dialog.getByRole("radio", { name: /Calm studio/ })).toBeVisible();
    await expect(dialog.getByRole("radio", { name: /Warm studio/ })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Your backgrounds" })).toBeVisible();
    await expect(dialog.getByText("Upload image")).toBeVisible();
  });

  test("preselects the last pick from the database, and shows it on the select (AC-1)", async ({
    page,
    baseURL,
  }) => {
    const { user, warm } = await signedInWithStudios(page, baseURL!);
    await setDefaultBackground(user.id, warm);
    await page.goto("/library");
    await expect(select(page)).toContainText("Warm studio");
    await select(page).click();
    await expect(page.getByRole("radio", { name: /Warm studio/ })).toBeChecked();
  });

  test("a last pick that is not ready falls back to Keep original (AC-1)", async ({
    page,
    baseURL,
  }) => {
    const { user } = await signedInWithStudios(page, baseURL!);
    const [pending] = await seedBackgrounds([
      { name: "Still processing", creatorId: user.id, status: "processing" },
    ]);
    await setDefaultBackground(user.id, pending!);
    await page.goto("/library");
    await expect(select(page)).toContainText("Keep original");
  });

  test("the picker works by keyboard and returns focus to the select", async ({
    page,
    baseURL,
  }) => {
    await signedInWithStudios(page, baseURL!);
    await page.goto("/library");
    // Not usable until the list has loaded.
    await expect(select(page)).toBeEnabled();
    await select(page).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Background" });
    await expect(dialog).toBeVisible();
    // A local database can hold the built in studios (pnpm db:seed), which list before these two,
    // so start on the test's own first studio instead of counting from Keep original (B2-T140).
    await dialog.getByRole("radio", { name: "Keep original" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("radio", { name: "Keep original" })).not.toBeChecked();
    await dialog.getByRole("radio", { name: /Calm studio/ }).focus();
    await page.keyboard.press("Space");
    await expect(dialog.getByRole("radio", { name: /Calm studio/ })).toBeChecked();
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("radio", { name: /Warm studio/ })).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(select(page)).toBeFocused();
    await expect(select(page)).toContainText("Warm studio");
  });

  test("the chosen background is sent with the upload (AC-1)", async ({ page, baseURL }) => {
    const { warm } = await signedInWithStudios(page, baseURL!);
    const bodies: unknown[] = [];
    await page.route("**/api/uploads", (route) => {
      bodies.push(route.request().postDataJSON());
      return route.fulfill({
        status: 503,
        json: { error: "storage_error", message: "Storage is having a problem right now." },
      });
    });
    await page.goto("/library");
    await select(page).click();
    await page.getByRole("radio", { name: /Warm studio/ }).check({ force: true });
    await page.getByRole("button", { name: "Done" }).click();
    await page.locator("#upload-video-input").setInputFiles({
      name: "take.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("not really a video"),
    });
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({ backgroundId: warm });
    await page.reload();
    // Nothing was stored by the mocked create, so the select is back on its saved value.
    await expect(select(page)).toContainText("Keep original");
  });

  test("an upload with no choice made sends the saved pick, and Keep original sends `original`", async ({
    page,
    baseURL,
  }) => {
    const { user, calm } = await signedInWithStudios(page, baseURL!);
    await setDefaultBackground(user.id, calm);
    const bodies: Record<string, unknown>[] = [];
    await page.route("**/api/uploads", (route) => {
      bodies.push(route.request().postDataJSON());
      return route.fulfill({ status: 503, json: { error: "storage_error", message: "x" } });
    });
    await page.goto("/library");
    await expect(select(page)).toContainText("Calm studio");
    const file = { name: "take.mp4", mimeType: "video/mp4", buffer: Buffer.from("x") };
    await page.locator("#upload-video-input").setInputFiles(file);
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]?.backgroundId).toBe(calm);
    await select(page).click();
    await page.getByRole("radio", { name: "Keep original" }).check({ force: true });
    await page.getByRole("button", { name: "Done" }).click();
    await page.locator("#upload-video-input").setInputFiles(file);
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1]?.backgroundId).toBe("original");
  });

  test("a failed list read still lets the creator upload, with no choice sent", async ({
    page,
    baseURL,
  }) => {
    await signedInWithStudios(page, baseURL!);
    await page.route("**/api/backgrounds", (route) => route.fulfill({ status: 500, json: {} }));
    const bodies: Record<string, unknown>[] = [];
    await page.route("**/api/uploads", (route) => {
      bodies.push(route.request().postDataJSON());
      return route.fulfill({ status: 503, json: { error: "storage_error", message: "x" } });
    });
    await page.goto("/library");
    await expect(page.getByText(/couldn.t load the backgrounds/)).toBeVisible();
    await page.locator("#upload-video-input").setInputFiles({
      name: "take.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("x"),
    });
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).not.toHaveProperty("backgroundId");
  });
}
