import { expect as baseExpect, type Page } from "@playwright/test";
import { signIn } from "../support/session";

// Delete dialog on the take page and the library cards (spec 0013 AC-4, AC-5, AC-11, AC-12).
// DELETE is stubbed so each answer (204, 500, 404, no answer) is exact; the server side is
// covered by the route tests and the pipeline checks.

export const expect = baseExpect.configure({ timeout: 15_000 });

export const cleanups: (() => Promise<void>)[] = [];

export async function signedIn(page: Page, baseURL: string) {
  const { user, cleanup } = await signIn(page.context(), baseURL);
  cleanups.push(cleanup);
  return user;
}

/** Answers DELETE /api/takes/{id} with each status in turn (the last one repeats). */
export async function stubDelete(page: Page, answers: readonly (number | "abort")[]) {
  const calls: string[] = [];
  await page.route(/\/api\/takes\/[^/?]+$/, (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    const answer = answers[Math.min(calls.length, answers.length - 1)]!;
    calls.push(route.request().url());
    if (answer === "abort") return route.abort("failed");
    return route.fulfill({
      status: answer,
      ...(answer === 204 ? {} : { json: { error: "x", message: "x" } }),
    });
  });
  return calls;
}

/** Tab and Shift+Tab many times: focus never leaves the open dialog (AC-12). */
export async function expectFocusTrapped(page: Page) {
  const dialog = page.getByRole("dialog");
  for (const key of ["Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
    await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
}

export const seeds = [
  { title: "Alpha take", status: "failed", failureCode: "unsupported", minutesAgo: 1 },
  { title: "Beta take", status: "failed", failureCode: "unsupported", minutesAgo: 2 },
  { title: "Gamma take", status: "failed", failureCode: "unsupported", minutesAgo: 3 },
] as const;
