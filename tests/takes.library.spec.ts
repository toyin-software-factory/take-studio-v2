import { test } from "@playwright/test";
import { seedTakes } from "./support/takes";
import { R2, cleanups, expect, expectNoSeriousAxeIssues, signedIn } from "./fixtures/takes";

test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups.length = 0;
});

test.describe("library", () => {
  test("empty state, upload area and limits, axe", async ({ page, baseURL }) => {
    await signedIn(page, baseURL!);
    await page.goto("/library");
    await expect(page).toHaveTitle("Your takes · Take Studio");
    await expect(page.getByRole("button", { name: "Choose a video" }).first()).toBeVisible();
    await expect(page.getByText("MP4 or MOV, up to 10 minutes, 2 GB, 1080p")).toBeVisible();
    await expect(page.getByText("No takes yet. Upload your first video.")).toBeVisible();
    await expectNoSeriousAxeIssues(page);
  });

  test("cards: newest first, status badges, mono duration, expiry, failure actions", async ({
    page,
    baseURL,
  }) => {
    const user = await signedIn(page, baseURL!);
    await seedTakes(user.id, [
      {
        title: "Oldest ready take",
        status: "ready",
        durationMs: 84_000,
        expiresInDays: 12,
        minutesAgo: 30,
        steps: [
          { name: "trim", status: "succeeded" },
          { name: "render", status: "succeeded" },
        ],
        removedRanges: [{ startMs: 1000, endMs: 5000 }],
      },
      {
        title: "Render crashed",
        status: "failed",
        failureCode: "ffmpeg_error",
        durationMs: 60_000,
        minutesAgo: 20,
        steps: [
          { name: "trim", status: "succeeded" },
          { name: "render", status: "failed" },
        ],
      },
      {
        title: "Too long take",
        status: "failed",
        failureCode: "too_long",
        durationMs: 14 * 60_000,
        minutesAgo: 10,
      },
      {
        title: "Newest processing",
        status: "processing",
        durationMs: 30_000,
        minutesAgo: 1,
        steps: [
          { name: "trim", status: "succeeded" },
          { name: "render", status: "running", progress: 40 },
        ],
      },
    ]);
    await page.goto("/library");

    const titles = page.getByRole("region", { name: "Takes" }).getByRole("heading", { level: 3 });
    await expect(titles).toHaveText([
      "Newest processing",
      "Too long take",
      "Render crashed",
      "Oldest ready take",
    ]);
    const ready = page
      .getByRole("main")
      .getByRole("listitem")
      .filter({ hasText: "Oldest ready take" });
    await expect(ready.getByText("Ready", { exact: true })).toBeVisible();
    await expect(ready.getByText("1:20")).toHaveClass(/mono/);
    await expect(ready.getByText(/^Video expires on \d{1,2} [A-Z][a-z]{2}$/)).toBeVisible();
    const crashed = page
      .getByRole("main")
      .getByRole("listitem")
      .filter({ hasText: "Render crashed" });
    await expect(crashed.getByRole("button", { name: "Try again" })).toBeVisible();
    const tooLong = page
      .getByRole("main")
      .getByRole("listitem")
      .filter({ hasText: "Too long take" });
    await expect(
      tooLong.getByText("This video is 14 minutes long. The limit is 10 minutes."),
    ).toBeVisible();
    await expect(tooLong.getByRole("button", { name: "Upload another video" })).toBeVisible();
    await expectNoSeriousAxeIssues(page);

    await ready.getByRole("link", { name: "Oldest ready take" }).click();
    await expect(page).toHaveURL(/\/takes\//);
  });

  test("cards load their thumbnail through a signed link, else keep the placeholder", async ({
    page,
    baseURL,
  }) => {
    const user = await signedIn(page, baseURL!);
    await seedTakes(user.id, [
      { title: "With thumbnail", status: "ready", durationMs: 5000, minutesAgo: 1 },
      { title: "Still uploading", status: "uploading", expiresInDays: null, minutesAgo: 2 },
    ]);
    const asked: string[] = [];
    await page.route("**/api/takes/*/media?kind=thumb", (route) => {
      asked.push(route.request().url());
      return route.fulfill({ json: { url: `${R2}/thumb.jpg`, expiresInSeconds: 3600 } });
    });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.route(`${R2}/thumb.jpg`, (route) =>
      route.fulfill({ body: png, contentType: "image/png" }),
    );
    await page.goto("/library");
    const card = page.getByRole("main").getByRole("listitem").filter({ hasText: "With thumbnail" });
    await expect(card.locator("img")).toBeVisible();
    // No link is requested for the take that is still uploading.
    expect(asked).toHaveLength(1);
    await expect(
      page
        .getByRole("main")
        .getByRole("listitem")
        .filter({ hasText: "Still uploading" })
        .locator("img"),
    ).toHaveCount(0);
  });

  test("a card refresh that gets 401 says the session ended, with a sign in action", async ({
    page,
    baseURL,
  }) => {
    const user = await signedIn(page, baseURL!);
    await seedTakes(user.id, [
      { title: "Quietly processing", status: "processing", minutesAgo: 1 },
    ]);
    // Only the take detail request (not its media links) answers 401, as an expired session does.
    await page.route("**/api/takes/*", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ status: 401, json: { error: "unauthorized" } })
        : route.continue(),
    );
    await page.goto("/library");
    const alert = page.getByRole("status").filter({ hasText: "Your session ended" });
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await expect(alert.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("refuses a file that isn't MP4 or MOV before uploading (AC-2)", async ({
    page,
    baseURL,
  }) => {
    await signedIn(page, baseURL!);
    let created = false;
    await page.route("**/api/uploads", (route) => {
      created = true;
      return route.abort();
    });
    await page.goto("/library");
    await page
      .locator("#upload-video-input")
      .setInputFiles({ name: "take.avi", mimeType: "video/x-msvideo", buffer: Buffer.from("x") });
    await expect(page.locator("[data-slot=alert]")).toContainText(
      "This file isn't an MP4 or MOV video. Choose an MP4 or MOV.",
    );
    expect(created).toBe(false);
  });
});
