import { readFileSync } from "node:fs";
import { devices, expect as baseExpect, test, type Page, type Route } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { signIn } from "./support/session";
import { seedTakes } from "./support/takes";

// The "Missed something?" button on the take page (spec 0017, AC-3). The POST is stubbed so each
// answer is exact; the real route is covered by src/server/takes/missed.test.ts.
const expect = baseExpect.configure({ timeout: 30_000 });
test.describe.configure({ timeout: 90_000 });

const clip = readFileSync("tests/fixtures/clip.mp4");
const R2 = "https://r2.test";

let cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

async function setup(page: Page, baseURL: string, answer: { status: number } = { status: 204 }) {
  const { user, cleanup } = await signIn(page.context(), baseURL);
  cleanups.push(cleanup);
  const posted: string[] = [];
  await page.route("**/api/takes/*/media?kind=play", (r) =>
    r.fulfill({ json: { url: `${R2}/clip.mp4`, expiresInSeconds: 3600 } }),
  );
  await page.route("**/api/takes/*/media?kind=thumb", (r) => r.fulfill({ status: 404, json: {} }));
  await page.route(`${R2}/clip.mp4`, (r: Route) =>
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
  await page.route("**/api/takes/*/missed", (r) => {
    posted.push(r.request().postData() ?? "");
    return r.fulfill({ status: answer.status, json: answer.status === 204 ? undefined : {} });
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
      removedRanges: [],
    },
  ]);
  return { id: id as string, posted };
}

const button = (page: Page) => page.getByRole("button", { name: "Missed something?" });

test("a keyboard press notes the time and announces it politely", async ({ page, baseURL }) => {
  const { id, posted } = await setup(page, baseURL ?? "");
  await page.goto(`/takes/${id}`);
  await expect(button(page)).toBeVisible();
  await button(page).focus();
  await page.keyboard.press("Enter");
  const note = page.getByTestId("missed-note");
  await expect(note).toHaveText(/^Thanks, noted at 0:0\d\. This helps us improve AI edits\.$/);
  await expect(note).toHaveAttribute("role", "status");
  await expect(note).toHaveAttribute("aria-live", "polite");
  expect(posted).toHaveLength(1);
  expect(JSON.parse(posted[0] ?? "{}")).toEqual({ atMs: expect.any(Number) });
});

test("a failed note says so and the button stays usable", async ({ page, baseURL }) => {
  const { id } = await setup(page, baseURL ?? "", { status: 500 });
  await page.goto(`/takes/${id}`);
  await button(page).click();
  await expect(page.getByTestId("missed-note")).toHaveText("Couldn’t note that. Try again.");
  await expect(button(page)).toBeEnabled();
});

test("passes axe, is 44 px tall and shows a focus ring on desktop", async ({ page, baseURL }) => {
  const { id } = await setup(page, baseURL ?? "");
  await page.goto(`/takes/${id}`);
  await expect(button(page)).toBeVisible();
  const box = await button(page).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await button(page).focus();
  await expect(button(page)).toHaveCSS("outline-style", "solid");
  await expectNoSeriousAxeIssues(page);
});

test("fits a phone, with a 44 px target and no sideways scroll", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: baseURL! });
  const page = await context.newPage();
  try {
    const { id } = await setup(page, baseURL ?? "");
    await page.goto(`/takes/${id}`);
    await expect(button(page)).toBeVisible();
    const box = await button(page).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await button(page).tap();
    await expect(page.getByTestId("missed-note")).toContainText("Thanks, noted at");
    await expectNoSeriousAxeIssues(page);
  } finally {
    await context.close();
  }
});
