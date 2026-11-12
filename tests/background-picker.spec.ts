import { devices, expect as baseExpect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { removeBackgrounds, seedBackgrounds, setDefaultBackground } from "./support/backgrounds";
import { signIn } from "./support/session";

// The upload area's Background select and picker dialog (spec 0008, AC-1, AC-12), against the
// real routes with seeded test backgrounds. The thumbnails are presigned R2 links, so they are
// answered with a tiny PNG here. Test users only.
const expect = baseExpect.configure({ timeout: 15_000 });

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

let cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

async function signedInWithStudios(page: Page, baseURL: string) {
  const { user, cleanup } = await signIn(page.context(), baseURL);
  const [calm, warm] = await seedBackgrounds([
    { name: "Calm studio", minutesAgo: 20 },
    { name: "Warm studio", minutesAgo: 10 },
  ]);
  cleanups.push(cleanup, () => removeBackgrounds([calm!, warm!]));
  await page.route("**/backgrounds/test/**", (route) =>
    route.fulfill({ body: PNG, contentType: "image/png" }),
  );
  return { user, calm: calm!, warm: warm! };
}

const select = (page: Page) => page.getByRole("button", { name: /Background/ });

test("the select starts on Keep original and the picker lists the studios (AC-1)", async ({
  page,
  baseURL,
}) => {
  await signedInWithStudios(page, baseURL!);
  await page.goto("/");
  await expect(select(page)).toContainText("Keep original");
  await select(page).click();
  const dialog = page.getByRole("dialog", { name: "Background" });
  await expect(dialog.getByRole("radio", { name: "Keep original" })).toBeChecked();
  await expect(dialog.getByRole("heading", { name: "Studios" })).toBeVisible();
  await expect(dialog.getByRole("radio", { name: /Calm studio/ })).toBeVisible();
  await expect(dialog.getByRole("radio", { name: /Warm studio/ })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Your backgrounds" })).toHaveCount(0);
});

test("preselects the last pick from the database, and shows it on the select (AC-1)", async ({
  page,
  baseURL,
}) => {
  const { user, warm } = await signedInWithStudios(page, baseURL!);
  await setDefaultBackground(user.id, warm);
  await page.goto("/");
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
  await page.goto("/");
  await expect(select(page)).toContainText("Keep original");
});

test("the picker works by keyboard and returns focus to the select", async ({ page, baseURL }) => {
  await signedInWithStudios(page, baseURL!);
  await page.goto("/");
  // Not usable until the list has loaded.
  await expect(select(page)).toBeEnabled();
  await select(page).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Background" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: "Keep original" }).focus();
  await page.keyboard.press("ArrowRight");
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
  await page.goto("/");
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
  await page.goto("/");
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
  await page.goto("/");
  await expect(page.getByText(/couldn.t load the backgrounds/)).toBeVisible();
  await page.locator("#upload-video-input").setInputFiles({
    name: "take.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("x"),
  });
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).not.toHaveProperty("backgroundId");
});

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
    await page.goto("/");
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
    await page.goto("/");
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
