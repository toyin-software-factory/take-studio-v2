import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./support/session";
import { seedTakes } from "./support/takes";
import { cardAngle, motionReady, scrollTo } from "./fixtures/home-motion";

// The homepage motion (spec 0010 task 2: AC-4, AC-5, AC-8) and that signed in pages never load
// the animation libraries (spec 0009 AC-9).
test.describe.configure({ timeout: 90_000 });

test.describe("reel (AC-5)", () => {
  test("pins and opens from the corner at desktop width, plays in view, and a pause is kept", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await motionReady(page);
    const reel = page.locator(".h-reel");
    await expect(reel).toHaveClass(/is-scrub/);
    const video = page.locator(".h-reel-media video");
    await page.evaluate(() => {
      const top = document.querySelector(".h-reel")!.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, top + 300);
    });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
    // Mid way the video is clipped to a window; fully scrolled it is full bleed.
    const clip = await page
      .locator(".h-reel-media")
      .evaluate((el) => getComputedStyle(el).clipPath);
    expect(clip).toMatch(/inset/);

    const pause = page.getByRole("button", { name: "Pause the reel" });
    await expect(pause).toBeVisible();
    const box = await pause.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await pause.click();
    await expect(page.getByRole("button", { name: "Play the reel" })).toBeVisible();
    // Scroll a little: a pause the visitor chose is not undone by the scroll.
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(700);
    expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  });

  test("the pause button is on screen and clickable before the reel has opened", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await motionReady(page);
    await page.evaluate(() => {
      const top = document.querySelector(".h-reel")!.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, top + 20);
    });
    const video = page.locator(".h-reel-media video");
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
    const pause = page.getByRole("button", { name: "Pause the reel" });
    await expect(pause).toBeVisible();
    // The button (or its icon) is the topmost thing at its own centre: not clipped away behind
    // the corner window and not covered by the heading area.
    const hit = await pause.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top !== null && el.contains(top);
    });
    expect(hit).toBe(true);
    await pause.click();
    await expect(page.getByRole("button", { name: "Play the reel" })).toBeVisible();
  });

  test("below 810 px it is an inline 16:9 video that starts only on play", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const reel = page.locator(".h-reel");
    await expect(reel).not.toHaveClass(/is-scrub/);
    const video = page.locator(".h-reel-media video");
    const box = await video.boundingBox();
    expect(Math.abs(box!.width / box!.height - 16 / 9)).toBeLessThan(0.02);
    await video.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    await page.getByRole("button", { name: "Play the reel" }).click();
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
    await expect(page.getByRole("button", { name: "Pause the reel" })).toBeVisible();
  });
});

test.describe("reduced motion (AC-8)", () => {
  test.use({ reducedMotion: "reduce" });

  test("nothing loops, scrubs or splits, and all the content is visible", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await motionReady(page);
    // A still fan (on its wheel, no loop), so no pause button.
    await page.waitForTimeout(2500);
    await expect(page.getByRole("button", { name: /card animation/ })).toHaveCount(0);
    const angle = await cardAngle(page);
    await page.waitForTimeout(1200);
    expect(await cardAngle(page)).toBe(angle);
    // No word splitting, no pinned reel, no smooth scroll.
    await expect(page.locator(".h-w-mask")).toHaveCount(0);
    await expect(page.locator(".h-reel")).not.toHaveClass(/is-scrub/);
    expect(await page.evaluate(() => document.documentElement.classList.contains("lenis"))).toBe(
      false,
    );
    // Entrance elements are visible without scrolling to them.
    for (const el of await page.locator("[data-enter]").all()) {
      await expect(el).toHaveCSS("opacity", "1");
    }
    // The reel does not play by itself.
    await page.locator(".h-reel").scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    expect(
      await page.locator(".h-reel-media video").evaluate((v: HTMLVideoElement) => v.paused),
    ).toBe(true);
    // The bar still changes state, with no transition.
    await scrollTo(page, 400);
    await expect(page.locator("header#nav")).toHaveClass(/is-float/);
    await expect(page.locator("header#nav")).toHaveCSS("transition-duration", "0s");
  });
});

test.describe("signed in pages do not load the animation libraries", () => {
  /** Every script a page loads, as text. */
  async function scriptsOf(page: Page, visit: () => Promise<void>): Promise<string[]> {
    const bodies: Promise<string>[] = [];
    page.on("response", (response) => {
      if (!(response.headers()["content-type"] ?? "").includes("javascript")) return;
      bodies.push(response.text().catch(() => ""));
    });
    await visit();
    await page.waitForLoadState("networkidle");
    return Promise.all(bodies);
  }
  const MARKERS = /ScrollTrigger|GreenSock|lenis|WebGLRenderer/i;

  test("the signed out homepage does (so the check can see them)", async ({ page }) => {
    const scripts = await scriptsOf(page, async () => {
      await page.goto("/");
      await expect(page.locator(".h-fan.is-fan")).toHaveCount(1);
    });
    expect(scripts.some((s) => MARKERS.test(s))).toBe(true);
  });

  test("the library and a take page load none", async ({ page, baseURL }) => {
    const { user, cleanup } = await signIn(page.context(), baseURL!);
    try {
      const [id] = await seedTakes(user.id, [
        { title: "Interview", status: "ready", durationMs: 5000 },
      ]);
      const scripts = await scriptsOf(page, async () => {
        await page.goto("/library");
        await expect(page.getByRole("heading", { name: "Your takes", level: 1 })).toBeVisible();
        await page.goto(`/takes/${id}`);
        await expect(page.getByRole("heading", { name: "Interview" })).toBeVisible();
      });
      expect(scripts.length).toBeGreaterThan(3);
      expect(scripts.filter((s) => MARKERS.test(s))).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });
});
