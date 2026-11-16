import { test, type Page } from "@playwright/test";
import { seedTakes } from "./support/takes";
import { R2, cleanups, clip, expect, expectNoSeriousAxeIssues, signedIn } from "./fixtures/takes";

test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups.length = 0;
});

const STEPS = [
  { name: "trim", status: "succeeded" },
  { name: "render", status: "succeeded" },
] as const;
const LINE = "Free videos end with an Edited with Take Studio credit.";

async function mockPlayback(page: Page) {
  await page.route("**/api/takes/*/media?kind=play", (route) =>
    route.fulfill({ json: { url: `${R2}/clip.mp4`, expiresInSeconds: 3600 } }),
  );
  await page.route(`${R2}/clip.mp4`, (route) =>
    route.fulfill({
      body: clip,
      contentType: "video/mp4",
      headers: { "access-control-allow-origin": "*" },
    }),
  );
}

test.describe("credit line on the take page (spec 0026 step 3)", () => {
  test("a credited take says so near Download, with no paid plan wording (AC-8)", async ({
    page,
    baseURL,
  }) => {
    const user = await signedIn(page, baseURL!);
    const [id] = await seedTakes(user.id, [
      {
        title: "Credited",
        status: "ready",
        durationMs: 60_000,
        steps: STEPS,
        removedRanges: [{ startMs: 1000, endMs: 5000 }],
        creditApplied: true,
      },
    ]);
    await mockPlayback(page);
    await page.goto(`/takes/${id}`);
    const note = page.locator('[data-check="credit-note"]');
    await expect(note).toHaveText(LINE);
    await expect(page.getByText(/paid plan|upgrade|remove it/i)).toHaveCount(0);
    await expect(page.locator('[data-check="credit-note-export"]')).toHaveText(LINE);
    const download = page.getByRole("button", { name: "Download", exact: true });
    const [n, d] = await Promise.all([note.boundingBox(), download.boundingBox()]);
    expect(Math.abs(n!.y - d!.y)).toBeLessThan(120);
    await expectNoSeriousAxeIssues(page);
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(note).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await expectNoSeriousAxeIssues(page);
  });

  test("a take without the credit shows no credit line (AC-9)", async ({ page, baseURL }) => {
    const user = await signedIn(page, baseURL!);
    const [id] = await seedTakes(user.id, [
      {
        title: "Plain",
        status: "ready",
        durationMs: 60_000,
        steps: STEPS,
        removedRanges: [{ startMs: 1000, endMs: 5000 }],
      },
    ]);
    await mockPlayback(page);
    await page.goto(`/takes/${id}`);
    await expect(page.getByRole("button", { name: "Download", exact: true })).toBeVisible();
    await expect(page.locator('[data-check^="credit-note"]')).toHaveCount(0);
  });
});
