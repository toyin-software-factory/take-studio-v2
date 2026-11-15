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
} from "./fixtures/cut-review";

test.describe.configure({ timeout: 90_000 });

test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups.length = 0;
});

// A phone context made inside the test: `test.use(devices[...])` cannot sit in a describe group.
test("on a phone the timeline scrolls inside itself and the page does not (AC-1, AC-10)", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ ...devices["Pixel 7"], baseURL: baseURL! });
  try {
    const page = await context.newPage();
    const { id } = await setup(page, baseURL!);
    await load(page, id);
    expect(await noPageScroll(page)).toBe(true);
    const box = await cutButton(page, 1).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
    await expectNoSeriousAxeIssues(page);
    // The pending bar: the text has the full width, the buttons share the row below it, 44 px tall.
    await cutButton(page, 3).click();
    await expect(bar(page)).toBeVisible();
    const text = await bar(page)
      .getByText(/1 change/)
      .boundingBox();
    const discard = await bar(page).getByRole("button", { name: "Discard" }).boundingBox();
    const render = await bar(page).getByRole("button", { name: "Render" }).boundingBox();
    const barBox = await bar(page).boundingBox();
    expect(discard!.y).toBeGreaterThanOrEqual(text!.y + text!.height);
    expect(Math.abs(discard!.y - render!.y)).toBeLessThan(2);
    for (const b of [discard!, render!]) expect(b.height).toBeGreaterThanOrEqual(44);
    expect(text!.width).toBeGreaterThan(barBox!.width * 0.7);
    expect(await noPageScroll(page)).toBe(true);
    await expectNoSeriousAxeIssues(page);
  } finally {
    await context.close();
  }
});

test("an AI cut shows its reason on focus and on press, and each block is described by it (AC-3)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, { detail: { cuts: AI_CUTS, aiEdit: "done" } });
  await load(page, id);
  await expect(reasonLineOf(page)).toHaveText("");
  await cutAny(page, 1).focus();
  await expect(reasonLineOf(page)).toHaveText("Cut 1: You restarted the sentence.");
  await expect(reasonLineOf(page)).toHaveAttribute("role", "status");
  const describedBy = await cutAny(page, 1).getAttribute("aria-describedby");
  await expect(page.locator(`[id="${describedBy}"]`)).toHaveText("You restarted the sentence.");
  await cutAny(page, 3).click();
  await expect(reasonLineOf(page)).toHaveText("Cut 3: A repeated word.");
  await expect(page.getByTestId("ai-unavailable")).toHaveCount(0);
  await expectNoSeriousAxeIssues(page);
});

test("a take that fell back to rules shows the rules cuts and the unavailable line (AC-7, AC-12)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, { detail: { aiEdit: "unavailable" } });
  await load(page, id);
  await expect(page.getByTestId("ai-unavailable")).toHaveText(
    "The AI edit didn’t run for this take, so only pauses were cut.",
  );
  await expect(cutButton(page, 1)).not.toHaveAttribute("aria-describedby", /.+/);
  await cutButton(page, 1).focus();
  await expect(reasonLineOf(page)).toHaveText("");
  await expectNoSeriousAxeIssues(page);
});

test("no unavailable line when aiEdit is null (not English or no speech)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, { detail: { aiEdit: null } });
  await load(page, id);
  await expect(cutButton(page, 1)).toBeVisible();
  await expect(page.getByTestId("ai-unavailable")).toHaveCount(0);
  await expect(page.getByTestId("no-ai-reasons")).toHaveText(
    "The AI didn’t run on this take, so only pauses were cut.",
  );
});

test("the cut list shows every reason; Undo and Redo stay in sync with the timeline; a row only seeks", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, { detail: { cuts: AI_CUTS, aiEdit: "done" } });
  await load(page, id);
  const rows = list(page).getByRole("listitem");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("You restarted the sentence.");
  await expect(rows.nth(0)).toContainText("0:01 to 0:01, 0.8 s");
  await expect(rows.nth(1)).toContainText("No reason given.");
  await expect(rows.nth(2)).toContainText("A repeated word.");
  await expect(rows.nth(2)).toContainText("kept");
  // Reading a reason (pressing the row) changes nothing.
  await rows
    .nth(0)
    .getByRole("button", { name: /^Cut 1 / })
    .click();
  await expect(cutAny(page, 1)).toHaveAttribute("aria-pressed", "false");
  await expect(bar(page)).toHaveCount(0);
  // Undo in the list flips the timeline block, Redo flips it back.
  await rows.nth(0).getByRole("button", { name: "Undo Cut 1" }).click();
  await expect(cutAny(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(rows.nth(0).getByRole("button", { name: "Redo Cut 1" })).toBeVisible();
  // The timeline toggles the list the other way round.
  await cutAny(page, 3).click();
  await expect(rows.nth(2).getByRole("button", { name: "Undo Cut 3" })).toBeVisible();
  await expect(reasonLineOf(page)).toHaveText("Cut 3: A repeated word.");
  // The reason line follows the cut the list just toggled, not the older focused block.
  await rows.nth(0).getByRole("button", { name: "Redo Cut 1" }).click();
  await expect(reasonLineOf(page)).toHaveText("Cut 1: You restarted the sentence.");
  await expectNoSeriousAxeIssues(page);
});

test("the summary counts word cuts and pauses separately", async ({ page, baseURL }) => {
  const { id } = await setup(page, baseURL!, { detail: { cuts: AI_CUTS, aiEdit: "done" } });
  await load(page, id);
  await expect(page.getByText("1 word cut and 1 pause, 1.5 s saved.")).toBeVisible();
});
