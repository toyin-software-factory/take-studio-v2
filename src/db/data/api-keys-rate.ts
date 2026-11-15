import { and, eq, lt, sql } from "drizzle-orm";
import { API_RATE, rateWindowStart } from "@/lib/api-rules";
import { apiRateWindow, bearerFailWindow } from "../schema";
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

/**
 * Counts one request in the key's current UTC minute and returns the count and the second into
 * the minute (spec 0018 AC-9). One atomic upsert, never a read then a write. `at` is for tests;
 * left out, the window and the second come from the database clock.
 */
export async function countApiRequest(
  db: Executor,
  keyId: string,
  at?: Date,
): Promise<{ readonly count: number; readonly secondsIntoMinute: number }> {
  const windowStart = at
    ? rateWindowStart(at)
    : sql<Date>`date_trunc('minute', now() at time zone 'utc') at time zone 'utc'`;
  const [row] = await db
    .insert(apiRateWindow)
    .values({ keyId, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [apiRateWindow.keyId, apiRateWindow.windowStart],
      set: { count: sql`${apiRateWindow.count} + 1` },
    })
    .returning({
      count: apiRateWindow.count,
      secondsIntoMinute: at
        ? sql<number>`${at.getUTCSeconds()}::int`
        : sql<number>`floor(extract(second from now()))::int`,
    });
  return row ?? { count: 1, secondsIntoMinute: 0 };
}

const windowNow = sql<Date>`date_trunc('minute', clock_timestamp() at time zone 'utc') at time zone 'utc'`;

/**
 * Failed bearer attempts this address has made in the current UTC minute (B2-T103), and the
 * second into the minute. A plain read, so it uses `clock_timestamp()` (volatile) to keep
 * Hyperdrive from serving a cached count. `at` is for tests.
 */
export async function bearerFailuresNow(
  db: Executor,
  ipHash: string,
  at?: Date,
): Promise<{ readonly failures: number; readonly secondsIntoMinute: number }> {
  const [row] = await db
    .select({
      failures: bearerFailWindow.count,
      secondsIntoMinute: at
        ? sql<number>`${at.getUTCSeconds()}::int`
        : sql<number>`floor(extract(second from clock_timestamp()))::int`,
    })
    .from(bearerFailWindow)
    .where(
      and(
        eq(bearerFailWindow.ipHash, ipHash),
        eq(bearerFailWindow.windowStart, at ? rateWindowStart(at) : windowNow),
      ),
    );
  return row ?? { failures: 0, secondsIntoMinute: at ? at.getUTCSeconds() : 0 };
}

/**
 * Counts one failed bearer attempt in the address's current UTC minute with one atomic upsert
 * that returns the new count, so parallel failures each get their own number (no lost counts, and
 * each one learns whether it went over the limit).
 */
export async function countBearerFailure(
  db: Executor,
  ipHash: string,
  at?: Date,
): Promise<{ readonly count: number; readonly secondsIntoMinute: number }> {
  const [row] = await db
    .insert(bearerFailWindow)
    .values({ ipHash, windowStart: at ? rateWindowStart(at) : windowNow, count: 1 })
    .onConflictDoUpdate({
      target: [bearerFailWindow.ipHash, bearerFailWindow.windowStart],
      set: { count: sql`${bearerFailWindow.count} + 1` },
    })
    .returning({
      count: bearerFailWindow.count,
      secondsIntoMinute: at
        ? sql<number>`${at.getUTCSeconds()}::int`
        : sql<number>`floor(extract(second from clock_timestamp()))::int`,
    });
  return row ?? { count: 1, secondsIntoMinute: 0 };
}

/** Deletes one batch of failed bearer rows older than an hour. Returns how many went. */
export async function purgeOldBearerFailures(
  db: Executor,
  now: Date,
  batch: number = RATE_WINDOW_PURGE_BATCH,
): Promise<number> {
  const cutoff = new Date(now.getTime() - API_RATE.keepMs);
  const old = db
    .select({ ipHash: bearerFailWindow.ipHash, windowStart: bearerFailWindow.windowStart })
    .from(bearerFailWindow)
    .where(lt(bearerFailWindow.windowStart, cutoff))
    .limit(batch);
  const removed = await db
    .delete(bearerFailWindow)
    .where(sql`(${bearerFailWindow.ipHash}, ${bearerFailWindow.windowStart}) in (${old})`)
    .returning({ ipHash: bearerFailWindow.ipHash });
  return removed.length;
}

/** Most batches one cleanup run purges (50 000 rows), so a flood cannot keep one run busy for long. */
const BEARER_PURGE_MAX_BATCHES = 50;

/**
 * Purges old failed bearer rows batch by batch until none are left (or the cap above), so a
 * backlog does not stretch how long an address hash is kept past the cleanup schedule.
 */
export async function purgeAllOldBearerFailures(db: Executor, now: Date): Promise<number> {
  let total = 0;
  for (let i = 0; i < BEARER_PURGE_MAX_BATCHES; i += 1) {
    const removed = await purgeOldBearerFailures(db, now);
    total += removed;
    if (removed < RATE_WINDOW_PURGE_BATCH) break;
  }
  return total;
}
