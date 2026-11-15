import { expect, test } from "@playwright/test";
import { FAQ } from "../src/components/home/content";
import { expectNoSeriousAxeIssues, expectNoSeriousAxeIssuesWhenSettled } from "./support/axe";

// The signed out homepage (spec 0010, build task 1: AC-1, AC-2, AC-3, AC-7, AC-9, AC-11).
test.describe.configure({ timeout: 90_000 });

test("the skip link comes first and the FAQ opens and closes by keyboard (AC-7, AC-9)", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();

  const first = page.getByRole("button", { name: /What do I need to film/ });
  await first.scrollIntoViewIfNeeded();
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#faq-1")).toHaveAttribute("inert", "");
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#faq-1")).not.toHaveAttribute("inert", "");
  await expect(page.getByText(FAQ.items[0].a)).toBeVisible();
  await page.keyboard.press("Space");
  await expect(first).toHaveAttribute("aria-expanded", "false");
});

test("the images load as files (AVIF where supported) and the videos are not base64 (AC-11)", async ({
  page,
}) => {
  await page.goto("/");
  const imgs = page.locator("main img");
  expect(await imgs.count()).toBeGreaterThan(8);
  await page.evaluate(async () => {
    await Promise.all(
      [...document.images].map((img) => {
        img.loading = "eager";
        return img.decode().catch(() => undefined);
      }),
    );
  });
  const broken = await page.evaluate(() =>
    [...document.images].filter((i) => i.naturalWidth === 0).map((i) => i.currentSrc),
  );
  expect(broken).toEqual([]);
  const srcs = await page.evaluate(() => [...document.images].map((i) => i.currentSrc));
  for (const src of srcs) expect(src).toMatch(/\/home\/.*\.(avif|webp|jpg)$/);
  const videoSources = await page
    .locator("video source")
    .evaluateAll((els) => els.map((el) => (el as HTMLSourceElement).getAttribute("src")));
  expect(videoSources.length).toBeGreaterThanOrEqual(8);
  for (const src of videoSources) expect(src).toMatch(/^\/home\/[a-z-]+\.(mp4|webm)$/);
});

test.describe("axe", () => {
  // The page moves (entrances, word reveals, the nav), so axe runs on the settled page: a frame
  // caught mid fade has a blended colour that is not the page's real one.
  test("finds no serious issues on the settled page at desktop width (AC-9)", async ({ page }) => {
    await page.goto("/");
    await expectNoSeriousAxeIssuesWhenSettled(page);
  });
  test("finds no serious issues on the settled page at phone width, with no sideways scroll", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expectNoSeriousAxeIssuesWhenSettled(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
  test.describe("with reduced motion", () => {
    test.use({ reducedMotion: "reduce" });
    // Nothing animates here, so the very first result is the final colours (no waiting).
    for (const [name, size] of [
      ["desktop", { width: 1280, height: 720 }],
      ["phone", { width: 390, height: 844 }],
    ] as const) {
      test(`the final colours pass at ${name} width (AC-8, AC-9)`, async ({ page }) => {
        await page.setViewportSize(size);
        await page.goto("/");
        await expect(page.locator(".h-fan.is-fan")).toHaveCount(1);
        await expectNoSeriousAxeIssues(page);
      });
    }
  });
});

// The closing email form (spec 0010, s8): the same magic link as the sign in page.
test.describe("closing email form", () => {
  const send = (page: import("@playwright/test").Page) =>
    page.getByRole("button", { name: "Email me a sign in link" });

  test("sends the link and shows the check your inbox state", async ({ page }) => {
    let posted: unknown = null;
    await page.route("**/api/auth/sign-in/magic-link", (route) => {
      posted = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: true }),
      });
    });
    await page.goto("/");
    const field = page.locator("#contact").getByLabel("Email");
    await field.fill("creator@example.com");
    await send(page).click();
    await expect(page.locator("#closing-status")).toContainText("Check your inbox.");
    await expect(page.locator("#closing-status")).toContainText(
      "If creator@example.com can sign in, a link is on its way.",
    );
    expect(posted).toMatchObject({ email: "creator@example.com", callbackURL: "/library" });
  });

  test("an invalid address is caught before sending", async ({ page }) => {
    await page.goto("/");
    await page.locator("#contact").getByLabel("Email").fill("not an email");
    await send(page).click();
    await expect(page.locator("#closing-status")).toHaveText(
      "Enter an email address like you@example.com.",
    );
    // Editing the address clears the error.
    await page.locator("#contact").getByLabel("Email").fill("creator@example.com");
    await expect(page.locator("#closing-status")).toHaveText("");
    await expect(page.locator("#contact").getByLabel("Email")).toHaveAttribute(
      "aria-invalid",
      "false",
    );
  });

  test("a rate limit shows the friendly message", async ({ page }) => {
    await page.route("**/api/auth/sign-in/magic-link", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ code: "EMAIL_RATE_LIMITED", message: "x" }),
      }),
    );
    await page.goto("/");
    await page.locator("#contact").getByLabel("Email").fill("creator@example.com");
    await send(page).click();
    await expect(page.locator("#closing-status")).toContainText("Too many sign in links");
  });

  test("without scripts the form falls back to the sign in page", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/");
    await page.locator("#contact").getByLabel("Email").fill("creator@example.com");
    await send(page).click();
    await expect(page).toHaveURL(/\/sign-in\??$/);
    expect(page.url()).not.toContain("creator");
    await context.close();
  });
});
