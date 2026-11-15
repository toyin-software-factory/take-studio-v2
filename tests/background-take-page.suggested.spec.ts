import { test } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import {
  CALM,
  R2,
  SUGGESTION,
  WARM,
  bar,
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

test("shows the grid, the current background and the clean edges tip (AC-4, AC-11)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!);
  await open(page, id);
  await expect(section(page)).toContainText("Now: your original background");
  await expect(section(page).getByRole("heading", { name: "Studios" })).toBeVisible();
  await expect(section(page).getByRole("radio", { name: /Calm studio/ })).toBeVisible();
  await expect(section(page).getByRole("heading", { name: "Your backgrounds" })).toBeVisible();
  await expect(section(page).getByText("Upload image")).toBeVisible();
  await expect(section(page).getByText(/Getting clean edges/)).toBeVisible();
  // Nothing is picked yet, so the pending bar has nothing to say.
  await expect(bar(page)).toHaveCount(0);
});

test("the suggested background card: Use it puts the change in the pending bar, nothing renders by itself (spec 0012 AC-5)", async ({
  page,
  baseURL,
}) => {
  const { id, state } = await setup(page, baseURL!, { detail: { suggestion: SUGGESTION } });
  await open(page, id);
  const card = section(page).getByTestId("suggested-background");
  await expect(card.getByRole("heading", { name: "Suggested: Warm studio" })).toBeVisible();
  await expect(card).toContainText("Suits a calm interview.");
  await expect(bar(page)).toHaveCount(0);
  await expectNoSeriousAxeIssues(page);
  await card.getByRole("button", { name: "Use it" }).click();
  await expect(bar(page)).toContainText("Background: Warm studio");
  await expect(section(page).getByRole("radio", { name: /Warm studio/ })).toBeChecked();
  await expect(card.getByRole("button", { name: "Use it" })).toHaveCount(0);
  await expect(card).toContainText("Press Render");
  expect(state.calls.some((c) => c.startsWith("POST"))).toBe(false);
  await render(page).click();
  await expect.poll(() => state.calls.some((c) => c.startsWith("POST"))).toBe(true);
  expect(state.calls.find((c) => c.startsWith("POST"))).toContain(`"background":{"id":"${WARM}"}`);
});

const HIDDEN: readonly (readonly [string, Record<string, unknown>])[] = [
  ["there is no suggestion", { suggestion: null }],
  [
    "it is the current background",
    { suggestion: SUGGESTION, background: { id: WARM, name: "Warm studio", keyed: true } },
  ],
  ["the take has no green screen", { suggestion: SUGGESTION, noGreenScreen: true }],
];

for (const [name, detail] of HIDDEN) {
  test(`the suggested card is hidden when ${name}`, async ({ page, baseURL }) => {
    const { id } = await setup(page, baseURL!, { detail });
    await open(page, id);
    await expect(section(page).getByRole("radio", { name: /Keep original/ })).toBeVisible();
    await expect(section(page).getByTestId("suggested-background")).toHaveCount(0);
  });
}

test("picks by keyboard, previews on the stage while the video stays, then Render in the pending bar uses the background (AC-4, AC-5, AC-12)", async ({
  page,
  baseURL,
}) => {
  const { id, state } = await setup(page, baseURL!, {
    preview: {
      post: { status: 202, json: { state: "making", noGreenScreen: false } },
      get: [
        { status: 200, json: { state: "ready", url: `${R2}/preview.png`, noGreenScreen: false } },
      ],
    },
  });
  await open(page, id);
  await page.locator("video").evaluate((v) => v.setAttribute("data-mark", "same"));
  await section(page).getByRole("radio", { name: "Keep original" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(section(page).getByRole("radio", { name: /Calm studio/ })).toBeChecked();
  await expect(page.getByText("Making a preview with Calm studio")).toBeVisible();
  await expect(page.getByAltText("Preview of your take on Calm studio")).toBeVisible();
  await expect(page.getByText("Preview, not your video yet")).toBeVisible();
  await expectNoSeriousAxeIssues(page);
  // The video is the same element and still there under the preview.
  await expect(page.locator("video[data-mark=same]")).toHaveCount(1);
  // The pick is a pending change, not a render (AC-5): nothing was sent yet.
  await expect(bar(page)).toContainText("Background: Calm studio");
  expect(state.calls.some((c) => c.startsWith("POST"))).toBe(false);
  await render(page).click();
  await expect.poll(() => state.calls.some((c) => c.startsWith("POST"))).toBe(true);
  expect(state.calls.find((c) => c.startsWith("POST"))).toContain(`"background":{"id":"${CALM}"}`);
  // Making the new video: progress shows, the choice cannot start another, the old video plays on.
  await expect(page.getByRole("status").filter({ hasText: "Rendering" })).toBeVisible();
  await expect(render(page)).toBeDisabled();
  await expect(page.locator("video[data-mark=same]")).toHaveCount(1);
  await expect(page.getByText("Preview, not your video yet")).toHaveCount(0);
});

test("choosing Keep original on a take with a background shows the original frame", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, {
    detail: { background: { id: CALM, name: "Calm studio", keyed: true } },
  });
  await open(page, id);
  await expect(section(page)).toContainText("Now: Calm studio");
  await section(page).getByRole("radio", { name: "Keep original" }).check({ force: true });
  await expect(page.getByAltText("Preview of your take on your original background")).toBeVisible();
  await expect(bar(page)).toContainText("Background: Original");
});

test("says so when the video was kept on its own background (AC-3) and when a preview finds no green screen (AC-4)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, {
    detail: { noGreenScreen: true },
    preview: {
      post: {
        status: 200,
        json: { state: "ready", url: `${R2}/preview.png`, noGreenScreen: true },
      },
    },
  });
  await open(page, id);
  await expect(section(page)).toContainText(
    "We couldn't find a green screen in this take, so we kept the original background.",
  );
  await section(page)
    .getByRole("radio", { name: /Warm studio/ })
    .check({ force: true });
  await expect(section(page)).toContainText("this background wouldn't show");
  // The server refuses a real background on a take with no green screen (409 no_green_screen) and
  // the page shows that message; the note above says why. Going back to the original is no change.
  await section(page).getByRole("radio", { name: "Keep original" }).check({ force: true });
  await expect(bar(page)).toHaveCount(0);
});

test("shows a failed change from before and keeps nothing pending (AC-5)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, {
    detail: {
      backgroundJob: { status: "failed", failureCode: "internal_error", targetBackgroundId: WARM },
    },
  });
  await open(page, id);
  await expect(section(page)).toContainText(
    "The new background didn't finish. Your video is unchanged. Try again.",
  );
  await expect(bar(page)).toHaveCount(0);
});
