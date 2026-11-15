import { expect as baseExpect, test, type Page } from "@playwright/test";
import { signIn } from "./support/session";

// The Review step's upload (spec 0021 AC-1, B2-T147): Cancel stops the transfer and keeps the
// take, and Try again sends the same take once the storage answers. The upload API and storage
// are stubbed; the part PUT is held open so there is something to cancel. Fake camera only.
const expect = baseExpect.configure({ timeout: 30_000 });
test.describe.configure({ timeout: 90_000 });
test.use({
  permissions: ["camera", "microphone"],
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

const R2 = "https://r2.test";
const takeId = "00000000-0000-4000-8000-0000000000a1";
let cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

/** The part PUT hangs until `release()`; `puts` counts how many were sent. */
async function stubSlowUpload(page: Page) {
  const state = { puts: 0, hold: true, creates: 0 };
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/uploads", (route) => {
    state.creates += 1;
    return route.fulfill({ status: 201, json: { takeId, partSize: 16 * 1024 ** 2, partCount: 1 } });
  });
  await page.route(`**/api/uploads/${takeId}/parts`, (route) =>
    route.fulfill({
      json: { parts: [{ partNumber: 1, url: `${R2}/part/1` }], expiresInSeconds: 900 },
    }),
  );
  await page.route(`${R2}/part/1`, async (route) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "PUT",
      "access-control-allow-headers": "content-type",
      "access-control-expose-headers": "ETag",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    state.puts += 1;
    if (state.hold) await gate.catch(() => {});
    return route.fulfill({ status: 200, headers: { ...cors, etag: '"abc123"' } }).catch(() => {});
  });
  await page.route(`**/api/uploads/${takeId}/complete`, (route) =>
    route.fulfill({ json: { takeId, status: "uploading" } }),
  );
  return {
    state,
    open: () => {
      state.hold = false;
      release();
    },
  };
}

async function recordATake(page: Page) {
  await page.getByRole("button", { name: "Turn on camera" }).click();
  await page.getByRole("button", { name: "Record" }).click();
  await expect(page.getByTestId("record-timer")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("button", { name: "Use this take" })).toBeVisible();
}

test("Cancel stops the upload, keeps the take, and Try again sends it (AC-1)", async ({
  page,
  baseURL,
}) => {
  const { cleanup } = await signIn(page.context(), baseURL!);
  cleanups.push(cleanup);
  await page.route("**/api/backgrounds", (r) =>
    r.fulfill({ json: { builtIn: [], mine: [], defaultId: null } }),
  );
  const upload = await stubSlowUpload(page);
  await page.goto("/record");
  await recordATake(page);

  await page.getByRole("button", { name: "Use this take" }).click();
  await expect(page.getByRole("progressbar", { name: "Upload progress" })).toBeVisible();
  await expect.poll(() => upload.state.puts).toBe(1);
  await page.getByRole("button", { name: "Cancel" }).click();

  // Back on Review with the same take: the reason, no progress bar, the video still playable.
  await expect(page.getByRole("alert").filter({ hasText: "wasn't uploaded" })).toContainText(
    "The upload was cancelled.",
  );
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.getByLabel("Your recording")).toBeVisible();
  await expect(page.getByRole("link", { name: "Save to device" })).toBeVisible();
  await expect(page).toHaveURL(/\/record/);

  upload.open();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page).toHaveURL(`/takes/${takeId}`);
  expect(upload.state.creates).toBe(2);
});
