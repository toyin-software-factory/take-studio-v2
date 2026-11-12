"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { formatClock, statusBadge } from "@/lib/take-display";
import type { RecentTake } from "@/server/takes/views";

/** The line under a recent take's title: its status in words, then its length. */
export function recentMeta(take: Pick<RecentTake, "status" | "durationMs">): string {
  const { label } = statusBadge(take.status);
  return take.durationMs === null ? label : `${label} · ${formatClock(take.durationMs)}`;
}

/**
 * The newest takes (at most five) under the nav. The take you are on is marked
 * `aria-current="page"`. Status is written out, never colour alone.
 */
export function RecentTakes({
  takes,
  onNavigate,
}: {
  readonly takes: readonly RecentTake[];
  readonly onNavigate?: () => void;
}) {
  const pathname = usePathname();
  if (takes.length === 0) return null;
  return (
    <section aria-labelledby="recent-takes-heading" className="min-h-0">
      <h2
        id="recent-takes-heading"
        className="px-3 pb-2 text-caption tracking-[var(--ls-eyebrow)] text-muted-foreground uppercase"
      >
        Recent takes
      </h2>
      <ul className="space-y-1">
        {takes.map((take) => {
          const current = pathname === `/takes/${take.id}`;
          return (
            <li key={take.id}>
              <Link
                href={`/takes/${take.id}`}
                aria-current={current ? "page" : undefined}
                onClick={onNavigate}
                className={cn(
                  "block rounded-md px-3 py-2 outline-hidden transition-colors hover:bg-hover-surface focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-solid focus-visible:outline-ring pointer-coarse:min-h-11",
                  current && "bg-hover-surface",
                )}
              >
                <span className={cn("block truncate text-small", current && "font-medium")}>
                  {take.title}
                </span>
                <span className="mono block truncate text-caption text-muted-foreground">
                  {recentMeta(take)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
