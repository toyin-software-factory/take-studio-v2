import { devices, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import {
  AI_CUTS,
  CUTS,
  bar,
  cleanups,
  cutAny,
  cutButton,
  expect,
  list,
  load,
  noPageScroll,
  setup,
  timeline,
} from "./fixtures/cut-review";

test.describe.configure({ timeout: 90_000 });

test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups.length = 0;
});

// B2-T95 (/test cut review timeline): keyboard, focus, targets, themes, reduced motion and the
// summary against the cut list. Arrows, Home and End arrived with B2-T97 (below).
const listButtons = (page: Page) => list(page).getByRole("button", { name: /^(Undo|Redo) / });

test("arrow keys scroll a far cut into view inside the timeline, with reduced motion too (B2-T97)", async ({
  page,
  baseURL,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const far = [
    ...CUTS,
    { id: "c4", startMs: 580_000, endMs: 581_000, kind: "pause", applied: true },
  ];
  const { id } = await setup(page, baseURL!, { detail: { cuts: far, durationMs: 600_000 } });
  await load(page, id);
  await cutButton(page, 1).focus();
  await page.keyboard.press("End");
  const last = timeline(page).getByRole("button", { name: /^Pause 4,/ });
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();
  expect(await noPageScroll(page)).toBe(true);
});

test("a focused block shows a visible focus ring, and the targets are 44 px on desktop (AC-10)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, { detail: { cuts: AI_CUTS, aiEdit: "done" } });
  await load(page, id);
  await cutAny(page, 1).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(cutAny(page, 1)).toBeFocused();
  await expect(cutAny(page, 1)).toHaveCSS("outline-style", "solid");
  await expect(cutAny(page, 1)).not.toHaveCSS("outline-width", "0px");
  const block = await cutAny(page, 1).boundingBox();
  expect(block!.height).toBeGreaterThanOrEqual(44);
  expect(block!.width).toBeGreaterThanOrEqual(24);
  const buttons = listButtons(page);
  await expect(buttons).toHaveCount(3);
  await buttons.nth(0).focus();
  await expect(buttons.nth(0)).toHaveCSS("outline-style", "solid");
});

// The list buttons are 44 px under a coarse pointer (the project rule, `pointer-coarse:min-h-11`),
// so that bar is measured on a phone; the timeline blocks are 44 px on every pointer (above).
test("every Undo and Redo button in the list is 44 px tall on a phone (AC-10)", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: baseURL! });
  try {
    const page = await context.newPage();
    const { id } = await setup(page, baseURL!, { detail: { cuts: AI_CUTS, aiEdit: "done" } });
    await load(page, id);
    const buttons = listButtons(page);
    await expect(buttons).toHaveCount(3);
    for (let i = 0; i < 3; i += 1) {
      const box = await buttons.nth(i).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  } finally {
    await context.close();
  }
});

test("the summary follows every keep and undo and always matches the cut list (C-36)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, { detail: { cuts: AI_CUTS, aiEdit: "done" } });
  await load(page, id);
  const cutCount = async () => listButtons(page).filter({ hasText: "Undo" }).count();
  await expect(page.getByText("1 word cut and 1 pause, 1.5 s saved.")).toBeVisible();
  expect(await cutCount()).toBe(2);
  // Keep the pause: only the word cut is left.
  await cutAny(page, 2).click();
  await expect(page.getByText("1 word cut, 0.8 s saved.")).toBeVisible();
  expect(await cutCount()).toBe(1);
  // Cut the kept word as well: two word cuts, no pause.
  await cutAny(page, 3).click();
  await expect(page.getByText("2 word cuts, 1.4 s saved.")).toBeVisible();
  expect(await cutCount()).toBe(2);
  // Keep everything.
  await cutAny(page, 1).click();
  await cutAny(page, 3).click();
  await expect(page.getByText("No pauses cut.")).toBeVisible();
  expect(await cutCount()).toBe(0);
});

test("the timeline, the list and the pending bar pass axe in light and dark (AC-10)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, { detail: { cuts: AI_CUTS, aiEdit: "done" } });
  await load(page, id);
  await cutAny(page, 1).click();
  await expect(bar(page)).toBeVisible();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expectNoSeriousAxeIssues(page);
  }
});

test("with reduced motion the timeline still toggles, with no running transitions (AC-10)", async ({
  page,
  baseURL,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { id } = await setup(page, baseURL!);
  await load(page, id);
  await cutButton(page, 1).click();
  await expect(cutButton(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(bar(page)).toBeVisible();
  const running = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter(
          (a) =>
            a.playState === "running" &&
            (a.effect?.getComputedTiming().iterations ?? 1) !== Infinity &&
            (a.effect?.getComputedTiming().duration as number) > 1,
        ).length,
  );
  expect(running).toBe(0);
  await expectNoSeriousAxeIssues(page);
});

test("the Missed button on the take page leaves every cut and the pending bar alone, in dark too", async ({
  page,
  baseURL,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const { id } = await setup(page, baseURL!);
  await page.route(new RegExp(`/api/takes/${id}/missed$`), (r) => r.fulfill({ status: 204 }));
  await load(page, id);
  const missed = page.getByRole("button", { name: "Missed something?" });
  await missed.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("missed-note")).toContainText("Thanks, noted at");
  await expect(bar(page)).toHaveCount(0);
  await expect(cutButton(page, 1)).toHaveAttribute("aria-pressed", "false");
  await expectNoSeriousAxeIssues(page);
});
