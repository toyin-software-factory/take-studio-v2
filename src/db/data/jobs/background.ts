import { and, count, desc, eq, gt, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { BACKGROUND_CHANGE } from "@/lib/background-rules";
import { ACTIVE_JOB_STATUSES, stepsFor } from "@/lib/processing";
import { type Result, err, ok } from "@/lib/result";
import { isExpired } from "@/lib/take-media";
import { background, processingJob, render, take, user } from "../../schema";
import type { Executor, ProcessingJob, Take, Tx } from "../../types";
import { discardJobRenders, flipLatestRender } from "./render-files";
import { runStart, startJobRow } from "./start-shared";
import type { FinishResult, FinishStatus, StartedJob } from "./types";

/** Stands for "keyed on a background that has since been deleted" when comparing targets. */
const DELETED_BACKGROUND = "deleted";

/**
 * LEGACY (HRF-T08): before the `background` kind existed every background change was a
 * `rerender` (a `rerender` never has a `trim` step, so the old "no trim step" rule matched all of
 * them), and those rows were not converted: they cannot be told from a `startJob` re render
 * afterwards. An old Worker may also start one during the deploy. The hourly count and the latest
 * change lookup therefore still treat a `rerender` as a possible background change, as they did
 * before. A later cleanup task converts the rows and removes this with the `rerender` branch of
 * `isBackgroundChange`.
 */
export const legacyBackgroundRerender = sql`${processingJob.kind} = 'rerender'`;

export type BackgroundStartError =
  | "not_found"
  | "invalid_transition"
  | "original_gone"
  | "job_active"
  | "same_background"
  | "no_green_screen"
  | "background_change_limit"
  | "background_not_ready";

/**
 * `startBackgroundJob` (spec 0008, "Job seam"), one transaction. Like `startTranscribeJob` it
 * never moves the take and never charges; it starts a `background` job that renders the take's
 * current cuts onto `backgroundId` (null is the original):
 * 0. lock the creator's row (lock order: creator, background, take, job), so the hourly limit
 *    below cannot be passed by parallel requests;
 * 1. lock the background `FOR KEY SHARE`, then the take `FOR UPDATE` (lock order);
 * 2. the background must exist and be built in or the creator's (`not_found` otherwise, so
 *    another creator's ID leaks nothing) and `ready` (`background_not_ready`);
 * 3. the take must be `ready` (`invalid_transition`) with its original still stored
 *    (`original_gone`) and no active job (`job_active`);
 * 4. refuse `same_background` when the target equals the latest render's effective background
 *    (`keyed ? background_id : null`), unless the latest video job failed (Try again);
 * 5. refuse `no_green_screen` for a real background when the latest render found no green screen
 *    (`keyed` false with a background name); going back to the original stays allowed;
 * 6. refuse `background_change_limit` at 10 background changes started in the last hour by the
 *    creator (counted from `processing_job` through `take.creator_id`);
 * 7. insert the job (0 seconds, `target_background_id`) and its steps.
 */
export async function startBackgroundJob(
  db: Executor,
  input: {
    readonly creatorId: string;
    readonly takeId: string;
    readonly backgroundId: string | null;
    readonly now?: Date;
  },
): Promise<Result<StartedJob, BackgroundStartError>> {
  if (!z.uuid().safeParse(input.takeId).success) return err("not_found");
  if (input.backgroundId !== null && !z.uuid().safeParse(input.backgroundId).success) {
    return err("not_found");
  }
  const now = input.now ?? new Date();

  return runStart<StartedJob, BackgroundStartError>(db, "job_active", async (tx) => {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, input.creatorId)).for("update");
    let target: string | null = null;
    if (input.backgroundId !== null) {
      const [chosen] = await tx
        .select()
        .from(background)
        .where(eq(background.id, input.backgroundId))
        .for("key share");
      if (!chosen || (chosen.creatorId !== null && chosen.creatorId !== input.creatorId)) {
        return err("not_found");
      }
      if (chosen.status !== "ready") return err("background_not_ready");
      target = chosen.id;
    }

    const [current] = await tx
      .select()
      .from(take)
      .where(and(eq(take.id, input.takeId), eq(take.creatorId, input.creatorId)))
      .for("update");
    if (!current) return err("not_found");

    if (isExpired(current, now)) return err("original_gone");
    if (current.status !== "ready") return err("invalid_transition");

    const [active] = await tx
      .select({ id: processingJob.id })
      .from(processingJob)
      .where(
        and(
          eq(processingJob.takeId, current.id),
          inArray(processingJob.status, ACTIVE_JOB_STATUSES),
        ),
      );
    if (active) return err("job_active");

    const [latestRender] = await tx
      .select({
        keyed: render.keyed,
        backgroundId: render.backgroundId,
        backgroundName: render.backgroundName,
      })
      .from(render)
      .where(and(eq(render.takeId, current.id), eq(render.isLatest, true)));
    // A keyed render whose background was deleted (the reference is now null) is on a
    // background that no request can name, so it never equals the original (null) or any ID.
    const effective = latestRender?.keyed
      ? (latestRender.backgroundId ?? DELETED_BACKGROUND)
      : null;
    if (target === effective) {
      // Asking for what the video already has is refused, unless the last video job failed:
      // then it is a retry of that change.
      const [latestJob] = await tx
        .select({ status: processingJob.status })
        .from(processingJob)
        .where(and(eq(processingJob.takeId, current.id), ne(processingJob.kind, "transcribe")))
        .orderBy(desc(processingJob.createdAt))
        .limit(1);
      if (latestJob?.status !== "failed") return err("same_background");
    }

    // The last render found no green screen: a real background would show nowhere, so the
    // re render would only cost. The original stays allowed.
    if (target !== null && latestRender?.backgroundName != null && latestRender.keyed === false) {
      return err("no_green_screen");
    }

    // Background changes are the jobs of kind `background`, plus (LEGACY, HRF-T08) the
    // `rerender` rows that were background changes before the kind existed. Failed ones and
    // retries count.
    const [recent] = await tx
      .select({ n: count() })
      .from(processingJob)
      .innerJoin(take, eq(take.id, processingJob.takeId))
      .where(
        and(
          eq(take.creatorId, input.creatorId),
          or(eq(processingJob.kind, "background"), legacyBackgroundRerender),
          gt(processingJob.createdAt, new Date(now.getTime() - 3_600_000)),
        ),
      );
    if ((recent?.n ?? 0) >= BACKGROUND_CHANGE.perHour) return err("background_change_limit");

    const started = await startJobRow(tx, {
      job: {
        takeId: current.id,
        kind: "background",
        targetBackgroundId: target,
        secondsCharged: 0,
        chargedMonth: null,
        chargedAccountHash: null,
      },
      stepNames: stepsFor("background", { hasBackground: target !== null }),
    });
    return started ? ok(started) : err("job_active");
  });
}

/**
 * The finish of a background change (spec 0008, `startBackgroundJob`): a `background` job works
 * beside a take that stays `ready`: no take transition, no refund (it charged nothing). A re
 * render started by `startJob` is a `rerender` with the take in `processing` and takes the
 * video path instead. LEGACY (HRF-T08 deploy window): a `rerender` on a take that is not
 * `processing` is still a background change (`isBackgroundChange`), because an old Worker may
 * have started it; a later cleanup task removes that branch.
 */
export async function finishBackgroundJob(
  tx: Tx,
  input: { readonly job: ProcessingJob; readonly current: Take; readonly status: FinishStatus },
): Promise<FinishResult> {
  const { job, current } = input;
  if (input.status === "succeeded") {
    // The new render becomes the latest and the take's background becomes the job's target
    // (null is the original), in this transaction.
    const queuedKeys = await flipLatestRender(tx, { takeId: job.takeId, jobId: job.id });
    // The take's background comes from the render that was just made (its snapshot), not
    // from `target_background_id`: a delete of the background clears that reference on the
    // job, and the render's snapshot says what the video really is on. A render with no
    // background (the original, or the background gone) leaves the take on the original.
    const [made] = await tx
      .select({ backgroundId: render.backgroundId })
      .from(render)
      .where(and(eq(render.jobId, job.id), eq(render.isLatest, true)));
    const [updated] = await tx
      .update(take)
      .set({ backgroundId: made ? made.backgroundId : job.targetBackgroundId })
      .where(eq(take.id, job.takeId))
      .returning();
    return { job, take: updated ?? current, refundedSeconds: 0, queuedKeys };
  }
  // Failed or cancelled: the take, its latest render and its background stay as they are;
  // only the files of this job's own renders go.
  const queuedKeys = await discardJobRenders(tx, { takeId: job.takeId, jobId: job.id });
  return { job, take: current, refundedSeconds: 0, queuedKeys };
}
