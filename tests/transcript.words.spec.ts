import { test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { signIn } from "./support/session";
import { replaceLatestRender, seedTakes, seedTranscript } from "./support/takes";
import {
  R2,
  READY,
  View,
  cleanups,
  expect,
  openTranscript,
  readyTake,
  serve,
} from "./fixtures/transcript";

test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups.length = 0;
});

test("'still being made' goes once the job this page saw making has finished", async ({
  page,
  baseURL,
}) => {
  const id = await readyTake(page, baseURL!);
  const reads: View[] = [
    { state: "none", canMake: true },
    { state: "making", canMake: false },
    READY,
  ];
  let reading = 0;
  await page.route(/\/api\/takes\/[^/]+\/transcript$/, (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 409,
        json: {
          error: "job_active",
          message: "Your transcript is still being made. Try again in a moment.",
        },
      });
    }
    const next = reads[Math.min(reading, reads.length - 1)];
    reading += 1;
    return route.fulfill({ json: next });
  });
  await openTranscript(page, id);
  await page.getByRole("button", { name: "Make transcript" }).click();
  await expect(page.getByText("still being made")).toBeVisible();
  await expect(page.getByText("second paragraph here")).toBeVisible();
  await expect(page.getByText("still being made")).toHaveCount(0);
});

test("the video has the take's thumbnail as its poster, so a phone paints something before play", async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const id = await readyTake(page, baseURL!);
  const jpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=",
    "base64",
  );
  await page.route("**/api/takes/*/media?kind=thumb", (route) =>
    route.fulfill({ json: { url: `${R2}/thumb.jpg`, expiresInSeconds: 3600 } }),
  );
  await page.route(`${R2}/thumb.jpg`, (route) =>
    route.fulfill({ body: jpeg, contentType: "image/jpeg" }),
  );
  await serve(page, [READY]);
  await openTranscript(page, id);
  await expect(page.locator("video")).toHaveAttribute("poster", `${R2}/thumb.jpg`);
});

test("no thumbnail, no poster", async ({ page, baseURL }) => {
  const id = await readyTake(page, baseURL!);
  await page.route("**/api/takes/*/media?kind=thumb", (route) =>
    route.fulfill({ status: 404, json: { error: "not_found", message: "x" } }),
  );
  await serve(page, [READY]);
  await openTranscript(page, id);
  await expect(page.locator("video")).toBeVisible();
  expect(await page.locator("video").getAttribute("poster")).toBeNull();
});

test.describe("ready: words, seek and captions", () => {
  async function ready(page: Page, baseURL: string) {
    const id = await readyTake(page, baseURL);
    await seedTranscript(id, [
      { w: "Um,", startMs: 100, endMs: 300, filler: true, para: true },
      { w: "Hello", startMs: 300, endMs: 700 },
      { w: "there.", startMs: 700, endMs: 1200 },
      { w: "Second", startMs: 1500, endMs: 1900, para: true },
      { w: "part.", startMs: 1900, endMs: 2500 },
    ]);
    await openTranscript(page, id);
    await expect(page.getByRole("region", { name: "Transcript" })).toContainText("Second part.");
    return id;
  }
  const currentTime = (page: Page) =>
    page.evaluate(() => document.querySelector("video")?.currentTime ?? -1);

  test("shows timestamped paragraphs, dotted fillers and both downloads (AC-2, AC-3, AC-4)", async ({
    page,
    baseURL,
  }) => {
    const id = await ready(page, baseURL!);
    const panel = page.getByRole("region", { name: "Transcript" });
    await expect(panel.getByRole("button", { name: "Play from 0:00" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Play from 0:01" })).toBeVisible();
    const filler = panel.getByText("Um,", { exact: true });
    await expect(filler).toHaveCSS("text-decoration-style", "dotted");
    await expect(panel.getByText("Hello", { exact: true })).not.toHaveCSS(
      "text-decoration-style",
      "dotted",
    );
    const text = panel.getByRole("link", { name: "Download text" });
    const srt = panel.getByRole("link", { name: "Download captions (SRT)" });
    await expect(text).toHaveAttribute("href", new RegExp(`/api/takes/${id}/transcript/txt\\?v=`));
    const file = await page.request.get((await srt.getAttribute("href"))!);
    expect(file.status()).toBe(200);
    expect(file.headers()["content-disposition"]).toContain('filename="Interview.srt"');
    expect(await file.text()).toContain("Hello there.");
    await expectNoSeriousAxeIssues(page);
  });

  test("a timestamp and a word seek the player, and the playing paragraph is marked (AC-2)", async ({
    page,
    baseURL,
  }) => {
    await ready(page, baseURL!);
    const panel = page.getByRole("region", { name: "Transcript" });
    await panel.getByRole("button", { name: "Play from 0:01" }).click();
    await expect.poll(() => currentTime(page)).toBeGreaterThan(1.4);
    await expect(panel.locator("li[aria-current]")).toContainText("Second part.");
    await panel.getByText("Hello", { exact: true }).click();
    await expect.poll(() => currentTime(page)).toBeLessThan(1);
    await expect(panel.locator("li[aria-current]")).toContainText("Hello there.");
  });

  test("the CC button is off by default and works by keyboard (AC-5)", async ({
    page,
    baseURL,
  }) => {
    await ready(page, baseURL!);
    const cc = page.getByRole("button", { name: "Captions" });
    await expect(cc).toHaveAttribute("aria-pressed", "false");
    const mode = () => page.evaluate(() => document.querySelector("video")?.textTracks[0]?.mode);
    expect(await mode()).toBe("hidden");
    // The real track from the VTT route has its cues.
    await expect
      .poll(() =>
        page.evaluate(() => document.querySelector("video")?.textTracks[0]?.cues?.length ?? 0),
      )
      .toBeGreaterThan(0);
    await cc.focus();
    await page.keyboard.press("Enter");
    await expect(cc).toHaveAttribute("aria-pressed", "true");
    await expect.poll(mode).toBe("showing");
    await page.keyboard.press("Space");
    await expect(cc).toHaveAttribute("aria-pressed", "false");
    await expect.poll(mode).toBe("hidden");
  });

  test("the caption track URL changes after a new render (AC-5)", async ({ page, baseURL }) => {
    const id = await ready(page, baseURL!);
    const src = () => page.locator("video track").getAttribute("src");
    const first = await src();
    expect(first).toMatch(new RegExp(`/api/takes/${id}/transcript/vtt\\?v=`));
    await replaceLatestRender(id);
    await page.reload();
    await expect(page.locator("video track")).toHaveCount(1);
    expect(await src()).not.toBe(first);
  });

  test("an expired take keeps its transcript and downloads (AC-10)", async ({ page, baseURL }) => {
    const { user, cleanup } = await signIn(page.context(), baseURL!);
    cleanups.push(cleanup);
    const [id] = await seedTakes(user.id, [
      { title: "Old take", status: "expired", durationMs: 5000, expiresInDays: -2 },
    ]);
    await seedTranscript(id!, [
      { w: "Still", startMs: 0, endMs: 400, para: true },
      { w: "here.", startMs: 400, endMs: 900 },
    ]);
    await openTranscript(page, id);
    const panel = page.getByRole("region", { name: "Transcript" });
    await expect(panel).toContainText("Still here.");
    await expect(panel.getByRole("link", { name: "Download text" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Make transcript" })).toHaveCount(0);
    await expectNoSeriousAxeIssues(page);
  });
});
