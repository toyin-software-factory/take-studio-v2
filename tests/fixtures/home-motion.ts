import { expect, type Page } from "@playwright/test";

export const scrollTo = (page: Page, y: number) =>
  page.evaluate((top) => window.scrollTo(0, top), y);

/** The first fan card's rotation, in degrees, from its computed transform. */
export const cardAngle = (page: Page) =>
  page.evaluate(() => {
    const card = document.querySelector(".h-fan-card");
    if (!card) return null;
    const m = new DOMMatrixReadOnly(getComputedStyle(card).transform);
    return Math.round(Math.atan2(m.b, m.a) * (180 / Math.PI) * 100) / 100;
  });

/** Waits for the page's motion to start: the fan is on its wheel and the loop's button is there. */
export async function motionReady(page: Page) {
  await page.goto("/");
  await expect(page.locator(".h-fan.is-fan")).toHaveCount(1);
}
