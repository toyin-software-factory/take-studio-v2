import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { dispatchJob } from "@/db/data/dispatch";
import { type ChangeStartError, startChangeJob } from "@/db/data/jobs";
import { processingJob, take } from "@/db/schema";
import type { Executor } from "@/db/types";
import type { CutPlanEntry } from "@/lib/cut-rules";
import { type Result, err, ok } from "@/lib/result";
import { recordEvent } from "../analytics/record";

export type StartChangesError = ChangeStartError | "dispatch_failed";

/**
 * Start one change render (spec 0011): `startChangeJob` (0 seconds charged, the take stays Ready
 * and keeps its current video) then the dispatch of `process-take`. A trigger that throws
 * finishes the job `trigger_failed` at once (inside `dispatchJob`), so it never sits queued and
 * nothing about the take changes.
 */
export async function startChanges(
  db: Executor,
  input: {
    readonly creatorId: string;
    readonly takeId: string;
    readonly baseRenderId?: string | null;
    readonly background?: { readonly id: string | null };
    readonly cuts: readonly CutPlanEntry[];
    readonly now?: Date;
  },
  trigger: (jobId: string) => Promise<{ readonly id: string }>,
): Promise<Result<{ readonly jobId: string }, StartChangesError>> {
  const started = await startChangeJob(db, input);
  if (!started.ok) return err(started.error);
  const dispatched = await dispatchJob(db, { jobId: started.data.id, trigger });
  if (!dispatched.ok) return err("dispatch_failed");
  // Spec 0016 AC-4: a change request started (IDs only). Best effort, never changes the result.
  await recordEvent(db, {
    name: "change_requested",
    creatorId: input.creatorId,
    takeId: input.takeId,
  });
  return ok({ jobId: started.data.id });
}

/** The status of one job of the creator's own take, or null (not theirs, not this take's). */
export async function jobStatusForCreator(
  db: Executor,
  creatorId: string,
  takeId: string,
  jobId: string,
): Promise<{ readonly status: string } | null> {
  if (!z.uuid().safeParse(takeId).success || !z.uuid().safeParse(jobId).success) return null;
  const [row] = await db
    .select({ status: processingJob.status })
    .from(processingJob)
    .innerJoin(take, eq(take.id, processingJob.takeId))
    .where(and(eq(processingJob.id, jobId), eq(take.id, takeId), eq(take.creatorId, creatorId)));
  return row ?? null;
}

/** The stored waveform of the creator's own take (null when not computed), or undefined for 404. */
export async function waveformForCreator(
  db: Executor,
  creatorId: string,
  takeId: string,
): Promise<readonly number[] | null | undefined> {
  if (!z.uuid().safeParse(takeId).success) return undefined;
  const [row] = await db
    .select({ waveform: take.waveform })
    .from(take)
    .where(and(eq(take.id, takeId), eq(take.creatorId, creatorId)));
  return row ? row.waveform : undefined;
}
