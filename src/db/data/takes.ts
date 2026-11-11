import { and, eq } from "drizzle-orm";
import type { TakeStatus } from "@/lib/processing";
import { type Result, err, ok } from "@/lib/result";
import { type Probe, canTransition, checkUpload, videoExpiresAt } from "@/lib/take-rules";
import { take } from "../schema";
import type { Executor, Take } from "../types";

/**
 * System functions for takes (spec 0002, API surface), safe for jobs: they act on IDs and
 * never take a creator from a request. Creator scoped functions live in src/server/takes.
 */

export type TransitionError = "not_found" | "invalid_transition";

type TransitionChanges = Partial<
  Pick<
    typeof take.$inferInsert,
    | "failureCode"
    | "durationMs"
    | "width"
    | "height"
    | "container"
    | "videoExpiresAt"
    | "uploadId"
    | "originalBytes"
  >
>;

/**
 * Moves a take from `from` to `to` as a compare and swap (`WHERE status = from`), applying
 * `changes` in the same update (AC-3). Rejects pairs the state machine does not allow.
 * Pass a transaction to compose it with other writes.
 */
export async function transitionTake(
  db: Executor,
  takeId: string,
  from: TakeStatus,
  to: TakeStatus,
  changes: TransitionChanges = {},
): Promise<Result<Take, TransitionError>> {
  if (!canTransition(from, to)) return err("invalid_transition");

  const [updated] = await db
    .update(take)
    .set({ ...changes, status: to })
    .where(and(eq(take.id, takeId), eq(take.status, from)))
    .returning();
  if (updated) return ok(updated);

  const [exists] = await db.select({ id: take.id }).from(take).where(eq(take.id, takeId));
  return err(exists ? "invalid_transition" : "not_found");
}

/** `takes.transition`: the compare and swap on its own (system). */
export function transition(
  db: Executor,
  input: { readonly takeId: string; readonly from: TakeStatus; readonly to: TakeStatus },
): Promise<Result<Take, TransitionError>> {
  return transitionTake(db, input.takeId, input.from, input.to);
}

/**
 * `takes.markUploaded` (AC-5): after the upload completes, checks the stored size (R2 HEAD)
 * and the probe against the limits. Within limits the take becomes `uploaded` with its
 * media facts and `video_expires_at` = now + 30 days; otherwise `failed` with a non
 * refundable code. Either way the multipart upload ID is cleared.
 */
export async function markUploaded(
  db: Executor,
  input: {
    readonly takeId: string;
    readonly sizeBytes: number;
    readonly probe: Probe | null;
    readonly now?: Date;
  },
): Promise<Result<Take, TransitionError>> {
  const now = input.now ?? new Date();
  const verdict = checkUpload(input.sizeBytes, input.probe);

  if (!verdict.ok) {
    return transitionTake(db, input.takeId, "uploading", "failed", {
      failureCode: verdict.failureCode,
      originalBytes: input.sizeBytes,
      uploadId: null,
    });
  }
  return transitionTake(db, input.takeId, "uploading", "uploaded", {
    durationMs: verdict.durationMs,
    width: verdict.width,
    height: verdict.height,
    container: verdict.container,
    originalBytes: input.sizeBytes,
    uploadId: null,
    videoExpiresAt: videoExpiresAt(now),
  });
}
