import { devices, expect as baseExpect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { seedClient } from "./support/oauth";
import { signIn } from "./support/session";

// The OAuth consent page (spec 0019 AC-14, AC-15, step 8): which app, what it can do, Allow and
// Deny as plain buttons, signed in only. The consent answer route is stubbed (Better Auth's real
// flow is covered by the endpoint tests); the client and the user are synthetic.

const expect = baseExpect.configure({ timeout: 15_000 });

const cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((c) => c()));
});

async function open(page: Page, baseURL: string, name: string | null = "Synthetic Assistant") {
  const { cleanup } = await signIn(page.context(), baseURL);
  cleanups.push(cleanup);
  const client = await seedClient({ name, redirectUris: ["https://assistant.example.test/done"] });
  cleanups.push(client.cleanup);
  await page.goto(`/oauth/consent?client_id=${client.clientId}&state=abc&sig=test`);
  return client;
}

test("shows the app, what it can do and where it returns, in light and dark (AC-14, AC-15)", async ({
  page,
  baseURL,
}) => {
  await open(page, baseURL!);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Allow this app");
  await expect(page.getByTestId("consent-app")).toHaveText("Synthetic Assistant");
  await expect(page.getByTestId("consent-hosts")).toHaveText("assistant.example.test");
  await expect(page.getByText("Run edits on your takes")).toBeVisible();
  await expect(page.getByText("only when you confirm it each time")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.getByRole("main").getByRole("link")).toHaveCount(0);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expectNoSeriousAxeIssues(page);
  }
});

test("a name with markup is shown as plain text", async ({ page, baseURL }) => {
  await open(page, baseURL!, "<b>Evil</b> <a href='https://evil.example.test'>click</a>");
  await expect(page.getByTestId("consent-app")).toContainText("<b>Evil</b>");
  await expect(page.getByTestId("consent-app").locator("b, a")).toHaveCount(0);
});

test("Allow posts the signed query and follows the answer; keyboard works (AC-15)", async ({
  page,
  baseURL,
}) => {
  await open(page, baseURL!);
  let posted: unknown = null;
  await page.route("**/api/auth/oauth2/consent", (route) => {
    posted = route.request().postDataJSON();
    return route.fulfill({ json: { url: new URL("/library?consented=1", baseURL!).href } });
  });
  await page.keyboard.press("Tab");
  await page.getByRole("button", { name: "Allow" }).focus();
  await expect(page.getByRole("button", { name: "Allow" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/consented=1/);
  expect(posted).toMatchObject({ accept: true });
  expect((posted as { oauth_query: string }).oauth_query).toContain("state=abc&sig=test");
});

test("Deny posts accept false", async ({ page, baseURL }) => {
  await open(page, baseURL!);
  let posted: unknown = null;
  await page.route("**/api/auth/oauth2/consent", (route) => {
    posted = route.request().postDataJSON();
    return route.fulfill({ json: { url: new URL("/library?denied=1", baseURL!).href } });
  });
  await page.getByRole("button", { name: "Deny" }).click();
  await expect(page).toHaveURL(/denied=1/);
  expect(posted).toMatchObject({ accept: false });
});

test("a failed answer keeps both buttons and tells you what to do (AC-15)", async ({
  page,
  baseURL,
}) => {
  await open(page, baseURL!);
  await page.route("**/api/auth/oauth2/consent", (route) =>
    route.fulfill({ status: 400, json: { error: "expired" } }),
  );
  await page.getByRole("button", { name: "Allow" }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("start again from the app");
  await expect(alert).toBeFocused();
  await expect(page.getByRole("button", { name: "Allow" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Deny" })).toBeEnabled();
  await expectNoSeriousAxeIssues(page);
});

test("an unknown app shows a plain message with no buttons", async ({ page, baseURL }) => {
  const { cleanup } = await signIn(page.context(), baseURL!);
  cleanups.push(cleanup);
  await page.goto("/oauth/consent?client_id=does-not-exist");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This request can't be shown");
  await expect(page.getByRole("button", { name: "Allow" })).toHaveCount(0);
  await expectNoSeriousAxeIssues(page);
});

test("signed out, the page goes to sign in", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto("/oauth/consent?client_id=x");
  await expect(page).toHaveURL(/\/sign-in/);
  await context.close();
});

const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["Pixel 7"];

test.describe("phone width", () => {
  // Context fields only: defaultBrowserType is worker scoped and cannot be set in a describe.
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });
  test("no sideways scroll, and Allow and Deny are at least 44 px tall", async ({
    page,
    baseURL,
  }) => {
    await open(page, baseURL!);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    for (const name of ["Allow", "Deny"]) {
      const box = await page.getByRole("button", { name }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await expectNoSeriousAxeIssues(page);
  });
});
