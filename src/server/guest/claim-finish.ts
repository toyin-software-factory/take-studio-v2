import { eq } from "drizzle-orm";
import { guestClaim, take, user } from "@/db/schema";
import type { Db } from "@/db/types";
import { usageAccountHash } from "@/lib/usage-hash";
import { chargeClaimedJobs, closeGuestIfEmpty, moveTake } from "./move";

/**
 * Finishes a parked claim for one take (spec 0023 AC-4). A claim parks the takes still being
 * uploaded; the complete route (after the probe is dispatched) and the cancel route call this when
 * a guest take stops uploading. If the guest's claim names an account, the take moves to it, and
 * the stored seconds of its unrefunded jobs are charged to that account, and the guest user goes
 * when nothing is left on it. No claim, or none named yet: nothing happens.
 * Lock order matches the claim and the complete route: the take row, then the claim row.
 * Never throws: the upload's own answer must not fail because of it, and the next call retries.
 */
export async function finishParkedClaim(
  db: Db,
  takeId: string,
  usageSecret: string | undefined,
): Promise<boolean> {
  // Without the secret the claimant cannot be charged, so the take waits for the next call.
  if (!usageSecret) return false;
  try {
    return await db.transaction(async (tx) => {
      const [t] = await tx
        .select({ id: take.id, creatorId: take.creatorId, guestOrigin: take.guestOrigin })
        .from(take)
        .where(eq(take.id, takeId))
        .for("update");
      if (!t || !t.guestOrigin) return false;
      const [claim] = await tx
        .select({ claimUserId: guestClaim.claimUserId })
        .from(guestClaim)
        .where(eq(guestClaim.guestUserId, t.creatorId))
        .for("update");
      if (!claim?.claimUserId) return false;
      const [owner] = await tx
        .select({ guest: user.guest })
        .from(user)
        .where(eq(user.id, t.creatorId));
      if (!owner?.guest) return false;
      const [claimant] = await tx
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, claim.claimUserId));
      if (!claimant) return false;
      const accountHash = await usageAccountHash(claimant.email, usageSecret);
      await moveTake(tx, t.id, t.creatorId, claim.claimUserId);
      // A job that started while the take was parked charged nobody: it charges the claimant now.
      await chargeClaimedJobs(tx, { takeId: t.id, accountHash, now: new Date() });
      await closeGuestIfEmpty(tx, t.creatorId, claim.claimUserId);
      return true;
    });
  } catch {
    return false;
  }
}
