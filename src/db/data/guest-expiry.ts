import { and, asc, eq, inArray, isNull, lt, lte, notExists, or, sql } from "drizzle-orm";
import { GUEST_TTL_HOURS } from "@/lib/guest-rules";
import { guestBudgetDay, guestClaim, guestIpDay, take, user } from "../schema";
import { runTx } from "../tx";
import type { Executor } from "../types";
import { CLEANUP } from "@/lib/cleanup-rules";
import { deleteTakesInTx } from "./deletion";

/**
 * The expired guest sweep (spec 0023 step 7, AC-9, G18, G28). Everything here goes through the
 * existing delete path (`deleteTakesInTx`), so the files are queued for the normal drain and the
 * rows cascade. IDs only: no address, hash or file name is returned or logged.
 */

/** What the caller finishes after the commit: stop runs, abort the upload, record the event. */
export type ExpiredGuestTake = {
  readonly takeId: string;
  readonly originalKey: string;
  readonly uploadId: string | null;
  readonly runIds: readonly string[];
  /** The visitor had typed an address (the `guest_expired` prop, spec 0023 G17). */
  readonly hadEmail: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` of the UTC day, for the date columns. */
const dayOf = (at: Date): string => at.toISOString().slice(0, 10);

/**
 * Deletes each unclaimed guest take 24 hours after it was created. A take counts as unclaimed
 * while it still belongs to a guest user and its claim is not parked for an account (a parked
 * claim moves its takes when their upload ends). Per take, one transaction: lock the take, check
 * it is still the guest's, read the upload id, delete. A failure on one take never stops the rest.
 */
export async function deleteExpiredGuestTakes(
  db: Executor,
  now: Date,
): Promise<readonly ExpiredGuestTake[]> {
  const cutoff = new Date(now.getTime() - GUEST_TTL_HOURS * 60 * 60 * 1000);
  const due = await db
    .select({ id: take.id })
    .from(take)
    .innerJoin(user, eq(user.id, take.creatorId))
    .innerJoin(guestClaim, eq(guestClaim.guestUserId, user.id))
    .where(
      and(
        eq(user.guest, true),
        eq(take.guestOrigin, true),
        // A parked claim keeps its takes (they move when the upload ends), except a failed one:
        // an abandoned parked upload holds nothing to move and expires on the normal schedule.
        or(isNull(guestClaim.claimUserId), eq(take.status, "failed")),
        lte(take.createdAt, cutoff),
      ),
    )
    .orderBy(asc(take.createdAt))
    .limit(CLEANUP.batchSize);

  const done: ExpiredGuestTake[] = [];
  for (const { id } of due) {
    try {
      const result = await runTx<ExpiredGuestTake | null, "tx_failed">(db, async (tx) => {
        // Lock order: the take first, then the claim row (the claim uses the same order).
        const [locked] = await tx
          .select({
            originalKey: take.originalKey,
            uploadId: take.uploadId,
            guest: user.guest,
            hadEmail: sql<boolean>`${guestClaim.email} is not null`,
            parked: sql<boolean>`${guestClaim.claimUserId} is not null and ${take.status} <> 'failed'`,
          })
          .from(take)
          .innerJoin(user, eq(user.id, take.creatorId))
          .innerJoin(guestClaim, eq(guestClaim.guestUserId, user.id))
          .where(eq(take.id, id))
          .for("update", { of: [take, guestClaim] });
        // Moved to an account, parked or gone since the read: not ours to delete.
        if (!locked || !locked.guest || locked.parked) return { ok: true as const, data: null };
        const deleted = await deleteTakesInTx(tx, [id]);
        return {
          ok: true as const,
          data: {
            takeId: id,
            originalKey: locked.originalKey,
            uploadId: locked.uploadId,
            runIds: deleted.runIds,
            hadEmail: locked.hadEmail,
          },
        };
      });
      if (result.ok && result.data) done.push(result.data);
    } catch {
      // The next sweep tries again.
    }
  }
  return done;
}

/**
 * Deletes guest users whose claim has expired and that have no take left (the claim row goes
 * with the user). Returns how many went. A guest with a take left waits for the take sweep.
 */
export async function deleteExpiredGuests(db: Executor, now: Date): Promise<number> {
  const gone = await db
    .delete(user)
    .where(
      and(
        eq(user.guest, true),
        inArray(
          user.id,
          db
            .select({ id: guestClaim.guestUserId })
            .from(guestClaim)
            .where(
              and(
                lte(guestClaim.expiresAt, now),
                notExists(
                  db
                    .select({ one: sql`1` })
                    .from(take)
                    .where(eq(take.creatorId, guestClaim.guestUserId)),
                ),
              ),
            ),
        ),
      ),
    )
    .returning({ id: user.id });
  return gone.length;
}

/** Deletes the per address and per day count rows older than 2 days (AC-6, AC-9). */
export async function purgeOldGuestCounts(db: Executor, now: Date): Promise<number> {
  const before = dayOf(new Date(now.getTime() - 2 * DAY_MS));
  const ips = await db
    .delete(guestIpDay)
    .where(lt(guestIpDay.day, before))
    .returning({ day: guestIpDay.day });
  const days = await db
    .delete(guestBudgetDay)
    .where(lt(guestBudgetDay.day, before))
    .returning({ day: guestBudgetDay.day });
  return ips.length + days.length;
}
