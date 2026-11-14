import { devices, expect as baseExpect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { signIn } from "./support/session";

// The "API keys" screen (spec 0018 AC-12, step 7): from the user menu, create by keyboard, the
// show once panel and its copy flow, the 5 key limit, revoke with a confirm, axe, phone width.
// The key routes are real (session cookie, same origin); only the Clipboard API is replaced
// where a test needs it to be denied.

const expect = baseExpect.configure({ timeout: 15_000 });

let cleanup: (() => Promise<void>) | undefined;
test.beforeEach(async ({ page, baseURL }) => {
  ({ cleanup } = await signIn(page.context(), baseURL!));
});
test.afterEach(async () => {
  await cleanup?.();
});

/** Makes a key through the form, by keyboard, and returns the raw key from the panel. */
async function makeKey(page: Page, name: string): Promise<string> {
  await page.getByLabel("Key name").fill(name);
  await page.keyboard.press("Enter");
  const field = page.getByLabel("New API key");
  await expect(field).toBeVisible();
  return field.inputValue();
}

async function dismiss(page: Page) {
  await page.getByRole("button", { name: "I have saved it" }).click();
  await expect(page.getByLabel("New API key")).toHaveCount(0);
}

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
  await expect(page.getByRole("status")).toHaveText("Copied");
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
  await expect(page.getByRole("status")).toContainText("press Ctrl+C or Cmd+C");
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

test("revoke: Escape and Keep it return focus; Revoke removes the row", async ({ page }) => {
  await page.goto("/account/api-keys");
  await makeKey(page, "Old key");
  await dismiss(page);
  await makeKey(page, "Other key");
  await dismiss(page);

  const revoke = page.getByRole("button", { name: "Revoke key Old key" });
  await revoke.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Revoke this key?" });
  await expect(dialog.getByText("Old key")).toBeVisible();
  await expectNoSeriousAxeIssues(page);
  for (const key of ["Tab", "Tab", "Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
    await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(revoke).toBeFocused();

  await revoke.click();
  await dialog.getByRole("button", { name: "Keep it" }).click();
  await expect(revoke).toBeFocused();

  await revoke.click();
  await dialog.getByRole("button", { name: "Revoke key" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: "Old key" })).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: "Other key" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your keys" })).toBeFocused();
  // Gone for good: a reload still lacks it.
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: "Old key" })).toHaveCount(0);
});

test("a failed revoke keeps the dialog open with an alert", async ({ page }) => {
  await page.goto("/account/api-keys");
  await makeKey(page, "Stubborn");
  await dismiss(page);
  await page.route(/\/api\/keys\/[^/?]+$/, (route) =>
    route.fulfill({ status: 500, json: { error: "x", message: "x" } }),
  );
  await page.getByRole("button", { name: "Revoke key Stubborn" }).click();
  await page.getByRole("button", { name: "Revoke key", exact: true }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("We couldn't revoke the key.");
  await expect(alert).toBeFocused();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test.describe("phone width", () => {
  test.use({ viewport: devices["iPhone 13"].viewport, hasTouch: true, isMobile: true });

  test("the flow holds at 390 px: 44 px targets, no sideways scroll, axe", async ({ page }) => {
    await page.goto("/account/api-keys");
    const long = "A fairly long key name that has to wrap on a phone".slice(0, 50);
    await makeKey(page, long);
    await expectNoSeriousAxeIssues(page);
    for (const name of ["Copy key", "I have saved it"]) {
      const box = await page.getByRole("button", { name }).boundingBox();
      expect(box!.height, name).toBeGreaterThanOrEqual(44);
    }
    await dismiss(page);
    const revoke = await page.getByRole("button", { name: `Revoke key ${long}` }).boundingBox();
    expect(revoke!.height).toBeGreaterThanOrEqual(44);
    const make = await page.getByRole("button", { name: "Make a key" }).boundingBox();
    expect(make!.height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expectNoSeriousAxeIssues(page);
  });
});
