import { and, asc, count, eq } from "drizzle-orm";
import { analyticsEvent, guestClaim, take, user } from "@/db/schema";
import type { Tx } from "@/db/types";

/**
 * Moving a guest's takes to the account that claimed them (spec 0023 steps 4 and 5). Both callers
 * (the claim and the upload complete route) run inside a transaction that already holds the take
 * rows `FOR UPDATE`, then the claim row: takes first, then the claim, so neither order deadlocks.
 */

/** The guest's take ids in lock order, locked. */
export async function lockGuestTakes(tx: Tx, guestUserId: string) {
  return tx
    .select({
      id: take.id,
      status: take.status,
      originalKey: take.originalKey,
    })
    .from(take)
    .where(eq(take.creatorId, guestUserId))
    .orderBy(asc(take.id))
    .for("update");
}

/** One take, and the events written for it, now belong to the claiming account. */
export async function moveTake(
  tx: Tx,
  takeId: string,
  guestUserId: string,
  userId: string,
): Promise<void> {
  await tx.update(take).set({ creatorId: userId }).where(eq(take.id, takeId));
  await tx
    .update(analyticsEvent)
    .set({ creatorId: userId })
    .where(and(eq(analyticsEvent.takeId, takeId), eq(analyticsEvent.creatorId, guestUserId)));
}

/**
 * When no take is left on the guest, the rest of its events go to the account and the guest user
 * is deleted (its claim row goes with it). Returns true when it was deleted.
 */
export async function closeGuestIfEmpty(
  tx: Tx,
  guestUserId: string,
  userId: string,
): Promise<boolean> {
  const [left] = await tx.select({ n: count() }).from(take).where(eq(take.creatorId, guestUserId));
  if ((left?.n ?? 0) > 0) return false;
  await tx
    .update(analyticsEvent)
    .set({ creatorId: userId })
    .where(eq(analyticsEvent.creatorId, guestUserId));
  await tx.delete(user).where(and(eq(user.id, guestUserId), eq(user.guest, true)));
  return true;
}

/** Parks the claim: the account is remembered, nothing else moves. */
export async function parkClaim(tx: Tx, claimId: string, userId: string): Promise<void> {
  await tx.update(guestClaim).set({ claimUserId: userId }).where(eq(guestClaim.id, claimId));
}
