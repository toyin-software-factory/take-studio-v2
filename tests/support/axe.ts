import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * Waits until no CSS transition or animation is running that will finish. A colour caught in the
 * middle of a fade (a tab losing its selected colour, a panel fading in) is a blend that axe
 * would count as low contrast, e.g. 4.45 for #656565 on #e1e1e1. Infinite animations are
 * skipped: they never settle, and the page is checked as it is.
 */
async function waitForAnimationsToSettle(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .every(
          (a) => a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity,
        ),
    undefined,
    { timeout: 10_000 },
  );
}

/** axe at WCAG 2.2 AA: no serious or critical issues on the page as it is now. */
export async function expectNoSeriousAxeIssues(page: Page): Promise<void> {
  await waitForAnimationsToSettle(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

/**
 * axe on a page that moves (the homepage): scroll through it once so every entrance has been
 * triggered, then check again and again until the animations have settled. A frame caught in the
 * middle of a fade has a blended colour that axe would count as low contrast, so only the
 * settled result counts; if it never clears, the last violations are in the failure message.
 */
export async function expectNoSeriousAxeIssuesWhenSettled(page: Page): Promise<void> {
  // The motion starts after hydration, from a dynamic import; it sets `html.js` as it starts and
  // its entrance observers exist from then on. Scrolling any earlier could pass a target by.
  await page.waitForFunction(() => document.documentElement.classList.contains("js"));
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.8);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    window.scrollTo(0, 0);
  });
  await expect
    .poll(
      async () => {
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        return results.violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map(
            (v) =>
              `${v.id}: ${v.nodes
                .slice(0, 3)
                .map((n) => `${n.target.join(" ")} (${(n.any[0]?.message ?? "").slice(0, 100)})`)
                .join("; ")}`,
          );
      },
      { timeout: 25_000, intervals: [500, 1000, 1500] },
    )
    .toEqual([]);
}
