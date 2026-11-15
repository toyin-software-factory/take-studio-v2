import { test } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { bar, cleanups, cutButton, expect, load, setup, timeline } from "./fixtures/cut-review";

test.describe.configure({ timeout: 90_000 });

test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups.length = 0;
});

test("toggles a cut by keyboard, lists it in the pending bar and discards (AC-1, AC-2, AC-4, AC-10)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!);
  await load(page, id);
  await expect(page.getByRole("status").filter({ hasText: "2 pauses cut" })).toBeVisible();
  await expect(cutButton(page, 1)).toHaveAttribute("aria-pressed", "false");
  await expect(bar(page)).toHaveCount(0);
  await cutButton(page, 1).focus();
  await page.keyboard.press("Space");
  await expect(cutButton(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(bar(page)).toContainText("1 change");
  await expect(bar(page)).toContainText("Keep pause 1");
  await expectNoSeriousAxeIssues(page);
  await bar(page).getByRole("button", { name: "Discard" }).click();
  await expect(bar(page)).toHaveCount(0);
  await expect(cutButton(page, 1)).toHaveAttribute("aria-pressed", "false");
});

test("Render sends the changes with baseRenderId and locks the page (AC-6)", async ({
  page,
  baseURL,
}) => {
  const { id, calls } = await setup(page, baseURL!);
  await load(page, id);
  await cutButton(page, 3).click();
  await bar(page).getByRole("button", { name: "Render" }).click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toContain('"baseRenderId"');
  expect(calls[0]).toContain('"cuts"');
  await expect(page.getByRole("status").filter({ hasText: "Rendering" })).toBeVisible();
  await expect(cutButton(page, 1)).toBeDisabled();
  await expect(bar(page).getByRole("button", { name: "Render" })).toBeDisabled();
});

test("a 429 hides Render and keeps Discard (AC-8)", async ({ page, baseURL }) => {
  const { id } = await setup(page, baseURL!, {
    change: { status: 429, json: { error: "change_limit" } },
  });
  await load(page, id);
  await cutButton(page, 3).click();
  await bar(page).getByRole("button", { name: "Render" }).click();
  await expect(bar(page).getByRole("button", { name: "Render" })).toHaveCount(0);
  await expect(bar(page).getByRole("button", { name: "Discard" })).toBeVisible();
});

test("confirms before leaving through an in app link with unsent changes (AC-4)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!);
  await load(page, id);
  await cutButton(page, 3).click();
  const asked: string[] = [];
  page.on("dialog", (d) => {
    asked.push(d.message());
    void d.dismiss();
  });
  await page.getByRole("link", { name: /Takes/ }).first().click();
  await expect.poll(() => asked.length).toBe(1);
  await expect(page).toHaveURL(new RegExp(`/takes/${id}$`));
});

test("shows a plain track when there is no waveform (AC-11)", async ({ page, baseURL }) => {
  const { id } = await setup(page, baseURL!, { waveform: null });
  await load(page, id);
  await expect(cutButton(page, 1)).toBeVisible();
  await expect(timeline(page).locator("canvas, svg[data-waveform]")).toHaveCount(0);
});

test("an original that cannot be fetched says so and keeps the page usable (AC-3)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, { original: { status: 410 } });
  await load(page, id);
  await cutButton(page, 3).click();
  await expect(page.getByText("The original has expired")).toBeVisible();
  await expect(cutButton(page, 3)).toBeDisabled();
});

test("a failed render keeps the changes and offers Try again, which a reload loses (AC-6)", async ({
  page,
  baseURL,
}) => {
  const { id, calls } = await setup(page, baseURL!, { job: { status: "failed" } });
  await load(page, id);
  await cutButton(page, 3).click();
  await bar(page).getByRole("button", { name: "Render" }).click();
  await expect.poll(() => calls.length).toBe(1);
  // The previous video and its summary stay, the page unlocks and the same changes are offered again.
  await expect(
    page.getByRole("status").filter({ hasText: "The new video didn't finish" }),
  ).toBeVisible();
  await expect(page.getByText("Removed 0:01 of pauses")).toBeVisible();
  // aria-pressed means "kept": pause 3 starts kept and the held change cuts it.
  await expect(cutButton(page, 3)).toHaveAttribute("aria-pressed", "false");
  await expect(cutButton(page, 3)).toBeEnabled();
  await expect(bar(page)).toContainText("Cut pause 3");
  await expect(bar(page).getByRole("button", { name: "Render" })).toHaveCount(0);
  await expect(bar(page).getByRole("button", { name: "Try again" })).toBeEnabled();
  await expectNoSeriousAxeIssues(page);
  // Try again sends exactly the same changes.
  await bar(page).getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1]).toBe(calls[0]);
  // A reload loses the held changes, so there is nothing to retry.
  await page.reload();
  await expect(timeline(page)).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(cutButton(page, 3)).toHaveAttribute("aria-pressed", "true");
});
