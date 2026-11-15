import { expect, type Page } from "@playwright/test";

export const field = (page: Page) => page.locator("canvas.h-studio-field");

/**
 * A capable device: 8 GB of memory, whatever the machine running the test reports (a small
 * runner reports 2, which would, rightly, switch the field off).
 */
export const capable = (page: Page) =>
  page.addInitScript(`Object.defineProperty(navigator, "deviceMemory", { value: 8 });`);

/** Scrolls so the studio section's top is `offset` px below the top of the viewport. */
export const scrollToStudio = (page: Page, offset: number) =>
  page.evaluate((o) => {
    const top = document.querySelector(".h-studio")!.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, top - o);
  }, offset);

export async function open(page: Page) {
  await page.goto("/");
  await expect(page.locator(".h-fan.is-fan")).toHaveCount(1);
}
