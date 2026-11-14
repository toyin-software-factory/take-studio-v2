import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { REALTIME_TOKEN, mintRefusal } from "@/lib/realtime-rules";
import { type Result, err, ok } from "@/lib/result";
import { realtimeTokenMint, user } from "../schema";
import { runTx } from "../tx";
import type { Executor } from "../types";

/**
 * Takes one mint slot for a creator (spec 0021 step 2): refused when the creator already minted
 * `perHour` in the last hour or `perDay` in the last day, otherwise a row is written. Locks the
 * creator's `user` row (`FOR UPDATE`, first in the lock order) so two requests at once cannot
 * both pass the count. A refused request writes nothing, so refusals never extend the window.
 */
export async function reserveMint(
  db: Executor,
  input: { readonly creatorId: string; readonly now: Date },
): Promise<Result<true, "not_found" | "hourly" | "daily">> {
  return runTx<true, "not_found" | "hourly" | "daily">(db, async (tx) => {
    const [owner] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, input.creatorId))
      .for("update");
    if (!owner) return err("not_found");
    const since = (ms: number) => new Date(input.now.getTime() - ms);
    const countSince = async (ms: number): Promise<number> => {
      const [row] = await tx
        .select({ n: count() })
        .from(realtimeTokenMint)
        .where(
          and(
            eq(realtimeTokenMint.creatorId, input.creatorId),
            gte(realtimeTokenMint.mintedAt, since(ms)),
          ),
        );
      return row?.n ?? 0;
    };
    const refusal = mintRefusal({
      lastHour: await countSince(REALTIME_TOKEN.hourMs),
      lastDay: await countSince(REALTIME_TOKEN.dayMs),
    });
    if (refusal) return err(refusal);
    await tx.insert(realtimeTokenMint).values({ creatorId: input.creatorId, mintedAt: input.now });
    return ok(true);
  });
}

/** Rows deleted per statement when purging old mints. */
export const MINT_PURGE_BATCH = 1000;

/** Deletes one batch of mint rows older than `REALTIME_TOKEN.keepMs`; the next sweep continues. */
export async function purgeOldMints(
  db: Executor,
  now: Date,
  batch: number = MINT_PURGE_BATCH,
): Promise<number> {
  const cutoff = new Date(now.getTime() - REALTIME_TOKEN.keepMs);
  const old = db
    .select({ id: realtimeTokenMint.id })
    .from(realtimeTokenMint)
    .where(lt(realtimeTokenMint.mintedAt, cutoff))
    .limit(batch);
  const removed = await db
    .delete(realtimeTokenMint)
    .where(sql`${realtimeTokenMint.id} in (${old})`)
    .returning({ id: realtimeTokenMint.id });
  return removed.length;
}
