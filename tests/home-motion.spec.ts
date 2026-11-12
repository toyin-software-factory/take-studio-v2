import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./support/session";
import { seedTakes } from "./support/takes";

// The homepage motion (spec 0010 task 2: AC-4, AC-5, AC-8) and that signed in pages never load
// the animation libraries (spec 0009 AC-9).
test.describe.configure({ timeout: 90_000 });

const scrollTo = (page: Page, y: number) => page.evaluate((top) => window.scrollTo(0, top), y);

/** The first fan card's rotation, in degrees, from its computed transform. */
const cardAngle = (page: Page) =>
  page.evaluate(() => {
    const card = document.querySelector(".h-fan-card");
    if (!card) return null;
    const m = new DOMMatrixReadOnly(getComputedStyle(card).transform);
    return Math.round(Math.atan2(m.b, m.a) * (180 / Math.PI) * 100) / 100;
  });

/** Waits for the page's motion to start: the fan is on its wheel and the loop's button is there. */
async function motionReady(page: Page) {
  await page.goto("/");
  await expect(page.locator(".h-fan.is-fan")).toHaveCount(1);
}

test.describe("nav (AC-4)", () => {
  test("floats into the pill after 202 px and back, and goes dark over a dark section", async ({
    page,
  }) => {
    await motionReady(page);
    const nav = page.locator("header#nav");
    await expect(nav).not.toHaveClass(/is-float/);
    await scrollTo(page, 150);
    await expect(nav).not.toHaveClass(/is-float/);
    await scrollTo(page, 400);
    await expect(nav).toHaveClass(/is-float/);
    await expect(nav).not.toHaveClass(/is-dark/);
    // The studio floor is a dark section: with its top under the bar the bar turns dark.
    await page.evaluate(() => {
      const top = document.querySelector("#studio")!.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, top + 200);
    });
    await expect(nav).toHaveClass(/is-dark/);
    await scrollTo(page, 0);
    await expect(nav).not.toHaveClass(/is-float/);
    await expect(nav).not.toHaveClass(/is-dark/);
  });
});

test.describe("menu dialog on a phone (AC-4)", () => {
  test("opens a full screen dialog that traps focus, closes on Escape and returns focus", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const burger = page.getByRole("button", { name: "Open menu" });
    await expect(burger).toBeVisible();
    // Under 810 px the bar shows the logo, a short call to action and the menu button only.
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
    await expect(page.getByRole("link", { name: "Start" })).toBeVisible();

    await burger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Menu" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("link", { name: "how it works" })).toBeVisible();
    // Tab round the whole dialog and a few more: focus never leaves it.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => !!document.activeElement?.closest("dialog"));
      expect(inside, `Tab ${i + 1}`).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(burger).toBeFocused();
  });

  test("choosing a link closes the dialog and goes to the section", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    const dialog = page.getByRole("dialog", { name: "Menu" });
    await dialog.getByRole("link", { name: "faq" }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  });
});

test.describe("hero fan (AC-5)", () => {
  test("turns, and the pause button stops and restarts it (and holds for the visit)", async ({
    page,
  }) => {
    await motionReady(page);
    const pause = page.getByRole("button", { name: "Pause the card animation" });
    await expect(pause).toBeVisible();
    const box = await pause.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);

    // The loop starts about 1.7 s in: wait for the angle to change.
    const first = await cardAngle(page);
    await expect.poll(() => cardAngle(page), { timeout: 15_000 }).not.toBe(first);

    await pause.focus();
    await page.keyboard.press("Enter");
    const play = page.getByRole("button", { name: "Play the card animation" });
    await expect(play).toBeVisible();
    await page.waitForTimeout(300);
    const frozen = await cardAngle(page);
    await page.waitForTimeout(900);
    expect(await cardAngle(page)).toBe(frozen);

    // The choice holds for the visit: after a reload the fan is still paused.
    await page.reload();
    await expect(page.getByRole("button", { name: "Play the card animation" })).toBeVisible();
    await page.waitForTimeout(3000);
    const held = await cardAngle(page);
    await page.waitForTimeout(900);
    expect(await cardAngle(page)).toBe(held);

    await page.getByRole("button", { name: "Play the card animation" }).click();
    await expect(page.getByRole("button", { name: "Pause the card animation" })).toBeVisible();
    await expect.poll(() => cardAngle(page), { timeout: 15_000 }).not.toBe(held);
  });

  test("pauses while the fan is out of view", async ({ page }) => {
    await motionReady(page);
    // Past the opening (900 ms plus 800 ms) and the loop's own 1.7 s delay: it is turning.
    await page.waitForTimeout(3500);
    const turning = await cardAngle(page);
    await expect.poll(() => cardAngle(page), { timeout: 10_000 }).not.toBe(turning);
    await scrollTo(page, 3000);
    await page.waitForTimeout(500);
    const away = await cardAngle(page);
    await page.waitForTimeout(1200);
    expect(await cardAngle(page)).toBe(away);
  });
});

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
  const MARKERS = /ScrollTrigger|GreenSock|lenis/i;

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
        await page.goto("/");
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
