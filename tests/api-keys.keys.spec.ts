import { test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { signIn } from "./support/session";
import { dismiss, expect, makeKey } from "./fixtures/api-keys";

let cleanup: (() => Promise<void>) | undefined;

test.beforeEach(async ({ page, baseURL }) => {
  ({ cleanup } = await signIn(page.context(), baseURL!));
});

test.afterEach(async () => {
  await cleanup?.();
});

/** The page also holds the connected apps list, so a live region is found inside its own section. */
const newKeyPanel = (page: Page) => page.getByRole("region", { name: /^Your new key/ });

test("the user menu opens the API keys screen, which starts empty", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "API keys" }).click();
  await expect(page).toHaveURL(/\/account\/api-keys$/);
  await expect(page.getByRole("heading", { level: 1, name: "API keys" })).toBeVisible();
  await expect(page).toHaveTitle("API keys · Take Studio");
  await expect(page.getByText("You have no API keys yet.")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expectNoSeriousAxeIssues(page);
});

test("signed out, the screen goes to sign in", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto("/account/api-keys");
  await expect(page).toHaveURL(/\/sign-in/);
  await context.close();
});

test("create by keyboard, copy, save: the key is shown once and never kept", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/account/api-keys");

  const key = await makeKey(page, "Zapier");
  expect(key).toMatch(/^tsk_[A-Za-z0-9_-]{43}$/);
  // Focus moved to the panel's heading, and the key wraps in a full width field.
  await expect(page.getByRole("heading", { name: "Your new key: Zapier" })).toBeFocused();
  await expect(page.getByText("Copy this key now. You won't see it again.")).toBeVisible();
  await expect(page.getByLabel("Key name")).toBeDisabled();
  await expectNoSeriousAxeIssues(page);

  await page.getByRole("button", { name: "Copy key" }).click();
  await expect(newKeyPanel(page).getByRole("status")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key);

  await dismiss(page);
  await expect(page.getByLabel("Key name")).toBeFocused();
  await expect(page.getByLabel("Key name")).toBeEnabled();

  // The row shows the name, the prefix and "Never used"; the raw key is nowhere in the page.
  const row = page.getByRole("listitem").filter({ hasText: "Zapier" });
  await expect(row.getByText("Never used")).toBeVisible();
  await expect(row.getByText(`${key.slice(4, 12)}…`)).toBeVisible();
  expect(await page.content()).not.toContain(key);
  const stored = await page.evaluate(() =>
    JSON.stringify([{ ...localStorage }, { ...sessionStorage }, location.href, document.cookie]),
  );
  expect(stored).not.toContain(key);

  // A reload does not bring it back; the list still has the key (prefix only).
  await page.reload();
  expect(await page.content()).not.toContain(key);
  await expect(page.getByRole("listitem").filter({ hasText: "Zapier" })).toBeVisible();
});

test("a denied Clipboard API selects the key and says how to copy it", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
  });
  await page.goto("/account/api-keys");
  await makeKey(page, "No clipboard");
  await page.getByRole("button", { name: "Copy key" }).click();
  await expect(newKeyPanel(page).getByRole("status")).toContainText("press Ctrl+C or Cmd+C");
  await expect(page.getByLabel("New API key")).toBeFocused();
  const selected = await page.evaluate(() => {
    const el = document.getElementById("new-key-value") as HTMLTextAreaElement;
    return el.value.slice(el.selectionStart, el.selectionEnd) === el.value;
  });
  expect(selected).toBe(true);
});

test("leaving with an unsaved key asks first, and not after saving", async ({ page }) => {
  await page.goto("/account/api-keys");
  // The page's own beforeunload handler: it cancels the event while the key is on screen.
  const asksBeforeLeaving = () =>
    page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
  expect(await asksBeforeLeaving()).toBe(false);
  await makeKey(page, "Unsaved");
  expect(await asksBeforeLeaving()).toBe(true);
  await dismiss(page);
  expect(await asksBeforeLeaving()).toBe(false);
});

test("a bad name shows an error linked to the field", async ({ page }) => {
  await page.goto("/account/api-keys");
  const field = page.getByLabel("Key name");
  await field.fill("   ");
  await page.keyboard.press("Enter");
  const error = page.getByText("Enter a name between 1 and 60 characters.");
  await expect(error).toBeVisible();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAttribute("aria-describedby", /api-key-name-error/);
  await field.fill("a".repeat(61));
  await page.keyboard.press("Enter");
  await expect(error).toBeVisible();
  await expectNoSeriousAxeIssues(page);
});

test("the 6th key is refused with the limit message", async ({ page }) => {
  await page.goto("/account/api-keys");
  for (const n of [1, 2, 3, 4, 5]) {
    await makeKey(page, `Key ${n}`);
    await dismiss(page);
  }
  await page.getByLabel("Key name").fill("One too many");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "You already have 5 keys" })).toHaveText(
    "You already have 5 keys. Revoke one to make another.",
  );
  await expect(page.getByLabel("New API key")).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(5);
  await expectNoSeriousAxeIssues(page);
});
