import { expect as baseExpect, test } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { signIn } from "./support/session";

// Privacy and Terms (spec 0015 AC-1, AC-7, AC-8, AC-12): public, the same for a signed in reader,
// one h1, a table of contents, the Draft banner while the facts are unset, axe in both themes.
const expect = baseExpect.configure({ timeout: 15_000 });

const PAGES = [
  { path: "/privacy", title: "Privacy Policy", heading: "Privacy Policy" },
  { path: "/terms", title: "Terms of Use", heading: "Terms of Use" },
] as const;

for (const { path, title, heading } of PAGES) {
  test.describe(path, () => {
    test("renders signed out with the Draft banner, a date and one h1", async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle(`${title} · Take Studio`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByText(/^Last updated \d{4}-\d{2}-\d{2}$/)).toBeVisible();
      await expect(page.getByTestId("legal-draft-banner")).toContainText("Draft, pending review");
      await expect(page.getByRole("navigation", { name: "On this page" })).toBeVisible();
      await expect(page.locator("[data-legal-copy] h2").first()).toBeVisible();
    });

    test("passes axe in the light and dark themes", async ({ page }) => {
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.goto(path);
        await expectNoSeriousAxeIssues(page);
      }
    });

    test("stays on the page for a signed in creator", async ({ page, baseURL }) => {
      const { cleanup } = await signIn(page.context(), baseURL ?? "");
      try {
        await page.goto(path);
        await expect(page).toHaveURL(new RegExp(`${path}$`));
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      } finally {
        await cleanup();
      }
    });
  });
}

test("the table of contents links jump to a section", async ({ page }) => {
  await page.goto("/privacy");
  await page.getByRole("navigation", { name: "On this page" }).getByRole("link").nth(1).click();
  await expect(page).toHaveURL(/#collect$/);
});

test("the homepage footer links Privacy and Terms", async ({ page }) => {
  await page.goto("/");
  const footer = page.locator("footer");
  await expect(footer.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  await expect(footer.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
});
