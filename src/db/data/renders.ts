import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { effectiveRemovedRanges, renderKey } from "@/lib/cut-rules";
import { type Result, err, ok } from "@/lib/result";
import { background, cut, processingJob, render } from "../schema";
import { runTx } from "../tx";
import type { Executor, Render } from "../types";

/**
 * System render functions (spec 0002, AC-10), safe for jobs: IDs only.
 *
 * Which render is the take's latest is decided by `jobs.finish` (it calls
 * `flipLatestRender`, which clears the old latest's `video_key` and queues it for deletion in
 * the same transaction). These functions only create a render and record its success.
 */

/** What a render records about its background (spec 0008); none means the original. */
export type BackgroundSnapshot = {
  readonly backgroundId: string | null;
  readonly backgroundName: string | null;
  /** True only when the green was actually replaced. */
  readonly keyed: boolean;
  /** The detected key colour (`#rrggbb`), null when not keyed. */
  readonly keyColor: string | null;
};

/**
 * `renders.create`: a `pending` render for a job, snapshotting the applied cuts as
 * `removed_ranges` at render step start (AC-9: a re render never recomputes cuts) and, with
 * `background`, the background it is made for (spec 0008). A change job's `cut_plan` (spec
 * 0011) is read from the job row here, never from the task payload, so a retry gets the same
 * ranges; the callers run this under `whileJobActive`, which holds that row locked.
 */
export async function create(
  db: Executor,
  input: {
    readonly takeId: string;
    readonly jobId: string;
    readonly background?: BackgroundSnapshot;
  },
): Promise<Result<Render, "not_found">> {
  return runTx(db, async (tx) => {
    const [job] = await tx
      .select({ id: processingJob.id, cutPlan: processingJob.cutPlan })
      .from(processingJob)
      .where(and(eq(processingJob.id, input.jobId), eq(processingJob.takeId, input.takeId)));
    if (!job) return err("not_found");

    const cuts = await tx
      .select({ id: cut.id, startMs: cut.startMs, endMs: cut.endMs, applied: cut.applied })
      .from(cut)
      .where(eq(cut.takeId, input.takeId))
      .orderBy(asc(cut.startMs));

    // The background may have been deleted since the job loaded it: then the render records no
    // reference (it still keeps the name) instead of failing on the foreign key.
    let backgroundId = input.background?.backgroundId ?? null;
    if (backgroundId) {
      const [still] = await tx
        .select({ id: background.id })
        .from(background)
        .where(eq(background.id, backgroundId))
        .for("key share");
      if (!still) backgroundId = null;
    }

    const [created] = await tx
      .insert(render)
      .values({
        id: crypto.randomUUID(),
        takeId: input.takeId,
        jobId: input.jobId,
        status: "pending",
        removedRanges: effectiveRemovedRanges(cuts, job.cutPlan),
        backgroundId,
        backgroundName: input.background?.backgroundName ?? null,
        keyed: input.background?.keyed ?? false,
        keyColor: input.background?.keyColor ?? null,
      })
      .returning();
    return created ? ok(created) : err("not_found");
  });
}

/**
 * `renders.completeLatest`: records a render's success, its length, and its video key
 * (`renders/{takeId}/{renderId}.mp4`, derived, never taken from input). Only a `pending`
 * render can complete. It becomes the take's latest when `jobs.finish` succeeds the job.
 */
export async function completeLatest(
  db: Executor,
  input: { readonly renderId: string; readonly durationMs: number },
): Promise<Result<Render, "not_found" | "invalid" | "already_final">> {
  if (!z.number().int().positive().safeParse(input.durationMs).success) return err("invalid");

  const [current] = await db
    .select({ takeId: render.takeId, status: render.status })
    .from(render)
    .where(eq(render.id, input.renderId));
  if (!current) return err("not_found");

  const [updated] = await db
    .update(render)
    .set({
      status: "succeeded",
      durationMs: input.durationMs,
      videoKey: renderKey(current.takeId, input.renderId),
    })
    .where(and(eq(render.id, input.renderId), eq(render.status, "pending")))
    .returning();
  return updated ? ok(updated) : err("already_final");
}

/**
 * `renders.markUnkeyed` (RF3-T05, spec 0008 AC-13): a `pending` render whose keyed output turned
 * out to be only the background is redone without the key, so the row now says so: `keyed`
 * false and no key colour. The background reference and name stay, which is what makes the take
 * page show the "no green screen" note. Only a `pending` render changes.
 */
export async function markUnkeyed(
  db: Executor,
  input: { readonly renderId: string },
): Promise<Result<Render, "not_found">> {
  const [updated] = await db
    .update(render)
    .set({ keyed: false, keyColor: null })
    .where(and(eq(render.id, input.renderId), eq(render.status, "pending")))
    .returning();
  return updated ? ok(updated) : err("not_found");
}
