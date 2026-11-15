/** Lighthouse result shapes and the pure readers that turn a run into a sample (moved out of lighthouse-ci.ts). */
import { BASE } from "./lighthouse-config";

export type Page = {
  readonly name: string;
  readonly path: string;
  readonly signedIn: boolean;
  /** False for the pages that send noindex on purpose. */
  readonly indexable: boolean;
};

export const METRICS = [
  { key: "lcp", audit: "largest-contentful-paint" },
  { key: "cls", audit: "cumulative-layout-shift" },
  { key: "tbt", audit: "total-blocking-time" },
  { key: "fcp", audit: "first-contentful-paint" },
] as const;
export type MetricKey = (typeof METRICS)[number]["key"];
export const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"] as const;
export type CategoryId = (typeof CATEGORIES)[number];
/** A quality score is null when one of its audits errored; that is reported, not a failure. */
export type Scores = Readonly<Record<CategoryId, number | null>> & { readonly performance: number };
export type Sample = Readonly<Record<MetricKey, number>> & { readonly scores: Scores };
export type FailedAudit = {
  readonly id: string;
  readonly title: string;
  readonly category: CategoryId;
  readonly items: number | null;
};

export type LhrAudit = {
  readonly title?: string;
  readonly score?: number | null;
  readonly scoreDisplayMode?: string;
  readonly numericValue?: number;
  readonly details?: unknown;
};

export type Lhr = {
  readonly runtimeError?: { readonly code: string };
  readonly finalDisplayedUrl: string;
  readonly categories: Readonly<
    Record<
      CategoryId,
      {
        readonly score: number | null;
        readonly auditRefs?: readonly { readonly id: string; readonly weight: number }[];
      }
    >
  >;
  readonly audits: Readonly<Record<string, LhrAudit>>;
};

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function medianOrNull(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length > 0 ? median(present) : null;
}

/** The status of the page's own request, from Lighthouse's network audit. */
export function documentStatus(lhr: Lhr): number | null {
  const details = lhr.audits["network-requests"]?.details as
    { items?: readonly { statusCode?: number }[] } | undefined;
  return details?.items?.[0]?.statusCode ?? null;
}

/** Why this run does not count as "the page loaded", or null. */
export function loadProblem(lhr: Lhr, page: Page): string | null {
  if (lhr.runtimeError) return `Lighthouse error ${lhr.runtimeError.code}`;
  const final = new URL(lhr.finalDisplayedUrl);
  if (final.origin !== new URL(BASE).origin) return `redirected to ${final.origin}`;
  if (final.pathname !== page.path) return `redirected to ${final.pathname}`;
  const status = documentStatus(lhr);
  if (status !== null && status >= 400) return `HTTP ${status}`;
  if (typeof lhr.categories.performance?.score !== "number") return "no performance score";
  for (const { audit } of METRICS) {
    if (typeof lhr.audits[audit]?.numericValue !== "number") return `no ${audit} value`;
  }
  return null;
}

export function sample(lhr: Lhr): Sample {
  const read = (audit: string) => lhr.audits[audit]!.numericValue!;
  return {
    lcp: read("largest-contentful-paint"),
    cls: read("cumulative-layout-shift"),
    tbt: read("total-blocking-time"),
    fcp: read("first-contentful-paint"),
    scores: {
      performance: lhr.categories.performance.score!,
      accessibility: lhr.categories.accessibility?.score ?? null,
      "best-practices": lhr.categories["best-practices"]?.score ?? null,
      seo: lhr.categories.seo?.score ?? null,
    },
  };
}

/** Audits of the three quality categories that did not pass, with how many items they flag. */
export function failedAudits(lhr: Lhr): readonly FailedAudit[] {
  const found: FailedAudit[] = [];
  for (const category of CATEGORIES.slice(1)) {
    for (const { id } of lhr.categories[category]?.auditRefs ?? []) {
      const audit = lhr.audits[id];
      if (!audit || typeof audit.score !== "number" || audit.score >= 1) continue;
      if (audit.scoreDisplayMode === "manual" || audit.scoreDisplayMode === "informative") continue;
      const items = (audit.details as { items?: readonly unknown[] } | undefined)?.items;
      found.push({ id, title: audit.title ?? id, category, items: items ? items.length : null });
    }
  }
  return found;
}

export type Result =
  | {
      readonly page: Page;
      readonly ok: true;
      readonly median: Sample;
      readonly failed: readonly FailedAudit[];
    }
  | { readonly page: Page; readonly ok: false; readonly problem: string };
