import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { devices, expect as baseExpect, test, type Page } from "@playwright/test";
import { signIn } from "./support/session";
import { seedTakes } from "./support/takes";

// Slow first requests (cold Worker, small CI and sandbox machines) need more than 5 s.
const expect = baseExpect.configure({ timeout: 15_000 });

// Library and take pages (spec 0004, AC-1, AC-2, AC-3 browser side, AC-8, AC-9, AC-11, AC-13).
// Takes are seeded in Postgres; R2 and the media links are mocked, since the Worker under test
// has placeholder storage credentials.

const clip = readFileSync("tests/fixtures/clip.mp4");
const R2 = "https://r2.test";

let cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

async function signedIn(page: Page, baseURL: string, name?: string) {
  const { user, cleanup } = await signIn(page.context(), baseURL, name);
  cleanups.push(cleanup);
  return user;
}

async function expectNoSeriousAxeIssues(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

/** Serves the fixture clip as the play link (and R2 answers any CORS preflight). */
async function mockPlayback(page: Page) {
  await page.route("**/api/takes/*/media?kind=play", (route) =>
    route.fulfill({ json: { url: `${R2}/clip.mp4`, expiresInSeconds: 3600 } }),
  );
  await page.route(`${R2}/clip.mp4`, (route) =>
    route.fulfill({
      body: clip,
      contentType: "video/mp4",
      headers: { "access-control-allow-origin": "*" },
    }),
  );
}

test.describe("library", () => {
  test("empty state, upload area and limits, axe", async ({ page, baseURL }) => {
    await signedIn(page, baseURL!);
    await page.goto("/");
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
    await page.goto("/");

    const titles = page.getByRole("region", { name: "Takes" }).getByRole("heading", { level: 3 });
    await expect(titles).toHaveText([
      "Newest processing",
      "Too long take",
      "Render crashed",
      "Oldest ready take",
    ]);
    const ready = page.getByRole("listitem").filter({ hasText: "Oldest ready take" });
    await expect(ready.getByText("Ready", { exact: true })).toBeVisible();
    await expect(ready.getByText("1:20")).toHaveClass(/mono/);
    await expect(ready.getByText("Video expires in 11 days")).toBeVisible();
    const crashed = page.getByRole("listitem").filter({ hasText: "Render crashed" });
    await expect(crashed.getByRole("button", { name: "Try again" })).toBeVisible();
    const tooLong = page.getByRole("listitem").filter({ hasText: "Too long take" });
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
    await page.goto("/");
    const card = page.getByRole("listitem").filter({ hasText: "With thumbnail" });
    await expect(card.locator("img")).toBeVisible();
    // No link is requested for the take that is still uploading.
    expect(asked).toHaveLength(1);
    await expect(
      page.getByRole("listitem").filter({ hasText: "Still uploading" }).locator("img"),
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
    await page.goto("/");
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
    await page.goto("/");
    await page
      .locator("#upload-video-input")
      .setInputFiles({ name: "take.webm", mimeType: "video/webm", buffer: Buffer.from("x") });
    await expect(page.locator("[data-slot=alert]")).toContainText(
      "This file isn't an MP4 or MOV video. Choose an MP4 or MOV.",
    );
    expect(created).toBe(false);
  });

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

    await page.goto("/");
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

    await page.goto("/");
    await page.locator("#upload-video-input").setInputFiles("tests/fixtures/clip.mp4");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Upload cancelled")).toBeVisible();
    expect(abandoned).toBe(true);
  });
});

test.describe("take page", () => {
  test("processing: steps on the stage, weighted overall bar, tab title (AC-8)", async ({
    page,
    baseURL,
  }) => {
    const user = await signedIn(page, baseURL!);
    const [id] = await seedTakes(user.id, [
      {
        title: "Interview",
        status: "processing",
        durationMs: 90_000,
        steps: [
          { name: "trim", status: "succeeded" },
          { name: "render", status: "running", progress: 50 },
        ],
      },
    ]);
    await page.goto(`/takes/${id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Interview" })).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Overall progress" })).toHaveAttribute(
      "aria-valuenow",
      "55",
    );
    await expect(page.getByText("Find pauses", { exact: true })).toBeVisible();
    await expect(page.getByText("Make the video", { exact: true })).toBeVisible();
    await expect(page).toHaveTitle("Processing… · Interview · Take Studio");
    await expectNoSeriousAxeIssues(page);
  });

  test("ready: player, removed note, downloads, rename, tab title (AC-9)", async ({
    page,
    baseURL,
  }) => {
    const user = await signedIn(page, baseURL!);
    const [id] = await seedTakes(user.id, [
      {
        title: "Podcast intro",
        status: "ready",
        durationMs: 120_000,
        steps: [
          { name: "trim", status: "succeeded" },
          { name: "render", status: "succeeded" },
        ],
        removedRanges: [
          { startMs: 1000, endMs: 30_000 },
          { startMs: 40_000, endMs: 95_000 },
        ],
      },
    ]);
    await mockPlayback(page);
    await page.goto(`/takes/${id}`);
    await expect(page).toHaveTitle("Ready · Podcast intro · Take Studio");
    await expect(page.getByText("Removed 1:24 of pauses")).toBeVisible();
    await expect(page.getByRole("button", { name: "Download", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download original" })).toBeVisible();
    const player = page.getByRole("group", { name: "Video player" });
    await expect(player.getByRole("button", { name: "Play" })).toBeVisible();
    await expect(player.getByText("0:03")).toBeVisible();
    await expectNoSeriousAxeIssues(page);

    await page.getByRole("button", { name: "Rename" }).click();
    const field = page.getByLabel("Title");
    await field.fill("Podcast intro, final");
    await field.press("Enter");
    await expect(
      page.getByRole("heading", { level: 1, name: "Podcast intro, final" }),
    ).toBeVisible();
    await expect(page).toHaveTitle("Ready · Podcast intro, final · Take Studio");
  });

  test("ready with no cuts shows the AC-7 note", async ({ page, baseURL }) => {
    const user = await signedIn(page, baseURL!);
    const [id] = await seedTakes(user.id, [
      {
        title: "Tight take",
        status: "ready",
        durationMs: 30_000,
        steps: [
          { name: "trim", status: "succeeded" },
          { name: "render", status: "skipped" },
        ],
      },
    ]);
    await mockPlayback(page);
    await page.goto(`/takes/${id}`);
    await expect(page.getByText("No long pauses found. Your video is ready as is.")).toBeVisible();
  });

  test("failed: friendly message with Try again or Upload another video (AC-10)", async ({
    page,
    baseURL,
  }) => {
    const user = await signedIn(page, baseURL!);
    const [retryable, media] = await seedTakes(user.id, [
      {
        title: "Crashed",
        status: "failed",
        failureCode: "ffmpeg_error",
        durationMs: 60_000,
        steps: [
          { name: "trim", status: "succeeded" },
          { name: "render", status: "failed" },
        ],
      },
      { title: "Huge", status: "failed", failureCode: "resolution_exceeded", durationMs: 60_000 },
    ]);
    await page.goto(`/takes/${retryable}`);
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page).toHaveTitle("Failed · Crashed · Take Studio");
    await page.goto(`/takes/${media}`);
    await expect(page.getByText("This video is bigger than 1080p, the limit.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Upload another video" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  test("another creator's take and a malformed ID get the same styled 404 (AC-11)", async ({
    browser,
    page,
    baseURL,
  }) => {
    await signedIn(page, baseURL!, "Creator A");
    const other = await browser.newContext();
    const { user: b, cleanup } = await signIn(other, baseURL!, "Creator B");
    cleanups.push(async () => {
      await cleanup();
      await other.close();
    });
    const [theirs] = await seedTakes(b.id, [
      { title: "B's secret take", status: "ready", durationMs: 1000 },
    ]);

    for (const path of [`/takes/${theirs}`, "/takes/not-a-take"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { name: "We couldn’t find that page" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Go to your takes" })).toBeVisible();
    }
    await expect(page.getByText("B's secret take")).toHaveCount(0);
    await expectNoSeriousAxeIssues(page);
  });
});

test.describe("phone width", () => {
  test.use({ viewport: devices["iPhone 13"].viewport });

  test("library and take page fit with no sideways scroll (AC-13)", async ({ page, baseURL }) => {
    const user = await signedIn(page, baseURL!);
    const [id] = await seedTakes(user.id, [
      {
        title: "A rather long title for a take recorded on a phone",
        status: "ready",
        durationMs: 75_000,
        steps: [
          { name: "trim", status: "succeeded" },
          { name: "render", status: "succeeded" },
        ],
        removedRanges: [{ startMs: 0, endMs: 9000 }],
      },
    ]);
    await mockPlayback(page);
    for (const path of ["/", `/takes/${id}`]) {
      await page.goto(path);
      await expect(page.getByRole("main")).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await expectNoSeriousAxeIssues(page);
    }
  });
});
