import { expect as baseExpect, type Page } from "@playwright/test";
import { signIn } from "../support/session";
import { setUsage } from "../support/usage";

export const expect = baseExpect.configure({ timeout: 15_000 });

export const cleanups: (() => Promise<void>)[] = [];

export async function setUp(page: Page, baseURL: string, state: Parameters<typeof setUsage>[1]) {
  const { user, cleanup } = await signIn(page.context(), baseURL);
  cleanups.push(cleanup, await setUsage(user, state));
  return user;
}
