import { readFileSync } from "node:fs";
import { expect as baseExpect, type Page } from "@playwright/test";
import { signIn } from "../support/session";
import { seedTakes } from "../support/takes";

// The background picker on the take page (spec 0008, AC-3 to AC-6, AC-11, AC-12). The list, the
// previews, the change and the take's own detail are stubbed so each state and message is exact;
// the real routes have their own tests.
export const expect = baseExpect.configure({ timeout: 30_000 });

export const clip = readFileSync("tests/fixtures/clip.mp4");

export const R2 = "https://r2.test";

export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

export const CALM = "00000000-0000-4000-8000-000000000001";

export const WARM = "00000000-0000-4000-8000-000000000002";

export const MINE = "00000000-0000-4000-8000-000000000004";

export type Item = {
  id: string;
  name: string;
  alt: string;
  status: string;
  failureCode: string | null;
  thumbUrl: string | null;
};

export const item = (id: string, name: string, extra: Partial<Item> = {}): Item => ({
  id,
  name,
  alt: `${name} backdrop`,
  status: "ready",
  failureCode: null,
  thumbUrl: `${R2}/thumb.png`,
  ...extra,
});

export const LIST = {
  builtIn: [item(CALM, "Calm studio"), item(WARM, "Warm studio")],
  mine: [item(MINE, "Office wall")],
  defaultId: null,
};

export type Stub = {
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

export const cleanups: (() => Promise<void>)[] = [];

export async function setup(page: Page, baseURL: string, stub: Partial<Stub> = {}) {
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

export const bar = (page: Page) => page.getByRole("region", { name: "Unsaved changes" });

export const render = (page: Page) => bar(page).getByRole("button", { name: "Render" });

export const section = (page: Page) =>
  page.getByRole("region", { name: "Background", exact: true });

export const open = async (page: Page, id: string) => {
  await page.goto(`/takes/${id}`);
  const tab = page.getByRole("tab", { name: "Background" });
  // A click before the page has hydrated does nothing, so click until the tab is selected.
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 1000 });
  }).toPass();
  await expect(section(page).getByRole("radio", { name: /Keep original/ })).toBeVisible();
};

export const SUGGESTION = {
  backgroundId: WARM,
  name: "Warm studio",
  reason: "Suits a calm interview.",
};
