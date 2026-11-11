import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// /design exists only in development and preview builds (spec 0003, AC-7).
const production = process.env.E2E_PRODUCTION === "1";

test.describe("design gallery (preview)", () => {
  test.skip(production, "The gallery is not served in production mode.");

  test("shows the tokens on light and stage and is noindex", async ({ page }) => {
    const res = await page.goto("/design");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Design system" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Light app colours" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Stage colours" })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("passes axe with no serious or critical issues", async ({ page }) => {
    await page.goto("/design");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  test("uses the self hosted fonts with tabular numbers", async ({ page }) => {
    await page.goto("/design");
    await page.evaluate(() => document.fonts.ready);
    const body = await page.locator("body").evaluate((el) => getComputedStyle(el).fontFamily);
    expect(body).toMatch(/Inter/);
    const mono = page.locator(".mono").first();
    expect(await mono.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toBe(
      "tabular-nums",
    );
    expect(await mono.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/JetBrains/);
  });

  test("loads the fonts without moving the layout", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { shift: number };
      w.shift = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as {
          hadRecentInput: boolean;
          value: number;
        }[]) {
          if (!e.hadRecentInput) w.shift += e.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    const hosts = new Set<string>();
    page.on("request", (request) => hosts.add(new URL(request.url()).host));
    await page.goto("/design");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { shift: number }).shift)).toBeLessThan(
      0.01,
    );
    // Self hosted: no font file comes from another host (spec 0001, next/font).
    expect([...hosts]).toEqual([new URL(page.url()).host]);
  });

  test("stops every running animation under reduced motion, not just the sample", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/design");
    await page.waitForTimeout(400);
    const running = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === "running")
        .map((a) => (a as CSSAnimation).animationName ?? a.constructor.name),
    );
    expect(running).toEqual([]);
  });

  test("stops animation under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/design");
    const duration = await page
      .getByTestId("motion-sample")
      .evaluate((el) => getComputedStyle(el).animationDuration);
    expect(parseFloat(duration)).toBeLessThan(0.001);
  });
});

test.describe("design gallery (production)", () => {
  test.skip(!production, "Run with E2E_PRODUCTION=1 to check the production behaviour.");

  test("returns not found", async ({ request }) => {
    const res = await request.get("/design");
    expect(res.status()).toBe(404);
  });
});
