import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { guestClaim, user } from "@/db/schema";
import type { Db } from "@/db/types";
import { runTx } from "@/db/tx";
import { hashGuestToken } from "@/lib/guest-hash";
import { usageAccountHash } from "@/lib/usage-hash";
import { type Result, err, ok } from "@/lib/result";
import type { R2 } from "@/lib/r2";
import { chargeClaimedJobs, closeGuestIfEmpty, lockGuestTakes, moveTake, parkClaim } from "./move";

/**
 * The claim (spec 0023 step 5, AC-3, AC-4, AC-5). One transaction: lock the guest's takes, then
 * the claim row, check who is asking, move every take whose upload is finished, park the rest,
 * and delete the guest user when nothing is left. A match is the cookie (same browser, any
 * email, moves at once) or the verified sign in email equal to the typed one (any device, only
 * after the confirm click, C5). Nothing here logs an address, a claim id or a link.
 */

export type ClaimDeps = {
  readonly db: Db;
  /** Tells a finished multipart upload (the object exists) from one still being sent. */
  readonly r2: Pick<R2, "headObject">;
  /** USAGE_HASH_SECRET: the claimant's usage hash for the account side of AC-8. */
  readonly usageSecret: string;
  readonly now?: () => Date;
};

export type ClaimInput = {
  readonly claimId: string;
  readonly userId: string;
  readonly cookie: string | null;
  /** The confirm click was made (C5). The cookie match never needs it. */
  readonly confirmed: boolean;
};

export type ClaimOutcome =
  /** Takes moved now, and takes still being uploaded that stay parked for this account. */
  | {
      readonly kind: "done";
      readonly moved: readonly string[];
      readonly pending: readonly string[];
      readonly via: "cookie" | "email";
    }
  /** Only the email matched: ask first, nothing has moved. */
  | { readonly kind: "confirm" }
  /** No match, an unknown or already claimed id, or nothing left: the calm message. */
  | { readonly kind: "none" };

const NONE: ClaimOutcome = { kind: "none" };

export async function claimGuest(
  deps: ClaimDeps,
  input: ClaimInput,
): Promise<Result<ClaimOutcome, "storage_error">> {
  if (!z.uuid().safeParse(input.claimId).success) return ok(NONE);
  const now = deps.now?.() ?? new Date();
  const [first] = await deps.db
    .select({ guestUserId: guestClaim.guestUserId })
    .from(guestClaim)
    .where(eq(guestClaim.id, input.claimId));
  if (!first) return ok(NONE);
  const cookieHash = input.cookie ? await hashGuestToken(input.cookie) : null;

  try {
    return await runTx<ClaimOutcome, "storage_error">(deps.db, async (tx) => {
      const takes = await lockGuestTakes(tx, first.guestUserId);
      const [claim] = await tx
        .select()
        .from(guestClaim)
        .where(
          and(
            eq(guestClaim.id, input.claimId),
            gt(guestClaim.expiresAt, now),
            isNull(guestClaim.claimedAt),
          ),
        )
        .for("update");
      const [account] = await tx
        .select({ email: user.email, verified: user.emailVerified, guest: user.guest })
        .from(user)
        .where(eq(user.id, input.userId));
      if (!claim || !account || account.guest || takes.length === 0) return ok(NONE);
      if (claim.claimUserId !== null && claim.claimUserId !== input.userId) return ok(NONE);

      const byCookie = cookieHash !== null && cookieHash === claim.tokenHash;
      const byEmail =
        account.verified && claim.email !== null && account.email.toLowerCase() === claim.email;
      if (!byCookie && !byEmail) return ok(NONE);
      const via = byCookie ? ("cookie" as const) : ("email" as const);
      if (via === "email" && !input.confirmed && claim.claimUserId !== input.userId) {
        return ok({ kind: "confirm" } as const);
      }

      const accountHash = await usageAccountHash(account.email, deps.usageSecret);
      const moved: string[] = [];
      const pending: string[] = [];
      for (const t of takes) {
        if (t.status === "uploading" && !(await uploadFinished(deps.r2, t.originalKey))) {
          pending.push(t.id);
          continue;
        }
        await moveTake(tx, t.id, first.guestUserId, input.userId);
        await chargeClaimedJobs(tx, { takeId: t.id, accountHash, now });
        moved.push(t.id);
      }
      if (pending.length > 0) await parkClaim(tx, claim.id, input.userId);
      else await closeGuestIfEmpty(tx, first.guestUserId, input.userId);
      return ok({ kind: "done", moved, pending, via } as const);
    });
  } catch {
    return err("storage_error");
  }
}

/** The multipart upload was completed in storage: the object exists. A storage error throws. */
async function uploadFinished(r2: ClaimDeps["r2"], key: string): Promise<boolean> {
  return (await r2.headObject(key)) !== null;
}
