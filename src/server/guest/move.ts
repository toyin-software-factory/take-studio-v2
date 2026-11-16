import { and, asc, count, eq, gt, isNull } from "drizzle-orm";
import { chargeUsage } from "@/db/data/usage";
import { analyticsEvent, guestClaim, processingJob, take, user } from "@/db/schema";
import type { Tx } from "@/db/types";
import { chargedMonth } from "@/lib/billing";

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

/** True when the take has any `initial` job row (charged, refunded or not): its job has started. */
export async function hasInitialJob(tx: Tx, takeId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: processingJob.id })
    .from(processingJob)
    .where(and(eq(processingJob.takeId, takeId), eq(processingJob.kind, "initial")))
    .limit(1);
  return row !== undefined;
}

/**
 * Spec 0023 AC-8 (G19): a take claimed after its job started was never charged to an account
 * (job start skipped the guest). Each `initial` job of the take that kept a charge and was not
 * refunded now adds its stored seconds to the claimant's month, with no ceiling (the take is
 * already processed, so it is kept whole), and remembers the hash and month so a later refund
 * gives the seconds back. The caller holds the take row lock. Returns the seconds charged.
 */
export async function chargeClaimedJobs(
  tx: Tx,
  input: { readonly takeId: string; readonly accountHash: string; readonly now: Date },
): Promise<number> {
  const jobs = await tx
    .select({ id: processingJob.id, seconds: processingJob.secondsCharged })
    .from(processingJob)
    .where(
      and(
        eq(processingJob.takeId, input.takeId),
        eq(processingJob.kind, "initial"),
        eq(processingJob.refunded, false),
        isNull(processingJob.chargedAccountHash),
        gt(processingJob.secondsCharged, 0),
      ),
    )
    .orderBy(asc(processingJob.id))
    .for("update");
  const month = chargedMonth(input.now);
  let total = 0;
  for (const job of jobs) {
    await chargeUsage(tx, {
      accountHash: input.accountHash,
      month,
      seconds: job.seconds,
      allowance: 0,
      enforce: false,
    });
    await tx
      .update(processingJob)
      .set({ chargedAccountHash: input.accountHash, chargedMonth: month, usageCounted: true })
      .where(eq(processingJob.id, job.id));
    total += job.seconds;
  }
  return total;
}
