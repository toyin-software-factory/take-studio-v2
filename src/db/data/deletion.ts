import { and, asc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { STORAGE_DELETION } from "@/lib/cleanup-rules";
import { renderKey } from "@/lib/cut-rules";
import { ACTIVE_JOB_STATUSES } from "@/lib/processing";
import { type Result, err, ok } from "@/lib/result";
import { thumbnailKey } from "@/lib/take-rules";
import { processingJob, render, storageDeletion, take } from "../schema";
import { runTx } from "../tx";
import type { Executor, Take, Tx } from "../types";
import { queueDeletions } from "./jobs";

/**
 * Deleting and expiring takes, and draining the file deletion queue (spec 0002, AC-17,
 * AC-18). Every file key removed from a row is queued in `storage_deletion` in the same
 * transaction, so no file is ever orphaned. Job safe: IDs only.
 */

/**
 * Every file key these takes may have stored: originals, the derived thumbnail key, plus the derived key of every render
 * row (`renders/{takeId}/{renderId}.mp4`), not only renders with a recorded `video_key`. A
 * render step uploads its file before the row records success, so a crash or failure in
 * between would otherwise orphan the object. Deleting a key that was never written is a no op.
 */
export async function takeFileKeys(tx: Executor, takeIds: readonly string[]): Promise<string[]> {
  if (takeIds.length === 0) return [];
  const originals = await tx
    .select({ key: take.originalKey })
    .from(take)
    .where(inArray(take.id, [...takeIds]));
  const renders = await tx
    .select({ id: render.id, takeId: render.takeId })
    .from(render)
    .where(inArray(render.takeId, [...takeIds]));
  return [
    ...new Set([
      ...originals.map(({ key }) => key),
      // The probe's thumbnail (`originals/{takeId}/thumb.jpg`), derived like the render keys.
      ...takeIds.map(thumbnailKey),
      ...renders.map((row) => renderKey(row.takeId, row.id)),
    ]),
  ];
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
    // A take is never expired while a job of any kind runs for it (a transcribe job leaves the
    // take `ready`); it expires on the next sweep after the job ends (spec 0007).
    const [active] = await tx
      .select({ id: processingJob.id })
      .from(processingJob)
      .where(
        and(
          eq(processingJob.takeId, input.takeId),
          inArray(processingJob.status, ACTIVE_JOB_STATUSES),
        ),
      );
    if (active) return err("invalid_transition");

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
 * Drains the file deletion queue in batches, without holding a transaction across R2 calls:
 * read a batch, delete each object, then record each outcome in its own short statement
 * (remove the row, or bump `attempts` and `last_error`, status text only, never the key).
 * A timeout mid batch therefore loses at most the row in flight, and failure counts always
 * reach `maxAttempts`. The task's queue runs one drain at a time; a rare overlap only repeats
 * a delete, which is harmless. Stops when no eligible rows are left or after `maxBatches`.
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
    const rows = await db
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
      .limit(batchSize);

    for (const row of rows) {
      try {
        await deleteObject(row.objectKey);
        await db.delete(storageDeletion).where(eq(storageDeletion.id, row.id));
        deleted++;
      } catch (error) {
        failed++;
        failedIds.add(row.id);
        const message = error instanceof Error ? error.message : "delete failed";
        await db
          .update(storageDeletion)
          .set({
            attempts: sql`${storageDeletion.attempts} + 1`,
            lastError: message.slice(0, 500),
          })
          .where(eq(storageDeletion.id, row.id));
      }
    }
    if (rows.length < batchSize) break;
  }

  const [{ stuck } = { stuck: 0 }] = await db
    .select({ stuck: sql<number>`count(*)::int` })
    .from(storageDeletion)
    .where(sql`${storageDeletion.attempts} >= ${maxAttempts}`);
  return { deleted, failed, stuck };
}
