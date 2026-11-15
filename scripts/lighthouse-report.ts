/** The job summary: tables of the metrics and scores and the failed audit list (moved out of lighthouse-ci.ts). */
import { RUNS } from "./lighthouse-config";
import { type Page, type Result } from "./lighthouse-lhr";

export const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
export const millis = (ms: number) => `${Math.round(ms)} ms`;

export const pageLabel = (page: Page) =>
  `${page.name} \`${page.path.replace(/[0-9a-f-]{36}/, ":id")}\``;
export const pct = (score: number | null) =>
  score === null ? "n/a" : String(Math.round(score * 100));

export function failedList(results: readonly Result[]): readonly string[] {
  const lines = results.flatMap((r) =>
    r.ok
      ? r.failed.map(
          (a) =>
            `- ${pageLabel(r.page)}: \`${a.id}\` (${a.category}) ${a.title}${a.items === null ? "" : `, ${a.items} item(s)`}`,
        )
      : [],
  );
  return lines.length > 0 ? lines : ["No failed audits."];
}

export function table(results: readonly Result[]): string {
  const perf = results.map((r) =>
    r.ok
      ? `| ${pageLabel(r.page)} | ${seconds(r.median.lcp)} | ${r.median.cls.toFixed(3)} | ${millis(r.median.tbt)} | ${seconds(r.median.fcp)} | ${pct(r.median.scores.performance)} |`
      : `| ${r.page.name} | FAILED: ${r.problem} | | | | |`,
  );
  const quality = results.map((r) =>
    r.ok
      ? `| ${pageLabel(r.page)} | ${pct(r.median.scores.accessibility)} | ${pct(r.median.scores["best-practices"])} | ${pct(r.median.scores.seo)} |`
      : `| ${r.page.name} | FAILED: ${r.problem} | | |`,
  );
  return [
    `## Lighthouse mobile (median of ${RUNS} runs)`,
    "",
    "Simulated slow 4G, 4x CPU slowdown, mobile screen. Performance is report only (the runner is shared, so read differences of a few percent as noise). Accessibility, best practices and SEO are gated: see `scripts/lighthouse-gate.ts`. An error or a page that does not load also fails.",
    "",
    "| Page | LCP | CLS | TBT | FCP | Performance |",
    "|---|---|---|---|---|---|",
    ...perf,
    "",
    "### Accessibility, best practices, SEO",
    "",
    "| Page | Accessibility | Best practices | SEO |",
    "|---|---|---|---|",
    ...quality,
    "",
    "### Failed audits",
    "",
    ...failedList(results),
    "",
    "The take page uses a seeded ready take whose thumbnail and play file are committed synthetic fixtures. Reports (HTML and JSON) are in the `lighthouse-reports` artifact.",
    "",
  ].join("\n");
}
