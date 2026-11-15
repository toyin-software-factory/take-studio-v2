import { devices, test, type Page } from "@playwright/test";
import { signIn } from "./support/session";
import { seedTakes } from "./support/takes";
import { R2, cleanups, clip, expect, expectNoSeriousAxeIssues, signedIn } from "./fixtures/takes";

test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups.length = 0;
});

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

  test("Full screen works where only webkitEnterFullscreen exists, as on iPhone Safari", async ({
    page,
    baseURL,
  }) => {
    const user = await signedIn(page, baseURL!);
    const [id] = await seedTakes(user.id, [
      {
        title: "Phone take",
        status: "ready",
        durationMs: 20_000,
        steps: [
          { name: "trim", status: "succeeded" },
          { name: "render", status: "succeeded" },
        ],
      },
    ]);
    await mockPlayback(page);
    // iPhone Safari has no requestFullscreen on a video, only webkitEnterFullscreen.
    await page.addInitScript(() => {
      Object.assign(window, { fullscreenCalls: 0 });
      Reflect.deleteProperty(Element.prototype, "requestFullscreen");
      Reflect.deleteProperty(Element.prototype, "webkitRequestFullscreen");
      Object.defineProperty(HTMLVideoElement.prototype, "webkitEnterFullscreen", {
        configurable: true,
        value() {
          Object.assign(window, { fullscreenCalls: Reflect.get(window, "fullscreenCalls") + 1 });
        },
      });
    });
    await page.goto(`/takes/${id}`);
    const player = page.getByRole("group", { name: "Video player" });
    await expect(player.locator("video")).toHaveAttribute("playsinline", "");
    await player.getByRole("button", { name: "Full screen" }).click();
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "fullscreenCalls"))).toBe(1);
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
      "/library",
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
    for (const path of ["/library", `/takes/${id}`]) {
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
