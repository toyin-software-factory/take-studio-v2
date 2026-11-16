import { expect, type Page } from "@playwright/test";

/** An animation or transition longer than this, in ms, is not reduced motion (the rule sets about 1). */
export const MAX_REDUCED_MS = 50;

type Seen = { readonly label: string; readonly running: boolean; readonly long: boolean };

/** Every animation and transition on the page now, running or not, with whether its timing is too long. */
export const animations = (page: Page, maxMs: number = MAX_REDUCED_MS): Promise<Seen[]> =>
  page.evaluate(
    (limit) =>
      document.getAnimations().map((a) => {
        const t = a.effect?.getComputedTiming();
        const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
        const end = Number(t?.endTime ?? 0);
        return {
          label: `${target?.tagName.toLowerCase() ?? "?"} ${a.constructor.name} ${t?.duration}ms x${t?.iterations}`,
          running: a.playState === "running",
          long: end > limit || Number(t?.iterations ?? 1) > 1,
        };
      }),
    maxMs,
  );

/**
 * With reduced motion on, the global CSS block cuts every duration to about 1 ms and every
 * animation to one run. Polling until nothing runs only waits for the page to settle; every
 * animation seen on the way is also checked against the limit, so a 2 second animation that
 * simply finishes still fails.
 */
export async function expectNoMotion(page: Page) {
  const tooLong = new Set<string>();
  await expect
    .poll(
      async () => {
        const seen = await animations(page);
        for (const a of seen) if (a.long) tooLong.add(a.label);
        return seen.filter((a) => a.running).map((a) => a.label);
      },
      { message: "running animations", timeout: 30_000 },
    )
    .toEqual([]);
  expect([...tooLong], "animations longer than the reduced motion limit").toEqual([]);
}
