import { expect, test, type Page } from "@playwright/test";

// The studio floor (spec 0010 task 3: AC-6, AC-8, AC-10): the lazy Three.js particle field, its
// fallbacks, the giant words, the scroll fill lines and the arc.
test.describe.configure({ timeout: 90_000 });

/** Scripts the page loads, as text, collected from the first call on. */
function collectScripts(page: Page): Promise<string>[] {
  const bodies: Promise<string>[] = [];
  // From the moment a script request STARTS (not when its answer arrives), so a request that is
  // sent early but answered late is still counted when the bodies are awaited.
  page.on("request", (request) => {
    if (request.resourceType() !== "script") return;
    bodies.push(
      request
        .response()
        .then((response) => (response ? response.text().catch(() => "") : ""))
        .catch(() => ""),
    );
  });
  return bodies;
}
const loadedThree = async (bodies: Promise<string>[]) =>
  (await Promise.all(bodies)).some((body) => /WebGLRenderer/.test(body));

const field = (page: Page) => page.locator("canvas.h-studio-field");

/** Counts WebGL context requests, so a test can see when the page first asks for one. */
const PROBE_COUNTER = `window.__glProbes = 0;
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (/webgl/.test(String(type))) window.__glProbes += 1;
    return get.call(this, type, ...rest);
  };`;
const probes = (page: Page) =>
  page.evaluate(() => (window as unknown as { __glProbes: number }).__glProbes);

/**
 * A capable device: 8 GB of memory, whatever the machine running the test reports (a small
 * runner reports 2, which would, rightly, switch the field off).
 */
const capable = (page: Page) =>
  page.addInitScript(`Object.defineProperty(navigator, "deviceMemory", { value: 8 });`);

/** Scrolls so the studio section's top is `offset` px below the top of the viewport. */
const scrollToStudio = (page: Page, offset: number) =>
  page.evaluate((o) => {
    const top = document.querySelector(".h-studio")!.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, top - o);
  }, offset);

async function open(page: Page) {
  await page.goto("/");
  await expect(page.locator(".h-fan.is-fan")).toHaveCount(1);
}

test.describe("the particle field loads lazily (AC-6, AC-10)", () => {
  test.beforeEach(async ({ page }) => capable(page));
  test("three is not fetched until the section is within one viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const bodies = collectScripts(page);
    await open(page);
    await page.waitForTimeout(1500);
    expect(await loadedThree(bodies)).toBe(false);
    expect(await field(page).getAttribute("data-field")).toBeNull();
    // Still more than a viewport away: nothing yet.
    await scrollToStudio(page, 2200);
    await page.waitForTimeout(1000);
    expect(await loadedThree(bodies)).toBe(false);
    // Within one viewport of the section entering: the chunk is fetched and the field starts.
    await scrollToStudio(page, 1100);
    await expect(field(page)).toHaveAttribute("data-field", "ready", { timeout: 30_000 });
    expect(await loadedThree(bodies)).toBe(true);
    // At most 24,000 points on desktop.
    expect(Number(await field(page).getAttribute("data-field-points"))).toBe(24_000);
  });

  test("the WebGL probe waits until the section is near", async ({ page }) => {
    await page.addInitScript(PROBE_COUNTER);
    await page.setViewportSize({ width: 1280, height: 720 });
    await open(page);
    await page.waitForTimeout(1500);
    expect(await probes(page)).toBe(0);
    await scrollToStudio(page, 1100);
    await expect(field(page)).toHaveAttribute("data-field", "ready", { timeout: 30_000 });
    expect(await probes(page)).toBeGreaterThan(0);
  });

  test("a chunk that fails to load leaves the glow and no half started state", async ({ page }) => {
    await page.route(/\.js(\?|$)/, async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      if (/WebGLRenderer/.test(body)) return route.abort();
      return route.fulfill({ response, body });
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await open(page);
    await scrollToStudio(page, 1100);
    await expect(field(page)).toHaveAttribute("data-field", "skipped", { timeout: 30_000 });
    await expect(field(page)).toHaveAttribute("data-field-reason", "load-failed");
    await expect(field(page)).toHaveCSS("background-image", /radial-gradient/);
  });

  test("8,000 points under 810 px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await scrollToStudio(page, 1200);
    await expect(field(page)).toHaveAttribute("data-field", "ready", { timeout: 30_000 });
    expect(Number(await field(page).getAttribute("data-field-points"))).toBe(8_000);
  });

  test("draws only while the section is on screen, at a workable frame time", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await open(page);
    await scrollToStudio(page, 200);
    await expect(field(page)).toHaveAttribute("data-field", "ready", { timeout: 30_000 });
    const frames = async () => Number((await field(page).getAttribute("data-field-frames")) ?? 0);
    const before = await frames();
    await page.waitForTimeout(1000);
    expect(await frames()).toBeGreaterThan(before);
    // Frame time while it draws (software GL on a CI runner: a generous limit, the number is
    // recorded in the test report).
    const ms = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let n = 0;
          const t0 = performance.now();
          const step = () => {
            n += 1;
            if (n < 60) requestAnimationFrame(step);
            else resolve((performance.now() - t0) / n);
          };
          requestAnimationFrame(step);
        }),
    );
    test.info().annotations.push({ type: "average frame ms", description: ms.toFixed(1) });
    expect(ms).toBeLessThan(120);
    // Scrolled away: the loop stops drawing.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
    const away = await frames();
    await page.waitForTimeout(1000);
    expect(await frames()).toBe(away);
  });

  test("is disposed when the page is left (client side navigation)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await open(page);
    await scrollToStudio(page, 200);
    await expect(field(page)).toHaveAttribute("data-field", "ready", { timeout: 30_000 });
    await page.evaluate(() => {
      (window as unknown as { kept: Element }).kept =
        document.querySelector("canvas.h-studio-field")!;
    });
    await page.locator("footer").getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 45_000 });
    const state = await page.evaluate(
      () => (window as unknown as { kept: HTMLElement }).kept.dataset.field,
    );
    expect(state).toBe("disposed");
  });
});

test.describe("fallbacks keep the CSS glow and never fetch three (AC-6)", () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    [
      "save data is on",
      "save-data",
      `Object.defineProperty(navigator, "connection", { value: { saveData: true } });`,
    ],
    [
      "device memory is under 4 GB",
      "low-memory",
      `Object.defineProperty(navigator, "deviceMemory", { value: 2 });`,
    ],
    [
      "WebGL is missing",
      "no-webgl",
      `Object.defineProperty(navigator, "deviceMemory", { value: 8 });
       const get = HTMLCanvasElement.prototype.getContext;
       HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
         return /webgl/.test(String(type)) ? null : get.call(this, type, ...rest);
       };`,
    ],
  ];
  for (const [name, reason, script] of cases) {
    test(`when ${name}`, async ({ page }) => {
      await page.addInitScript(PROBE_COUNTER);
      await page.addInitScript(script);
      await page.setViewportSize({ width: 1280, height: 720 });
      const bodies = collectScripts(page);
      await open(page);
      await scrollToStudio(page, 200);
      await expect(field(page)).toHaveAttribute("data-field", "skipped");
      await expect(field(page)).toHaveAttribute("data-field-reason", reason);
      await page.waitForTimeout(800);
      expect(await loadedThree(bodies)).toBe(false);
      // The cheap limits are enough: no WebGL context is created just to find out.
      if (reason !== "no-webgl") expect(await probes(page)).toBe(0);
      // The glow is the canvas's own background.
      await expect(field(page)).toHaveCSS("background-image", /radial-gradient/);
    });
  }
});

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
