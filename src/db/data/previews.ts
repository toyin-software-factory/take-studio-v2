import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { cutVersion, isStalePreview, previewKey } from "@/lib/background-preview";
import { removedRanges } from "@/lib/cut-rules";
import { type Result, err, ok } from "@/lib/result";
import { background, backgroundPreview, cut, render, take } from "../schema";
import { runTx } from "../tx";
import type { Background, BackgroundPreview, Executor, Render, Take } from "../types";

/**
 * Data functions for background previews (spec 0008, AC-4). A preview is one frame of a take on
 * a background, cached in `background_preview` per take, background and cut version. Files:
 * `previews/{takeId}/{previewId}.jpg`, deleted by exact key (a take's rows are read on take
 * deletion, see `takeFileKeys`).
 */

/** True when the take's original is gone or past its expiry (previews of it are not served). */
function takeExpired(
  t: { readonly status: string; readonly videoExpiresAt: Date | null },
  now: Date,
): boolean {
  return (
    t.status === "expired" ||
    (t.videoExpiresAt !== null && t.videoExpiresAt.getTime() <= now.getTime())
  );
}

export type RequestPreviewError =
  "not_found" | "original_gone" | "not_ready" | "background_not_ready";

export type PreviewRequest = { readonly preview: BackgroundPreview; readonly dispatch: boolean };

/**
 * `requestPreview`, one transaction (lock order: the background `FOR KEY SHARE`, then the take).
 * The background must be built in or the creator's (`not_found` otherwise) and `ready`; the
 * take the creator's, `ready`, with its original stored. The row for the take's current cut
 * version is reused: `ready` is a cache hit and a fresh `making` is left running, neither
 * dispatches; a `failed` row, or a `making` one older than two minutes, is reset to `making`
 * and dispatched again; no row inserts one. `dispatch` says whether the caller must start the
 * `preview-background` job.
 */
export async function requestPreview(
  db: Executor,
  input: {
    readonly creatorId: string;
    readonly takeId: string;
    readonly backgroundId: string;
    readonly now?: Date;
  },
): Promise<
  Result<{ readonly preview: BackgroundPreview; readonly dispatch: boolean }, RequestPreviewError>
> {
  if (!z.uuid().safeParse(input.takeId).success) return err("not_found");
  if (!z.uuid().safeParse(input.backgroundId).success) return err("not_found");
  const now = input.now ?? new Date();

  return runTx<PreviewRequest, RequestPreviewError>(db, async (tx) => {
    const [chosen] = await tx
      .select()
      .from(background)
      .where(eq(background.id, input.backgroundId))
      .for("key share");
    if (!chosen || (chosen.creatorId !== null && chosen.creatorId !== input.creatorId)) {
      return err("not_found");
    }
    if (chosen.status !== "ready") return err("background_not_ready");

    const [current] = await tx
      .select()
      .from(take)
      .where(and(eq(take.id, input.takeId), eq(take.creatorId, input.creatorId)))
      .for("update");
    if (!current) return err("not_found");
    if (takeExpired(current, now)) return err("original_gone");
    if (current.status !== "ready") return err("not_ready");

    const cuts = await tx.select().from(cut).where(eq(cut.takeId, current.id));
    const version = await cutVersion(removedRanges(cuts));

    const [existing] = await tx
      .select()
      .from(backgroundPreview)
      .where(
        and(
          eq(backgroundPreview.takeId, current.id),
          eq(backgroundPreview.backgroundId, chosen.id),
          eq(backgroundPreview.cutVersion, version),
        ),
      );
    if (existing) {
      if (existing.status === "ready") return ok({ preview: existing, dispatch: false });
      if (existing.status === "making" && !isStalePreview(existing.updatedAt, now)) {
        return ok({ preview: existing, dispatch: false });
      }
      // Failed, or stale: start again on the same row.
      const [reset] = await tx
        .update(backgroundPreview)
        .set({ status: "making", objectKey: null, noGreenScreen: false, updatedAt: now })
        .where(eq(backgroundPreview.id, existing.id))
        .returning();
      return reset ? ok({ preview: reset, dispatch: true }) : err("not_found");
    }

    const [created] = await tx
      .insert(backgroundPreview)
      .values({
        id: crypto.randomUUID(),
        takeId: current.id,
        backgroundId: chosen.id,
        cutVersion: version,
        status: "making",
      })
      .returning();
    return created ? ok({ preview: created, dispatch: true }) : err("not_found");
  });
}

/**
 * `getPreview`: the preview of the creator's take on a background for the take's current cut
 * version (read only), or `not_found` when none was requested (or the take or background is not
 * theirs).
 */
export async function getPreview(
  db: Executor,
  input: {
    readonly creatorId: string;
    readonly takeId: string;
    readonly backgroundId: string;
    readonly now?: Date;
  },
): Promise<Result<BackgroundPreview, "not_found" | "original_gone">> {
  if (!z.uuid().safeParse(input.takeId).success) return err("not_found");
  if (!z.uuid().safeParse(input.backgroundId).success) return err("not_found");
  const [owned] = await db
    .select({ id: take.id, status: take.status, videoExpiresAt: take.videoExpiresAt })
    .from(take)
    .where(and(eq(take.id, input.takeId), eq(take.creatorId, input.creatorId)));
  if (!owned) return err("not_found");
  // Expiry queues the previews' files for deletion, so a still of an expired take is not served.
  if (takeExpired(owned, input.now ?? new Date())) return err("original_gone");
  const [chosen] = await db.select().from(background).where(eq(background.id, input.backgroundId));
  if (!chosen || (chosen.creatorId !== null && chosen.creatorId !== input.creatorId)) {
    return err("not_found");
  }
  const cuts = await db.select().from(cut).where(eq(cut.takeId, input.takeId));
  const version = await cutVersion(removedRanges(cuts));
  const [row] = await db
    .select()
    .from(backgroundPreview)
    .where(
      and(
        eq(backgroundPreview.takeId, input.takeId),
        eq(backgroundPreview.backgroundId, input.backgroundId),
        eq(backgroundPreview.cutVersion, version),
      ),
    );
  return row ? ok(row) : err("not_found");
}

/** What the job needs to make a preview: the rows, re read when the job starts. */
export type PreviewWork = {
  readonly preview: BackgroundPreview;
  readonly take: Take;
  readonly background: Background;
  /** The take's latest render (its key colour is reused when it was keyed). */
  readonly latestRender: Render | null;
};

/**
 * `loadPreviewWork`: the preview (it must still be `making`), its take and its background, and
 * the take's latest render; null when any of them is gone or the preview is no longer wanted
 * (deleted or expired take, deleted background, a reset, an already finished row).
 */
export async function loadPreviewWork(
  db: Executor,
  previewId: string,
  now: Date = new Date(),
): Promise<PreviewWork | null> {
  const [preview] = await db
    .select()
    .from(backgroundPreview)
    .where(eq(backgroundPreview.id, previewId));
  if (!preview || preview.status !== "making") return null;
  const [t] = await db.select().from(take).where(eq(take.id, preview.takeId));
  const [bg] = await db.select().from(background).where(eq(background.id, preview.backgroundId));
  if (!t || !bg || bg.status !== "ready" || !bg.imageKey) return null;
  // An expired take has no original to read, and its files are being deleted.
  if (takeExpired(t, now)) return null;
  const [latestRender] = await db
    .select()
    .from(render)
    .where(and(eq(render.takeId, t.id), eq(render.isLatest, true)));
  return { preview, take: t, background: bg, latestRender: latestRender ?? null };
}

export type CompletePreviewError = "gone" | "superseded";

/**
 * `completePreview`: records the finished still (`ready`, its derived key, whether the take had
 * no green screen), in one transaction that holds a share lock on the take, so it waits for an
 * expiry (`expireTake` locks the take `FOR UPDATE`, queues the preview keys and marks it
 * expired) and sees its result. It writes only while the row exists, the take is not expired and
 * the row is still `making`:
 * - `gone`: the row or the take is gone, or the take expired. Nothing references the file the
 *   job just wrote, so the job removes it.
 * - `superseded`: the row is no longer `making` (a retry or a reset finished it). The file at
 *   the derived key may be that run's, so the job leaves it alone.
 */
export async function completePreview(
  db: Executor,
  input: { readonly previewId: string; readonly noGreenScreen: boolean; readonly now?: Date },
): Promise<Result<BackgroundPreview, CompletePreviewError>> {
  return runTx<BackgroundPreview, CompletePreviewError>(db, async (tx) => {
    const [row] = await tx
      .select({ takeId: backgroundPreview.takeId })
      .from(backgroundPreview)
      .where(eq(backgroundPreview.id, input.previewId));
    if (!row) return err("gone");
    const [owner] = await tx
      .select({ status: take.status, videoExpiresAt: take.videoExpiresAt })
      .from(take)
      .where(eq(take.id, row.takeId))
      .for("share");
    if (!owner || takeExpired(owner, input.now ?? new Date())) return err("gone");
    const [updated] = await tx
      .update(backgroundPreview)
      .set({
        status: "ready",
        objectKey: previewKey(row.takeId, input.previewId),
        noGreenScreen: input.noGreenScreen,
      })
      .where(and(eq(backgroundPreview.id, input.previewId), eq(backgroundPreview.status, "making")))
      .returning();
    return updated ? ok(updated) : err("superseded");
  });
}

/** `failPreview`: a `making` preview ends `failed` (a new request starts it again). */
export async function failPreview(db: Executor, previewId: string): Promise<void> {
  await db
    .update(backgroundPreview)
    .set({ status: "failed", objectKey: null })
    .where(and(eq(backgroundPreview.id, previewId), eq(backgroundPreview.status, "making")));
}
