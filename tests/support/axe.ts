import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** axe at WCAG 2.2 AA: no serious or critical issues on the page as it is now. */
export async function expectNoSeriousAxeIssues(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}
