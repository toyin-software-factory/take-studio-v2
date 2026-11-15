import { readFileSync } from "node:fs";
import { expect as baseExpect, type Page } from "@playwright/test";
import { signIn } from "../support/session";
import { seedTakes } from "../support/takes";

// Take page transcript panel and player captions (spec 0007, AC-2, AC-3, AC-5, AC-12). State
// tests answer GET /api/takes/{id}/transcript with fixtures, so each state is exact; the ready
// tests use a real transcript row, the real routes and a real caption track. Test users only.
export const expect = baseExpect.configure({ timeout: 15_000 });

/** Opens the take page on its Transcript tab (the inspector's default tab is Export). */
export async function openTranscript(page: Page, id: string) {
  await page.goto(`/takes/${id}`);
  const tab = page.getByRole("tab", { name: "Transcript" });
  // A click before the page has hydrated does nothing, so click until the tab is selected.
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 1000 });
  }).toPass();
}

export const clip = readFileSync("tests/fixtures/clip.mp4");

export const R2 = "https://r2.test";

export const cleanups: (() => Promise<void>)[] = [];

export async function readyTake(page: Page, baseURL: string, extra: Record<string, unknown> = {}) {
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

export type View = Record<string, unknown>;

export const para = (startMs: number, text: string, filler = false) => ({
  startMs,
  words: text.split(" ").map((w, i) => ({
    index: Math.round(startMs / 100) + i,
    w,
    startMs: startMs + i * 300,
    endMs: startMs + i * 300 + 250,
    filler: filler && i === 0,
  })),
});

export const READY: View = {
  state: "ready",
  canMake: false,
  version: "v1",
  paragraphs: [para(0, "Um hello there"), para(1500, "second paragraph here")],
};

/** Answers the transcript read with each view in turn (the last one repeats). */
export async function serve(page: Page, views: readonly (View | number)[]) {
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
