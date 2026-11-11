import { and, asc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { STORAGE_DELETION } from "@/lib/cleanup-rules";
import { ACTIVE_JOB_STATUSES } from "@/lib/processing";
import { type Result, err, ok } from "@/lib/result";
import { processingJob, render, storageDeletion, take } from "../schema";
import { runTx } from "../tx";
import type { Executor, Take, Tx } from "../types";
import { queueDeletions } from "./jobs";

/**
 * Deleting and expiring takes, and draining the file deletion queue (spec 0002, AC-17,
 * AC-18). Every file key removed from a row is queued in `storage_deletion` in the same
 * transaction, so no file is ever orphaned. Job safe: IDs only.
 */

/** Every stored file key of these takes: originals and render videos. */
export async function takeFileKeys(tx: Executor, takeIds: readonly string[]): Promise<string[]> {
  if (takeIds.length === 0) return [];
  const originals = await tx
    .select({ key: take.originalKey })
    .from(take)
    .where(inArray(take.id, [...takeIds]));
  const renders = await tx
    .select({ key: render.videoKey })
    .from(render)
    .where(and(inArray(render.takeId, [...takeIds]), isNotNull(render.videoKey)));
  return [...originals, ...renders].flatMap(({ key }) => (key ? [key] : []));
}

export type DeletedTakes = {
  /** File keys queued for deletion. */
  readonly queuedKeys: readonly string[];
  /** Trigger.dev runs of active jobs; cancel them after the transaction commits. */
  readonly runIds: readonly string[];
};

/**
 * Deletes takes inside an open transaction: queues their file keys, collects their active
 * runs, then deletes the rows (jobs, steps, cuts and renders cascade). The caller has
 * already checked ownership and locked the takes.
 */
export async function deleteTakesInTx(tx: Tx, takeIds: readonly string[]): Promise<DeletedTakes> {
  if (takeIds.length === 0) return { queuedKeys: [], runIds: [] };
  const ids = [...takeIds];

  const queuedKeys = await takeFileKeys(tx, ids);
  const active = await tx
    .select({ runId: processingJob.triggerRunId })
    .from(processingJob)
    .where(
      and(
        inArray(processingJob.takeId, ids),
        inArray(processingJob.status, ACTIVE_JOB_STATUSES),
        isNotNull(processingJob.triggerRunId),
      ),
    );

  await queueDeletions(tx, queuedKeys);
  await tx.delete(take).where(inArray(take.id, ids));
  return { queuedKeys, runIds: active.flatMap(({ runId }) => (runId ? [runId] : [])) };
}

/** Take statuses that can expire. `processing` is skipped and retried on the next sweep. */
const EXPIRABLE = ["uploaded", "ready", "failed"] as const;

/**
 * `takes.expire` (AC-18): the take becomes `expired` and its video files go: the original
 * and every render video are queued for deletion and render keys are cleared, all in one
 * transaction. Take, cuts, render settings (removed ranges) and transcript stay.
 * `original_key` is NOT NULL, so the take keeps the key string of the deleted original.
 */
export async function expireTake(
  db: Executor,
  input: { readonly takeId: string },
): Promise<
  Result<
    { readonly take: Take; readonly queuedKeys: readonly string[] },
    "not_found" | "invalid_transition"
  >
> {
  return runTx(db, async (tx) => {
    const [locked] = await tx
      .select({ status: take.status })
      .from(take)
      .where(eq(take.id, input.takeId))
      .for("update");
    if (!locked) return err("not_found");
    if (!(EXPIRABLE as readonly string[]).includes(locked.status)) return err("invalid_transition");

    const queuedKeys = await takeFileKeys(tx, [input.takeId]);
    await queueDeletions(tx, queuedKeys);
    await tx
      .update(render)
      .set({ videoKey: null })
      .where(and(eq(render.takeId, input.takeId), isNotNull(render.videoKey)));
    const [expired] = await tx
      .update(take)
      .set({ status: "expired", uploadId: null })
      .where(eq(take.id, input.takeId))
      .returning();
    return expired ? ok({ take: expired, queuedKeys }) : err("not_found");
  });
}

export type DrainResult = {
  /** Objects deleted and their queue rows removed. */
  readonly deleted: number;
  /** Deletes that failed this time (attempts bumped, retried on a later drain). */
  readonly failed: number;
  /** Rows left for a person after too many failed attempts. */
  readonly stuck: number;
};

/**
 * Drains the file deletion queue in batches. Each batch claims rows with
 * `FOR UPDATE SKIP LOCKED` (so parallel drains never touch the same row), deletes each object
 * with `deleteObject`, removes the row on success, or bumps `attempts` and `last_error` (status
 * text only, never the key) on failure. Stops when no claimable rows are left or after
 * `maxBatches`.
 */
export async function drainDeletions(
  db: Executor,
  deleteObject: (key: string) => Promise<void>,
  options: {
    readonly batchSize?: number;
    readonly maxAttempts?: number;
    readonly maxBatches?: number;
  } = {},
): Promise<DrainResult> {
  const batchSize = options.batchSize ?? STORAGE_DELETION.batchSize;
  const maxAttempts = options.maxAttempts ?? STORAGE_DELETION.maxAttempts;
  const maxBatches = options.maxBatches ?? 20;
  let deleted = 0;
  let failed = 0;
  const failedIds = new Set<string>();

  for (let batch = 0; batch < maxBatches; batch++) {
    const handled = await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(storageDeletion)
        .where(
          and(
            lt(storageDeletion.attempts, maxAttempts),
            // Don't retry a row that already failed in this drain.
            failedIds.size > 0
              ? sql`${storageDeletion.id} not in (${sql.join(
                  [...failedIds].map((id) => sql`${id}::uuid`),
                  sql`, `,
                )})`
              : undefined,
          ),
        )
        .orderBy(asc(storageDeletion.attempts), asc(storageDeletion.createdAt))
        .limit(batchSize)
        .for("update", { skipLocked: true });

      for (const row of rows) {
        try {
          await deleteObject(row.objectKey);
          await tx.delete(storageDeletion).where(eq(storageDeletion.id, row.id));
          deleted++;
        } catch (error) {
          failed++;
          failedIds.add(row.id);
          const message = error instanceof Error ? error.message : "delete failed";
          await tx
            .update(storageDeletion)
            .set({ attempts: row.attempts + 1, lastError: message.slice(0, 500) })
            .where(eq(storageDeletion.id, row.id));
        }
      }
      return rows.length;
    });
    if (handled < batchSize) break;
  }

  const [{ stuck } = { stuck: 0 }] = await db
    .select({ stuck: sql<number>`count(*)::int` })
    .from(storageDeletion)
    .where(sql`${storageDeletion.attempts} >= ${maxAttempts}`);
  return { deleted, failed, stuck };
}
