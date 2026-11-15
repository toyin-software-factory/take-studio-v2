import { test } from "@playwright/test";
import { seedTakes } from "./support/takes";
import { R2, cleanups, clip, expect, signedIn } from "./fixtures/takes";

test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups.length = 0;
});

test.describe("library", () => {
  test("uploads straight to storage with progress, then opens the take (AC-3)", async ({
    page,
    baseURL,
  }) => {
    const user = await signedIn(page, baseURL!);
    const [takeId] = await seedTakes(user.id, [
      { title: "clip", status: "uploading", expiresInDays: null },
    ]);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let partBody = 0;
    await page.route("**/api/uploads", (route) =>
      route.fulfill({ status: 201, json: { takeId, partSize: 16 * 1024 ** 2, partCount: 1 } }),
    );
    await page.route(`**/api/uploads/${takeId}/parts`, (route) =>
      route.fulfill({
        json: { parts: [{ partNumber: 1, url: `${R2}/part/1` }], expiresInSeconds: 900 },
      }),
    );
    await page.route(`${R2}/part/1`, async (route) => {
      const cors = {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "PUT",
        "access-control-allow-headers": "content-type",
        "access-control-expose-headers": "ETag",
      };
      if (route.request().method() === "OPTIONS")
        return route.fulfill({ status: 204, headers: cors });
      partBody = route.request().postDataBuffer()?.length ?? 0;
      await held;
      return route.fulfill({ status: 200, headers: { ...cors, etag: '"abc123"' } });
    });
    let completeBody: unknown;
    await page.route(`**/api/uploads/${takeId}/complete`, (route) => {
      completeBody = route.request().postDataJSON();
      return route.fulfill({ json: { takeId, status: "uploading" } });
    });

    await page.goto("/library");
    await page.locator("#upload-video-input").setInputFiles("tests/fixtures/clip.mp4");
    await expect(page.getByText("clip.mp4")).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Upload progress" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    release();

    await expect(page).toHaveURL(`/takes/${takeId}`);
    expect(partBody).toBe(clip.length);
    expect(completeBody).toEqual({ parts: [{ partNumber: 1, etag: "abc123" }] });
    await expect(page.getByRole("heading", { name: "Checking your video…" })).toBeVisible();
  });

  test("Cancel stops the upload and tells the server (AC-3)", async ({ page, baseURL }) => {
    await signedIn(page, baseURL!);
    const takeId = "00000000-0000-4000-8000-000000000001";
    let abandoned = false;
    await page.route("**/api/uploads", (route) =>
      route.fulfill({ status: 201, json: { takeId, partSize: 16 * 1024 ** 2, partCount: 1 } }),
    );
    await page.route(`**/api/uploads/${takeId}/parts`, (route) =>
      route.fulfill({
        json: { parts: [{ partNumber: 1, url: `${R2}/part/1` }], expiresInSeconds: 900 },
      }),
    );
    await page.route(`${R2}/part/1`, () => new Promise(() => undefined)); // never answers
    await page.route(`**/api/uploads/${takeId}`, (route) => {
      abandoned = route.request().method() === "DELETE";
      return route.fulfill({ json: { takeId, status: "uploading" } });
    });

    await page.goto("/library");
    await page.locator("#upload-video-input").setInputFiles("tests/fixtures/clip.mp4");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Upload cancelled")).toBeVisible();
    expect(abandoned).toBe(true);
  });
});
