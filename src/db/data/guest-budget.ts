import { eq, inArray, sql } from "drizzle-orm";
import {
  GUEST_DAILY_MINUTES_KEY,
  GUEST_UPLOAD_ENABLED_KEY,
  type GuestSettings,
  parseGuestSettings,
  utcDay,
} from "@/lib/guest-rules";
import { appSetting, guestBudgetDay, take } from "../schema";
import type { Executor } from "../types";
import { runTx } from "../tx";
import { ok } from "@/lib/result";

/** The two guest settings, read at the time of the check so a change needs no deploy (AC-6). */
export async function readGuestSettings(db: Executor): Promise<GuestSettings> {
  const rows = await db
    .select({ key: appSetting.key, value: appSetting.value })
    .from(appSetting)
    .where(inArray(appSetting.key, [GUEST_UPLOAD_ENABLED_KEY, GUEST_DAILY_MINUTES_KEY]));
  return parseGuestSettings(Object.fromEntries(rows.map((row) => [row.key, row.value])));
}

/** Whole minutes, rounded up: what a take of `durationMs` reserves (spec 0023, AC-6). */
export function minutesToReserve(durationMs: number): number {
  return Math.max(1, Math.ceil(durationMs / 60_000));
}

/** Advisory look at the drop: is today's budget already spent? The real check is the reservation. */
export async function guestBudgetSpent(db: Executor, now: Date): Promise<boolean> {
  const settings = await readGuestSettings(db);
  const [row] = await db
    .select({ minutes: guestBudgetDay.reservedMinutes })
    .from(guestBudgetDay)
    .where(eq(guestBudgetDay.day, utcDay(now)));
  return (row?.minutes ?? 0) >= settings.dailyMinutes;
}

/**
 * Reserves a guest take's probed minutes against today's budget (AC-6, G20). One transaction:
 * the day's row is created if missing, a conditional update adds the minutes only while the day
 * still fits, and the take records the minutes and the day. No row updated means the budget is
 * spent. Two takes at the same moment cannot both pass: the update locks the day's row.
 */
export async function reserveGuestMinutes(
  db: Executor,
  input: { readonly takeId: string; readonly durationMs: number; readonly now?: Date },
): Promise<{ readonly ok: boolean }> {
  const now = input.now ?? new Date();
  const day = utcDay(now);
  const minutes = minutesToReserve(input.durationMs);
  const settings = await readGuestSettings(db);
  const result = await runTx(db, async (tx) => {
    // Take first, then the day (the order release uses): a repeat admission reserves nothing more.
    const [current] = await tx
      .select({ reserved: take.guestReservedMinutes })
      .from(take)
      .where(eq(take.id, input.takeId))
      .for("update");
    if (current && current.reserved !== null) return ok(true);
    await tx.insert(guestBudgetDay).values({ day }).onConflictDoNothing();
    const rows = await tx
      .update(guestBudgetDay)
      .set({ reservedMinutes: sql`${guestBudgetDay.reservedMinutes} + ${minutes}` })
      .where(
        sql`${guestBudgetDay.day} = ${day} and ${guestBudgetDay.reservedMinutes} + ${minutes} <= ${settings.dailyMinutes}`,
      )
      .returning({ day: guestBudgetDay.day });
    if (rows.length === 0) return { ok: false as const, error: "spent" as const };
    await tx
      .update(take)
      .set({ guestReservedMinutes: minutes, guestReservedDay: day })
      .where(eq(take.id, input.takeId));
    return ok(true);
  });
  return { ok: result.ok };
}

/**
 * Gives a take's reserved minutes back, once (AC-6). Locks the take, reads the old value (null
 * means already released), clears it, then subtracts from the day that was reserved, not today.
 */
export async function releaseGuestMinutes(db: Executor, takeId: string): Promise<boolean> {
  const result = await runTx(db, async (tx) => {
    const [row] = await tx
      .select({ minutes: take.guestReservedMinutes, day: take.guestReservedDay })
      .from(take)
      .where(eq(take.id, takeId))
      .for("update");
    if (!row || row.minutes === null || row.day === null) {
      return { ok: false as const, error: "nothing" as const };
    }
    await tx
      .update(take)
      .set({ guestReservedMinutes: null, guestReservedDay: null })
      .where(eq(take.id, takeId));
    await tx
      .update(guestBudgetDay)
      .set({
        reservedMinutes: sql`greatest(0, ${guestBudgetDay.reservedMinutes} - ${row.minutes})`,
      })
      .where(eq(guestBudgetDay.day, row.day));
    return ok(true);
  });
  return result.ok;
}
