import type { Executor } from "@/db/types";
import { listForCreator } from ".";
import { recentView, type RecentTake } from "./views";

/** How many takes the sidebar lists. */
export const RECENT_TAKES_LIMIT = 5;

/**
 * The creator's newest takes for the sidebar (spec 0009, AC-4): the same query as the library,
 * five rows. A failure gives an empty list, never an error: the frame must still render.
 */
export async function recentForCreator(
  db: Executor,
  creatorId: string,
): Promise<readonly RecentTake[]> {
  try {
    const page = await listForCreator(db, creatorId, { limit: RECENT_TAKES_LIMIT });
    return page.ok ? page.data.rows.map(recentView) : [];
  } catch {
    // A database error must not break the page for an optional list.
    return [];
  }
}
