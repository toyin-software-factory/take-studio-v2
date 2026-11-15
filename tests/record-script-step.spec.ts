import { expect as baseExpect, test } from "@playwright/test";
import { signIn } from "./support/session";

// The Script step of /record (B2-T127): Clear with Undo, the Follow my voice row, the shell nav.
const expect = baseExpect.configure({ timeout: 30_000 });
test.describe.configure({ timeout: 90_000 });

let cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

test.beforeEach(async ({ page, baseURL }) => {
  const { cleanup } = await signIn(page.context(), baseURL ?? "");
  cleanups.push(cleanup);
  await page.route("**/api/backgrounds", (r) =>
    r.fulfill({ json: { builtIn: [], mine: [], defaultId: null } }),
  );
  await page.goto("/record");
});

test("Clear empties the script and Undo brings it back", async ({ page }) => {
  const script = page.getByLabel("Script (optional)");
  await script.fill("Hello to the lens");
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(script).toHaveValue("");
  const toast = page.getByRole("status").filter({ hasText: "Script cleared" });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(script).toHaveValue("Hello to the lens");
});

test("Clear on an empty script does nothing", async ({ page }) => {
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByText("Script cleared")).toHaveCount(0);
});

test("Follow my voice is off by default and asks before it turns on", async ({ page }) => {
  const toggle = page.getByRole("switch", { name: "Follow my voice" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("the sidebar shows Backgrounds and Settings as Soon, not as links", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Main" }).first();
  await expect(nav.getByRole("link", { name: "Takes" })).toBeVisible();
  await expect(nav.getByRole("link", { name: /API and agents/ })).toBeVisible();
  for (const name of ["Backgrounds", "Settings"]) {
    await expect(nav.getByRole("link", { name })).toHaveCount(0);
    await expect(nav.getByText(name)).toBeVisible();
  }
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Record");
});
