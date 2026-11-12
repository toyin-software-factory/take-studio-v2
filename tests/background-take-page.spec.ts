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
  await page.route(new RegExp(`/api/takes/${id}/background$`), (route) => {
    state.calls.push(`PUT ${route.request().postData()}`);
    if (state.put === "abort") return route.abort();
    return route.fulfill({ status: state.put.status, json: state.put.json ?? {} });
  });
  return { id: id as string, state };
}

const section = (page: Page) => page.getByRole("region", { name: "Background", exact: true });
const open = async (page: Page, id: string) => {
  await page.goto(`/takes/${id}`);
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
  await expect(section(page).getByRole("button", { name: "Keep original" })).toBeDisabled();
});

test("picks by keyboard, previews on the stage while the video stays, then uses the background (AC-4, AC-5, AC-12)", async ({
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
  await section(page).getByRole("button", { name: "Use this background" }).click();
  await expect.poll(() => state.calls.some((c) => c.startsWith("PUT"))).toBe(true);
  expect(state.calls.find((c) => c.startsWith("PUT"))).toContain(`"backgroundId":"${CALM}"`);
  // Making the new video: progress shows, the choice cannot start another, the old video plays on.
  await expect(section(page)).toContainText(
    "Making your video with the new background. You can keep watching this one.",
  );
  await expect(section(page).getByRole("button", { name: "Use this background" })).toBeDisabled();
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
  await expect(section(page).getByRole("button", { name: "Keep original" })).toBeEnabled();
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
});

test("shows a failed change and Try again repeats the failed target (AC-5)", async ({
  page,
  baseURL,
}) => {
  const { id, state } = await setup(page, baseURL!, {
    detail: {
      backgroundJob: { status: "failed", failureCode: "internal_error", targetBackgroundId: WARM },
    },
  });
  await open(page, id);
  await expect(section(page)).toContainText(
    "The new background didn't finish. Your video is unchanged. Try again.",
  );
  await expect(section(page).getByRole("radio", { name: /Warm studio/ })).toBeChecked();
  await section(page).getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => state.calls.some((c) => c.startsWith("PUT"))).toBe(true);
  expect(state.calls.find((c) => c.startsWith("PUT"))).toContain(`"backgroundId":"${WARM}"`);
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

test("keeps its message when a lost start cannot be confirmed either (AC-5)", async ({
  page,
  baseURL,
}) => {
  const { id, state } = await setup(page, baseURL!, { put: "abort" });
  await open(page, id);
  await section(page)
    .getByRole("radio", { name: /Calm studio/ })
    .check({ force: true });
  // Looking at the take again fails too.
  state.detailStatus = 500;
  await section(page).getByRole("button", { name: "Use this background" }).click();
  await expect(
    section(page)
      .getByRole("alert")
      .filter({ hasText: /couldn.t confirm the change started/ }),
  ).toBeVisible();
  // It stays until the creator acts again.
  await page.waitForTimeout(500);
  await expect(
    section(page)
      .getByRole("alert")
      .filter({ hasText: /couldn.t confirm the change started/ }),
  ).toBeVisible();
});

test("shows a refusal from the server, and a failed preview with a way to try it again", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, {
    put: {
      status: 409,
      json: {
        error: "job_active",
        message: "Your transcript is still being made. Try again in a moment.",
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
    section(page).getByRole("alert").filter({ hasText: "isn't ready yet" }),
  ).toBeVisible();
  await expect(section(page).getByRole("button", { name: "Try the preview again" })).toBeVisible();
  await section(page).getByRole("button", { name: "Use this background" }).click();
  await expect(section(page)).toContainText(
    "Your transcript is still being made. Try again in a moment.",
  );
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
        backgroundJob: {
          status: "failed",
          failureCode: "background_missing",
          targetBackgroundId: CALM,
        },
      },
      preview: {
        post: {
          status: 200,
          json: { state: "ready", url: `${R2}/preview.png`, noGreenScreen: true },
        },
      },
    });
    await open(page, id);
    await expect(section(page).getByRole("button", { name: "Try again" })).toBeVisible();
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
    const action = await section(page)
      .getByRole("button", { name: "Use this background" })
      .boundingBox();
    expect(action?.height).toBeGreaterThanOrEqual(44);
  });
});

test("'Try again' is only for the failed target: another pick is a new change", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, {
    detail: {
      backgroundJob: { status: "failed", failureCode: "internal_error", targetBackgroundId: WARM },
    },
  });
  await open(page, id);
  await expect(section(page).getByRole("button", { name: "Try again" })).toBeVisible();
  await section(page)
    .getByRole("radio", { name: /Calm studio/ })
    .check({ force: true });
  await expect(section(page).getByRole("button", { name: "Use this background" })).toBeVisible();
  await expect(section(page).getByRole("button", { name: "Try again" })).toHaveCount(0);
  await section(page)
    .getByRole("radio", { name: /Warm studio/ })
    .check({ force: true });
  await expect(section(page).getByRole("button", { name: "Try again" })).toBeVisible();
});

test("deleting the failed target falls back to Keep original, not the deleted ID", async ({
  page,
  baseURL,
}) => {
  const { id, state } = await setup(page, baseURL!, {
    list: { ...LIST, mine: [item(MINE, "Office wall")] },
    detail: {
      backgroundJob: { status: "failed", failureCode: "internal_error", targetBackgroundId: MINE },
    },
  });
  await page.route("**/api/backgrounds/*", (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    state.list = 500;
    return route.fulfill({ status: 204 });
  });
  await open(page, id);
  await expect(section(page).getByRole("radio", { name: /Office wall/ })).toBeChecked();
  await section(page).getByRole("button", { name: "Delete Office wall" }).click();
  await expect(section(page).getByRole("radio", { name: "Keep original" })).toBeChecked();
  // Nothing is left to retry: the button is the plain, disabled "Keep original" (already current).
  await expect(section(page).getByRole("button", { name: "Keep original" })).toBeDisabled();
  await expect(section(page).getByRole("button", { name: "Try again" })).toHaveCount(0);
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

test("a click on the preview reaches the video (play and pause still work)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, {
    preview: {
      post: {
        status: 200,
        json: { state: "ready", url: `${R2}/preview.png`, noGreenScreen: false },
      },
    },
  });
  await open(page, id);
  await section(page)
    .getByRole("radio", { name: /Calm studio/ })
    .check({ force: true });
  await expect(page.getByAltText("Preview of your take on Calm studio")).toBeVisible();
  // The still is only to look at: the point under it is the video, so a click plays and pauses it.
  const still = page.getByAltText("Preview of your take on Calm studio");
  await still.scrollIntoViewIfNeeded();
  const box = await still.boundingBox();
  const topmost = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.tagName ?? "",
    { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 },
  );
  expect(topmost).toBe("VIDEO");
});
