import { expect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssuesWhenSettled } from "./support/axe";
import { R2 } from "./fixtures/takes";

// The homepage drop card (spec 0023 AC-1, AC-2, AC-13). The Turnstile script, the guest routes
// and storage are stubbed; the card, the upload client and the keyboard paths are the real ones.
test.describe.configure({ timeout: 90_000 });

const HAS_KEY = Boolean(process.env.TURNSTILE_SITE_KEY);
const TAKE = "00000000-0000-4000-8000-0000000000aa";

const WIDGET = `window.turnstile={_c:{},render(el,o){const id='w'+Math.random();this._c[id]=o;return id},execute(id){this._c[id].callback('stub-token')},reset(){},remove(){}};`;

async function stubGuest(page: Page, hold?: Promise<void>) {
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
  await page.route(`${R2}/part/1`, async (route) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "PUT",
      "access-control-allow-headers": "content-type",
      "access-control-expose-headers": "ETag",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    await hold;
    return route.fulfill({ status: 200, headers: { ...cors, etag: '"abc123"' } });
  });
  await page.route(`**/api/uploads/${TAKE}/complete`, (route) =>
    route.fulfill({ json: { takeId: TAKE, status: "uploading" } }),
  );
}

test("without a bot check key the card sends the visitor to sign in (AC-1)", async ({ page }) => {
  test.skip(HAS_KEY, "only when TURNSTILE_SITE_KEY is unset");
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles("tests/fixtures/clip.mp4");
  await expect(page.locator(".h-drop-alert, .h-drop-refused")).toContainText("Sign in");
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
});

test.describe("with a bot check key", () => {
  test.skip(!HAS_KEY, "needs TURNSTILE_SITE_KEY (CI sets Cloudflare's test key)");

  test("a bad file is refused in words, before anything is sent (AC-1, AC-13)", async ({
    page,
  }) => {
    await stubGuest(page);
    await page.goto("/");
    await page.locator("input[type=file]").setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hi"),
    });
    await expect(page.locator(".h-drop-alert")).toBeVisible();
    await expect(page.getByLabel("Where should we send it?")).toHaveCount(0);
  });

  test("upload shows progress, the email step opens at once and the link is sent (AC-1, AC-2)", async ({
    page,
  }) => {
    let release!: () => void;
    await stubGuest(page, new Promise<void>((r) => (release = r)));
    let sent: unknown;
    await page.route("**/api/guest/email", (route) => {
      sent = route.request().postDataJSON();
      return route.fulfill({ json: { ok: true } });
    });
    await page.goto("/");
    await page.locator("input[type=file]").setInputFiles("tests/fixtures/clip.mp4");
    await expect(page.getByRole("progressbar", { name: "Upload progress" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(page.locator(".h-drop-progress")).toContainText(/(KB|MB)( · \d+:\d\d)?/);
    await expect(page.getByText("Step 2 of 3: Upload and email")).toBeAttached();

    const field = page.getByLabel("Where should we send it?");
    await field.fill("not an email");
    await page.getByRole("button", { name: "Send me the link" }).click();
    await expect(page.locator("#drop-email-error")).toHaveText(
      "Enter a real email address, like name@example.com.",
    );

    await field.fill("maker@example.com");
    await expectNoSeriousAxeIssuesWhenSettled(page);
    await field.press("Enter");
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeFocused();
    expect(sent).toEqual({ email: "maker@example.com" });
    await expect(page.getByText("maker@example.com")).toBeVisible();
    await expect(page.getByText("Step 3 of 3: Check your email")).toBeAttached();
    release();
    await expect(page.locator(".h-drop-tick")).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Upload progress" })).toHaveCount(0);
  });

  test("a video over the free length is refused before it is sent, with the number (item 1, 2)", async ({
    page,
  }) => {
    await stubGuest(page);
    let created = 0;
    await page.route("**/api/guest/uploads", (route) => {
      created += 1;
      return route.abort();
    });
    await page.addInitScript(() =>
      Object.defineProperty(HTMLMediaElement.prototype, "duration", { get: () => 240 }),
    );
    await page.goto("/");
    await page.locator("input[type=file]").setInputFiles("tests/fixtures/clip.mp4");
    await expect(page.locator(".h-drop-alert")).toHaveText(
      "That video is longer than we can take for a free try (3 minutes). Trim it or sign in to upload a longer one.",
    );
    expect(created).toBe(0);
  });

  test("the card works at phone width without sideways scrolling (AC-13)", async ({ page }) => {
    await stubGuest(page);
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/");
    const card = page.getByRole("region", { name: "Try it without an account" });
    await expect(card).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    for (const button of await card.locator("button").all()) {
      const box = await button.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});

test("the idle card has no serious accessibility issues and the button opens by keyboard (AC-13)", async ({
  page,
}) => {
  await page.goto("/");
  const choose = page.getByRole("button", { name: "Choose a file" });
  await choose.focus();
  await expect(choose).toBeFocused();
  await expectNoSeriousAxeIssuesWhenSettled(page);
});
