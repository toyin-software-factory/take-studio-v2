import { expect as baseExpect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { signIn } from "./support/session";

// The /record page (spec 0021 task 1: AC-1, AC-3, AC-4 browser side, AC-5 denied). Chromium's
// fake camera and microphone stand in for a device; the upload API and storage are stubbed so
// each answer is exact. Real iPhone and Android runs are listed for /check verify.
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

async function setup(page: Page, baseURL: string) {
  const { cleanup } = await signIn(page.context(), baseURL);
  cleanups.push(cleanup);
  await page.route("**/api/backgrounds", (r) =>
    r.fulfill({ json: { builtIn: [], mine: [], defaultId: null } }),
  );
}

/** Stubs the whole upload; `created` collects the create bodies. */
async function stubUpload(page: Page, created: unknown[], createStatus = 201) {
  await page.route("**/api/uploads", (route) => {
    created.push(route.request().postDataJSON());
    return createStatus === 201
      ? route.fulfill({
          status: 201,
          json: { takeId, partSize: 16 * 1024 ** 2, partCount: 1 },
        })
      : route.fulfill({
          status: createStatus,
          json: { message: "That would use more than you have left." },
        });
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
}

async function recordTwoSeconds(page: Page) {
  await page.getByRole("button", { name: "Turn on camera" }).click();
  await page.getByRole("button", { name: "Record" }).click();
  await expect(page.getByTestId("record-timer")).toBeVisible();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("button", { name: "Use this take" })).toBeVisible();
}

test("records with a script, reviews, uploads and opens the take (AC-1, AC-3, AC-4)", async ({
  page,
  baseURL,
}) => {
  await setup(page, baseURL!);
  const created: unknown[] = [];
  await stubUpload(page, created);

  await page.goto("/record");
  await expect(page.getByRole("heading", { name: "Record a take" })).toBeVisible();
  await expectNoSeriousAxeIssues(page);
  await page.getByLabel("Script (optional)").fill("Hello and welcome. ".repeat(40));
  await page.getByRole("button", { name: "Turn on camera" }).click();
  await expect(page.getByRole("button", { name: "Record" })).toBeVisible();
  await expect(page.getByLabel("Camera preview")).toBeVisible();
  await expectNoSeriousAxeIssues(page);

  await page.getByRole("button", { name: "Record" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Recording starts" })).toHaveText(
    "Recording starts in 3",
  );
  await expect(page.getByTestId("record-timer")).toBeVisible();
  await expect(page.getByTestId("script-scroll")).toBeVisible();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "Stop" }).click();

  await expect(page.getByLabel("Your recording")).toBeVisible();
  await expect(page.getByRole("button", { name: "Record again" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Save to your device" })).toBeVisible();
  await expectNoSeriousAxeIssues(page);

  await page.getByRole("button", { name: "Use this take" }).click();
  await expect(page).toHaveURL(`/takes/${takeId}`);
  expect(created).toHaveLength(1);
  const body = created[0] as { fileName: string; container: string; sizeBytes: number };
  expect(body.fileName).toMatch(/^Recording \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.(webm|mp4)$/);
  expect(["webm", "mp4"]).toContain(body.container);
  expect(body.sizeBytes).toBeGreaterThan(0);
});

test("Record again brings the camera back; a refused upload keeps the take (AC-1)", async ({
  page,
  baseURL,
}) => {
  await setup(page, baseURL!);
  await stubUpload(page, [], 403);

  await page.goto("/record");
  await recordTwoSeconds(page);
  await page.getByRole("button", { name: "Use this take" }).click();
  await expect(page.getByText("This take wasn't uploaded")).toBeVisible();
  await expect(page.getByLabel("Your recording")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

  await page.getByRole("button", { name: "Record again" }).click();
  await expect(page.getByLabel("Camera preview")).toBeVisible();
  await expect(page.getByRole("button", { name: "Record" })).toBeVisible();
});

test("a blocked camera says so and offers a file upload (AC-5)", async ({ page, baseURL }) => {
  await setup(page, baseURL!);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("blocked", "NotAllowedError"));
  });
  await page.goto("/record");
  await page.getByRole("button", { name: "Turn on camera" }).click();
  await expect(page.getByText("Camera or microphone is blocked")).toBeVisible();
  await expect(page.getByRole("link", { name: "Upload a file instead" })).toBeVisible();
  await expectNoSeriousAxeIssues(page);
});

test("a busy camera says so; Try again works without a reload (AC-5)", async ({
  page,
  baseURL,
}) => {
  await setup(page, baseURL!);
  await page.addInitScript(() => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let calls = 0;
    navigator.mediaDevices.getUserMedia = (c) =>
      calls++ === 0 ? Promise.reject(new DOMException("busy", "NotReadableError")) : real(c);
  });
  await page.goto("/record");
  await page.getByRole("button", { name: "Turn on camera" }).click();
  await expect(page.getByText("Your camera or microphone is busy")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByLabel("Camera preview")).toBeVisible();
  await expect(page.getByRole("img", { name: /Microphone level:/ })).toBeVisible();
});

test("the failure screen has no sideways scroll on a phone (AC-5, AC-10)", async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await setup(page, baseURL!);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("blocked", "NotAllowedError"));
  });
  await page.goto("/record");
  await page.getByRole("button", { name: "Turn on camera" }).click();
  await expect(page.getByText("Camera or microphone is blocked")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the library has a Record button beside Choose a video", async ({ page, baseURL }) => {
  await setup(page, baseURL!);
  await page.goto("/library");
  await page.getByRole("link", { name: "Record" }).click();
  await expect(page).toHaveURL("/record");
});
