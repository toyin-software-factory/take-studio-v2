import { devices, test } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import {
  CALM,
  R2,
  SUGGESTION,
  cleanups,
  expect,
  open,
  render,
  section,
  setup,
} from "./fixtures/background-take-page";

test.describe.configure({ timeout: 90_000 });

test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups.length = 0;
});

test("keeps the current and the chosen background visible when the list cannot load", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, {
    list: 500,
    detail: { background: { id: CALM, name: "Calm studio", keyed: true } },
  });
  await open(page, id);
  await expect(section(page)).toContainText(/We couldn.t load your backgrounds/);
  await expect(section(page).getByRole("radio", { name: /Calm studio/ })).toBeChecked();
  await section(page).getByRole("radio", { name: "Keep original" }).check({ force: true });
  await expect(section(page).getByRole("radio", { name: /Calm studio/ })).toBeVisible();
});

test("shows a refusal from the server, and a failed preview with a way to try it again", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, {
    put: {
      status: 409,
      json: {
        error: "background_not_ready",
        message: "That background isn't ready yet. Try again in a moment.",
      },
    },
    preview: {
      post: {
        status: 409,
        json: {
          error: "background_not_ready",
          message: "That background isn't ready yet. Try again in a moment.",
        },
      },
    },
  });
  await open(page, id);
  await section(page)
    .getByRole("radio", { name: /Calm studio/ })
    .check({ force: true });
  await expect(
    section(page)
      .locator('[data-slot="alert"], p[role="alert"]')
      .filter({ hasText: "isn't ready yet" }),
  ).toBeVisible();
  await expect(section(page).getByRole("button", { name: "Try the preview again" })).toBeVisible();
  await render(page).click();
  await expect(page.getByRole("status").filter({ hasText: "isn't ready yet" })).toBeVisible();
});

test("deleting a background removes it from the list and resets the choice", async ({
  page,
  baseURL,
}) => {
  const { id, state } = await setup(page, baseURL!);
  await page.route("**/api/backgrounds/*", (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    state.list = 500; // the refresh after the delete fails
    return route.fulfill({ status: 204 });
  });
  await open(page, id);
  await section(page)
    .getByRole("radio", { name: /Office wall/ })
    .check({ force: true });
  await section(page).getByRole("button", { name: "Delete Office wall" }).click();
  await expect(section(page).getByRole("radio", { name: /Office wall/ })).toHaveCount(0);
  await expect(section(page).getByRole("radio", { name: "Keep original" })).toBeChecked();
});

for (const [name, viewport] of [
  ["desktop", { width: 1280, height: 900 }],
  ["phone", { width: devices["iPhone 13"].viewport.width, height: 800 }],
] as const) {
  test(`axe finds no serious issues in the picker states at ${name}`, async ({ page, baseURL }) => {
    await page.setViewportSize(viewport);
    const { id } = await setup(page, baseURL!, {
      detail: {
        noGreenScreen: true,
      },
      preview: {
        post: {
          status: 200,
          json: { state: "ready", url: `${R2}/preview.png`, noGreenScreen: true },
        },
      },
    });
    await open(page, id);
    await expect(section(page)).toContainText("couldn't find a green screen");
    await expectNoSeriousAxeIssues(page);
    await section(page)
      .getByRole("radio", { name: /Warm studio/ })
      .check({ force: true });
    await expect(page.getByAltText("Preview of your take on Warm studio")).toBeVisible();
    await expectNoSeriousAxeIssues(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test.describe("touch targets on a phone", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } });
  test("Use it is at least 44 px, axe is clean and the page does not scroll sideways", async ({
    page,
    baseURL,
  }) => {
    const { id } = await setup(page, baseURL!, { detail: { suggestion: SUGGESTION } });
    await open(page, id);
    const box = await section(page).getByRole("button", { name: "Use it" }).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await expectNoSeriousAxeIssues(page);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over).toBeLessThanOrEqual(0);
  });
  test("the tiles and the action are at least 44 px", async ({ page, baseURL }) => {
    const { id } = await setup(page, baseURL!);
    await open(page, id);
    for (const name of ["Keep original", /Calm studio/, /Office wall/]) {
      const box = await section(page).getByRole("radio", { name }).locator("..").boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await section(page)
      .getByRole("radio", { name: /Calm studio/ })
      .check({ force: true });
    const action = await render(page).boundingBox();
    expect(action?.height).toBeGreaterThanOrEqual(44);
  });
});

test("a refresh that was fetched before a delete cannot bring the deleted background back", async ({
  page,
  baseURL,
}) => {
  const { id, state } = await setup(page, baseURL!);
  let release: () => void = () => undefined;
  await page.route("**/api/backgrounds/*", (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    // The refresh after the delete is answered from the list as it was, and late.
    state.gate = new Promise<void>((resolve) => (release = resolve));
    return route.fulfill({ status: 204 });
  });
  await open(page, id);
  await section(page).getByRole("button", { name: "Delete Office wall" }).click();
  await expect(section(page).getByRole("radio", { name: /Office wall/ })).toHaveCount(0);
  release();
  await page.waitForTimeout(800);
  await expect(section(page).getByRole("radio", { name: /Office wall/ })).toHaveCount(0);
});
