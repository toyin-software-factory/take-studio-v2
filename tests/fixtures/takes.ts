import { readFileSync } from "node:fs";
import { expect as baseExpect, type Page } from "@playwright/test";
import { signIn } from "../support/session";

// Slow first requests (cold Worker, small CI and sandbox machines) need more than 5 s.
export const expect = baseExpect.configure({ timeout: 15_000 });

// Library and take pages (spec 0004, AC-1, AC-2, AC-3 browser side, AC-8, AC-9, AC-11, AC-13).
// Takes are seeded in Postgres; R2 and the media links are mocked, since the Worker under test
// has placeholder storage credentials.

export const clip = readFileSync("tests/fixtures/clip.mp4");

export const R2 = "https://r2.test";

export const cleanups: (() => Promise<void>)[] = [];

export async function signedIn(page: Page, baseURL: string, name?: string) {
  const { user, cleanup } = await signIn(page.context(), baseURL, name);
  cleanups.push(cleanup);
  return user;
}

export { expectNoSeriousAxeIssues } from "../support/axe";
