import { and, count, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { API_KEYS } from "@/lib/api-rules";
import { type Result, err, ok } from "@/lib/result";
import { apiKey, user } from "../schema";
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

/**
 * The key check (spec 0018 AC-3, AC-10): one `UPDATE ... RETURNING` by hash. It is a write, so
 * Hyperdrive never caches it and a revoked key stops at once. It sets the column to itself, so
 * nothing moves here: `last_used_at` is moved by `touchApiKey` once the request is let through
 * (a 429 is not a use). Null when no key has that hash.
 */
export async function authenticateApiKey(
  db: Executor,
  keyHash: string,
): Promise<{ readonly keyId: string; readonly creatorId: string } | null> {
  const [row] = await db
    .update(apiKey)
    .set({ lastUsedAt: sql`${apiKey.lastUsedAt}` })
    .where(eq(apiKey.keyHash, keyHash))
    .returning({ keyId: apiKey.id, creatorId: apiKey.creatorId });
  return row ?? null;
}

/**
 * Moves `last_used_at` for a key whose request was let through, at most once an hour (database
 * `now()`, so two requests at once write at most once).
 */
export async function touchApiKey(db: Executor, keyId: string): Promise<void> {
  await db
    .update(apiKey)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(apiKey.id, keyId),
        or(isNull(apiKey.lastUsedAt), lt(apiKey.lastUsedAt, sql`now() - interval '1 hour'`)),
      ),
    );
}

// Split by job (B2-T117): the rate windows and the bearer failure counts are in `api-keys-rate`.
// This file keeps the import path stable.
export {
  RATE_WINDOW_PURGE_BATCH,
  bearerFailuresNow,
  countApiRequest,
  countBearerFailure,
  purgeAllOldBearerFailures,
  purgeOldBearerFailures,
  purgeOldRateWindows,
} from "./api-keys-rate";
