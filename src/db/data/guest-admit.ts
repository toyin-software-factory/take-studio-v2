import { eq } from "drizzle-orm";
import { ok } from "@/lib/result";
import { runTx } from "../tx";
import { GUEST_MAX_SECONDS } from "@/lib/guest-rules";
import { take } from "../schema";
import type { Executor } from "../types";
import { queueDeletions } from "./jobs/render-files";
import { reserveGuestMinutes } from "./guest-budget";
import { transitionTake } from "./takes";

export type GuestAdmission = "admitted" | "guest_too_long" | "guest_budget_spent";

/**
 * Spec 0023 AC-6, where the probe result is written and before any job exists. The predicate is
 * `take.guest_origin` (never the creator's guest flag), so a take already moved to a claimant is
 * still checked. A take over 3 minutes, or one the day's budget has no room for, fails with a
 * non refundable code and its original is queued for deletion. Not a guest take: admitted as is.
 */
export async function admitGuestTake(
  db: Executor,
  takeId: string,
  now?: Date,
): Promise<GuestAdmission> {
  const [row] = await db
    .select({
      status: take.status,
      guestOrigin: take.guestOrigin,
      durationMs: take.durationMs,
      originalKey: take.originalKey,
      reserved: take.guestReservedMinutes,
    })
    .from(take)
    .where(eq(take.id, takeId));
  if (!row?.guestOrigin || row.status !== "uploaded" || row.reserved !== null) return "admitted";

  // The failed move and the deletion row share one transaction: no original is left unqueued.
  const refuse = async (code: "guest_too_long" | "guest_budget_spent") => {
    await runTx(db, async (tx) => {
      const moved = await transitionTake(tx, takeId, "uploaded", "failed", { failureCode: code });
      if (!moved.ok) return moved;
      await queueDeletions(tx, [row.originalKey]);
      return ok(true);
    });
    return code;
  };
  const durationMs = row.durationMs ?? 0;
  if (durationMs > GUEST_MAX_SECONDS * 1000) return refuse("guest_too_long");
  const reserved = await reserveGuestMinutes(db, { takeId, durationMs, now });
  return reserved.ok ? "admitted" : refuse("guest_budget_spent");
}
