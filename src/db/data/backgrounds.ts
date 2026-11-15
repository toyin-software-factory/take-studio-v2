import { and, asc, count, eq, gt, isNull } from "drizzle-orm";
import {
  BACKGROUND_UPLOAD,
  type BackgroundFailureCode,
  backgroundKeys,
} from "@/lib/background-rules";
import type { CatalogEntry } from "@/lib/ai-edit";
import { type Result, err, ok } from "@/lib/result";
import { background, take, user } from "../schema";
import { runTx } from "../tx";
import type { Executor } from "../types";

/**
 * System functions for uploaded backgrounds (spec 0008, AC-8 to AC-10; Pipeline step 5). IDs
 * only, safe for jobs. Lock order (src/db/AGENTS.md): creator, then background, then take, job.
 */

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

/**
 * The built in catalog the AI sees (spec 0012 AC-8): built in (`creator_id` null) and ready only,
 * ID, name and alt text, oldest first so the order is stable. Never an upload: those names are
 * creator text.
 */
export async function listBuiltInCatalog(db: Executor): Promise<readonly CatalogEntry[]> {
  const rows = await db
    .select({ id: background.id, name: background.name, alt: background.alt })
    .from(background)
    .where(and(isNull(background.creatorId), eq(background.status, "ready")))
    .orderBy(asc(background.createdAt), asc(background.id));
  return rows.map((r) => ({ id: r.id, name: r.name, alt: r.alt ?? r.name }));
}

/**
 * Sets or clears the take's AI background suggestion (spec 0012 AC-5; null clears both columns).
 * The reason can quote the take: never log it.
 */
export async function setTakeSuggestion(
  db: Executor,
  takeId: string,
  suggestion: { readonly backgroundId: string; readonly reason: string } | null,
): Promise<void> {
  await db
    .update(take)
    .set({
      suggestedBackgroundId: suggestion?.backgroundId ?? null,
      suggestionReason: suggestion?.reason ?? null,
    })
    .where(eq(take.id, takeId));
}

// Split by job (B2-T117): deleting, purging and failing stuck uploads is in
// `backgrounds-delete`. This file keeps the import path stable.
export {
  deleteBackground,
  deleteCreatorBackgrounds,
  failStuckBackgrounds,
  purgeRemovedBackgrounds,
} from "./backgrounds-delete";
