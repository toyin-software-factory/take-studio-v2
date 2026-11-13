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
  /** What `GET /jobs/{id}` answers; the default is a job that keeps running. */
  job?: { status: string };
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
    route.fulfill({ json: opts.job ?? { status: "running" } }),
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
  await expect(page.getByRole("status").filter({ hasText: "2 pauses cut" })).toBeVisible();
  await expect(cutButton(page, 1)).toHaveAttribute("aria-pressed", "false");
  await expect(bar(page)).toHaveCount(0);
  await cutButton(page, 1).focus();
  await page.keyboard.press("Space");
  await expect(cutButton(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(bar(page)).toContainText("1 change");
  await expect(bar(page)).toContainText("Keep pause 1");
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
    change: { status: 429, json: { error: "change_limit" } },
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
  await expect(page.getByText("The original has expired")).toBeVisible();
  await expect(cutButton(page, 3)).toBeDisabled();
});

test("a failed render keeps the changes and offers Try again, which a reload loses (AC-6)", async ({
  page,
  baseURL,
}) => {
  const { id, calls } = await setup(page, baseURL!, { job: { status: "failed" } });
  await load(page, id);
  await cutButton(page, 3).click();
  await bar(page).getByRole("button", { name: "Render" }).click();
  await expect.poll(() => calls.length).toBe(1);
  // The previous video and its summary stay, the page unlocks and the same changes are offered again.
  await expect(
    page.getByRole("status").filter({ hasText: "The new video didn't finish" }),
  ).toBeVisible();
  await expect(page.getByText("Removed 0:01 of pauses")).toBeVisible();
  // aria-pressed means "kept": pause 3 starts kept and the held change cuts it.
  await expect(cutButton(page, 3)).toHaveAttribute("aria-pressed", "false");
  await expect(cutButton(page, 3)).toBeEnabled();
  await expect(bar(page)).toContainText("Cut pause 3");
  await expect(bar(page).getByRole("button", { name: "Render" })).toHaveCount(0);
  await expect(bar(page).getByRole("button", { name: "Try again" })).toBeEnabled();
  await expectNoSeriousAxeIssues(page);
  // Try again sends exactly the same changes.
  await bar(page).getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1]).toBe(calls[0]);
  // A reload loses the held changes, so there is nothing to retry.
  await page.reload();
  await expect(timeline(page)).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(cutButton(page, 3)).toHaveAttribute("aria-pressed", "true");
});

// A phone context made inside the test: `test.use(devices[...])` cannot sit in a describe group.
test("on a phone the timeline scrolls inside itself and the page does not (AC-1, AC-10)", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: baseURL! });
  try {
    const page = await context.newPage();
    const { id } = await setup(page, baseURL!);
    await load(page, id);
    expect(await noPageScroll(page)).toBe(true);
    const box = await cutButton(page, 1).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
    await expectNoSeriousAxeIssues(page);
    // The pending bar: the text has the full width, the buttons share the row below it, 44 px tall.
    await cutButton(page, 3).click();
    await expect(bar(page)).toBeVisible();
    const text = await bar(page)
      .getByText(/1 change/)
      .boundingBox();
    const discard = await bar(page).getByRole("button", { name: "Discard" }).boundingBox();
    const render = await bar(page).getByRole("button", { name: "Render" }).boundingBox();
    const barBox = await bar(page).boundingBox();
    expect(discard!.y).toBeGreaterThanOrEqual(text!.y + text!.height);
    expect(Math.abs(discard!.y - render!.y)).toBeLessThan(2);
    for (const b of [discard!, render!]) expect(b.height).toBeGreaterThanOrEqual(44);
    expect(text!.width).toBeGreaterThan(barBox!.width * 0.7);
    expect(await noPageScroll(page)).toBe(true);
    await expectNoSeriousAxeIssues(page);
  } finally {
    await context.close();
  }
});

// Spec 0012 part 3 (AC-3, AC-7, AC-12): the reason line and the "AI edit wasn't available" line.
const AI_CUTS = [
  {
    id: "c1",
    startMs: 1000,
    endMs: 1800,
    kind: "ai",
    applied: true,
    proposedBy: "ai",
    reason: "You restarted the sentence.",
  },
  {
    id: "c2",
    startMs: 2500,
    endMs: 3200,
    kind: "pause",
    applied: true,
    proposedBy: "rules",
    reason: null,
  },
  {
    id: "c3",
    startMs: 4000,
    endMs: 4600,
    kind: "ai",
    applied: false,
    proposedBy: "ai",
    reason: "A repeated word.",
  },
];
const reasonLineOf = (page: Page) => page.getByTestId("cut-reason");
const cutAny = (page: Page, n: number) =>
  timeline(page).getByRole("button", { name: new RegExp(`^(Pause|Cut) ${n},`) });

test("an AI cut shows its reason on focus and on press, and each block is described by it (AC-3)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, { detail: { cuts: AI_CUTS, aiEdit: "done" } });
  await load(page, id);
  await expect(reasonLineOf(page)).toHaveText("");
  await cutAny(page, 1).focus();
  await expect(reasonLineOf(page)).toHaveText("Cut 1: You restarted the sentence.");
  await expect(reasonLineOf(page)).toHaveAttribute("role", "status");
  const describedBy = await cutAny(page, 1).getAttribute("aria-describedby");
  await expect(page.locator(`[id="${describedBy}"]`)).toHaveText("You restarted the sentence.");
  await cutAny(page, 3).click();
  await expect(reasonLineOf(page)).toHaveText("Cut 3: A repeated word.");
  await expect(page.getByTestId("ai-unavailable")).toHaveCount(0);
  await expectNoSeriousAxeIssues(page);
});

test("a take that fell back to rules shows the rules cuts and the unavailable line (AC-7, AC-12)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, { detail: { aiEdit: "unavailable" } });
  await load(page, id);
  await expect(page.getByTestId("ai-unavailable")).toHaveText(
    "AI edit wasn't available for this take.",
  );
  await expect(cutButton(page, 1)).not.toHaveAttribute("aria-describedby", /.+/);
  await cutButton(page, 1).focus();
  await expect(reasonLineOf(page)).toHaveText("");
  await expectNoSeriousAxeIssues(page);
});

test("no unavailable line when aiEdit is null (not English or no speech)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, { detail: { aiEdit: null } });
  await load(page, id);
  await expect(cutButton(page, 1)).toBeVisible();
  await expect(page.getByTestId("ai-unavailable")).toHaveCount(0);
});

test("on a phone the reason line wraps without sideways page scroll (AC-3)", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: baseURL! });
  try {
    const page = await context.newPage();
    const long = "You said the same thing twice and then started again from the top of the line.";
    const cuts = AI_CUTS.map((c) => (c.id === "c1" ? { ...c, reason: long } : c));
    const { id } = await setup(page, baseURL!, { detail: { cuts, aiEdit: "done" } });
    await load(page, id);
    await cutAny(page, 1).click();
    await expect(reasonLineOf(page)).toContainText("Cut 1:");
    expect(await noPageScroll(page)).toBe(true);
    await expectNoSeriousAxeIssues(page);
  } finally {
    await context.close();
  }
});
