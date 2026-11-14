import { countEvents } from "@/db/data/analytics";
import type { Executor } from "@/db/types";
import type { InsightsWindow } from "@/lib/analytics-events";

export type Funnel = {
  readonly window: InsightsWindow;
  readonly signedUp: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS: Record<InsightsWindow, number | null> = { "7d": 7, "30d": 30, all: null };

/** Start of a reporting window (null: all time). Pure, so the clock is passed in. */
export function windowStart(window: InsightsWindow, now: Date): Date | null {
  const days = WINDOW_DAYS[window];
  return days === null ? null : new Date(now.getTime() - days * DAY_MS);
}

/** The funnel counts for a window (spec 0016, AC-7). Counts only: no creator, email or name. */
export async function funnel(
  db: Executor,
  window: InsightsWindow,
  now: Date = new Date(),
): Promise<Funnel> {
  return { window, signedUp: await countEvents(db, "signup", windowStart(window, now)) };
}
