import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { devices, expect as baseExpect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { signIn } from "./support/session";
import { seedTakes } from "./support/takes";

// Library, sign in, link expired and error pages on the v2 look (spec 0009, AC-6, AC-8, AC-9,
// AC-10): axe on each, and the rule that signed in pages load none of the homepage libraries.
const expect = baseExpect.configure({ timeout: 15_000 });

let cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()));
  cleanups = [];
});

async function seedLibrary(page: Page, baseURL: string) {
  const { user, cleanup } = await signIn(page.context(), baseURL);
  cleanups.push(cleanup);
  return seedTakes(user.id, [
    {
      title: "Founder intro",
      status: "ready",
      durationMs: 84_000,
      steps: [
        { name: "trim", status: "succeeded" },
        { name: "render", status: "succeeded" },
      ],
      removedRanges: [{ startMs: 1000, endMs: 9000 }],
      minutesAgo: 5,
    },
    {
      title: "Product demo",
      status: "processing",
      durationMs: 30_000,
      minutesAgo: 20,
      steps: [
        { name: "trim", status: "succeeded" },
        { name: "render", status: "running", progress: 40 },
      ],
    },
    {
      title: "Behind the scenes",
      status: "failed",
      failureCode: "ffmpeg_error",
      durationMs: 40_000,
      minutesAgo: 60,
    },
    { title: "Old take", status: "expired", durationMs: 20_000, expiresInDays: -2, minutesAgo: 90 },
  ]);
}

test("library with cards in every state passes axe on desktop", async ({ page, baseURL }) => {
  await seedLibrary(page, baseURL!);
  await page.goto("/library");
  await expect(page.getByRole("heading", { level: 3, name: "Founder intro" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Takes", exact: true }).getByRole("listitem"),
  ).toHaveCount(4);
  await expectNoSeriousAxeIssues(page);
});

test.describe("on a phone", () => {
  const { viewport, deviceScaleFactor } = devices["Pixel 7"];
  test.use({ viewport, deviceScaleFactor, isMobile: true, hasTouch: true });

  test("library with cards passes axe and has no sideways scroll", async ({ page, baseURL }) => {
    await seedLibrary(page, baseURL!);
    await page.goto("/library");
    await expect(page.getByRole("heading", { level: 3, name: "Founder intro" })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
    await expectNoSeriousAxeIssues(page);
  });

  test("sign in and link expired pass axe and fit a phone", async ({ page }) => {
    for (const path of ["/sign-in", "/sign-in/link-expired"]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { level: 1, name: "Sign in to Take Studio" }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "Take Studio" })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(0);
      await expectNoSeriousAxeIssues(page);
    }
  });
});

test("not found keeps its brand link and passes axe", async ({ page, baseURL }) => {
  const { cleanup } = await signIn(page.context(), baseURL!);
  cleanups.push(cleanup);
  const response = await page.goto("/takes/not-a-take");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("link", { name: "Take Studio" })).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: "Go to your takes" })
      .or(page.getByRole("link", { name: "Go to your takes" })),
  ).toBeVisible();
  await expectNoSeriousAxeIssues(page);
});

// AC-9: the homepage libraries stay out of the signed in app. Two checks: nothing outside the
// homepage imports them (the source), and the scripts a signed in page really loads carry none
// of their code (the build output, as served).
const HOME_ONLY = ["gsap", "lenis", "three"];
const importsOf = (file: string): string[] =>
  [
    ...readFileSync(file, "utf8").matchAll(
      /from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g,
    ),
  ].map((m) => m[1] ?? m[2] ?? "");

test("only the homepage imports gsap, lenis or three", () => {
  const files = (readdirSync("src", { recursive: true, encoding: "utf8" }) as string[])
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => join("src", f));
  const offenders = files.filter(
    (f) =>
      !f.startsWith(join("src", "components", "home")) &&
      importsOf(f).some((spec) =>
        HOME_ONLY.some((lib) => spec === lib || spec.startsWith(`${lib}/`)),
      ),
  );
  expect(offenders).toEqual([]);
});

const MARKER =
  /GreenSock|gsap\.(?:core|registerPlugin|version)|WebGLRenderer|THREE\.REVISION|lenis-smooth|lenis-stopped/;

/** The same origin scripts a page loads, by URL, with their text. */
async function scriptsOf(page: Page, baseURL: string, paths: string[]) {
  const scripts = new Map<string, string>();
  page.on("response", async (response) => {
    const url = response.url();
    if (response.request().resourceType() !== "script" || !url.startsWith(baseURL)) return;
    scripts.set(url, await response.text().catch(() => ""));
  });
  for (const path of paths) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  return scripts;
}

test("the signed out homepage does load the libraries (so the check below can see them)", async ({
  page,
  baseURL,
}) => {
  const scripts = await scriptsOf(page, baseURL!, ["/"]);
  const carriers = [...scripts].filter(([, code]) => MARKER.test(code));
  expect(carriers.length, "no script on the homepage carries a library marker").toBeGreaterThan(0);
});

test("signed in pages load no gsap, lenis or three code", async ({ page, baseURL }) => {
  const ids = await seedLibrary(page, baseURL!);
  const scripts = await scriptsOf(page, baseURL!, ["/library", `/takes/${ids[0]}`]);
  expect(scripts.size).toBeGreaterThan(0);
  const hits = [...scripts].filter(([, code]) => MARKER.test(code)).map(([url]) => url);
  expect(hits).toEqual([]);
});
