import { test } from "@playwright/test";
import {
  R2,
  WARM,
  bar,
  cleanups,
  clip,
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

test("a change refused because one is already running says so, and the page catches up", async ({
  page,
  baseURL,
}) => {
  const { id, state } = await setup(page, baseURL!, {
    put: { status: 409, json: { error: "job_active" } },
  });
  await open(page, id);
  await section(page)
    .getByRole("radio", { name: /Calm studio/ })
    .check({ force: true });
  // The other tab's change starts as this tab's request arrives. Setting it any earlier races the
  // page's own polling: it could disable the button before the click (CI hit that after the v2
  // restyle changed load timing).
  state.afterPut = () => {
    state.detail = {
      backgroundJob: { status: "running", failureCode: null, targetBackgroundId: WARM },
    };
  };
  await render(page).click();
  // The refusal also read the take again: the running change now locks the bar. The pick stays.
  await expect(page.getByRole("status").filter({ hasText: "Rendering" })).toBeVisible();
  await expect(bar(page)).toContainText("Background: Calm studio");
  await expect(render(page)).toBeDisabled();
});

test("a refusal with no message body still tells the creator (never silent)", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!, { put: { status: 502, json: undefined } });
  await open(page, id);
  await section(page)
    .getByRole("radio", { name: /Calm studio/ })
    .check({ force: true });
  await render(page).click();
  await expect(page.getByRole("status").filter({ hasText: "didn't start" })).toBeVisible();
});

test("the Keep original tile shows the take's thumbnail, and gets a fresh link when the old one has expired", async ({
  page,
  baseURL,
}) => {
  const { id } = await setup(page, baseURL!);
  let links = 0;
  await page.route("**/api/takes/*/media?kind=thumb", (r) => {
    links += 1;
    // The first link has expired (R2 answers 403); the second works.
    return r.fulfill({
      json: { url: `${R2}/${links === 1 ? "expired" : "original"}.png`, expiresInSeconds: 3600 },
    });
  });
  await page.route(`${R2}/expired.png`, (r) =>
    r.fulfill({ status: 403, body: "Request has expired" }),
  );
  await open(page, id);
  const tile = section(page)
    .getByRole("radio", { name: /Keep original/ })
    .locator("..");
  const img = tile.locator("img");
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  expect(links).toBeGreaterThanOrEqual(1);
});

test("when the new video's link fails, the current video keeps playing and Try again swaps it", async ({
  page,
  baseURL,
}) => {
  const { id, state } = await setup(page, baseURL!, {
    detail: { latestRender: { id: "render-1", status: "succeeded", durationMs: 3000 } },
  });
  let fresh = false;
  let broken = false;
  await page.route("**/api/takes/*/media?kind=play", (r) =>
    broken
      ? r.fulfill({ status: 500, json: { error: "storage_error", message: "stub" } })
      : r.fulfill({
          json: { url: `${R2}/${fresh ? "clip2" : "clip"}.mp4`, expiresInSeconds: 3600 },
        }),
  );
  await page.route(`${R2}/clip2.mp4`, (r) =>
    r.fulfill({
      body: clip,
      contentType: "video/mp4",
      headers: { "access-control-allow-origin": "*", "accept-ranges": "bytes" },
    }),
  );
  await open(page, id);
  await expect(page.locator("video")).toHaveAttribute("src", `${R2}/clip.mp4`);
  await page.locator("video").evaluate((v) => v.setAttribute("data-mark", "same"));

  broken = true;
  state.detail = { latestRender: { id: "render-2", status: "succeeded", durationMs: 3000 } };
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  // A few quiet tries, then a message; the working video is never taken away.
  await expect(page.getByText(/didn.t load\./)).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("video[data-mark=same]")).toHaveAttribute("src", `${R2}/clip.mp4`);

  broken = false;
  fresh = true;
  await page
    .getByRole("status")
    .filter({ hasText: /didn.t load\./ })
    .getByRole("button", { name: "Try again" })
    .click();
  await expect(page.locator("video[data-mark=same]")).toHaveAttribute("src", `${R2}/clip2.mp4`);
  await expect(page.getByText(/didn.t load\./)).toHaveCount(0);
});
