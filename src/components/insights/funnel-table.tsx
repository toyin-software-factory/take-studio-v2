import {
  FOUNDING_MEMBER_TARGET,
  INSIGHTS_WINDOWS,
  type InsightsWindow,
} from "@/lib/analytics-events";
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

function percent(part: number, whole: number): string {
  return whole === 0 ? "none yet" : `${Math.round((part / whole) * 100)}%`;
}

function Row({ label, value }: { readonly label: string; readonly value: string | number }) {
  return (
    <tr className="border-b border-border">
      <th scope="row" className="py-3 pr-4 font-normal">
        {label}
      </th>
      <td className="py-3 text-right font-mono text-h3 tabular-nums">{value}</td>
    </tr>
  );
}

/** Counts only: no creator rows, emails or names (spec 0016, AC-7). */
export function FunnelTable({
  funnel,
  founding,
}: {
  readonly funnel: Funnel;
  readonly founding: number;
}) {
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
        <Row label="Signed up" value={funnel.signedUp} />
        <Row label="Uploaded a take" value={funnel.uploaded} />
        <Row label="Had a ready take" value={funnel.ready} />
        <Row label="Downloaded a video" value={funnel.downloaded} />
        <Row label="Uploaded a second take" value={funnel.secondTake} />
        <Row label="AI edits used" value={funnel.aiEditUses} />
        <Row
          label="Ready takes with an AI edit"
          value={percent(funnel.readyWithAiEdit, funnel.readyTakes)}
        />
        <Row label="Change requests" value={funnel.changeRequests} />
        <Row label="Limit hits" value={funnel.limitHits} />
        <Row
          label="Founding members (all time)"
          value={`${founding} of ${FOUNDING_MEMBER_TARGET}`}
        />
      </tbody>
      {funnel.failures.length > 0 && (
        <tbody>
          {funnel.failures.map((f) => (
            <Row key={f.code} label={`Failed: ${f.code}`} value={f.count} />
          ))}
        </tbody>
      )}
    </table>
  );
}
