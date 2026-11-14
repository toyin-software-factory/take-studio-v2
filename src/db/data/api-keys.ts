import { and, count, desc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { API_KEYS, API_RATE, rateWindowStart } from "@/lib/api-rules";
import { type Result, err, ok } from "@/lib/result";
import { apiKey, apiRateWindow, bearerFailWindow, user } from "../schema";
import { runTx } from "../tx";
import type { Executor } from "../types";

/** What a creator may see of a key: never the hash. */
export type ApiKeyRow = {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
};

const columns = {
  id: apiKey.id,
  name: apiKey.name,
  prefix: apiKey.prefix,
  createdAt: apiKey.createdAt,
  lastUsedAt: apiKey.lastUsedAt,
};

/**
 * Stores a key's hash for a creator (spec 0018 AC-1). The caller generates the key and passes
 * only the hash and prefix, so the raw key never reaches this layer. Locks the creator's `user`
 * row (`FOR UPDATE`, first in the lock order) so two creates at once cannot both pass the count:
 * a sixth key is `key_limit`.
 */
export async function createApiKey(
  db: Executor,
  input: {
    readonly creatorId: string;
    readonly name: string;
    readonly prefix: string;
    readonly keyHash: string;
  },
): Promise<Result<ApiKeyRow, "not_found" | "key_limit">> {
  return runTx<ApiKeyRow, "not_found" | "key_limit">(db, async (tx) => {
    const [owner] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, input.creatorId))
      .for("update");
    if (!owner) return err("not_found");
    const [held] = await tx
      .select({ n: count() })
      .from(apiKey)
      .where(eq(apiKey.creatorId, input.creatorId));
    if ((held?.n ?? 0) >= API_KEYS.maxPerCreator) return err("key_limit");
    const [row] = await tx
      .insert(apiKey)
      .values({
        creatorId: input.creatorId,
        name: input.name,
        prefix: input.prefix,
        keyHash: input.keyHash,
      })
      .returning(columns);
    return row ? ok(row) : err("not_found");
  });
}

/** The creator's keys, newest first (AC-3). Selects named columns, so the hash is never read. */
export async function listApiKeys(db: Executor, creatorId: string): Promise<readonly ApiKeyRow[]> {
  return db
    .select(columns)
    .from(apiKey)
    .where(eq(apiKey.creatorId, creatorId))
    .orderBy(desc(apiKey.createdAt), desc(apiKey.id));
}

/**
 * Deletes one of the creator's keys (AC-3). Another creator's, a malformed or a missing ID are
 * all `not_found`, as is a repeat.
 */
export async function revokeApiKey(
  db: Executor,
  creatorId: string,
  keyId: string,
): Promise<Result<null, "not_found">> {
  if (!z.uuid().safeParse(keyId).success) return err("not_found");
  const removed = await db
    .delete(apiKey)
    .where(and(eq(apiKey.id, keyId), eq(apiKey.creatorId, creatorId)))
    .returning({ id: apiKey.id });
  return removed.length > 0 ? ok(null) : err("not_found");
}

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
 * The key check (spec 0018 AC-3, AC-10): one `UPDATE ... RETURNING` by hash. It is a write, so
 * Hyperdrive never caches it and a revoked key stops at once. `last_used_at` moves at most once
 * an hour (database `now()`, so two requests at once write at most once). Null when no key has
 * that hash.
 */
export async function authenticateApiKey(
  db: Executor,
  keyHash: string,
): Promise<{ readonly keyId: string; readonly creatorId: string } | null> {
  const [row] = await db
    .update(apiKey)
    .set({
      lastUsedAt: sql`case when ${apiKey.lastUsedAt} is null
        or ${apiKey.lastUsedAt} < now() - interval '1 hour' then now() else ${apiKey.lastUsedAt} end`,
    })
    .where(eq(apiKey.keyHash, keyHash))
    .returning({ keyId: apiKey.id, creatorId: apiKey.creatorId });
  return row ?? null;
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
