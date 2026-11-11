import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Sign in page states (spec 0006, AC-1, AC-2, AC-4, AC-8). The link endpoint is mocked so the
// states can be shown without sending mail; the real endpoint is covered by src/server/auth.test.ts.

async function expectNoSeriousAxeIssues(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(blocking, JSON.stringify(blocking.map((v) => v.id))).toEqual([]);
}

async function mockLink(page: Page, status: number, body: unknown) {
  await page.route("**/api/auth/sign-in/magic-link", (route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }),
  );
}

test("idle: Google and the email form (AC-1), accessible", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(
    page.getByRole("heading", { level: 1, name: "Sign in to Take Studio" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Email me a sign in link" })).toBeVisible();
  await expectNoSeriousAxeIssues(page);
});

test("an invalid address is caught before sending", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("not an email");
  await page.getByRole("button", { name: "Email me a sign in link" }).click();
  await expect(page.getByText("Enter an email address like you@example.com.")).toBeVisible();
});

test("sent: Check your inbox, the same wording for any address (AC-1)", async ({ page }) => {
  await mockLink(page, 200, { status: true });
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("creator@example.com");
  await page.getByRole("button", { name: "Email me a sign in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  await expect(
    page.getByText("If creator@example.com can sign in, a link is on its way."),
  ).toBeVisible();
  await expectNoSeriousAxeIssues(page);
  await page.getByRole("button", { name: "Use a different email" }).click();
  await expect(page.getByRole("button", { name: "Email me a sign in link" })).toBeVisible();
});

test("rate limited shows a friendly message (AC-4)", async ({ page }) => {
  await mockLink(page, 429, { code: "EMAIL_RATE_LIMITED", message: "x" });
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("creator@example.com");
  await page.getByRole("button", { name: "Email me a sign in link" }).click();
  await expect(page.locator('[data-slot="alert"]')).toContainText("Too many sign in links");
  await expectNoSeriousAxeIssues(page);
});

test("a failed send says to try again or use Google (AC-8)", async ({ page }) => {
  await mockLink(page, 503, { code: "EMAIL_SEND_FAILED", message: "x" });
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("creator@example.com");
  await page.getByRole("button", { name: "Email me a sign in link" }).click();
  await expect(page.locator('[data-slot="alert"]')).toContainText("We couldn't send the email");
  await expect(page.locator('[data-slot="alert"]')).toContainText(
    "Please try again or use Google.",
  );
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
});

test("an expired or used link shows a friendly page with a way to get a new one (AC-2)", async ({
  page,
}) => {
  await page.goto("/sign-in/link-expired");
  await expect(page.getByRole("status")).toContainText("That link has expired or was already used");
  await expect(page.getByRole("button", { name: "Email me a sign in link" })).toBeVisible();
  await expectNoSeriousAxeIssues(page);
});
