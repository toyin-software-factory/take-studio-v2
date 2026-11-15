import { devices, test } from "@playwright/test";
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

test("revoking the key whose panel is open clears the panel and unlocks creating", async ({
  page,
}) => {
  await page.goto("/account/api-keys");
  await makeKey(page, "First key");
  await dismiss(page);
  await makeKey(page, "Second key");
  // The panel belongs to "Second key"; revoking the other key leaves it alone.
  await page.getByRole("button", { name: "Revoke key First key" }).click();
  const dialog = page.getByRole("dialog", { name: "Revoke this key?" });
  await dialog.getByRole("button", { name: "Revoke key" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("New API key")).toBeVisible();
  // Revoking the shown key drops the panel, so the secret is not left beside no key.
  await page.getByRole("button", { name: "Revoke key Second key" }).click();
  await dialog.getByRole("button", { name: "Revoke key" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("New API key")).toHaveCount(0);
  await expect(page.getByLabel("Key name")).toBeEnabled();
});

test("after a revoke, Keep it on the next key still returns focus to its row", async ({ page }) => {
  await page.goto("/account/api-keys");
  await makeKey(page, "Alpha");
  await dismiss(page);
  await makeKey(page, "Beta");
  await dismiss(page);
  const dialog = page.getByRole("dialog", { name: "Revoke this key?" });
  await page.getByRole("button", { name: "Revoke key Alpha" }).click();
  await dialog.getByRole("button", { name: "Revoke key" }).click();
  await expect(dialog).toHaveCount(0);
  const beta = page.getByRole("button", { name: "Revoke key Beta" });
  await beta.click();
  await dialog.getByRole("button", { name: "Keep it" }).click();
  await expect(beta).toBeFocused();
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
