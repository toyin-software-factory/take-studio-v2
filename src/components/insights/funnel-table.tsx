import { INSIGHTS_WINDOWS, type InsightsWindow } from "@/lib/analytics-events";
import type { Funnel } from "@/server/analytics/report";
import { cn } from "@/lib/utils";

const WINDOW_LABELS: Record<InsightsWindow, string> = {
  "7d": "7 days",
  "30d": "30 days",
  all: "All time",
};

const LINK =
  "inline-flex min-h-9 items-center rounded-sm px-3 text-sm pointer-coarse:min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** The window choice: links, so it works without script and the choice is in the URL. */
export function WindowLinks({ current }: { readonly current: InsightsWindow }) {
  return (
    <nav aria-label="Reporting window" className="flex gap-1">
      {INSIGHTS_WINDOWS.map((w) => (
        <a
          key={w}
          href={`/insights?window=${w}`}
          aria-current={w === current ? "page" : undefined}
          className={cn(
            LINK,
            w === current ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-muted",
          )}
        >
          {WINDOW_LABELS[w]}
        </a>
      ))}
    </nav>
  );
}

/** Counts only: no creator rows, emails or names (spec 0016, AC-7). */
export function FunnelTable({ funnel }: { readonly funnel: Funnel }) {
  return (
    <table className="w-full max-w-md text-left">
      <caption className="sr-only">
        Funnel counts for {WINDOW_LABELS[funnel.window]}. Counts come from recorded events and can
        miss a few.
      </caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Step</th>
          <th scope="col">Count</th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-b border-border">
          <th scope="row" className="py-3 pr-4 font-normal">
            Signed up
          </th>
          <td className="py-3 text-right font-mono text-h3 tabular-nums">{funnel.signedUp}</td>
        </tr>
      </tbody>
    </table>
  );
}
