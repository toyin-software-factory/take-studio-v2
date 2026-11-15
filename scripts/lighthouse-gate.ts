/**
 * The Lighthouse score gate (B2-T114). Pure: takes the measured medians and failed audits of each
 * page and returns what broke the recorded numbers. Performance is not here on purpose: it is noisy
 * on shared runners, so it stays report only.
 *
 * To change a number, edit `MIN_SCORE` or `NOINDEX_ALLOWED_SEO_FAILURES` below, update the table in
 * `docs/reviews/launch-lighthouse-review.md` and the line in `scripts/AGENTS.md` in the same PR.
 */

export type GatedCategory = "accessibility" | "best-practices" | "seo";

/** The least score (0 to 1, medians over the runs) an indexable page may have, per category. */
export const MIN_SCORE: Readonly<Record<GatedCategory, number>> = {
  accessibility: 1,
  "best-practices": 1,
  seo: 1,
};

/**
 * Pages that are noindex on purpose (sign in, library, take page, record) fail `is-crawlable`
 * and score 63 on SEO. Nothing else may fail in SEO there; their accessibility and best practices
 * minimums are the same as everywhere.
 */
export const NOINDEX_ALLOWED_SEO_FAILURES: readonly string[] = ["is-crawlable"];

export type GatePage = {
  readonly name: string;
  /** False for the pages that send `noindex` on purpose. */
  readonly indexable: boolean;
  readonly scores: Readonly<Record<GatedCategory, number | null>>;
  /** Ids of the SEO audits that failed in any run. */
  readonly failedSeoAudits: readonly string[];
};

const pct = (score: number) => String(Math.round(score * 100));

const ALL_CATEGORIES: readonly GatedCategory[] = ["accessibility", "best-practices", "seo"];

function scoreViolations(page: GatePage): readonly string[] {
  return ALL_CATEGORIES.flatMap((category) => {
    const score = page.scores[category];
    // A null score fails everywhere, SEO on a noindex page included.
    if (score === null) return [`${page.name}: ${category} has no score, so it cannot be checked`];
    // A noindex page is not held to the SEO minimum; its failing audit list is checked instead.
    if (category === "seo" && !page.indexable) return [];
    if (score < MIN_SCORE[category]) {
      return [
        `${page.name}: ${category} is ${pct(score)}, the least allowed is ${pct(MIN_SCORE[category])}`,
      ];
    }
    return [];
  });
}

function noindexSeoViolations(page: GatePage): readonly string[] {
  if (page.indexable) return [];
  const unexpected = page.failedSeoAudits.filter(
    (id) => !NOINDEX_ALLOWED_SEO_FAILURES.includes(id),
  );
  const missing = NOINDEX_ALLOWED_SEO_FAILURES.filter((id) => !page.failedSeoAudits.includes(id));
  return [
    ...unexpected.map(
      (id) => `${page.name}: SEO audit ${id} fails, only is-crawlable may on a noindex page`,
    ),
    ...missing.map(
      (id) => `${page.name}: SEO audit ${id} no longer fails, the page may have lost its noindex`,
    ),
  ];
}

/** Every way the pages break the recorded numbers; empty when the gate passes. */
export function gateViolations(pages: readonly GatePage[]): readonly string[] {
  return pages.flatMap((page) => [...scoreViolations(page), ...noindexSeoViolations(page)]);
}
