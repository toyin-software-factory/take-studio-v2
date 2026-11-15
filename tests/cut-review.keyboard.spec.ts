import { devices, test } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import {
  AI_CUTS,
  bar,
  cleanups,
  cutAny,
  cutButton,
  expect,
  list,
  load,
  noPageScroll,
  reasonLineOf,
  setup,
  timeline,
} from "./fixtures/cut-review";

test.describe.configure({ timeout: 90_000 });

test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups.length = 0;
});

test("a fallback take says the AI didn't run; on a phone the list fits without sideways scroll", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: baseURL! });
  const page = await context.newPage();
  try {
    const { id } = await setup(page, baseURL!, { detail: { aiEdit: "unavailable" } });
    await load(page, id);
    await expect(page.getByTestId("ai-unavailable")).toBeVisible();
    await expect(list(page).getByRole("listitem")).toHaveCount(3);
    await expect(list(page).getByRole("button", { name: "Undo Pause 1" })).toBeVisible();
    const box = await list(page).getByRole("button", { name: "Undo Pause 1" }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const scrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(scrolls).toBe(false);
    await expectNoSeriousAxeIssues(page);
  } finally {
    await context.close();
  }
});

test("on a phone the reason line wraps without sideways page scroll (AC-3)", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: baseURL! });
  try {
    const page = await context.newPage();
    const long = "You said the same thing twice and then started again from the top of the line.";
    const cuts = AI_CUTS.map((c) => (c.id === "c1" ? { ...c, reason: long } : c));
    const { id } = await setup(page, baseURL!, { detail: { cuts, aiEdit: "done" } });
    await load(page, id);
    await cutAny(page, 1).click();
    await expect(reasonLineOf(page)).toContainText("Cut 1:");
    expect(await noPageScroll(page)).toBe(true);
    await expectNoSeriousAxeIssues(page);
  } finally {
    await context.close();
  }
});

test("Enter and Space both toggle a block, and keeping then cutting again leaves no change (AC-1, AC-2, AC-10)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!);
  await load(page, id);
  await cutButton(page, 2).focus();
  await page.keyboard.press("Enter");
  await expect(cutButton(page, 2)).toHaveAttribute("aria-pressed", "true");
  await expect(bar(page)).toContainText("Keep pause 2");
  await page.keyboard.press("Space");
  await expect(cutButton(page, 2)).toHaveAttribute("aria-pressed", "false");
  await expect(bar(page)).toHaveCount(0);
});

test("the blocks are one Tab stop: timeline, one block, then the cut list (AC-10, B2-T97)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!);
  await load(page, id);
  await timeline(page).focus();
  await page.keyboard.press("Tab");
  await expect(cutButton(page, 1)).toBeFocused();
  // Tab again leaves the blocks: it never lands on block 2 or 3.
  await page.keyboard.press("Tab");
  await expect(timeline(page).locator(":focus")).toHaveCount(0);
  await expect(cutButton(page, 2)).toHaveAttribute("tabindex", "-1");
  await expect(cutButton(page, 3)).toHaveAttribute("tabindex", "-1");
  // Shift+Tab comes back to the same block, not the last one.
  await page.keyboard.press("Shift+Tab");
  await expect(cutButton(page, 1)).toBeFocused();
});

test("arrows, Home and End move between cuts; Enter and Space still toggle (B2-T97)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!);
  await load(page, id);
  await cutButton(page, 1).focus();
  await page.keyboard.press("ArrowRight");
  await expect(cutButton(page, 2)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(cutButton(page, 3)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(cutButton(page, 3)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(cutButton(page, 2)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(cutButton(page, 1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(cutButton(page, 1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(cutButton(page, 3)).toBeFocused();
  // Moving never changes a cut; Enter does.
  await expect(bar(page)).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(cutButton(page, 3)).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Home");
  await page.keyboard.press("Space");
  await expect(cutButton(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(bar(page)).toContainText("2 changes");
});

test("the focused block is the Tab stop, its reason is read and its ring is visible (B2-T97, spec 0012 AC-3)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, { detail: { cuts: AI_CUTS, aiEdit: "done" } });
  await load(page, id);
  await cutAny(page, 1).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(cutAny(page, 3)).toBeFocused();
  await expect(cutAny(page, 3)).toHaveAttribute("tabindex", "0");
  await expect(cutAny(page, 1)).toHaveAttribute("tabindex", "-1");
  await expect(cutAny(page, 3)).toHaveCSS("outline-style", "solid");
  await expect(reasonLineOf(page)).toHaveText("Cut 3: A repeated word.");
  await expect(cutAny(page, 3)).toHaveAccessibleDescription("A repeated word.");
  // Leaving and coming back lands on the cut last used.
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(cutAny(page, 3)).toBeFocused();
});
