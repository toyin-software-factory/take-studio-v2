import { expect, test } from "@playwright/test";
import { ready } from "./fixtures/home-details";

// The homepage details (spec 0010 task 4: AC-5, AC-7, AC-8, AC-9): tile video controls, flip
// counters that keep the real number, the FAQ panel motion and reduced motion.
test.describe.configure({ timeout: 90_000 });

// Homepage speed (spec 0010 AC-10): nothing above the fold shifts after the first paint, and the
// headline and lead wait for the draft's intro (rise in masks, fade) and are never left hidden.
test.describe("first paint", () => {
  test.use({ viewport: { width: 412, height: 823 }, hasTouch: true, isMobile: true });

  test("the layout does not shift while the page loads and the motion starts", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as {
          value: number;
          hadRecentInput: boolean;
        }[]) {
          if (!entry.hadRecentInput) w.__cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await ready(page);
    await page.waitForTimeout(2500);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(0.01);
  });

  test("the headline and lead are visible before any script runs", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.locator(".h-h1")).toBeVisible();
    await expect(page.locator(".h-hero-lead")).toHaveCSS("opacity", "1");
    await expect(page.locator(".h-nav")).toHaveCSS("opacity", "1");
    await context.close();
  });

  test("the intro hides the headline words, lead and bar at load, then shows them", async ({
    page,
  }) => {
    // Hold the intro at its start: the draft's load motion (AC-10, as changed 2026-11-13).
    await page.goto("/");
    await expect(page.locator(".h-hero .h-w-mask").first()).toBeAttached({ timeout: 20_000 });
    await expect(page.locator(".h-h1")).toHaveAttribute("aria-label", /Film one take\./);
    await expect(page.locator(".h-hero .h-w-mask").first()).toHaveAttribute("aria-hidden", "true");
    await page.waitForTimeout(3500);
    for (const selector of [".h-h1", ".h-hero-lead", ".h-nav"]) {
      await expect(page.locator(selector).first()).toBeVisible();
      await expect(page.locator(selector).first()).toHaveCSS("opacity", "1");
    }
    await expect(page.locator("html")).not.toHaveClass(/h-intro-pending/);
    const words = await page
      .locator(".h-hero .h-w")
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).transform));
    expect(words.every((t) => t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)")).toBe(true);
  });

  test("before the intro runs the headline is hidden, and the 3 s timer brings it back", async ({
    page,
  }) => {
    // Browser time is held, so a slow parse cannot run the guard timer early.
    await page.clock.install();
    // Only the inline guard runs: no bundle loads, so the intro never takes over.
    await page.route("**/*.js", (route) => route.abort());
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveClass(/h-intro-pending/);
    await expect(page.locator(".h-h1")).toBeHidden();
    const box = await page.locator(".h-h1").boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(40);
    // Past the guard's deadline the mark is gone and nothing is left hidden.
    await page.clock.fastForward(3500);
    await expect(page.locator("html")).not.toHaveClass(/h-intro-pending/);
    await expect(page.locator(".h-h1")).toBeVisible();
    await expect(page.locator(".h-nav")).toHaveCSS("opacity", "1");
    await expect(page.locator(".h-hero-lead")).toHaveCSS("opacity", "1");
  });
});

test.describe("first paint, reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("nothing is hidden or split, the text shows at once", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).not.toHaveClass(/h-intro-pending/);
    for (const selector of [".h-h1", ".h-hero-lead", ".h-nav"]) {
      await expect(page.locator(selector).first()).toBeVisible();
      await expect(page.locator(selector).first()).toHaveCSS("opacity", "1");
    }
    await expect(page.locator(".h-hero .h-w-mask")).toHaveCount(0);
  });
});

test.describe("phone layout like the draft (B-T11)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the fan is 300 px tall with 160 px cards and its list does not clip", async ({ page }) => {
    await ready(page);
    await expect(page.locator(".h-fan")).toHaveCSS("height", "300px");
    await expect(page.locator(".h-fan-card").first()).toHaveCSS("width", "160px");
    await expect(page.locator(".h-fan-list")).toHaveCSS("overflow-x", "visible");
  });

  test("the reel video has square corners 32 px under the heading", async ({ page }) => {
    await ready(page);
    await expect(page.locator(".h-reel-media video")).toHaveCSS("border-radius", "0px");
    await expect(page.locator(".h-reel-title")).toHaveCSS("margin-bottom", "0px");
    await expect(page.locator(".h-reel-media")).toHaveCSS("margin-top", "32px");
  });

  test("the closing button centres its text", async ({ page }) => {
    await ready(page);
    await expect(page.locator(".h-closing .h-btn-split")).toHaveCSS("text-align", "center");
  });
});

test.describe("tile poster scale", () => {
  test("the poster scales while its tile plays, and not under reduced motion", async ({
    browser,
  }) => {
    for (const reduce of [false, true]) {
      const context = await browser.newContext({
        reducedMotion: reduce ? "reduce" : "no-preference",
      });
      const page = await context.newPage();
      await ready(page);
      const poster = page.locator(".h-tile-media .h-tile-poster").first();
      const tile = page.locator(".h-tile-media").first();
      await tile.scrollIntoViewIfNeeded();
      await tile.hover({ position: { x: 20, y: 20 } });
      await page.waitForTimeout(800);
      const transform = await poster.evaluate((el) => getComputedStyle(el).transform);
      if (reduce) expect(transform).toBe("none");
      else expect(transform).not.toBe("none");
      await context.close();
    }
  });
});
