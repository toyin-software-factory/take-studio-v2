import { and, count, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
import { ACTIVE_JOB_STATUSES } from "@/lib/processing";
import { BACKGROUND_UPLOAD, backgroundKeys } from "@/lib/background-rules";
import { type Result, err, ok } from "@/lib/result";
import { background, backgroundPreview, processingJob, user } from "../schema";
import { runTx } from "../tx";
import type { Executor } from "../types";
import { queueDeletions } from "./jobs";

/**
 * System functions for uploaded backgrounds (spec 0008, AC-8 to AC-10; Pipeline step 5). IDs
 * only, safe for jobs. Lock order (src/db/AGENTS.md): creator, then background, then take, job.
 */

/** Every file key of one background row, for deletion: its three files and its previews. */
async function fileKeys(tx: Executor, row: typeof background.$inferSelect): Promise<string[]> {
  const fixed = row.creatorId ? Object.values(backgroundKeys(row.creatorId, row.id)) : [];
  const previews = await tx
    .select({ key: backgroundPreview.objectKey })
    .from(backgroundPreview)
    .where(and(eq(backgroundPreview.backgroundId, row.id), isNotNull(backgroundPreview.objectKey)));
  return [...fixed, ...previews.flatMap((p) => (p.key ? [p.key] : []))];
}

/**
 * Deletes an uploaded background (AC-10). The row is locked first. It is refused (`in_use`)
 * while a queued or running job targets it: deleting would null the job's target
 * (ON DELETE SET NULL) and the worker could not tell that from "Keep original". Built ins and
 * other creators' backgrounds are `not_found`. Queues the three files and every preview still.
 */
export async function deleteBackground(
  db: Executor,
  creatorId: string,
  id: string,
  now: Date = new Date(),
): Promise<Result<void, "not_found" | "in_use">> {
  return runTx(db, async (tx) => {
    // Lock order: creator first. Deleting the row sets `user.default_background_id` to null (the
    // foreign key), which locks the creator row, and a background change locks creator, then
    // background; taking the creator here first keeps the two from deadlocking.
    await tx.select({ id: user.id }).from(user).where(eq(user.id, creatorId)).for("update");
    const [row] = await tx
      .select()
      .from(background)
      .where(and(eq(background.id, id), eq(background.creatorId, creatorId)))
      .for("update");
    if (!row) return err("not_found" as const);
    const [active] = await tx
      .select({ n: count() })
      .from(processingJob)
      .where(
        and(
          eq(processingJob.targetBackgroundId, id),
          inArray(processingJob.status, [...ACTIVE_JOB_STATUSES]),
        ),
      );
    if ((active?.n ?? 0) > 0) return err("in_use" as const);
    await queueDeletions(tx, await fileKeys(tx, row));
    // An upload link lives 15 minutes: a PUT sent before it expired can still write the source
    // file after the queue drained it. While that is possible the row stays as a hidden
    // `removed` tombstone, and `purgeRemovedBackgrounds` queues the keys once more and then
    // deletes it. Anything else is deleted at once.
    const linkMayBeLive =
      row.status === "uploading" &&
      now.getTime() - row.createdAt.getTime() < BACKGROUND_UPLOAD.removedKeepMs;
    if (linkMayBeLive) {
      await tx
        .update(background)
        .set({ status: "failed", failureCode: "removed", updatedAt: now })
        .where(eq(background.id, id));
    } else {
      await tx.delete(background).where(eq(background.id, id));
    }
    return ok(undefined);
  });
}

/**
 * The second half of deleting an upload whose link may still have been live: once the link has
 * expired, queues the keys again (catching a late write) and deletes the hidden row. One row at
 * a time; rows another run holds are skipped. Returns how many were purged.
 */
export async function purgeRemovedBackgrounds(
  db: Executor,
  now: Date,
  limit = 50,
): Promise<number> {
  const cutoff = new Date(now.getTime() - BACKGROUND_UPLOAD.removedKeepMs);
  const due = await db
    .select({ id: background.id })
    .from(background)
    .where(
      and(
        eq(background.status, "failed"),
        eq(background.failureCode, "removed"),
        lt(background.updatedAt, cutoff),
      ),
    )
    .limit(limit);
  let purged = 0;
  for (const { id } of due) {
    const done = await runTx(db, async (tx) => {
      const [row] = await tx
        .select()
        .from(background)
        .where(eq(background.id, id))
        .for("update", { skipLocked: true });
      if (!row || row.failureCode !== "removed" || row.updatedAt >= cutoff) return ok(false);
      await queueDeletions(tx, await fileKeys(tx, row));
      await tx.delete(background).where(eq(background.id, id));
      return ok(true);
    });
    if (done.ok && done.data) purged += 1;
  }
  return purged;
}

/**
 * Deletes every background of a creator in the account deletion transaction and queues their
 * files. Backgrounds are locked first (lock order), before the creator's takes.
 */
export async function deleteCreatorBackgrounds(tx: Executor, creatorId: string): Promise<number> {
  const rows = await tx
    .select()
    .from(background)
    .where(eq(background.creatorId, creatorId))
    .for("update");
  for (const row of rows) await queueDeletions(tx, await fileKeys(tx, row));
  if (rows.length > 0) await tx.delete(background).where(eq(background.creatorId, creatorId));
  return rows.length;
}

/**
 * Fails uploads that never finished: `uploading` or `processing` for over an hour, with
 * `upload_incomplete` or `ingest_error`, and queues their files (the source may be stored even
 * though the browser never completed). One row at a time, rows another run holds are skipped.
 * Returns how many were failed.
 */
export async function failStuckBackgrounds(db: Executor, now: Date, limit = 50): Promise<number> {
  const cutoff = new Date(now.getTime() - BACKGROUND_UPLOAD.stuckAfterMs);
  const stuck = await db
    .select({ id: background.id })
    .from(background)
    .where(
      and(
        or(eq(background.status, "uploading"), eq(background.status, "processing")),
        lt(background.updatedAt, cutoff),
      ),
    )
    .limit(limit);
  let failed = 0;
  for (const { id } of stuck) {
    const done = await runTx(db, async (tx) => {
      const [row] = await tx
        .select()
        .from(background)
        .where(eq(background.id, id))
        .for("update", { skipLocked: true });
      if (!row || !["uploading", "processing"].includes(row.status) || row.updatedAt >= cutoff) {
        return ok(false);
      }
      await queueDeletions(tx, await fileKeys(tx, row));
      await tx
        .update(background)
        .set({
          status: "failed",
          failureCode: row.status === "uploading" ? "upload_incomplete" : "ingest_error",
          updatedAt: now,
        })
        .where(eq(background.id, id));
      return ok(true);
    });
    if (done.ok && done.data) failed += 1;
  }
  return failed;
}
