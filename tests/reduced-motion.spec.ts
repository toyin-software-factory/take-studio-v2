import { readFileSync } from "node:fs";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { signIn } from "./support/session";
import { seedTakes } from "./support/takes";

// B2-T99 (launch UI review item 4): with reduced motion on, nothing on the library, the take page
// or /record is still animating or transitioning. The global CSS block cuts every duration to 1 ms
// and every animation to one run, so after a short settle nothing may be running.
const expect = baseExpect.configure({ timeout: 30_000 });
test.describe.configure({ timeout: 90_000 });
test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

const clip = readFileSync("tests/fixtures/clip.mp4");
const R2 = "https://r2.test";

let cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

/** Animations and transitions still running (an infinite one counts as running forever). */
const running = (page: Page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === "running")
      .map((a) => {
        const timing = a.effect?.getComputedTiming();
        const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
        return `${target?.tagName.toLowerCase() ?? "?"} ${a.constructor.name} ${timing?.iterations}`;
      }),
  );

async function noneRunning(page: Page) {
  await expect.poll(() => running(page), { message: "running animations" }).toEqual([]);
}

test("reduced motion: no running animation on the library, a take page and /record", async ({
  page,
  baseURL,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { user, cleanup } = await signIn(page.context(), baseURL ?? "");
  cleanups.push(cleanup);
  await page.route("**/api/takes/*/media?kind=play", (r) =>
    r.fulfill({ json: { url: `${R2}/clip.mp4`, expiresInSeconds: 3600 } }),
  );
  await page.route("**/api/takes/*/media?kind=thumb", (r) => r.fulfill({ status: 404, json: {} }));
  await page.route(`${R2}/clip.mp4`, (r) =>
    r.fulfill({
      body: clip,
      contentType: "video/mp4",
      headers: { "access-control-allow-origin": "*", "accept-ranges": "bytes" },
    }),
  );
  await page.route("**/api/backgrounds", (r) =>
    r.fulfill({ json: { builtIn: [], mine: [], defaultId: null } }),
  );
  await page.route("**/api/takes/*/waveform", (r) => r.fulfill({ json: { waveform: null } }));
  const [id] = await seedTakes(user.id, [
    {
      title: "Motion check",
      status: "ready",
      durationMs: 5000,
      steps: [
        { name: "trim", status: "succeeded" },
        { name: "render", status: "succeeded" },
      ],
      removedRanges: [],
    },
  ]);

  await page.goto("/library");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await noneRunning(page);

  await page.goto(`/takes/${id as string}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await noneRunning(page);

  await page.goto("/record");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await noneRunning(page);
});
