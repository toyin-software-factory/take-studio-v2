import { devices, expect as baseExpect, test } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { seedClient } from "./support/oauth";
import { signIn } from "./support/session";

// Connected apps beside the API keys (spec 0019 AC-14, AC-15, step 8). The list and the
// disconnect use the real routes and a synthetic client with a consent row for a test user.

const expect = baseExpect.configure({ timeout: 15_000 });

const cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((c) => c()));
});

async function setup(page: import("@playwright/test").Page, baseURL: string, connect = true) {
  const { user, cleanup } = await signIn(page.context(), baseURL);
  cleanups.push(cleanup);
  if (connect) {
    const client = await seedClient({
      name: "Synthetic Assistant",
      redirectUris: ["https://assistant.example.test/done"],
      consentFor: user.id,
    });
    cleanups.push(client.cleanup);
  }
  await page.goto("/account/api-keys");
}

test("an empty list says so, in light and dark", async ({ page, baseURL }) => {
  await setup(page, baseURL!, false);
  await expect(page.getByRole("heading", { level: 2, name: "Connected apps" })).toBeVisible();
  await expect(page.getByText("No apps are connected.")).toBeVisible();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expectNoSeriousAxeIssues(page);
  }
});

test("lists the app with when it connected and last used, in light and dark", async ({
  page,
  baseURL,
}) => {
  await setup(page, baseURL!);
  const section = page.getByRole("region", { name: "Connected apps" });
  await expect(section.getByText("Synthetic Assistant")).toBeVisible();
  await expect(section.getByText("Connected", { exact: true })).toBeVisible();
  await expect(section.getByText("Never used")).toBeVisible();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expectNoSeriousAxeIssues(page);
  }
});

test("disconnect asks first; Keep returns focus; Disconnect removes it at once (AC-14)", async ({
  page,
  baseURL,
}) => {
  await setup(page, baseURL!);
  const button = page.getByRole("button", { name: "Disconnect Synthetic Assistant" });
  await button.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("It stops working right away");
  await expectNoSeriousAxeIssues(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();

  await button.click();
  await page.getByRole("dialog").getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText("No apps are connected.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Connected apps" })).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Disconnected." })).toHaveCount(1);
  await page.reload();
  await expect(page.getByText("No apps are connected.")).toBeVisible();
});

test("a failed disconnect keeps the dialog open with an alert", async ({ page, baseURL }) => {
  await setup(page, baseURL!);
  await page.route("**/api/connected-apps/*", (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({ status: 500, json: { error: "server_error" } })
      : route.continue(),
  );
  await page.getByRole("button", { name: "Disconnect Synthetic Assistant" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("alert")).toContainText("couldn't disconnect");
  await expect(page.getByRole("alert")).toBeFocused();
});

test("a failed load shows a message and Try again works", async ({ page, baseURL }) => {
  const { cleanup } = await signIn(page.context(), baseURL!);
  cleanups.push(cleanup);
  let fail = true;
  await page.route("**/api/connected-apps", (route) => {
    if (fail) return route.fulfill({ status: 500, json: { error: "server_error" } });
    return route.fulfill({ json: { apps: [] } });
  });
  await page.goto("/account/api-keys");
  await expect(page.getByRole("alert")).toContainText("couldn't load");
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("No apps are connected.")).toBeVisible();
});

const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["Pixel 7"];

test.describe("phone width", () => {
  // Context fields only: defaultBrowserType is worker scoped and cannot be set in a describe.
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });
  test("no sideways scroll and a 44 px Disconnect button", async ({ page, baseURL }) => {
    await setup(page, baseURL!);
    const button = page.getByRole("button", { name: "Disconnect Synthetic Assistant" });
    await expect(button).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expectNoSeriousAxeIssues(page);
  });
});
