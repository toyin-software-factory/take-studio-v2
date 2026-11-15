import { readFileSync } from "node:fs";
import { expect as baseExpect, type Page } from "@playwright/test";
import { signIn } from "../support/session";
import { seedTakes } from "../support/takes";

// The cut review timeline on the take page (spec 0011, AC-1 to AC-6, AC-10, AC-11). The take's
// cuts, the waveform, the change and its job are stubbed so each state is exact.
export const expect = baseExpect.configure({ timeout: 30_000 });

export const clip = readFileSync("tests/fixtures/clip.mp4");

export const R2 = "https://r2.test";

export const CUTS = [
  { id: "c1", startMs: 1000, endMs: 1800, kind: "pause", applied: true },
  { id: "c2", startMs: 2500, endMs: 3200, kind: "pause", applied: true },
  { id: "c3", startMs: 4000, endMs: 4600, kind: "pause", applied: false },
];

export const cleanups: (() => Promise<void>)[] = [];

export type Opts = {
  waveform?: number[] | null;
  original?: { status: number };
  detail?: Record<string, unknown>;
  change?: { status: number; json: unknown };
  /** What `GET /jobs/{id}` answers; the default is a job that keeps running. */
  job?: { status: string };
};

export async function setup(page: Page, baseURL: string, opts: Opts = {}) {
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

export const timeline = (page: Page) => page.getByRole("region", { name: "Cut timeline" });

export const bar = (page: Page) => page.getByRole("region", { name: "Unsaved changes" });

export const cutButton = (page: Page, n: number) =>
  timeline(page).getByRole("button", { name: new RegExp(`^Pause ${n},`) });

export const noPageScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

export async function load(page: Page, id: string) {
  await page.goto(`/takes/${id}`);
  await expect(timeline(page)).toBeVisible();
}

// Spec 0012 part 3 (AC-3, AC-7, AC-12): the reason line and the "AI edit wasn't available" line.
export const AI_CUTS = [
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

export const reasonLineOf = (page: Page) => page.getByTestId("cut-reason");

export const cutAny = (page: Page, n: number) =>
  timeline(page).getByRole("button", { name: new RegExp(`^(Pause|Cut) ${n},`) });

// B2-T25: a visible list of cuts with their reasons, readable without undoing anything.
export const list = (page: Page) => page.getByRole("list", { name: "Cuts and reasons" });
