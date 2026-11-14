import { expect, test } from "@playwright/test";
import { API_REGISTRY } from "../src/lib/api-registry";
import { expectNoSeriousAxeIssues } from "./support/axe";

/** Spec 0018 AC-11: the public API docs and the OpenAPI file. No sign in anywhere. */

test("the docs page is public, lists every route and passes axe", async ({ page }) => {
  const response = await page.goto("/docs/api");
  expect(response?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe("/docs/api");
  await expect(page.getByRole("heading", { level: 1, name: "Take Studio API" })).toBeVisible();
  await expect(page).toHaveTitle(/API · Take Studio/);
  for (const route of API_REGISTRY) {
    await expect(
      page.locator("code", { hasText: `${route.method} ${route.path}` }).first(),
      `${route.method} ${route.path}`,
    ).toBeAttached();
  }
  await expect(page.getByText("This is v1.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Upload to download/ })).toBeVisible();
  await expect(page.getByText("Authorization: Bearer", { exact: false }).first()).toBeVisible();
  await expectNoSeriousAxeIssues(page);
});

test("is indexable: no noindex tag", async ({ page }) => {
  await page.goto("/docs/api");
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
});

test("keyboard: skip link first, contents links jump, code blocks can be scrolled", async ({
  page,
}) => {
  await page.goto("/docs/api");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#content")).toBeFocused();

  await page
    .getByRole("navigation", { name: "On this page" })
    .getByRole("link", { name: "Errors" })
    .click();
  await expect(page).toHaveURL(/#errors$/);
  await expect(page.getByRole("heading", { name: "Errors", level: 2 })).toBeInViewport();

  const block = page
    .getByRole("group", { name: /Command for step 1/ })
    .or(page.locator('pre[aria-label="Command for step 1"]'));
  await page.keyboard.press("Tab"); // keyboard modality, so focus-visible applies
  await block.focus();
  await expect(block).toBeFocused();
  const outline = await block.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
});

test("phone width: no sideways scroll, 44 px links, axe", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/docs/api");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const link = page.getByRole("navigation", { name: "On this page" }).getByRole("link").first();
  expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expectNoSeriousAxeIssues(page);
  await context.close();
});

test("openapi.json is public JSON for every registered route", async ({ request }) => {
  const response = await request.get("/api/openapi.json");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  const doc = (await response.json()) as {
    openapi: string;
    paths: Record<string, Record<string, unknown>>;
    components: { securitySchemes: { bearerAuth: { scheme: string } } };
  };
  expect(doc.openapi).toBe("3.1.0");
  expect(doc.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
  for (const route of API_REGISTRY) {
    expect(
      doc.paths[route.path]?.[route.method.toLowerCase()],
      `${route.method} ${route.path}`,
    ).toBeDefined();
  }
  expect(JSON.stringify(doc)).not.toMatch(/tsk_[A-Za-z0-9_-]{43}/);
});

test("robots.txt allows the OpenAPI file and keeps the rest of /api/ closed; sitemap lists the docs", async ({
  request,
}) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Allow: /api/openapi.json");
  expect(robots).toContain("Disallow: /api/");
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/docs/api");
});
