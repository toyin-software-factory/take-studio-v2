import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { removedRanges, renderKey } from "@/lib/cut-rules";
import { type Result, err, ok } from "@/lib/result";
import { cut, processingJob, render } from "../schema";
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
 * `background`, the background it is made for (spec 0008).
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
      .select({ id: processingJob.id })
      .from(processingJob)
      .where(and(eq(processingJob.id, input.jobId), eq(processingJob.takeId, input.takeId)));
    if (!job) return err("not_found");

    const cuts = await tx
      .select({ startMs: cut.startMs, endMs: cut.endMs, applied: cut.applied })
      .from(cut)
      .where(eq(cut.takeId, input.takeId))
      .orderBy(asc(cut.startMs));

    const [created] = await tx
      .insert(render)
      .values({
        id: crypto.randomUUID(),
        takeId: input.takeId,
        jobId: input.jobId,
        status: "pending",
        removedRanges: removedRanges(cuts),
        backgroundId: input.background?.backgroundId ?? null,
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
