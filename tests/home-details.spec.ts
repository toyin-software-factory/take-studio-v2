import { expect, test, type Page } from "@playwright/test";

// The homepage details (spec 0010 task 4: AC-5, AC-7, AC-8, AC-9): tile video controls, flip
// counters that keep the real number, the FAQ panel motion and reduced motion.
test.describe.configure({ timeout: 90_000 });

const ready = async (page: Page) => {
  await page.goto("/");
  await expect(page.locator("html.js")).toHaveCount(1, { timeout: 20_000 });
};

test("each tile video has a labelled play button of at least 44 px", async ({ page }) => {
  await ready(page);
  const buttons = page.locator(".h-tile-toggle");
  await expect(buttons).toHaveCount(3);
  for (const button of await buttons.all()) {
    await expect(button).toHaveAccessibleName(/^(Play|Pause) the .+ loop$/);
    const box = await button.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});

test("a tile's button plays and pauses its video and a chosen pause is kept", async ({ page }) => {
  await ready(page);
  const tile = page.locator(".h-tile-media").first();
  await tile.scrollIntoViewIfNeeded();
  const button = tile.locator(".h-tile-toggle");
  const video = tile.locator("video");
  // With a mouse the tile plays while the pointer is on it, so the button then shows Pause.
  await tile.hover();
  await expect(tile).toHaveAttribute("data-playing", "true");
  await expect(button).toHaveAccessibleName(/^Pause /);
  // The cursor disc over a tile says what a click will do, and follows the video without a move.
  await page.mouse.move(5, 5);
  await tile.hover();
  await expect(page.locator(".h-cursor.is-play")).toHaveText("Pause");
  await button.click();
  await expect(tile).toHaveAttribute("data-playing", "false");
  await expect(video).toHaveAttribute("data-user-paused", "1");
  // Hovering again does not undo a pause the visitor chose.
  await page.mouse.move(0, 0);
  await tile.hover();
  await expect(tile).toHaveAttribute("data-playing", "false");
});

test("a tile keeps playing while it has keyboard focus after the pointer leaves", async ({
  page,
}) => {
  await ready(page);
  const tile = page.locator(".h-tile-media").nth(1);
  await tile.scrollIntoViewIfNeeded();
  await tile.locator(".h-tile-toggle").focus();
  await expect(tile).toHaveAttribute("data-playing", "true");
  await tile.hover();
  await page.mouse.move(2, 2);
  await expect(tile).toHaveAttribute("data-playing", "true");
  // Moving focus away with the pointer also away ends it.
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  await expect(tile).toHaveAttribute("data-playing", "false");
});

test("flip counters keep the real number in the page", async ({ page }) => {
  await ready(page);
  const stat = page.locator(".h-stat-num").first();
  await stat.scrollIntoViewIfNeeded();
  await expect(stat.locator(".h-flip")).toHaveAttribute("aria-hidden", "true");
  await expect(stat).toContainText(/\d/);
  await expect(page.locator("#limits")).toContainText("1080");
});

test("a FAQ answer opens with the panel row growing and closes again", async ({ page }) => {
  await ready(page);
  const trigger = page.locator(".h-acc-trigger").first();
  await trigger.scrollIntoViewIfNeeded();
  const panel = page.locator(".h-acc-panel").first();
  await expect(panel).toHaveCSS("grid-template-rows", "0px");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(panel.locator(".h-acc-inner")).toBeVisible();
  await trigger.click();
  await expect(panel.locator(".h-acc-inner")).toBeHidden();
});

test.describe("drift rows on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("each row is one line that slides with the scroll and the page does not scroll sideways", async ({
    page,
  }) => {
    await ready(page);
    const first = page.locator(".h-drift").first();
    await expect(first).toHaveClass(/is-drift/, { timeout: 20_000 });
    await first.scrollIntoViewIfNeeded();
    const before = await first.evaluate((el) => getComputedStyle(el).transform);
    await page.mouse.wheel(0, 250);
    await expect
      .poll(() => first.evaluate((el) => getComputedStyle(el).transform))
      .not.toBe(before);
    expect(await first.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(60);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("no flip digits, no cursor, no drift, and tile videos do not start by themselves", async ({
    page,
  }) => {
    await ready(page);
    await expect(page.locator(".h-flip")).toHaveCount(0);
    await expect(page.locator(".h-cursor")).toHaveCount(0);
    await expect(page.locator(".h-drift.is-drift")).toHaveCount(0);
    const tile = page.locator(".h-tile-media").first();
    await tile.scrollIntoViewIfNeeded();
    await tile.hover();
    await expect(tile).toHaveAttribute("data-playing", "false");
  });
});

test("without scripts every FAQ answer is shown and nothing is rolled", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator(".h-acc-inner").first()).toBeVisible();
  await expect(page.locator(".h-flip")).toHaveCount(0);
  await context.close();
});

test("the particle field is clipped to the dark studio floor", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const section = document.querySelector<HTMLElement>("#studio")!;
    const canvas = document.querySelector<HTMLElement>("canvas.h-studio-field")!;
    const clip = canvas.parentElement!;
    const bottom = section.getBoundingClientRect().bottom + window.scrollY;
    // The viewport shows the last 200 px of the section and 400 px of the next one.
    window.scrollTo(0, bottom - 200 - 0);
    await new Promise((r) => setTimeout(r, 300));
    const s = section.getBoundingClientRect();
    const c = clip.getBoundingClientRect();
    return {
      overflow: getComputedStyle(clip).overflow,
      clipBottom: c.bottom,
      sectionBottom: s.bottom,
      clipTop: c.top,
      sectionTop: s.top,
    };
  });
  expect(result.overflow).toBe("clip");
  expect(Math.round(result.clipBottom)).toBe(Math.round(result.sectionBottom));
  expect(Math.round(result.clipTop)).toBe(Math.round(result.sectionTop));
});

// Homepage speed (spec 0010 AC-10): nothing above the fold shifts after the first paint, and the
// headline and lead are in that first paint, not hidden until the intro runs.
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
    await context.close();
  });

  test("the intro never hides or moves the headline and lead", async ({ page }) => {
    await ready(page);
    for (const selector of [".h-h1", ".h-hero-lead", ".h-nav"]) {
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
