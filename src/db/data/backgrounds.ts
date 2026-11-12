import { and, count, eq, gt, inArray, isNotNull, lt, or } from "drizzle-orm";
import { ACTIVE_JOB_STATUSES } from "@/lib/processing";
import {
  BACKGROUND_UPLOAD,
  type BackgroundFailureCode,
  backgroundKeys,
} from "@/lib/background-rules";
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

export type StartedUpload = { readonly id: string; readonly sourceKey: string };

/**
 * A new `uploading` background for the creator: at most 20 started per hour (failed ones
 * count, like takes) and 100 kept. The creator's row is locked so parallel requests cannot
 * both slip under a limit.
 */
export async function createBackgroundUpload(
  db: Executor,
  input: { creatorId: string; name: string; bytes: number; now?: Date },
): Promise<Result<StartedUpload, "rate_limited" | "library_full">> {
  const now = input.now ?? new Date();
  return runTx(db, async (tx) => {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, input.creatorId)).for("update");
    const [recent] = await tx
      .select({ n: count() })
      .from(background)
      .where(
        and(
          eq(background.creatorId, input.creatorId),
          gt(background.createdAt, new Date(now.getTime() - 3_600_000)),
        ),
      );
    if ((recent?.n ?? 0) >= BACKGROUND_UPLOAD.perHour) return err("rate_limited" as const);
    const [kept] = await tx
      .select({ n: count() })
      .from(background)
      .where(eq(background.creatorId, input.creatorId));
    if ((kept?.n ?? 0) >= BACKGROUND_UPLOAD.libraryCap) return err("library_full" as const);
    const id = crypto.randomUUID();
    const { sourceKey } = backgroundKeys(input.creatorId, id);
    await tx.insert(background).values({
      id,
      creatorId: input.creatorId,
      name: input.name,
      sourceKey,
      bytes: input.bytes,
      status: "uploading",
    });
    return ok({ id, sourceKey });
  });
}

/** The creator's own background (never a built in), or null. A malformed ID is not found. */
export async function getOwnBackground(db: Executor, creatorId: string, id: string) {
  const [row] = await db
    .select()
    .from(background)
    .where(and(eq(background.id, id), eq(background.creatorId, creatorId)));
  return row ?? null;
}

/** `/complete`: `uploading` to `processing`. Anything else is `not_uploaded`. */
export async function beginProcessing(
  db: Executor,
  creatorId: string,
  id: string,
): Promise<Result<void, "not_found" | "not_uploaded">> {
  return runTx(db, async (tx) => {
    const [row] = await tx
      .select({ status: background.status })
      .from(background)
      .where(and(eq(background.id, id), eq(background.creatorId, creatorId)))
      .for("update");
    if (!row) return err("not_found" as const);
    if (row.status !== "uploading") return err("not_uploaded" as const);
    await tx
      .update(background)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(background.id, id));
    return ok(undefined);
  });
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
): Promise<Result<void, "not_found" | "in_use">> {
  return runTx(db, async (tx) => {
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
    await tx.delete(background).where(eq(background.id, id));
    return ok(undefined);
  });
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

/** What ingest stores when it succeeds. */
export type IngestResult = {
  readonly imageKey: string;
  readonly thumbKey: string;
  readonly width: number;
  readonly height: number;
};

/**
 * The end of an ingest: re-reads the row under a lock. Deleted meanwhile, or no longer
 * `processing` (cleanup failed it): writes nothing and returns `gone`, so the caller queues the
 * keys it wrote. Otherwise `ready` with the files and size.
 */
export async function saveIngest(
  db: Executor,
  id: string,
  result: IngestResult,
): Promise<Result<void, "gone">> {
  return runTx(db, async (tx) => {
    const [row] = await tx
      .select({ status: background.status })
      .from(background)
      .where(eq(background.id, id))
      .for("update");
    if (!row || row.status !== "processing") return err("gone" as const);
    await tx
      .update(background)
      .set({
        status: "ready",
        failureCode: null,
        imageKey: result.imageKey,
        thumbKey: result.thumbKey,
        width: result.width,
        height: result.height,
        updatedAt: new Date(),
      })
      .where(eq(background.id, id));
    return ok(undefined);
  });
}

/** Ingest refused the image: `failed` with the code, only while the row is still `processing`. */
export async function failIngest(
  db: Executor,
  id: string,
  code: BackgroundFailureCode,
): Promise<boolean> {
  const [row] = await db
    .update(background)
    .set({ status: "failed", failureCode: code, updatedAt: new Date() })
    .where(and(eq(background.id, id), eq(background.status, "processing")))
    .returning({ id: background.id });
  return row !== undefined;
}
