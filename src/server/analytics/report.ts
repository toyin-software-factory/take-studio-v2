import type { Executor } from "@/db/types";
import type { InsightsWindow } from "@/lib/analytics-events";
import { type CutQuality, summariseCutQuality } from "@/lib/cut-quality";
import {
  aiEditShare,
  creatorCount,
  eventCount,
  failuresByCode,
  latestCutSnapshots,
  secondTakeCount,
} from "./report-queries";

export type Funnel = {
  readonly window: InsightsWindow;
  readonly signedUp: number;
  readonly uploaded: number;
  readonly ready: number;
  readonly downloaded: number;
  readonly secondTake: number;
  readonly aiEditUses: number;
  /** Ready takes in the window, and how many of them had a finished AI edit. */
  readonly readyTakes: number;
  readonly readyWithAiEdit: number;
  readonly changeRequests: number;
  readonly limitHits: number;
  readonly failures: readonly { readonly code: string; readonly count: number }[];
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
  const since = windowStart(window, now);
  const [
    signedUp,
    uploaded,
    ready,
    downloaded,
    secondTake,
    aiEditUses,
    share,
    changes,
    limits,
    failures,
  ] = await Promise.all([
    eventCount(db, "signup", since),
    creatorCount(db, "take_uploaded", since),
    creatorCount(db, "take_ready", since),
    creatorCount(db, "take_downloaded", since, "video"),
    secondTakeCount(db, since),
    eventCount(db, "ai_edit_used", since),
    aiEditShare(db, since),
    eventCount(db, "change_requested", since),
    eventCount(db, "limit_hit", since),
    failuresByCode(db, since),
  ]);
  return {
    window,
    signedUp,
    uploaded,
    ready,
    downloaded,
    secondTake,
    aiEditUses,
    readyTakes: share.ready,
    readyWithAiEdit: share.done,
    changeRequests: changes,
    limitHits: limits,
    failures,
  };
}

/** Founding members: creators with at least two uploaded takes, all time (AC-7). */
export async function foundingMembers(db: Executor): Promise<number> {
  return secondTakeCount(db, null);
}

/**
 * The "Cut quality" numbers for a window (spec 0017 AC-5): the latest snapshot per take, summed
 * by proposer and kind, and the `cut_missed` marks in the window. Counts only.
 */
export async function cutQuality(
  db: Executor,
  window: InsightsWindow,
  now: Date = new Date(),
): Promise<CutQuality> {
  const since = windowStart(window, now);
  const [snapshots, missed] = await Promise.all([
    latestCutSnapshots(db, since),
    eventCount(db, "cut_missed", since),
  ]);
  return summariseCutQuality(snapshots, missed);
}
