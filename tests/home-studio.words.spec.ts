import { expect, test } from "@playwright/test";
import { capable, field, open, scrollToStudio } from "./fixtures/home-studio";

// The studio floor (spec 0010 task 3: AC-6, AC-8, AC-10): the lazy Three.js particle field, its
// fallbacks, the giant words, the scroll fill lines and the arc.
test.describe.configure({ timeout: 90_000 });

test.describe("the words, the fill lines and the arc (AC-6)", () => {
  test.beforeEach(async ({ page }) => capable(page));
  test("one giant word at a time while the stage is pinned", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await open(page);
    await expect(page.locator(".h-studio")).toHaveClass(/is-staged/);
    const opacity = (i: number) =>
      page
        .locator(".h-studio-word")
        .nth(i)
        .evaluate((el) => Number(getComputedStyle(el).opacity));
    const wordsTop = () =>
      page.evaluate(
        () =>
          document.querySelector(".h-studio-words")!.getBoundingClientRect().top + window.scrollY,
      );
    const top = await wordsTop();
    await page.evaluate((y) => window.scrollTo(0, y + 100), top);
    await expect.poll(() => opacity(0)).toBe(1);
    expect(await opacity(1)).toBe(0);
    // A bit past the first third of the block: the second word has taken over.
    await page.evaluate((y) => window.scrollTo(0, y + 720 * 1.3), top);
    await expect.poll(() => opacity(1), { timeout: 5000 }).toBe(1);
    expect(await opacity(0)).toBe(0);
    // The decorative words are hidden from screen readers; the same text is read out once.
    await expect(page.locator(".h-studio-word-stage")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(".h-studio .h-sr-only").first()).toHaveText("Trim, key, caption.");
  });

  test("the nav stays dark over the whole studio floor, including the pinned words", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await open(page);
    const nav = page.locator("header#nav");
    const wordsTop = await page.evaluate(
      () => document.querySelector(".h-studio-words")!.getBoundingClientRect().top + window.scrollY,
    );
    // Deep into the pinned words (the section is 300vh taller than it was before the motion).
    await page.evaluate((y) => window.scrollTo(0, y + 720 * 2.4), wordsTop);
    await expect(nav).toHaveClass(/is-dark/);
    // Back on a light section after it: the dark variant goes.
    await page.evaluate(() => {
      const top =
        document.querySelector("#capabilities")!.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, top + 200);
    });
    await expect(nav).not.toHaveClass(/is-dark/);
  });

  test("the statement lines fill as they scroll up, and stay readable text", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await open(page);
    const line = page.locator("[data-fill]").first();
    const progress = () =>
      line.evaluate(
        (el) =>
          el.style.getPropertyValue("--fill-progress") ||
          getComputedStyle(el).getPropertyValue("--fill-progress"),
      );
    await expect.poll(progress).toMatch(/^0/);
    await line.evaluate((el) => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, top - 720 * 0.2 + 600);
    });
    await expect.poll(progress, { timeout: 8000 }).toMatch(/^100/);
    // The text itself is real, readable text (the white copy over it is aria-hidden).
    await expect(line).toContainText("No editing timeline.");
    await expect(line.locator(".h-fill-top")).toHaveAttribute("aria-hidden", "true");
  });

  test("turning reduced motion on clears a half filled line", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await open(page);
    const line = page.locator("[data-fill]").first();
    // Scroll to where the line is about half filled.
    await line.evaluate((el) => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, top - 720 * 0.8 + 200);
    });
    // A real number above 0 (NaN, from an unset property, fails this), then below 100.
    const progress = () =>
      line.evaluate((el) => parseFloat(el.style.getPropertyValue("--fill-progress")));
    await expect.poll(progress, { timeout: 8000 }).toBeGreaterThan(0);
    const half = await progress();
    expect(Number.isFinite(half)).toBe(true);
    expect(half).toBeLessThan(100);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect
      .poll(() => line.evaluate((el) => el.style.getPropertyValue("--fill-progress")))
      .toBe("");
    await expect(line.locator(".h-fill-top")).toHaveCSS(
      "clip-path",
      /inset\(0px 0(px|%) 0px 0px\)/,
    );
  });

  test("the arc flattens from full height to a quarter as the section arrives", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await open(page);
    const arc = () =>
      page
        .locator(".h-studio")
        .evaluate((el) =>
          Number(
            getComputedStyle(el).getPropertyValue("--arc-k") ||
              el.style.getPropertyValue("--arc-k"),
          ),
        );
    expect(await arc()).toBeCloseTo(1, 1);
    await scrollToStudio(page, 720 * 0.3);
    await expect.poll(arc, { timeout: 8000 }).toBeLessThan(0.3);
  });

  test("the particle field fades out completely before the section's bottom edge arrives", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await open(page);
    // Scrolls so the section's bottom edge is `offset` px below the top of the viewport.
    const scrollToBottomEdge = (offset: number) =>
      page.evaluate((o) => {
        const r = document.querySelector(".h-studio")!.getBoundingClientRect();
        window.scrollTo(0, r.bottom + window.scrollY - o);
      }, offset);
    const opacity = () => field(page).evaluate((el) => Number(getComputedStyle(el).opacity));
    await scrollToBottomEdge(720 * 2.5);
    await expect.poll(opacity, { timeout: 8000 }).toBe(1);
    await scrollToBottomEdge(720 * 1.3);
    await expect.poll(opacity, { timeout: 8000 }).toBeGreaterThan(0);
    await expect.poll(opacity).toBeLessThan(1);
    await scrollToBottomEdge(720);
    await expect.poll(opacity, { timeout: 8000 }).toBe(0);
    await scrollToBottomEdge(720 * 2.5);
    await expect.poll(opacity, { timeout: 8000 }).toBe(1);
  });
});

test.describe("reduced motion (AC-8)", () => {
  test.use({ reducedMotion: "reduce" });
  test.beforeEach(async ({ page }) => capable(page));

  test("one still frame, no ticker, the words and fill lines plain and visible", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await open(page);
    await scrollToStudio(page, 1100);
    await expect(field(page)).toHaveAttribute("data-field", "static", { timeout: 30_000 });
    await page.waitForTimeout(1500);
    // Exactly one frame is ever drawn, however long it stays or scrolls.
    await scrollToStudio(page, 100);
    await page.waitForTimeout(1500);
    expect(await field(page).getAttribute("data-field-frames")).toBe("1");
    // Not staged: the three words are one plain line, all visible.
    await expect(page.locator(".h-studio")).not.toHaveClass(/is-staged/);
    for (const word of ["Trim.", "Key.", "Caption."]) {
      await expect(page.locator(".h-studio-word", { hasText: word })).toBeVisible();
    }
    // The fill lines are fully white from the start; nothing is waiting to be revealed.
    for (const line of await page.locator("[data-fill]").all()) {
      await expect(line.locator(".h-fill-top")).toHaveCSS(
        "clip-path",
        /inset\(0px 0(px|%) 0px 0px\)/,
      );
    }
  });
});

// DV0-T17: the field opens below the heading, as in the draft (docs/design/home-v2.html).
test.describe("the field opens below the heading (DV0-T17)", () => {
  test.beforeEach(async ({ page }) => capable(page));
  for (const [name, viewport] of [
    ["desktop", { width: 1280, height: 642 }],
    ["phone", { width: 390, height: 844 }],
  ] as const) {
    test(`at ${name} the canvas starts under the heading and the heading has two lines`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await open(page);
      await scrollToStudio(page, viewport.height * 0.3);
      const boxes = await page.evaluate(() => {
        const rect = (selector: string) => {
          const r = document.querySelector(selector)!.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom };
        };
        const strong = document.querySelector(".h-studio-intro h2 > .h-w-mask");
        return {
          heading: rect(".h-studio-intro h2"),
          muted: rect(".h-studio-intro .h-muted"),
          canvas: rect("canvas.h-studio-field"),
          strongTop: strong?.getBoundingClientRect().top ?? null,
        };
      });
      // The canvas is below the heading (it never covers it) and the top of the stage is plain.
      expect(boxes.canvas.top).toBeGreaterThanOrEqual(boxes.heading.bottom - 1);
      // The white sentence (the first word directly under the heading) starts below the muted line.
      expect(boxes.strongTop).not.toBeNull();
      expect(boxes.strongTop!).toBeGreaterThanOrEqual(boxes.muted.bottom - 1);
    });
  }

  test("the canvas sticks to the top while the words pin, and goes with the section when scrolling back", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 642 });
    await open(page);
    const canvasTop = () =>
      page.evaluate(
        () => document.querySelector("canvas.h-studio-field")!.getBoundingClientRect().top,
      );
    await scrollToStudio(page, -700);
    await expect.poll(canvasTop).toBe(0);
    await scrollToStudio(page, 400);
    await expect.poll(canvasTop).toBeGreaterThan(300);
  });
});
