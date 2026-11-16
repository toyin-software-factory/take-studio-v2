import { expect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssuesWhenSettled } from "./support/axe";
import { R2 } from "./fixtures/takes";

// Spec 0023 AC-10: a guest plays the finished render in the drop card before claiming it. The
// guest routes, Turnstile and storage are stubbed; the card, the polling hook and the player are
// the real ones. The play link itself (a real presigned R2 URL) needs a deployed check.
test.describe.configure({ timeout: 90_000 });

const HAS_KEY = Boolean(process.env.TURNSTILE_SITE_KEY);
const TAKE = "00000000-0000-4000-8000-0000000000bb";
const PLAY = `${R2}/play/final.mp4`;

const WIDGET = `window.turnstile={_c:{},render(el,o){const id='w'+Math.random();this._c[id]=o;return id},execute(id){this._c[id].callback('stub-token')},reset(){},remove(){}};`;

async function stubUpload(page: Page) {
  await page.route("**/challenges.cloudflare.com/**", (route) =>
    route.fulfill({ contentType: "text/javascript", body: WIDGET }),
  );
  await page.route("**/api/guest/uploads", (route) =>
    route.fulfill({ status: 201, json: { takeId: TAKE, partSize: 16 * 1024 ** 2, partCount: 1 } }),
  );
  await page.route(`**/api/uploads/${TAKE}/parts`, (route) =>
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
  await page.route(`**/api/uploads/${TAKE}/complete`, (route) =>
    route.fulfill({ json: { takeId: TAKE, status: "uploading" } }),
  );
  await page.route("**/api/guest/email", (route) => route.fulfill({ json: { ok: true } }));
  await page.route(PLAY, (route) =>
    route.fulfill({ status: 200, contentType: "video/mp4", body: "" }),
  );
}

async function sendEmail(page: Page) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles("tests/fixtures/clip.mp4");
  const field = page.getByLabel("Where should we send it?");
  await field.fill("maker@example.com");
  await field.press("Enter");
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
}

test.describe("guest result view", () => {
  test.skip(!HAS_KEY, "needs TURNSTILE_SITE_KEY (CI sets Cloudflare's test key)");

  test("the guest plays the finished render before claiming, with no download (AC-10)", async ({
    page,
  }) => {
    await stubUpload(page);
    let polls = 0;
    await page.route("**/api/guest/take", (route) => {
      polls += 1;
      return route.fulfill({
        json:
          polls < 2
            ? { status: "processing", playUrl: null, expiresInSeconds: null }
            : { status: "ready", playUrl: PLAY, expiresInSeconds: 3600 },
      });
    });
    await sendEmail(page);

    const result = page.locator(".h-drop-result");
    const keep = page.getByText("Check your email to keep it");
    await expect(keep).toBeVisible();
    await expect(result.getByRole("status")).toContainText("working on your take");

    const video = page.getByLabel("Your finished take");
    await expect(video).toBeVisible({ timeout: 20_000 });
    await expect(video).toHaveAttribute("src", PLAY);
    await expect(video).toHaveJSProperty("controls", true);
    await expect(video).toHaveAttribute("controlslist", /nodownload/);
    await expect(result.getByRole("status")).toContainText("Your take is ready");
    await expect(page.locator("a[download], a[href*='download']")).toHaveCount(0);
    await expect(keep).toBeVisible();

    await video.focus();
    await expect(video).toBeFocused();
    await expectNoSeriousAxeIssuesWhenSettled(page);
  });

  test("a failed take says so in words and keeps the email note (AC-10)", async ({ page }) => {
    await stubUpload(page);
    await page.route("**/api/guest/take", (route) =>
      route.fulfill({ json: { status: "failed", playUrl: null, expiresInSeconds: null } }),
    );
    await sendEmail(page);
    await expect(page.locator(".h-drop-result").getByRole("status")).toContainText(
      "couldn't finish",
      {
        timeout: 20_000,
      },
    );
    await expect(page.getByLabel("Your finished take")).toHaveCount(0);
    await expect(page.getByText("Check your email to keep it")).toBeVisible();
  });

  test("a take that is gone stops the polling and says so (AC-10)", async ({ page }) => {
    await stubUpload(page);
    let polls = 0;
    await page.route("**/api/guest/take", (route) => {
      polls += 1;
      return route.fulfill({ status: 404, json: { error: "not_found" } });
    });
    await sendEmail(page);
    await expect(page.locator(".h-drop-result").getByRole("status")).toContainText(
      "no longer available",
      { timeout: 20_000 },
    );
    await page.waitForTimeout(6_000);
    expect(polls).toBe(1);
    await expect(page.getByText("Check your email to keep it")).toBeVisible();
  });
});
