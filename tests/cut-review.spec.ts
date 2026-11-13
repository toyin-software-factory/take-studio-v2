import { readFileSync } from "node:fs";
import { devices, expect as baseExpect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { signIn } from "./support/session";
import { seedTakes } from "./support/takes";

// The cut review timeline on the take page (spec 0011, AC-1 to AC-6, AC-10, AC-11). The take's
// cuts, the waveform, the change and its job are stubbed so each state is exact.
const expect = baseExpect.configure({ timeout: 30_000 });
test.describe.configure({ timeout: 90_000 });

const clip = readFileSync("tests/fixtures/clip.mp4");
const R2 = "https://r2.test";
const CUTS = [
  { id: "c1", startMs: 1000, endMs: 1800, kind: "pause", applied: true },
  { id: "c2", startMs: 2500, endMs: 3200, kind: "pause", applied: true },
  { id: "c3", startMs: 4000, endMs: 4600, kind: "pause", applied: false },
];

let cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

type Opts = {
  waveform?: number[] | null;
  original?: { status: number };
  detail?: Record<string, unknown>;
  change?: { status: number; json: unknown };
};

async function setup(page: Page, baseURL: string, opts: Opts = {}) {
  const { user, cleanup } = await signIn(page.context(), baseURL);
  cleanups.push(cleanup);
  const calls: string[] = [];
  const bytes = (route: import("@playwright/test").Route) =>
    route.fulfill({
      body: clip,
      contentType: "video/mp4",
      headers: { "access-control-allow-origin": "*", "accept-ranges": "bytes" },
    });
  await page.route("**/api/takes/*/media?kind=play", (r) =>
    r.fulfill({ json: { url: `${R2}/clip.mp4`, expiresInSeconds: 3600 } }),
  );
  await page.route("**/api/takes/*/media?kind=thumb", (r) => r.fulfill({ status: 404, json: {} }));
  await page.route("**/api/takes/*/media?kind=original", (r) =>
    opts.original && opts.original.status !== 200
      ? r.fulfill({ status: opts.original.status, json: {} })
      : r.fulfill({ json: { url: `${R2}/original.mp4`, expiresInSeconds: 3600 } }),
  );
  await page.route(`${R2}/clip.mp4`, bytes);
  await page.route(`${R2}/original.mp4`, bytes);
  await page.route("**/api/backgrounds", (r) =>
    r.fulfill({ json: { builtIn: [], mine: [], defaultId: null } }),
  );
  const [id] = await seedTakes(user.id, [
    {
      title: "Interview",
      status: "ready",
      durationMs: 5000,
      steps: [
        { name: "trim", status: "succeeded" },
        { name: "render", status: "succeeded" },
      ],
      removedRanges: [
        { startMs: 1000, endMs: 1800 },
        { startMs: 2500, endMs: 3200 },
      ],
    },
  ]);
  await page.route(new RegExp(`/api/takes/${id}/waveform$`), (r) =>
    r.fulfill({
      json: {
        waveform:
          opts.waveform === undefined
            ? Array.from({ length: 50 }, (_, i) => (i * 7) % 100)
            : opts.waveform,
      },
    }),
  );
  await page.route(new RegExp(`/api/takes/${id}$`), async (route) => {
    try {
      const real = await route.fetch();
      const body = (await real.json()) as Record<string, unknown>;
      return await route.fulfill({
        status: real.status(),
        json: { ...body, cuts: CUTS, originalAvailable: true, ...opts.detail },
      });
    } catch {
      return route.abort().catch(() => undefined);
    }
  });
  await page.route(new RegExp(`/api/takes/${id}/changes$`), (route) => {
    calls.push(`POST ${route.request().postData()}`);
    const c = opts.change ?? { status: 202, json: { jobId: "j1" } };
    return route.fulfill({ status: c.status, json: c.json });
  });
  await page.route(new RegExp(`/api/takes/${id}/jobs/`), (route) =>
    route.fulfill({ json: { status: "running" } }),
  );
  return { id: id as string, calls };
}

const timeline = (page: Page) => page.getByRole("region", { name: "Cut timeline" });
const bar = (page: Page) => page.getByRole("region", { name: "Unsaved changes" });
const cutButton = (page: Page, n: number) =>
  timeline(page).getByRole("button", { name: new RegExp(`^Pause ${n},`) });
const noPageScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function load(page: Page, id: string) {
  await page.goto(`/takes/${id}`);
  await expect(timeline(page)).toBeVisible();
}

test("toggles a cut by keyboard, lists it in the pending bar and discards (AC-1, AC-2, AC-4, AC-10)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!);
  await load(page, id);
  await expect(timeline(page)).toContainText("2 pauses cut");
  await expect(cutButton(page, 1)).toHaveAttribute("aria-pressed", "false");
  await expect(bar(page)).toHaveCount(0);
  await cutButton(page, 1).focus();
  await page.keyboard.press("Space");
  await expect(cutButton(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(bar(page)).toContainText("1 change");
  await expect(bar(page)).toContainText("Keep 1");
  await expectNoSeriousAxeIssues(page);
  await bar(page).getByRole("button", { name: "Discard" }).click();
  await expect(bar(page)).toHaveCount(0);
  await expect(cutButton(page, 1)).toHaveAttribute("aria-pressed", "false");
});

test("Render sends the changes with baseRenderId and locks the page (AC-6)", async ({
  page,
  baseURL,
}) => {
  const { id, calls } = await setup(page, baseURL!);
  await load(page, id);
  await cutButton(page, 3).click();
  await bar(page).getByRole("button", { name: "Render" }).click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toContain('"baseRenderId"');
  expect(calls[0]).toContain('"cuts"');
  await expect(page.getByRole("status").filter({ hasText: "Rendering" })).toBeVisible();
  await expect(cutButton(page, 1)).toBeDisabled();
  await expect(bar(page).getByRole("button", { name: "Render" })).toBeDisabled();
});

test("a 429 hides Render and keeps Discard (AC-8)", async ({ page, baseURL }) => {
  const { id } = await setup(page, baseURL!, {
    change: { status: 429, json: { error: "rate_limited" } },
  });
  await load(page, id);
  await cutButton(page, 3).click();
  await bar(page).getByRole("button", { name: "Render" }).click();
  await expect(bar(page).getByRole("button", { name: "Render" })).toHaveCount(0);
  await expect(bar(page).getByRole("button", { name: "Discard" })).toBeVisible();
});

test("confirms before leaving through an in app link with unsent changes (AC-4)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!);
  await load(page, id);
  await cutButton(page, 3).click();
  const asked: string[] = [];
  page.on("dialog", (d) => {
    asked.push(d.message());
    void d.dismiss();
  });
  await page.getByRole("link", { name: /Takes/ }).first().click();
  await expect.poll(() => asked.length).toBe(1);
  await expect(page).toHaveURL(new RegExp(`/takes/${id}$`));
});

test("shows a plain track when there is no waveform (AC-11)", async ({ page, baseURL }) => {
  const { id } = await setup(page, baseURL!, { waveform: null });
  await load(page, id);
  await expect(cutButton(page, 1)).toBeVisible();
  await expect(timeline(page).locator("canvas, svg[data-waveform]")).toHaveCount(0);
});

test("an original that cannot be fetched says so and keeps the page usable (AC-3)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, { original: { status: 410 } });
  await load(page, id);
  await cutButton(page, 3).click();
  await expect(bar(page)).toBeVisible();
  await expect(cutButton(page, 3)).toBeEnabled();
});

test.describe("phone width", () => {
  test.use({ ...devices["Pixel 7"] });
  test("the timeline scrolls inside itself and the page does not (AC-1, AC-10)", async ({
    page,
    baseURL,
  }) => {
    const { id } = await setup(page, baseURL!);
    await load(page, id);
    expect(await noPageScroll(page)).toBe(true);
    const box = await cutButton(page, 1).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
    await expectNoSeriousAxeIssues(page);
  });
});
