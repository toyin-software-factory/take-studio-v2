import { expect, type Page } from "@playwright/test";

export const ready = async (page: Page) => {
  await page.goto("/");
  await expect(page.locator("html.js")).toHaveCount(1, { timeout: 20_000 });
};
