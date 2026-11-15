import { expect, type Page } from "@playwright/test";

/** Animations and transitions still running (an infinite one counts as running forever). */
export const running = (page: Page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === "running")
      .map((a) => {
        const timing = a.effect?.getComputedTiming();
        const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
        return `${target?.tagName.toLowerCase() ?? "?"} ${a.constructor.name} ${timing?.iterations}`;
      }),
  );

/**
 * With reduced motion on, the global CSS block cuts every duration to about 1 ms and every
 * animation to one run, so after a short settle nothing may be running.
 */
export async function expectNoMotion(page: Page) {
  await expect
    .poll(() => running(page), { message: "running animations", timeout: 30_000 })
    .toEqual([]);
}
