import { lt, sql } from "drizzle-orm";
import { API_RATE } from "@/lib/api-rules";
import { apiRateWindow } from "../schema";
import type { Executor } from "../types";

/** Rows deleted per statement when purging old rate windows. */
export const RATE_WINDOW_PURGE_BATCH = 1000;

/**
 * Deletes one batch of rate window rows older than `API_RATE.keepMs` (spec 0018 AC-9). Only the
 * current minute matters for the limit, so an hour back is plenty. Returns how many rows went;
 * the next sweep continues.
 */
export async function purgeOldRateWindows(
  db: Executor,
  now: Date,
  batch: number = RATE_WINDOW_PURGE_BATCH,
): Promise<number> {
  const cutoff = new Date(now.getTime() - API_RATE.keepMs);
  const old = db
    .select({ keyId: apiRateWindow.keyId, windowStart: apiRateWindow.windowStart })
    .from(apiRateWindow)
    .where(lt(apiRateWindow.windowStart, cutoff))
    .limit(batch);
  const removed = await db
    .delete(apiRateWindow)
    .where(sql`(${apiRateWindow.keyId}, ${apiRateWindow.windowStart}) in (${old})`)
    .returning({ keyId: apiRateWindow.keyId });
  return removed.length;
}
