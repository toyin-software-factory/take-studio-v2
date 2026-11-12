import { readFileSync } from "node:fs";
import { devices, expect as baseExpect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { signIn } from "./support/session";
import { replaceLatestRender, seedTakes, seedTranscript } from "./support/takes";

// Take page transcript panel and player captions (spec 0007, AC-2, AC-3, AC-5, AC-12). State
// tests answer GET /api/takes/{id}/transcript with fixtures, so each state is exact; the ready
// tests use a real transcript row, the real routes and a real caption track. Test users only.
const expect = baseExpect.configure({ timeout: 15_000 });

/** Opens the take page on its Transcript tab (the inspector's default tab is Export). */
async function openTranscript(page: Page, id: string) {
  await page.goto(`/takes/${id}`);
  const tab = page.getByRole("tab", { name: "Transcript" });
  // A click before the page has hydrated does nothing, so click until the tab is selected.
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 1000 });
  }).toPass();
}

const clip = readFileSync("tests/fixtures/clip.mp4");
const R2 = "https://r2.test";

let cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

async function readyTake(page: Page, baseURL: string, extra: Record<string, unknown> = {}) {
  const { user, cleanup } = await signIn(page.context(), baseURL);
  cleanups.push(cleanup);
  await page.route("**/api/takes/*/media?kind=play", (route) =>
    route.fulfill({ json: { url: `${R2}/clip.mp4`, expiresInSeconds: 3600 } }),
  );
  // Like R2, answer byte range requests; without them the browser treats the video as not
  // seekable and a seek would do nothing.
  await page.route(`${R2}/clip.mp4`, (route) => {
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? "");
    const headers = { "access-control-allow-origin": "*", "accept-ranges": "bytes" };
    if (!range) return route.fulfill({ body: clip, contentType: "video/mp4", headers });
    const start = Number(range[1]);
    const end = Math.min(range[2] ? Number(range[2]) : clip.length - 1, clip.length - 1);
    return route.fulfill({
      status: 206,
      body: clip.subarray(start, end + 1),
      contentType: "video/mp4",
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${clip.length}` },
    });
  });
  const [id] = await seedTakes(user.id, [
    {
      title: "Interview",
      status: "ready",
      durationMs: 5000,
      steps: [
        { name: "trim", status: "succeeded" },
        { name: "render", status: "succeeded" },
      ],
      removedRanges: [{ startMs: 3000, endMs: 5000 }],
      ...extra,
    },
  ]);
  return id as string;
}

type View = Record<string, unknown>;
const para = (startMs: number, text: string, filler = false) => ({
  startMs,
  words: text.split(" ").map((w, i) => ({
    w,
    startMs: startMs + i * 300,
    endMs: startMs + i * 300 + 250,
    filler: filler && i === 0,
  })),
});
const READY: View = {
  state: "ready",
  canMake: false,
  version: "v1",
  paragraphs: [para(0, "Um hello there"), para(1500, "second paragraph here")],
};

/** Answers the transcript read with each view in turn (the last one repeats). */
async function serve(page: Page, views: readonly (View | number)[]) {
  let calls = 0;
  await page.route(/\/api\/takes\/[^/]+\/transcript$/, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const next = views[Math.min(calls, views.length - 1)];
    calls += 1;
    return typeof next === "number"
      ? route.fulfill({ status: next, json: { error: "x", message: "x" } })
      : route.fulfill({ json: next });
  });
}

const sizes = [
  ["desktop", { width: 1280, height: 900 }],
  ["phone", { width: devices["iPhone 13"].viewport.width, height: 800 }],
] as const;

test.describe("states", () => {
  const states: readonly [string, View, string | RegExp][] = [
    ["making", { state: "making", canMake: false }, "Making your transcript"],
    ["none and can make", { state: "none", canMake: true }, "Make transcript"],
    ["none and cannot make", { state: "none", canMake: false }, "No transcript for this take"],
    ["failed", { state: "failed", canMake: true }, /The transcript didn.t finish/],
    [
      "not English",
      { state: "skipped", reason: "not_english", canMake: false },
      "English only for now",
    ],
    [
      "no speech",
      { state: "skipped", reason: "no_speech", canMake: false },
      "No speech found in this take",
    ],
    [
      "video expired",
      { state: "skipped", reason: "original_gone", canMake: false },
      "video has expired",
    ],
    [
      "ready, no words",
      { state: "ready", canMake: false, version: "v1", paragraphs: [] },
      "No words in the trimmed video",
    ],
    ["ready", READY, "second paragraph here"],
  ];
  for (const [name, view, text] of states) {
    for (const [size, viewport] of sizes) {
      test(`${name} at ${size}: shown, no sideways scroll, axe clean`, async ({
        page,
        baseURL,
      }) => {
        await page.setViewportSize(viewport);
        const id = await readyTake(page, baseURL!);
        await serve(page, [view]);
        await openTranscript(page, id);
        const panel = page.getByRole("region", { name: "Transcript" });
        await expect(panel).toContainText(text);
        if (name === "failed")
          await expect(panel.getByRole("button", { name: "Try again" })).toBeVisible();
        if (name === "none and can make")
          await expect(panel.getByRole("button", { name: "Make transcript" })).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        await expectNoSeriousAxeIssues(page);
      });
    }
  }

  test("making turns into the transcript without a reload", async ({ page, baseURL }) => {
    const id = await readyTake(page, baseURL!);
    await serve(page, [{ state: "making", canMake: false }, READY]);
    await openTranscript(page, id);
    await expect(page.getByText("Making your transcript")).toBeVisible();
    await expect(page.getByText("second paragraph here")).toBeVisible();
    await expect(page.getByText("Making your transcript")).toBeHidden();
  });

  test("Make transcript starts the job and shows it being made", async ({ page, baseURL }) => {
    const id = await readyTake(page, baseURL!);
    let started = false;
    await page.route(/\/api\/takes\/[^/]+\/transcript$/, (route) => {
      if (route.request().method() === "POST") {
        started = true;
        return route.fulfill({ status: 202, json: { state: "making" } });
      }
      // Like the server: once the job exists, the read says it is being made.
      return route.fulfill({ json: { state: started ? "making" : "none", canMake: !started } });
    });
    await openTranscript(page, id);
    await page.getByRole("button", { name: "Make transcript" }).click();
    await expect(page.getByText("Making your transcript")).toBeVisible();
  });
});

test.describe("kept behaviour of the panel", () => {
  test("a load error shows beside a transcript that already loaded", async ({ page, baseURL }) => {
    const id = await readyTake(page, baseURL!);
    await serve(page, [{ state: "making", canMake: false }, 500]);
    await openTranscript(page, id);
    await expect(page.getByText(/We couldn.t load the transcript/)).toBeVisible();
    await expect(page.getByText("Making your transcript")).toBeVisible();
  });

  test("a 404 while making ends the checking: no stale 'making', no promise of retries", async ({
    page,
    baseURL,
  }) => {
    const id = await readyTake(page, baseURL!);
    await serve(page, [{ state: "making", canMake: false }, 404]);
    await openTranscript(page, id);
    await expect(page.getByText("Making your transcript")).toBeVisible();
    await expect(page.getByText(/can.t check on the transcript any more/)).toBeVisible();
    await expect(page.getByText("Making your transcript")).toHaveCount(0);
    await expect(page.getByText("keep trying")).toHaveCount(0);
  });

  test("no 'we'll keep trying' after a 404", async ({ page, baseURL }) => {
    const id = await readyTake(page, baseURL!);
    await serve(page, [404]);
    await openTranscript(page, id);
    await expect(page.getByRole("heading", { name: "Interview" })).toBeVisible();
    await expect(page.getByText("keep trying")).toHaveCount(0);
  });

  test("an actionable start refusal stays until the creator acts; the 'still being made' note goes once final", async ({
    page,
    baseURL,
  }) => {
    const id = await readyTake(page, baseURL!);
    const refusals = [
      {
        status: 409,
        json: {
          error: "original_gone",
          message: "This take's video has expired, so a transcript can't be made.",
        },
      },
    ];
    let posts = 0;
    await page.route(/\/api\/takes\/[^/]+\/transcript$/, (route) => {
      if (route.request().method() === "POST") {
        posts += 1;
        return route.fulfill(refusals[0]!);
      }
      return route.fulfill({ json: { state: "none", canMake: true } });
    });
    await openTranscript(page, id);
    await page.getByRole("button", { name: "Make transcript" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "can't be made" })).toBeVisible();
    // The poll keeps reading `none`; the refusal is not cleared by it.
    await page.waitForTimeout(100);
    await expect(page.getByRole("alert").filter({ hasText: "can't be made" })).toBeVisible();
    expect(posts).toBe(1);
  });
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

test.describe("touch targets on a phone", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } });

  test("the paragraph timestamp button is at least 44 px", async ({ page, baseURL }) => {
    const id = await readyTake(page, baseURL!);
    await serve(page, [READY]);
    await openTranscript(page, id);
    const box = await page.getByRole("button", { name: "Play from 0:01" }).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  });
});
