import { test } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import {
  CALM,
  R2,
  WARM,
  cleanups,
  clip,
  expect,
  open,
  section,
  setup,
} from "./fixtures/background-take-page";

test.describe.configure({ timeout: 90_000 });

test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups.length = 0;
});

const READY_PREVIEW = {
  post: { status: 200, json: { state: "ready", url: `${R2}/preview.png`, noGreenScreen: false } },
};

// S3S-T14: a still preview must not look like a video that will not play.
test("while a still shows, the transport is hidden and the stage says it is a still; Back restores the video", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, { preview: READY_PREVIEW });
  await open(page, id);
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await page.locator("video").evaluate((v) => v.setAttribute("data-mark", "same"));
  await section(page)
    .getByRole("radio", { name: /Calm studio/ })
    .check({ force: true });
  const still = page.getByAltText("Preview of your take on Calm studio");
  await expect(still).toBeVisible();

  // The label (announced: role=status), the banner, and no playable controls.
  const status = page.getByRole("status").filter({ hasText: "Still preview, not a video" });
  await expect(status).toHaveText(
    "Still preview, not a video. Press \u201cRender\u201d to make it.",
  );
  await expect(page.getByText("Preview, not your video yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Play" })).toBeHidden();
  await expect(page.getByRole("slider", { name: "Seek" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Mute" })).toBeHidden();
  // The video is paused under the still, and a click on the still does not start it.
  expect(await page.locator("video").evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await still.click({ force: true });
  expect(await page.locator("video").evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);

  // Back to your video: the controls and the picture return, on the same video element.
  await page.getByRole("button", { name: "Back to your video" }).click();
  await expect(still).toHaveCount(0);
  await expect(status).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Seek" })).toBeVisible();
  await expect(page.locator("video[data-mark=same]")).toHaveCount(1);
  await expect(section(page).getByRole("radio", { name: /Keep original/ })).toBeChecked();
  await expect(page.getByRole("button", { name: "Back to your video" })).toHaveCount(0);
});

test("the stage line names Render when the original is what is previewed", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, {
    detail: { background: { id: CALM, name: "Calm studio", keyed: true } },
  });
  await open(page, id);
  await section(page).getByRole("radio", { name: "Keep original" }).check({ force: true });
  await expect(
    page.getByRole("status").filter({ hasText: "Still preview, not a video" }),
  ).toContainText("\u201cRender\u201d");
  await expect(page.getByRole("button", { name: "Play" })).toBeHidden();
  // Returning to the current background (Calm studio) ends the preview too.
  await page.getByRole("button", { name: "Back to your video" }).click();
  await expect(section(page).getByRole("radio", { name: /Calm studio/ })).toBeChecked();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
});

test("focus is not left on a control that gets hidden: it moves to Back to your video", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, { preview: READY_PREVIEW });
  await open(page, id);
  await page.getByRole("button", { name: "Play" }).focus();
  await expect(page.getByRole("button", { name: "Play" })).toBeFocused();
  // Choose a studio without moving focus (a click through the DOM).
  await section(page)
    .getByRole("radio", { name: /Calm studio/ })
    .evaluate((el: HTMLInputElement) => el.click());
  await expect(page.getByAltText("Preview of your take on Calm studio")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to your video" })).toBeFocused();
});

test("axe finds no serious issues while a still preview shows", async ({ page, baseURL }) => {
  const { id } = await setup(page, baseURL!, { preview: READY_PREVIEW });
  await open(page, id);
  await section(page)
    .getByRole("radio", { name: /Calm studio/ })
    .check({ force: true });
  await expect(page.getByRole("status").filter({ hasText: "Still preview" })).toBeVisible();
  await expectNoSeriousAxeIssues(page);
});

// S3S-T13: the page after a background change.
test("a render finishing swaps the player source and the page, without a reload, and clears the preview", async ({
  page,
  baseURL,
}) => {
  const { id, state } = await setup(page, baseURL!, {
    detail: { latestRender: { id: "render-1", status: "succeeded", durationMs: 3000 } },
    preview: {
      post: {
        status: 200,
        json: { state: "ready", url: `${R2}/preview.png`, noGreenScreen: false },
      },
    },
  });
  let plays = 0;
  await page.route("**/api/takes/*/media?kind=play", (r) => {
    plays += 1;
    return r.fulfill({
      json: { url: `${R2}/${plays === 1 ? "clip" : "clip2"}.mp4`, expiresInSeconds: 3600 },
    });
  });
  await page.route(`${R2}/clip2.mp4`, (r) =>
    r.fulfill({
      body: clip,
      contentType: "video/mp4",
      headers: { "access-control-allow-origin": "*", "accept-ranges": "bytes" },
    }),
  );
  const downloads: string[] = [];
  await page.route("**/api/takes/*/media?kind=download", (r) => {
    downloads.push(r.request().url());
    return r.fulfill({ status: 500, json: { error: "x", message: "stub" } });
  });
  await open(page, id);
  await expect(page.locator("video")).toHaveAttribute("src", `${R2}/clip.mp4`);
  await page.locator("video").evaluate((v) => v.setAttribute("data-mark", "same"));
  // This tab picked Warm studio and is looking at its preview.
  await section(page)
    .getByRole("radio", { name: /Warm studio/ })
    .check({ force: true });
  await expect(page.getByAltText("Preview of your take on Warm studio")).toBeVisible();

  // Meanwhile the change finished (in this tab or another): the next check finds a new render.
  state.detail = {
    latestRender: { id: "render-2", status: "succeeded", durationMs: 3000 },
    background: { id: WARM, name: "Warm studio", keyed: true },
  };
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator("video")).toHaveAttribute("src", `${R2}/clip2.mp4`);
  // Same element, no reload: the page and the stage both caught up.
  await expect(page.locator("video[data-mark=same]")).toHaveCount(1);
  await expect(section(page)).toContainText("Now: Warm studio");
  await expect(page.getByText("Preview, not your video yet")).toHaveCount(0);
  // Download asks the server when clicked, so it gives the new render.
  await page.getByRole("button", { name: "Download", exact: true }).click();
  await expect.poll(() => downloads.length).toBe(1);
});
