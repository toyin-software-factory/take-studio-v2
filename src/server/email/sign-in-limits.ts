import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";

/**
 * "Email me a sign in link" limits (spec 0006, AC-4). Per IP (10 an hour) is Better Auth's
 * database rate limit (see auth.ts); this is the per email part: at most 3 requests per email
 * per 15 minutes, stored in the database because Workers have no shared memory. The key is a
 * SHA-256 of the lowercased email, so no address is stored. A transaction lock per key keeps
 * two parallel requests from both passing the check.
 */
export const SIGN_IN_EMAIL_LIMIT = { max: 3, windowMs: 15 * 60 * 1000 } as const;

type Db = PostgresJsDatabase<typeof schema>;

/** Stable key for an email: hex SHA-256 of the trimmed, lowercased address. */
export async function emailKey(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Records a sign in link request for `email` unless it is over the limit. Returns false (and
 * records nothing) when the email already had `max` requests inside the window.
 */
export async function takeSignInEmailSlot(
  db: Db,
  email: string,
  now: Date = new Date(),
): Promise<boolean> {
  const key = await emailKey(email);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    const since = new Date(now.getTime() - SIGN_IN_EMAIL_LIMIT.windowMs);
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.signInEmailAttempt)
      .where(
        and(
          eq(schema.signInEmailAttempt.emailKey, key),
          gte(schema.signInEmailAttempt.createdAt, since),
        ),
      );
    if ((row?.n ?? 0) >= SIGN_IN_EMAIL_LIMIT.max) return false;
    await tx
      .insert(schema.signInEmailAttempt)
      .values({ id: crypto.randomUUID(), emailKey: key, createdAt: now });
    // Prune rows well past any window (an hour), so the table stays small.
    await tx
      .delete(schema.signInEmailAttempt)
      .where(lt(schema.signInEmailAttempt.createdAt, new Date(now.getTime() - 60 * 60 * 1000)));
    return true;
  });
}
