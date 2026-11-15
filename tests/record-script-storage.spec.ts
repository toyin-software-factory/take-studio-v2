import { expect as baseExpect, test } from "@playwright/test";
import { signIn } from "./support/session";

// B2-T142 (verify gaps in spec 0021): the browser side of AC-2 (the 20000 character cap) and
// AC-8 (the script travels with the create, the device draft is cleared once the take exists).
// Upload and storage are stubbed; Chromium's fake camera and microphone stand in for a device.
const expect = baseExpect.configure({ timeout: 30_000 });
test.describe.configure({ timeout: 90_000 });
test.use({
  permissions: ["camera", "microphone"],
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

const R2 = "https://r2.test";
const takeId = "00000000-0000-4000-8000-0000000000b2";
const SCRIPT = "Synthetic line for the lens. ".repeat(10).trim();

let cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

test.beforeEach(async ({ page, baseURL }) => {
  const { cleanup } = await signIn(page.context(), baseURL ?? "");
  cleanups.push(cleanup);
  await page.route("**/api/backgrounds", (r) =>
    r.fulfill({ json: { builtIn: [], mine: [], defaultId: null } }),
  );
});

test("the script box holds at most 20000 characters and counts them (AC-2)", async ({ page }) => {
  await page.goto("/record");
  const box = page.getByLabel("Script (optional)");
  await expect(box).toHaveAttribute("maxlength", "20000");
  await box.fill("x".repeat(20_000));
  await expect(page.getByText("20,000 / 20,000")).toBeVisible();
});

test("the script is sent with the recording, and the device draft is cleared (AC-8)", async ({
  page,
}) => {
  const created: { script?: string; source?: string }[] = [];
  await page.route("**/api/uploads", (route) => {
    created.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: { takeId, partSize: 16 * 1024 ** 2, partCount: 1 } });
  });
  await page.route(`**/api/uploads/${takeId}/parts`, (route) =>
    route.fulfill({
      json: { parts: [{ partNumber: 1, url: `${R2}/part/1` }], expiresInSeconds: 900 },
    }),
  );
  await page.route(`${R2}/part/1`, (route) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "PUT",
      "access-control-allow-headers": "content-type",
      "access-control-expose-headers": "ETag",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ status: 200, headers: { ...cors, etag: '"abc123"' } });
  });
  await page.route(`**/api/uploads/${takeId}/complete`, (route) =>
    route.fulfill({ json: { takeId, status: "uploading" } }),
  );

  await page.goto("/record");
  await page.getByLabel("Script (optional)").fill(SCRIPT);
  const draftKeys = () =>
    page.evaluate(() =>
      Object.keys(window.localStorage).filter((k) => k.startsWith("ts.scriptDraft.")),
    );
  await expect.poll(draftKeys).toHaveLength(1);

  await page.getByRole("button", { name: "Turn on camera" }).click();
  await page.getByRole("button", { name: "Record" }).click();
  await expect(page.getByTestId("record-timer")).toBeVisible();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "Stop" }).click();
  await page.getByRole("button", { name: "Use this take" }).click();
  await expect(page).toHaveURL(`/takes/${takeId}`);

  expect(created).toHaveLength(1);
  expect(created[0]?.source).toBe("recording");
  expect(created[0]?.script).toBe(SCRIPT);
  expect(await draftKeys()).toEqual([]);
});
