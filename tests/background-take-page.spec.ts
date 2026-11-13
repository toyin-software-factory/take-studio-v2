import { readFileSync } from "node:fs";
import { devices, expect as baseExpect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { signIn } from "./support/session";
import { seedTakes } from "./support/takes";

// The background picker on the take page (spec 0008, AC-3 to AC-6, AC-11, AC-12). The list, the
// previews, the change and the take's own detail are stubbed so each state and message is exact;
// the real routes have their own tests.
const expect = baseExpect.configure({ timeout: 30_000 });
test.describe.configure({ timeout: 90_000 });

const clip = readFileSync("tests/fixtures/clip.mp4");
const R2 = "https://r2.test";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const CALM = "00000000-0000-4000-8000-000000000001";
const WARM = "00000000-0000-4000-8000-000000000002";
const MINE = "00000000-0000-4000-8000-000000000004";

type Item = {
  id: string;
  name: string;
  alt: string;
  status: string;
  failureCode: string | null;
  thumbUrl: string | null;
};
const item = (id: string, name: string, extra: Partial<Item> = {}): Item => ({
  id,
  name,
  alt: `${name} backdrop`,
  status: "ready",
  failureCode: null,
  thumbUrl: `${R2}/thumb.png`,
  ...extra,
});
const LIST = {
  builtIn: [item(CALM, "Calm studio"), item(WARM, "Warm studio")],
  mine: [item(MINE, "Office wall")],
  defaultId: null,
};

type Stub = {
  list: unknown | number;
  /** Holds the next list request until released (to test a late answer). */
  gate?: Promise<void>;
  detail: Record<string, unknown>;
  detailStatus?: number;
  preview: { post: { status: number; json: unknown }; get?: { status: number; json: unknown }[] };
  put: { status: number; json?: unknown } | "abort";
  /** Runs when the change request reaches the stub (another tab's change starting meanwhile). */
  afterPut?: () => void;
  calls: string[];
};

let cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

async function setup(page: Page, baseURL: string, stub: Partial<Stub> = {}) {
  const { user, cleanup } = await signIn(page.context(), baseURL);
  cleanups.push(cleanup);
  const state: Stub = {
    list: LIST,
    detail: {},
    preview: { post: { status: 202, json: { state: "making", noGreenScreen: false } } },
    put: { status: 202, json: { jobId: "j1" } },
    calls: [],
    ...stub,
  };
  await page.route("**/api/takes/*/media?kind=play", (r) =>
    r.fulfill({ json: { url: `${R2}/clip.mp4`, expiresInSeconds: 3600 } }),
  );
  await page.route("**/api/takes/*/media?kind=thumb", (r) =>
    r.fulfill({ json: { url: `${R2}/original.png`, expiresInSeconds: 3600 } }),
  );
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
  await page.route(`${R2}/*.png`, (r) =>
    r.fulfill({
      body: PNG,
      contentType: "image/png",
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await page.route("**/api/backgrounds", async (r) => {
    // An answer built before the gate, delivered after it: the list as it was.
    const answer =
      typeof state.list === "number" ? { status: state.list, json: {} } : { json: state.list };
    const gate = state.gate;
    state.gate = undefined;
    if (gate) await gate;
    return r.fulfill(answer);
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
    },
  ]);
  // The take's own read, with the background fields the test wants.
  await page.route(new RegExp(`/api/takes/${id}$`), async (route) => {
    if (state.detailStatus) return route.fulfill({ status: state.detailStatus, json: {} });
    try {
      const real = await route.fetch();
      const body = (await real.json()) as Record<string, unknown>;
      return await route.fulfill({ status: real.status(), json: { ...body, ...state.detail } });
    } catch {
      // The test ended while a poll was in flight.
      return route.abort().catch(() => undefined);
    }
  });
  await page.route(new RegExp(`/api/takes/${id}/background/preview`), (route) => {
    const method = route.request().method();
    state.calls.push(`PREVIEW ${method}`);
    if (method === "POST")
      return route.fulfill({ status: state.preview.post.status, json: state.preview.post.json });
    const next = state.preview.get?.shift();
    return route.fulfill({
      status: next?.status ?? 200,
      json: next?.json ?? { state: "making", noGreenScreen: false },
    });
  });
  await page.route(new RegExp(`/api/takes/${id}/jobs/`), (route) =>
    route.fulfill({ json: { status: "running" } }),
  );
  await page.route(new RegExp(`/api/takes/${id}/changes$`), (route) => {
    state.calls.push(`POST ${route.request().postData()}`);
    if (state.put === "abort") return route.abort();
    state.afterPut?.();
    return route.fulfill({ status: state.put.status, json: state.put.json ?? {} });
  });
  return { id: id as string, state };
}

const bar = (page: Page) => page.getByRole("region", { name: "Unsaved changes" });
const render = (page: Page) => bar(page).getByRole("button", { name: "Render" });
const section = (page: Page) => page.getByRole("region", { name: "Background", exact: true });
const open = async (page: Page, id: string) => {
  await page.goto(`/takes/${id}`);
  const tab = page.getByRole("tab", { name: "Background" });
  // A click before the page has hydrated does nothing, so click until the tab is selected.
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 1000 });
  }).toPass();
  await expect(section(page).getByRole("radio", { name: /Keep original/ })).toBeVisible();
};

test("shows the grid, the current background and the clean edges tip (AC-4, AC-11)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!);
  await open(page, id);
  await expect(section(page)).toContainText("Now: your original background");
  await expect(section(page).getByRole("heading", { name: "Studios" })).toBeVisible();
  await expect(section(page).getByRole("radio", { name: /Calm studio/ })).toBeVisible();
  await expect(section(page).getByRole("heading", { name: "Your backgrounds" })).toBeVisible();
  await expect(section(page).getByText("Upload image")).toBeVisible();
  await expect(section(page).getByText(/Getting clean edges/)).toBeVisible();
  // Nothing is picked yet, so the pending bar has nothing to say.
  await expect(bar(page)).toHaveCount(0);
});

const SUGGESTION = { backgroundId: WARM, name: "Warm studio", reason: "Suits a calm interview." };

test("the suggested background card: Use it puts the change in the pending bar, nothing renders by itself (spec 0012 AC-5)", async ({
  page,
  baseURL,
}) => {
  const { id, state } = await setup(page, baseURL!, { detail: { suggestion: SUGGESTION } });
  await open(page, id);
  const card = section(page).getByTestId("suggested-background");
  await expect(card.getByRole("heading", { name: "Suggested: Warm studio" })).toBeVisible();
  await expect(card).toContainText("Suits a calm interview.");
  await expect(bar(page)).toHaveCount(0);
  await expectNoSeriousAxeIssues(page);
  await card.getByRole("button", { name: "Use it" }).click();
  await expect(bar(page)).toContainText("Background: Warm studio");
  await expect(section(page).getByRole("radio", { name: /Warm studio/ })).toBeChecked();
  await expect(card.getByRole("button", { name: "Use it" })).toHaveCount(0);
  await expect(card).toContainText("Press Render");
  expect(state.calls.some((c) => c.startsWith("POST"))).toBe(false);
  await render(page).click();
  await expect.poll(() => state.calls.some((c) => c.startsWith("POST"))).toBe(true);
  expect(state.calls.find((c) => c.startsWith("POST"))).toContain(`"background":{"id":"${WARM}"}`);
});

const HIDDEN: readonly (readonly [string, Record<string, unknown>])[] = [
  ["there is no suggestion", { suggestion: null }],
  [
    "it is the current background",
    { suggestion: SUGGESTION, background: { id: WARM, name: "Warm studio", keyed: true } },
  ],
  ["the take has no green screen", { suggestion: SUGGESTION, noGreenScreen: true }],
];

for (const [name, detail] of HIDDEN) {
  test(`the suggested card is hidden when ${name}`, async ({ page, baseURL }) => {
    const { id } = await setup(page, baseURL!, { detail });
    await open(page, id);
    await expect(section(page).getByRole("radio", { name: /Keep original/ })).toBeVisible();
    await expect(section(page).getByTestId("suggested-background")).toHaveCount(0);
  });
}

test("picks by keyboard, previews on the stage while the video stays, then Render in the pending bar uses the background (AC-4, AC-5, AC-12)", async ({
  page,
  baseURL,
}) => {
  const { id, state } = await setup(page, baseURL!, {
    preview: {
      post: { status: 202, json: { state: "making", noGreenScreen: false } },
      get: [
        { status: 200, json: { state: "ready", url: `${R2}/preview.png`, noGreenScreen: false } },
      ],
    },
  });
  await open(page, id);
  await page.locator("video").evaluate((v) => v.setAttribute("data-mark", "same"));
  await section(page).getByRole("radio", { name: "Keep original" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(section(page).getByRole("radio", { name: /Calm studio/ })).toBeChecked();
  await expect(page.getByText("Making a preview with Calm studio")).toBeVisible();
  await expect(page.getByAltText("Preview of your take on Calm studio")).toBeVisible();
  await expect(page.getByText("Preview, not your video yet")).toBeVisible();
  await expectNoSeriousAxeIssues(page);
  // The video is the same element and still there under the preview.
  await expect(page.locator("video[data-mark=same]")).toHaveCount(1);
  // The pick is a pending change, not a render (AC-5): nothing was sent yet.
  await expect(bar(page)).toContainText("Background: Calm studio");
  expect(state.calls.some((c) => c.startsWith("POST"))).toBe(false);
  await render(page).click();
  await expect.poll(() => state.calls.some((c) => c.startsWith("POST"))).toBe(true);
  expect(state.calls.find((c) => c.startsWith("POST"))).toContain(`"background":{"id":"${CALM}"}`);
  // Making the new video: progress shows, the choice cannot start another, the old video plays on.
  await expect(page.getByRole("status").filter({ hasText: "Rendering" })).toBeVisible();
  await expect(render(page)).toBeDisabled();
  await expect(page.locator("video[data-mark=same]")).toHaveCount(1);
  await expect(page.getByText("Preview, not your video yet")).toHaveCount(0);
});

test("choosing Keep original on a take with a background shows the original frame", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, {
    detail: { background: { id: CALM, name: "Calm studio", keyed: true } },
  });
  await open(page, id);
  await expect(section(page)).toContainText("Now: Calm studio");
  await section(page).getByRole("radio", { name: "Keep original" }).check({ force: true });
  await expect(page.getByAltText("Preview of your take on your original background")).toBeVisible();
  await expect(bar(page)).toContainText("Background: Original");
});

test("says so when the video was kept on its own background (AC-3) and when a preview finds no green screen (AC-4)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, {
    detail: { noGreenScreen: true },
    preview: {
      post: {
        status: 200,
        json: { state: "ready", url: `${R2}/preview.png`, noGreenScreen: true },
      },
    },
  });
  await open(page, id);
  await expect(section(page)).toContainText(
    "We couldn't find a green screen in this take, so we kept the original background.",
  );
  await section(page)
    .getByRole("radio", { name: /Warm studio/ })
    .check({ force: true });
  await expect(section(page)).toContainText("this background wouldn't show");
  // The server refuses a real background on a take with no green screen (409 no_green_screen) and
  // the page shows that message; the note above says why. Going back to the original is no change.
  await section(page).getByRole("radio", { name: "Keep original" }).check({ force: true });
  await expect(bar(page)).toHaveCount(0);
});

test("shows a failed change from before and keeps nothing pending (AC-5)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, {
    detail: {
      backgroundJob: { status: "failed", failureCode: "internal_error", targetBackgroundId: WARM },
    },
  });
  await open(page, id);
  await expect(section(page)).toContainText(
    "The new background didn't finish. Your video is unchanged. Try again.",
  );
  await expect(bar(page)).toHaveCount(0);
});

test("keeps the current and the chosen background visible when the list cannot load", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, {
    list: 500,
    detail: { background: { id: CALM, name: "Calm studio", keyed: true } },
  });
  await open(page, id);
  await expect(section(page)).toContainText(/We couldn.t load your backgrounds/);
  await expect(section(page).getByRole("radio", { name: /Calm studio/ })).toBeChecked();
  await section(page).getByRole("radio", { name: "Keep original" }).check({ force: true });
  await expect(section(page).getByRole("radio", { name: /Calm studio/ })).toBeVisible();
});

test("shows a refusal from the server, and a failed preview with a way to try it again", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, {
    put: {
      status: 409,
      json: {
        error: "background_not_ready",
        message: "That background isn't ready yet. Try again in a moment.",
      },
    },
    preview: {
      post: {
        status: 409,
        json: {
          error: "background_not_ready",
          message: "That background isn't ready yet. Try again in a moment.",
        },
      },
    },
  });
  await open(page, id);
  await section(page)
    .getByRole("radio", { name: /Calm studio/ })
    .check({ force: true });
  await expect(
    section(page)
      .locator('[data-slot="alert"], p[role="alert"]')
      .filter({ hasText: "isn't ready yet" }),
  ).toBeVisible();
  await expect(section(page).getByRole("button", { name: "Try the preview again" })).toBeVisible();
  await render(page).click();
  await expect(page.getByRole("status").filter({ hasText: "isn't ready yet" })).toBeVisible();
});

test("deleting a background removes it from the list and resets the choice", async ({
  page,
  baseURL,
}) => {
  const { id, state } = await setup(page, baseURL!);
  await page.route("**/api/backgrounds/*", (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    state.list = 500; // the refresh after the delete fails
    return route.fulfill({ status: 204 });
  });
  await open(page, id);
  await section(page)
    .getByRole("radio", { name: /Office wall/ })
    .check({ force: true });
  await section(page).getByRole("button", { name: "Delete Office wall" }).click();
  await expect(section(page).getByRole("radio", { name: /Office wall/ })).toHaveCount(0);
  await expect(section(page).getByRole("radio", { name: "Keep original" })).toBeChecked();
});

for (const [name, viewport] of [
  ["desktop", { width: 1280, height: 900 }],
  ["phone", { width: devices["iPhone 13"].viewport.width, height: 800 }],
] as const) {
  test(`axe finds no serious issues in the picker states at ${name}`, async ({ page, baseURL }) => {
    await page.setViewportSize(viewport);
    const { id } = await setup(page, baseURL!, {
      detail: {
        noGreenScreen: true,
      },
      preview: {
        post: {
          status: 200,
          json: { state: "ready", url: `${R2}/preview.png`, noGreenScreen: true },
        },
      },
    });
    await open(page, id);
    await expect(section(page)).toContainText("couldn't find a green screen");
    await expectNoSeriousAxeIssues(page);
    await section(page)
      .getByRole("radio", { name: /Warm studio/ })
      .check({ force: true });
    await expect(page.getByAltText("Preview of your take on Warm studio")).toBeVisible();
    await expectNoSeriousAxeIssues(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test.describe("touch targets on a phone", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } });
  test("Use it is at least 44 px, axe is clean and the page does not scroll sideways", async ({
    page,
    baseURL,
  }) => {
    const { id } = await setup(page, baseURL!, { detail: { suggestion: SUGGESTION } });
    await open(page, id);
    const box = await section(page).getByRole("button", { name: "Use it" }).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await expectNoSeriousAxeIssues(page);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over).toBeLessThanOrEqual(0);
  });
  test("the tiles and the action are at least 44 px", async ({ page, baseURL }) => {
    const { id } = await setup(page, baseURL!);
    await open(page, id);
    for (const name of ["Keep original", /Calm studio/, /Office wall/]) {
      const box = await section(page).getByRole("radio", { name }).locator("..").boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await section(page)
      .getByRole("radio", { name: /Calm studio/ })
      .check({ force: true });
    const action = await render(page).boundingBox();
    expect(action?.height).toBeGreaterThanOrEqual(44);
  });
});

test("a refresh that was fetched before a delete cannot bring the deleted background back", async ({
  page,
  baseURL,
}) => {
  const { id, state } = await setup(page, baseURL!);
  let release: () => void = () => undefined;
  await page.route("**/api/backgrounds/*", (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    // The refresh after the delete is answered from the list as it was, and late.
    state.gate = new Promise<void>((resolve) => (release = resolve));
    return route.fulfill({ status: 204 });
  });
  await open(page, id);
  await section(page).getByRole("button", { name: "Delete Office wall" }).click();
  await expect(section(page).getByRole("radio", { name: /Office wall/ })).toHaveCount(0);
  release();
  await page.waitForTimeout(800);
  await expect(section(page).getByRole("radio", { name: /Office wall/ })).toHaveCount(0);
});

const READY_PREVIEW = {
  post: { status: 200, json: { state: "ready", url: `${R2}/preview.png`, noGreenScreen: false } },
};

// S3S-T14: a still preview must not look like a video that will not play.
test("while a still shows, the transport is hidden and the stage says it is a still; Back restores the video", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, { preview: READY_PREVIEW });
  await open(page, id);
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await page.locator("video").evaluate((v) => v.setAttribute("data-mark", "same"));
  await section(page)
    .getByRole("radio", { name: /Calm studio/ })
    .check({ force: true });
  const still = page.getByAltText("Preview of your take on Calm studio");
  await expect(still).toBeVisible();

  // The label (announced: role=status), the banner, and no playable controls.
  const status = page.getByRole("status").filter({ hasText: "Still preview, not a video" });
  await expect(status).toHaveText(
    "Still preview, not a video. Press \u201cRender\u201d to make it.",
  );
  await expect(page.getByText("Preview, not your video yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Play" })).toBeHidden();
  await expect(page.getByRole("slider", { name: "Seek" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Mute" })).toBeHidden();
  // The video is paused under the still, and a click on the still does not start it.
  expect(await page.locator("video").evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await still.click({ force: true });
  expect(await page.locator("video").evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);

  // Back to your video: the controls and the picture return, on the same video element.
  await page.getByRole("button", { name: "Back to your video" }).click();
  await expect(still).toHaveCount(0);
  await expect(status).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Seek" })).toBeVisible();
  await expect(page.locator("video[data-mark=same]")).toHaveCount(1);
  await expect(section(page).getByRole("radio", { name: /Keep original/ })).toBeChecked();
  await expect(page.getByRole("button", { name: "Back to your video" })).toHaveCount(0);
});

test("the stage line names Render when the original is what is previewed", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, {
    detail: { background: { id: CALM, name: "Calm studio", keyed: true } },
  });
  await open(page, id);
  await section(page).getByRole("radio", { name: "Keep original" }).check({ force: true });
  await expect(
    page.getByRole("status").filter({ hasText: "Still preview, not a video" }),
  ).toContainText("\u201cRender\u201d");
  await expect(page.getByRole("button", { name: "Play" })).toBeHidden();
  // Returning to the current background (Calm studio) ends the preview too.
  await page.getByRole("button", { name: "Back to your video" }).click();
  await expect(section(page).getByRole("radio", { name: /Calm studio/ })).toBeChecked();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
});

test("focus is not left on a control that gets hidden: it moves to Back to your video", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, { preview: READY_PREVIEW });
  await open(page, id);
  await page.getByRole("button", { name: "Play" }).focus();
  await expect(page.getByRole("button", { name: "Play" })).toBeFocused();
  // Choose a studio without moving focus (a click through the DOM).
  await section(page)
    .getByRole("radio", { name: /Calm studio/ })
    .evaluate((el: HTMLInputElement) => el.click());
  await expect(page.getByAltText("Preview of your take on Calm studio")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to your video" })).toBeFocused();
});

test("axe finds no serious issues while a still preview shows", async ({ page, baseURL }) => {
  const { id } = await setup(page, baseURL!, { preview: READY_PREVIEW });
  await open(page, id);
  await section(page)
    .getByRole("radio", { name: /Calm studio/ })
    .check({ force: true });
  await expect(page.getByRole("status").filter({ hasText: "Still preview" })).toBeVisible();
  await expectNoSeriousAxeIssues(page);
});

// S3S-T13: the page after a background change.
test("a render finishing swaps the player source and the page, without a reload, and clears the preview", async ({
  page,
  baseURL,
}) => {
  const { id, state } = await setup(page, baseURL!, {
    detail: { latestRender: { id: "render-1", status: "succeeded", durationMs: 3000 } },
    preview: {
      post: {
        status: 200,
        json: { state: "ready", url: `${R2}/preview.png`, noGreenScreen: false },
      },
    },
  });
  let plays = 0;
  await page.route("**/api/takes/*/media?kind=play", (r) => {
    plays += 1;
    return r.fulfill({
      json: { url: `${R2}/${plays === 1 ? "clip" : "clip2"}.mp4`, expiresInSeconds: 3600 },
    });
  });
  await page.route(`${R2}/clip2.mp4`, (r) =>
    r.fulfill({
      body: clip,
      contentType: "video/mp4",
      headers: { "access-control-allow-origin": "*", "accept-ranges": "bytes" },
    }),
  );
  const downloads: string[] = [];
  await page.route("**/api/takes/*/media?kind=download", (r) => {
    downloads.push(r.request().url());
    return r.fulfill({ status: 500, json: { error: "x", message: "stub" } });
  });
  await open(page, id);
  await expect(page.locator("video")).toHaveAttribute("src", `${R2}/clip.mp4`);
  await page.locator("video").evaluate((v) => v.setAttribute("data-mark", "same"));
  // This tab picked Warm studio and is looking at its preview.
  await section(page)
    .getByRole("radio", { name: /Warm studio/ })
    .check({ force: true });
  await expect(page.getByAltText("Preview of your take on Warm studio")).toBeVisible();

  // Meanwhile the change finished (in this tab or another): the next check finds a new render.
  state.detail = {
    latestRender: { id: "render-2", status: "succeeded", durationMs: 3000 },
    background: { id: WARM, name: "Warm studio", keyed: true },
  };
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator("video")).toHaveAttribute("src", `${R2}/clip2.mp4`);
  // Same element, no reload: the page and the stage both caught up.
  await expect(page.locator("video[data-mark=same]")).toHaveCount(1);
  await expect(section(page)).toContainText("Now: Warm studio");
  await expect(page.getByText("Preview, not your video yet")).toHaveCount(0);
  // Download asks the server when clicked, so it gives the new render.
  await page.getByRole("button", { name: "Download", exact: true }).click();
  await expect.poll(() => downloads.length).toBe(1);
});

test("a change refused because one is already running says so, and the page catches up", async ({
  page,
  baseURL,
}) => {
  const { id, state } = await setup(page, baseURL!, {
    put: { status: 409, json: { error: "job_active" } },
  });
  await open(page, id);
  await section(page)
    .getByRole("radio", { name: /Calm studio/ })
    .check({ force: true });
  // The other tab's change starts as this tab's request arrives. Setting it any earlier races the
  // page's own polling: it could disable the button before the click (CI hit that after the v2
  // restyle changed load timing).
  state.afterPut = () => {
    state.detail = {
      backgroundJob: { status: "running", failureCode: null, targetBackgroundId: WARM },
    };
  };
  await render(page).click();
  // The refusal also read the take again: the running change now locks the bar. The pick stays.
  await expect(page.getByRole("status").filter({ hasText: "Rendering" })).toBeVisible();
  await expect(bar(page)).toContainText("Background: Calm studio");
  await expect(render(page)).toBeDisabled();
});

test("a refusal with no message body still tells the creator (never silent)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, { put: { status: 502, json: undefined } });
  await open(page, id);
  await section(page)
    .getByRole("radio", { name: /Calm studio/ })
    .check({ force: true });
  await render(page).click();
  await expect(page.getByRole("status").filter({ hasText: "didn't start" })).toBeVisible();
});

test("the Keep original tile shows the take's thumbnail, and gets a fresh link when the old one has expired", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!);
  let links = 0;
  await page.route("**/api/takes/*/media?kind=thumb", (r) => {
    links += 1;
    // The first link has expired (R2 answers 403); the second works.
    return r.fulfill({
      json: { url: `${R2}/${links === 1 ? "expired" : "original"}.png`, expiresInSeconds: 3600 },
    });
  });
  await page.route(`${R2}/expired.png`, (r) =>
    r.fulfill({ status: 403, body: "Request has expired" }),
  );
  await open(page, id);
  const tile = section(page)
    .getByRole("radio", { name: /Keep original/ })
    .locator("..");
  const img = tile.locator("img");
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  expect(links).toBeGreaterThanOrEqual(1);
});

test("when the new video's link fails, the current video keeps playing and Try again swaps it", async ({
  page,
  baseURL,
}) => {
  const { id, state } = await setup(page, baseURL!, {
    detail: { latestRender: { id: "render-1", status: "succeeded", durationMs: 3000 } },
  });
  let fresh = false;
  let broken = false;
  await page.route("**/api/takes/*/media?kind=play", (r) =>
    broken
      ? r.fulfill({ status: 500, json: { error: "storage_error", message: "stub" } })
      : r.fulfill({
          json: { url: `${R2}/${fresh ? "clip2" : "clip"}.mp4`, expiresInSeconds: 3600 },
        }),
  );
  await page.route(`${R2}/clip2.mp4`, (r) =>
    r.fulfill({
      body: clip,
      contentType: "video/mp4",
      headers: { "access-control-allow-origin": "*", "accept-ranges": "bytes" },
    }),
  );
  await open(page, id);
  await expect(page.locator("video")).toHaveAttribute("src", `${R2}/clip.mp4`);
  await page.locator("video").evaluate((v) => v.setAttribute("data-mark", "same"));

  broken = true;
  state.detail = { latestRender: { id: "render-2", status: "succeeded", durationMs: 3000 } };
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  // A few quiet tries, then a message; the working video is never taken away.
  await expect(page.getByText(/didn.t load\./)).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("video[data-mark=same]")).toHaveAttribute("src", `${R2}/clip.mp4`);

  broken = false;
  fresh = true;
  await page
    .getByRole("status")
    .filter({ hasText: /didn.t load\./ })
    .getByRole("button", { name: "Try again" })
    .click();
  await expect(page.locator("video[data-mark=same]")).toHaveAttribute("src", `${R2}/clip2.mp4`);
  await expect(page.getByText(/didn.t load\./)).toHaveCount(0);
});
