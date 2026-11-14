import { and, count, desc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { API_KEYS, API_RATE } from "@/lib/api-rules";
import { type Result, err, ok } from "@/lib/result";
import { apiKey, apiRateWindow, user } from "../schema";
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
