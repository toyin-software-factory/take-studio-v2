import { expect, test } from "@playwright/test";
import { API_REGISTRY } from "../src/lib/api-registry";
import { expectNoSeriousAxeIssues } from "./support/axe";

/** Spec 0019 AC-12: the public MCP setup docs. No sign in anywhere. */

test("the page is public, shows the three setups and lists every flagged tool", async ({
  page,
}) => {
  const response = await page.goto("/docs/mcp");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/AI assistants · Take Studio/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Take Studio for AI assistants" }),
  ).toBeVisible();
  for (const name of ["Claude Code", "Cursor", "Any other client (JSON)"])
    await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByLabel("Setup for Claude Code")).toContainText("claude mcp add");
  await expect(page.getByLabel("Setup for Cursor")).toContainText("mcpServers");

  const tools = page.locator("#tools");
  for (const route of API_REGISTRY.filter((r) => r.mcp !== undefined)) {
    await expect(
      tools.locator("code", { hasText: new RegExp(`^${route.mcp}$`) }),
      `${route.mcp}`,
    ).toBeAttached();
  }
  await expect(page.getByText("tsk_xxxx").first()).toBeAttached();
  await expectNoSeriousAxeIssues(page);
});

test("is indexable, and keyboard users skip to the content and scroll the code", async ({
  page,
}) => {
  await page.goto("/docs/mcp");
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#content")).toBeFocused();
  const block = page.getByLabel("Setup for Claude Code");
  await block.focus();
  await expect(block).toBeFocused();
});

test("at phone width nothing scrolls sideways and the links are tall enough", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/docs/mcp");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expectNoSeriousAxeIssues(page);
});
