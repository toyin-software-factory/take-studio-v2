import { devices, expect as baseExpect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { removeBackgrounds, seedBackgrounds, setDefaultBackground } from "./support/backgrounds";
import { signIn } from "./support/session";

// The upload area's Background select and picker dialog (spec 0008, AC-1, AC-12), against the
// real routes with seeded test backgrounds. The thumbnails are presigned R2 links, so they are
// answered with a tiny PNG here. Test users only.
// The first signed in page after a cold server start can take a while.
const expect = baseExpect.configure({ timeout: 30_000 });

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

// Built in studios belong to nobody, so every test here sees every other test's studios. They
// run one after another in this file so the seeded studios never overlap.
test.describe.configure({ mode: "serial", timeout: 90_000 });

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

test("the picker works by keyboard and returns focus to the select", async ({ page, baseURL }) => {
  await signedInWithStudios(page, baseURL!);
  await page.goto("/library");
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

// Uploading and deleting a background from the picker (spec 0008, AC-8, AC-10). The network is
// stubbed so each step and each message is exact; the real routes have their own tests.
type Item = {
  id: string;
  name: string;
  alt: string;
  status: string;
  failureCode: string | null;
  thumbUrl: string | null;
};

async function stubLibrary(
  page: Page,
  state: { mine: Item[]; calls: string[]; defaultId?: string | null; listStatus?: number },
) {
  await page.route("**/api/backgrounds", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      if (state.listStatus) return route.fulfill({ status: state.listStatus, json: {} });
      return route.fulfill({
        json: { builtIn: [], mine: state.mine, defaultId: state.defaultId ?? null },
      });
    }
    state.calls.push(`POST ${JSON.stringify(route.request().postDataJSON())}`);
    return route.fulfill({
      status: 201,
      json: { id: "11111111-1111-4111-8111-111111111111", uploadUrl: "https://r2.test/put-here" },
    });
  });
  await page.route("https://r2.test/put-here", (route) => {
    state.calls.push(`PUT ${route.request().headers()["content-type"]}`);
    return route.fulfill({ status: 200 });
  });
  await page.route("**/api/backgrounds/*/complete", (route) => {
    state.calls.push("COMPLETE");
    return route.fulfill({ json: { status: "processing" } });
  });
}

const png = { name: "Office wall.png", mimeType: "image/png", buffer: Buffer.from("png bytes") };
const NEW_ID = "11111111-1111-4111-8111-111111111111";
const readyItem = (name: string): Item => ({
  id: NEW_ID,
  name,
  alt: name,
  status: "ready",
  failureCode: null,
  thumbUrl: null,
});

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

test("shows the friendly message when processing refuses the image", async ({ page, baseURL }) => {
  await signedInWithStudios(page, baseURL!);
  const state = { mine: [] as Item[], calls: [] as string[] };
  await stubLibrary(page, state);
  await page.goto("/library");
  await expect(select(page)).toBeEnabled();
  await select(page).click();
  await page.getByLabel("Upload image").setInputFiles(png);
  await expect.poll(() => state.calls.includes("COMPLETE")).toBe(true);
  state.mine = [{ ...readyItem("Office wall"), status: "failed", failureCode: "image_too_small" }];
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

test("deleting the picked background puts the pick back to Keep original (the next upload sends original)", async ({
  page,
  baseURL,
}) => {
  await signedInWithStudios(page, baseURL!);
  const state = { mine: [readyItem("Office wall")], calls: [] as string[] };
  await stubLibrary(page, state);
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/uploads", (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, json: { error: "storage_error", message: "x" } });
  });
  await page.route("**/api/backgrounds/*", (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    state.mine = [];
    return route.fulfill({ status: 204 });
  });
  await page.goto("/library");
  await expect(select(page)).toBeEnabled();
  await select(page).click();
  await page.getByRole("radio", { name: /Office wall/ }).check({ force: true });
  await page.getByRole("button", { name: "Delete Office wall" }).click();
  await expect(page.getByRole("radio", { name: /Office wall/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(select(page)).toContainText("Keep original");
  await page
    .locator("#upload-video-input")
    .setInputFiles({ name: "take.mp4", mimeType: "video/mp4", buffer: Buffer.from("x") });
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]?.backgroundId).toBe("original");
});

test("an upload that never finished can be removed", async ({ page, baseURL }) => {
  await signedInWithStudios(page, baseURL!);
  const state = {
    mine: [{ ...readyItem("Half sent"), status: "uploading" }],
    calls: [] as string[],
  };
  await stubLibrary(page, state);
  let deleted = 0;
  await page.route("**/api/backgrounds/*", (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    deleted += 1;
    state.mine = [];
    return route.fulfill({ status: 204 });
  });
  await page.goto("/library");
  await expect(select(page)).toBeEnabled();
  await select(page).click();
  await expect(page.getByText("This upload didn't finish.")).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).click();
  await expect.poll(() => deleted).toBe(1);
  await expect(page.getByText("Half sent")).toHaveCount(0);
});

test("a pick made while a delete is pending is kept when the delete finishes", async ({
  page,
  baseURL,
}) => {
  await signedInWithStudios(page, baseURL!);
  const other = { ...readyItem("Second wall"), id: "22222222-2222-4222-8222-222222222222" };
  const state = { mine: [readyItem("Office wall"), other], calls: [] as string[] };
  await stubLibrary(page, state);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/backgrounds/*", async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    await gate; // the delete stays pending until the test lets it finish
    state.mine = [other];
    return route.fulfill({ status: 204 });
  });
  await page.goto("/library");
  await expect(select(page)).toBeEnabled();
  await select(page).click();
  await page.getByRole("radio", { name: /Office wall/ }).check({ force: true });
  await page.getByRole("button", { name: "Delete Office wall" }).click();
  // While the delete is pending the creator picks another background.
  await page.getByRole("radio", { name: /Second wall/ }).check({ force: true });
  release();
  await expect(page.getByRole("radio", { name: /Office wall/ })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /Second wall/ })).toBeChecked();
});

test("deleting the saved default leaves the list at once, even if the refresh fails (the next upload sends original)", async ({
  page,
  baseURL,
}) => {
  await signedInWithStudios(page, baseURL!);
  const state: { mine: Item[]; calls: string[]; defaultId: string | null; listStatus?: number } = {
    mine: [readyItem("Office wall")],
    calls: [],
    defaultId: NEW_ID,
  };
  await stubLibrary(page, state);
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/uploads", (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, json: { error: "storage_error", message: "x" } });
  });
  await page.route("**/api/backgrounds/*", (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    state.mine = [];
    state.listStatus = 500; // the refresh after the delete fails
    return route.fulfill({ status: 204 });
  });
  await page.goto("/library");
  await expect(select(page)).toContainText("Office wall"); // the saved default
  await select(page).click();
  await page.getByRole("button", { name: "Delete Office wall" }).click();
  await expect(page.getByRole("radio", { name: /Office wall/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(select(page)).toContainText("Keep original");
  await page
    .locator("#upload-video-input")
    .setInputFiles({ name: "take.mp4", mimeType: "video/mp4", buffer: Buffer.from("x") });
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]?.backgroundId).toBe("original");
});
