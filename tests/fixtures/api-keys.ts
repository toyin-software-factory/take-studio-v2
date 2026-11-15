import { expect as baseExpect, type Page } from "@playwright/test";

// The "API keys" screen (spec 0018 AC-12, step 7): from the user menu, create by keyboard, the
// show once panel and its copy flow, the 5 key limit, revoke with a confirm, axe, phone width.
// The key routes are real (session cookie, same origin); only the Clipboard API is replaced
// where a test needs it to be denied.

export const expect = baseExpect.configure({ timeout: 15_000 });

/** Makes a key through the form, by keyboard, and returns the raw key from the panel. */
export async function makeKey(page: Page, name: string): Promise<string> {
  await page.getByLabel("Key name").fill(name);
  await page.keyboard.press("Enter");
  const field = page.getByLabel("New API key");
  await expect(field).toBeVisible();
  return field.inputValue();
}

export async function dismiss(page: Page) {
  await page.getByRole("button", { name: "I have saved it" }).click();
  await expect(page.getByLabel("New API key")).toHaveCount(0);
}
