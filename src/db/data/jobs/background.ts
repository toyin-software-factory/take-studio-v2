import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { effectiveRemovedRanges, sameRanges } from "@/lib/cut-rules";
import { cut, processingJob, render, take } from "../../schema";
import type { ProcessingJob, Take, Tx } from "../../types";
import { discardJobRenders, flipLatestRender } from "./render-files";
import type { FinishResult, FinishStatus } from "./types";

/**
 * The finish of a background change (spec 0008, `startChangeJob`): a `background` job works
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
  const { current } = input;
  let { job } = input;
  let status = input.status;
  // Spec 0011 safety check: a job with a cut plan only succeeds when its render has exactly the
  // plan's ranges, so an old task version that ignores the plan can never ship a wrong video.
  if (status === "succeeded" && job.cutPlan !== null && !(await rendersPlan(tx, job))) {
    console.error("render_mismatch", { jobId: job.id, takeId: job.takeId });
    const [failed] = await tx
      .update(processingJob)
      .set({ status: "failed", failureCode: "render_mismatch" })
      .where(eq(processingJob.id, job.id))
      .returning();
    job = failed ?? job;
    status = "failed";
  }
  if (status === "succeeded") {
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
    await applyCutPlan(tx, job);
    return { job, take: updated ?? current, refundedSeconds: 0, queuedKeys };
  }
  // Failed or cancelled: the take, its latest render and its background stay as they are;
  // only the files of this job's own renders go.
  const queuedKeys = await discardJobRenders(tx, { takeId: job.takeId, jobId: job.id });
  return { job, take: current, refundedSeconds: 0, queuedKeys };
}

/** True when the job's newest succeeded render has the ranges its cut plan asks for. */
async function rendersPlan(tx: Tx, job: ProcessingJob): Promise<boolean> {
  const [made] = await tx
    .select({ removedRanges: render.removedRanges })
    .from(render)
    .where(
      and(eq(render.takeId, job.takeId), eq(render.jobId, job.id), eq(render.status, "succeeded")),
    )
    .orderBy(desc(render.createdAt))
    .limit(1);
  if (!made) return false;
  const cuts = await tx
    .select({ id: cut.id, startMs: cut.startMs, endMs: cut.endMs, applied: cut.applied })
    .from(cut)
    .where(eq(cut.takeId, job.takeId))
    .orderBy(asc(cut.startMs));
  return sameRanges(made.removedRanges, effectiveRemovedRanges(cuts, job.cutPlan));
}

/**
 * Writes the plan's states onto the cuts, all with the job's `finished_at` as `creator_changed_at`
 * (re analysis keeps a creator touched cut, spec 0002 AC-9). `WHERE id AND take_id` so an entry
 * can only ever reach this take's own cuts.
 */
async function applyCutPlan(tx: Tx, job: ProcessingJob): Promise<void> {
  const changedAt = job.finishedAt ?? new Date();
  for (const applied of [true, false]) {
    const ids = (job.cutPlan ?? []).filter((e) => e.applied === applied).map((e) => e.cutId);
    if (ids.length === 0) continue;
    await tx
      .update(cut)
      .set({ applied, creatorChangedAt: changedAt })
      .where(and(inArray(cut.id, ids), eq(cut.takeId, job.takeId)));
  }
}
