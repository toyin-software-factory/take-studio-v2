import { test } from "@playwright/test";
import {
  Item,
  NEW_ID,
  expect,
  readyItem,
  select,
  signedInWithStudios,
  stubLibrary,
} from "../fixtures/background-picker";

export function registerDelete(): void {
  test("deleting the picked background puts the pick back to Keep original (the next upload sends original)", async ({
    page,
    baseURL,
  }) => {
    await signedInWithStudios(page, baseURL!);
    const state = { mine: [readyItem("Office wall")], calls: [] as string[] };
    await stubLibrary(page, state);
    const bodies: Record<string, unknown>[] = [];
    await page.route("**/api/uploads", (route) => {
      bodies.push(route.request().postDataJSON());
      return route.fulfill({ status: 503, json: { error: "storage_error", message: "x" } });
    });
    await page.route("**/api/backgrounds/*", (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      state.mine = [];
      return route.fulfill({ status: 204 });
    });
    await page.goto("/library");
    await expect(select(page)).toBeEnabled();
    await select(page).click();
    await page.getByRole("radio", { name: /Office wall/ }).check({ force: true });
    await page.getByRole("button", { name: "Delete Office wall" }).click();
    await expect(page.getByRole("radio", { name: /Office wall/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(select(page)).toContainText("Keep original");
    await page
      .locator("#upload-video-input")
      .setInputFiles({ name: "take.mp4", mimeType: "video/mp4", buffer: Buffer.from("x") });
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]?.backgroundId).toBe("original");
  });

  test("an upload that never finished can be removed", async ({ page, baseURL }) => {
    await signedInWithStudios(page, baseURL!);
    const state = {
      mine: [{ ...readyItem("Half sent"), status: "uploading" }],
      calls: [] as string[],
    };
    await stubLibrary(page, state);
    let deleted = 0;
    await page.route("**/api/backgrounds/*", (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      deleted += 1;
      state.mine = [];
      return route.fulfill({ status: 204 });
    });
    await page.goto("/library");
    await expect(select(page)).toBeEnabled();
    await select(page).click();
    await expect(page.getByText("This upload didn't finish.")).toBeVisible();
    await page.getByRole("button", { name: "Remove" }).click();
    await expect.poll(() => deleted).toBe(1);
    await expect(page.getByText("Half sent")).toHaveCount(0);
  });

  test("a pick made while a delete is pending is kept when the delete finishes", async ({
    page,
    baseURL,
  }) => {
    await signedInWithStudios(page, baseURL!);
    const other = { ...readyItem("Second wall"), id: "22222222-2222-4222-8222-222222222222" };
    const state = { mine: [readyItem("Office wall"), other], calls: [] as string[] };
    await stubLibrary(page, state);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/backgrounds/*", async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      await gate; // the delete stays pending until the test lets it finish
      state.mine = [other];
      return route.fulfill({ status: 204 });
    });
    await page.goto("/library");
    await expect(select(page)).toBeEnabled();
    await select(page).click();
    await page.getByRole("radio", { name: /Office wall/ }).check({ force: true });
    await page.getByRole("button", { name: "Delete Office wall" }).click();
    // While the delete is pending the creator picks another background.
    await page.getByRole("radio", { name: /Second wall/ }).check({ force: true });
    release();
    await expect(page.getByRole("radio", { name: /Office wall/ })).toHaveCount(0);
    await expect(page.getByRole("radio", { name: /Second wall/ })).toBeChecked();
  });

  test("deleting the saved default leaves the list at once, even if the refresh fails (the next upload sends original)", async ({
    page,
    baseURL,
  }) => {
    await signedInWithStudios(page, baseURL!);
    const state: { mine: Item[]; calls: string[]; defaultId: string | null; listStatus?: number } =
      {
        mine: [readyItem("Office wall")],
        calls: [],
        defaultId: NEW_ID,
      };
    await stubLibrary(page, state);
    const bodies: Record<string, unknown>[] = [];
    await page.route("**/api/uploads", (route) => {
      bodies.push(route.request().postDataJSON());
      return route.fulfill({ status: 503, json: { error: "storage_error", message: "x" } });
    });
    await page.route("**/api/backgrounds/*", (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      state.mine = [];
      state.listStatus = 500; // the refresh after the delete fails
      return route.fulfill({ status: 204 });
    });
    await page.goto("/library");
    await expect(select(page)).toContainText("Office wall"); // the saved default
    await select(page).click();
    await page.getByRole("button", { name: "Delete Office wall" }).click();
    await expect(page.getByRole("radio", { name: /Office wall/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Done" }).click();
    await expect(select(page)).toContainText("Keep original");
    await page
      .locator("#upload-video-input")
      .setInputFiles({ name: "take.mp4", mimeType: "video/mp4", buffer: Buffer.from("x") });
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]?.backgroundId).toBe("original");
  });
}
