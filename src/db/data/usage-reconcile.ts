import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { USAGE_LIMIT_ENABLED_KEY } from "@/lib/usage-rules";
import { appSetting, processingJob } from "../schema";
import { runTx } from "../tx";
import type { Executor } from "../types";
import { chargeUsage, returnUsage } from "./usage";

export type ReconcileSummary = {
  readonly added: number;
  readonly subtracted: number;
  readonly jobs: number;
  /** Jobs whose transaction failed: they stay owed, so a switch on must wait for a clean run. */
  readonly failed: number;
};

/**
 * The one time reconcile of spec 0014 AC-11. It never overwrites a total (that would give back
 * the charge of a take deleted after the migration): it applies differences, using the two
 * flags on `processing_job`:
 * 1. a job that has a charge, is not refunded and is not `usage_counted` is added;
 * 2. a job that is `usage_counted`, refunded and not `usage_returned` is subtracted;
 * and flips the flags in the same transaction. Each job is its own transaction that locks the
 * job row (`FOR UPDATE`) and re checks the flags under the lock, so it is serialised against
 * the refund's `refunded` swap and a second run finds nothing. Rows of takes deleted
 * meanwhile are not seen.
 */
export async function reconcileUsage(db: Executor): Promise<ReconcileSummary> {
  const charged = and(
    isNotNull(processingJob.chargedAccountHash),
    isNotNull(processingJob.chargedMonth),
    sql`${processingJob.secondsCharged} > 0`,
  );
  const pending = await db
    .select({ id: processingJob.id })
    .from(processingJob)
    .where(
      and(
        charged,
        or(
          and(eq(processingJob.refunded, false), eq(processingJob.usageCounted, false)),
          and(
            eq(processingJob.refunded, true),
            eq(processingJob.usageCounted, true),
            eq(processingJob.usageReturned, false),
          ),
        ),
      ),
    );

  let added = 0;
  let subtracted = 0;
  let jobs = 0;
  let failed = 0;
  for (const { id } of pending) {
    // A thrown database error counts as failed too, and must not stop the sweep.
    const delta = await runTx<number, "tx_failed">(db, async (tx) => {
      const [job] = await tx
        .select()
        .from(processingJob)
        .where(eq(processingJob.id, id))
        .for("update");
      // Gone or no longer owed under the lock: a refund or another run got there first.
      if (!job?.chargedAccountHash || !job.chargedMonth || job.secondsCharged <= 0) {
        return { ok: true as const, data: 0 };
      }
      const month = job.chargedMonth;
      const accountHash = job.chargedAccountHash;
      if (!job.refunded && !job.usageCounted) {
        await chargeUsage(tx, {
          accountHash,
          month,
          seconds: job.secondsCharged,
          allowance: 0,
          enforce: false,
        });
        await tx.update(processingJob).set({ usageCounted: true }).where(eq(processingJob.id, id));
        return { ok: true as const, data: job.secondsCharged };
      }
      if (job.refunded && job.usageCounted && !job.usageReturned) {
        await returnUsage(tx, { accountHash, month, seconds: job.secondsCharged });
        await tx.update(processingJob).set({ usageReturned: true }).where(eq(processingJob.id, id));
        return { ok: true as const, data: -job.secondsCharged };
      }
      return { ok: true as const, data: 0 };
    }).catch(() => ({ ok: false as const, error: "tx_failed" as const }));
    if (!delta.ok) {
      failed += 1;
      continue;
    }
    if (delta.data === 0) continue;
    jobs += 1;
    if (delta.data > 0) added += delta.data;
    else subtracted += -delta.data;
  }
  return { added, subtracted, jobs, failed };
}

/** Sets `usage_limit_enabled` to true (spec 0014 AC-11), inserting the row if it is missing. Safe to repeat. */
export async function enableUsageLimit(db: Executor): Promise<void> {
  await db
    .insert(appSetting)
    .values({ key: USAGE_LIMIT_ENABLED_KEY, value: true })
    .onConflictDoUpdate({
      target: appSetting.key,
      set: { value: true, updatedAt: sql`now()` },
    });
}
