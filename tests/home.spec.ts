import { expect, test } from "@playwright/test";
import { FAQ } from "../src/components/home/content";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { signIn } from "./support/session";

// The signed out homepage (spec 0010, build task 1: AC-1, AC-2, AC-3, AC-7, AC-9, AC-11).
test.describe.configure({ timeout: 90_000 });

const SECTIONS = ["top", "reel", "proof", "studio", "capabilities", "limits", "faq", "contact"];

test("renders the ten sections in order, with the right calls to action (AC-1, AC-2)", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Film one take. Get it back ready to post.",
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  // nav, then eight sections in main, then the footer.
  await expect(page.locator("header#nav")).toHaveCount(1);
  const ids = await page.locator("main > section").evaluateAll((els) => els.map((el) => el.id));
  expect(ids.map((id) => id || "proof")).toEqual(SECTIONS);
  await expect(page.locator("footer")).toHaveCount(1);
  // Document order: the nav comes before main, and the footer after it.
  const inOrder = await page.evaluate(() => {
    const nav = document.querySelector("header#nav")!;
    const main = document.querySelector("main")!;
    const footer = document.querySelector("footer")!;
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return follows(nav, main) && follows(main, footer);
  });
  expect(inOrder).toBe(true);

  // Sign in calls to action, and the email link; no form anywhere.
  await expect(page.getByRole("link", { name: "Upload a take" }).first()).toHaveAttribute(
    "href",
    "/sign-in",
  );
  await expect(page.getByRole("link", { name: "Upload your first take" }).first()).toHaveAttribute(
    "href",
    "/sign-in",
  );
  await expect(page.getByRole("link", { name: "hello@takestudio.app" }).first()).toHaveAttribute(
    "href",
    "mailto:hello@takestudio.app",
  );
  await expect(page.locator("form")).toHaveCount(0);

  // The limits are the product's own.
  const limits = page.getByRole("region", { name: /Simple limits/ });
  for (const text of ["10", "min", "2", "GB", "1080", "p", "30", "days"]) {
    await expect(limits).toContainText(text);
  }
  // Nothing about features that are not built.
  const body = await page.locator("body").innerText();
  for (const claim of [/review timeline/i, /monthly/i, /undo/i, /invite/i]) {
    expect(body).not.toMatch(claim);
  }
});

test("page text and metadata are in the HTML with JavaScript off (AC-3)", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Film one take.");
  await expect(page.getByRole("heading", { name: /Before you upload/ })).toBeVisible();
  // Every FAQ answer is shown without scripts.
  for (const item of FAQ.items) await expect(page.getByText(item.a)).toBeVisible();

  const html = await response!.text();
  expect(html).toContain("<title>Film one take. Get it back ready to post. · Take Studio</title>");
  const meta = (selector: string) => page.locator(selector).first().getAttribute("content");
  expect(await meta('meta[name="description"]')).toContain("trims the pauses");
  expect(await meta('meta[property="og:title"]')).toContain("Film one take");
  expect(await meta('meta[property="og:image"]')).toMatch(/opengraph-image/);
  expect(await meta('meta[property="og:image:width"]')).toBe("1200");
  expect(await meta('meta[property="og:image:height"]')).toBe("630");
  expect(await meta('meta[name="twitter:card"]')).toBe("summary_large_image");
  expect(await meta('meta[name="twitter:image"]')).toMatch(/twitter-image/);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);

  const ld = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}",
  );
  expect(ld).toMatchObject({ "@type": "SoftwareApplication", name: "Take Studio" });
  await context.close();
});

test("the share images are 1200 by 630 JPEGs", async ({ request, page }) => {
  await page.goto("/");
  for (const property of ["og:image", "twitter:image"]) {
    const attr = property.startsWith("og") ? "property" : "name";
    const url = await page.locator(`meta[${attr}="${property}"]`).first().getAttribute("content");
    const res = await request.get(url!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/jpeg");
    const bytes = await res.body();
    // JPEG SOF0/SOF2 marker holds height then width.
    let i = 2;
    let size: [number, number] | null = null;
    while (i < bytes.length) {
      if (bytes[i] !== 0xff) break;
      const marker = bytes[i + 1]!;
      const length = bytes.readUInt16BE(i + 2);
      if (marker === 0xc0 || marker === 0xc2) {
        size = [bytes.readUInt16BE(i + 7), bytes.readUInt16BE(i + 5)];
        break;
      }
      i += 2 + length;
    }
    expect(size).toEqual([1200, 630]);
  }
});

test("robots.txt and sitemap.xml list / and keep the app out (AC-3)", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toMatch(/Allow: \//);
  for (const path of ["/takes", "/design", "/api/"]) expect(robots).toContain(`Disallow: ${path}`);
  expect(robots).toMatch(/Sitemap: .*\/sitemap\.xml/);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toMatch(/<loc>[^<]*\/<\/loc>/);
  expect(sitemap).not.toMatch(/\/takes|\/design|\/api/);
});

test("signed in, / still shows the takes library (AC-1)", async ({ page, baseURL }) => {
  const { cleanup } = await signIn(page.context(), baseURL!);
  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Your takes", level: 1 })).toBeVisible();
    await expect(page.getByText("Get it back ready to post.")).toHaveCount(0);
    await expect(page).toHaveTitle("Your takes · Take Studio");
  } finally {
    await cleanup();
  }
});

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
  test("finds no serious issues on the page at desktop width (AC-9)", async ({ page }) => {
    await page.goto("/");
    await expectNoSeriousAxeIssues(page);
  });
  test("finds no serious issues at phone width and has no sideways scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expectNoSeriousAxeIssues(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
