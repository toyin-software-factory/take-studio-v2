import { expect as baseExpect, test } from "@playwright/test";
import { expectNoSeriousAxeIssues } from "./support/axe";
import { signIn } from "./support/session";

// Privacy and Terms (spec 0015 AC-1, AC-7, AC-8, AC-12): public, the same for a signed in reader,
// one h1, a table of contents, the Draft banner while the facts are unset, axe in both themes.
const expect = baseExpect.configure({ timeout: 15_000 });

const PAGES = [
  { path: "/privacy", title: "Privacy Policy", heading: "Privacy Policy" },
  { path: "/terms", title: "Terms of Use", heading: "Terms of Use" },
] as const;

for (const { path, title, heading } of PAGES) {
  test.describe(path, () => {
    test("renders signed out with the Draft banner, a date and one h1", async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle(`${title} · Take Studio`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByText(/^Last updated \d{4}-\d{2}-\d{2}$/)).toBeVisible();
      await expect(page.getByTestId("legal-draft-banner")).toContainText("Draft, pending review");
      await expect(page.getByRole("navigation", { name: "On this page" })).toBeVisible();
      await expect(page.locator("[data-legal-copy] h2").first()).toBeVisible();
    });

    test("passes axe in the light and dark themes", async ({ page }) => {
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.goto(path);
        await expectNoSeriousAxeIssues(page);
      }
    });

    test("stays on the page for a signed in creator", async ({ page, baseURL }) => {
      const { cleanup } = await signIn(page.context(), baseURL ?? "");
      try {
        await page.goto(path);
        await expect(page).toHaveURL(new RegExp(`${path}$`));
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      } finally {
        await cleanup();
      }
    });
  });
}

for (const { path } of PAGES) {
  test.describe(`${path} accessibility and print (AC-12)`, () => {
    test("headings are ordered: one h1, then h2s, never a skipped level", async ({ page }) => {
      await page.goto(path);
      const levels = await page
        .locator("main :is(h1,h2,h3,h4,h5,h6)")
        .evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))));
      expect(levels[0]).toBe(1);
      levels.slice(1).forEach((level, i) => {
        expect(level).toBeGreaterThan(1);
        expect(level - (levels[i] ?? 1)).toBeLessThanOrEqual(1);
      });
    });

    test("every table of contents link has a matching section", async ({ page }) => {
      await page.goto(path);
      const toc = page.getByRole("navigation", { name: "On this page" });
      const hrefs = await toc
        .getByRole("link")
        .evaluateAll((els) => els.map((el) => el.getAttribute("href")));
      expect(hrefs.length).toBeGreaterThan(2);
      for (const href of hrefs) {
        expect(href).toMatch(/^#[\w-]+$/);
        await expect(page.locator(`section${href}`)).toHaveCount(1);
      }
      const ids = await page
        .locator("[data-legal-copy] > section")
        .evaluateAll((els) => els.map((el) => `#${el.id}`));
      expect(hrefs).toEqual(ids);
    });

    test("keyboard focus order: skip link, brand, contents, then the in text links", async ({
      page,
    }) => {
      await page.goto(path);
      const focused = () =>
        page.evaluate(() => {
          const el = document.activeElement;
          return el
            ? {
                text: el.textContent?.trim() ?? "",
                inToc: !!el.closest("nav[aria-label='On this page']"),
              }
            : null;
        });
      await page.keyboard.press("Tab");
      expect((await focused())?.text).toBe("Skip to content");
      await page.keyboard.press("Tab");
      expect((await focused())?.text).toBe("Take Studio");
      await page.keyboard.press("Tab");
      expect((await focused())?.inToc).toBe(true);
      // The focused link shows a visible ring (outline or ring shadow), not nothing.
      const focus = page.locator(":focus");
      const style = await focus.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { outline: cs.outlineStyle, width: cs.outlineWidth, shadow: cs.boxShadow };
      });
      expect(
        style.outline !== "none" && style.width !== "0px" ? true : style.shadow !== "none",
      ).toBe(true);
    });

    test("the text column keeps a readable line length", async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(path);
      const box = await page.locator("article p").nth(1).boundingBox();
      const font = await page
        .locator("article p")
        .nth(1)
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      // 72ch is about 0.5em per character: under ~80 characters per line.
      expect((box?.width ?? 0) / font).toBeLessThanOrEqual(80);
    });

    test("fits a phone with no sideways scroll", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 800 });
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test("prints without the header or table of contents, as dark text on white", async ({
      page,
    }) => {
      await page.emulateMedia({ media: "print", colorScheme: "dark" });
      await page.goto(path);
      await expect(page.locator("header")).toBeHidden();
      await expect(page.getByRole("navigation", { name: "On this page" })).toBeHidden();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const colours = await page.evaluate(() => {
        const rgb = (v: string) => (v.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
        const body = getComputedStyle(document.body);
        const text = getComputedStyle(document.querySelector("[data-legal-copy] p") as Element);
        return { bg: rgb(body.backgroundColor), fg: rgb(text.color) };
      });
      expect(Math.min(...colours.bg)).toBeGreaterThanOrEqual(250);
      expect(Math.max(...colours.fg)).toBeLessThanOrEqual(60);
    });
  });
}

test("the table of contents links jump to a section", async ({ page }) => {
  await page.goto("/privacy");
  await page.getByRole("navigation", { name: "On this page" }).getByRole("link").nth(1).click();
  await expect(page).toHaveURL(/#collect$/);
  await expect(page.locator("#collect")).toBeInViewport();
});

test("the homepage footer links Privacy and Terms", async ({ page }) => {
  await page.goto("/");
  const footer = page.locator("footer");
  await expect(footer.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  await expect(footer.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
});
