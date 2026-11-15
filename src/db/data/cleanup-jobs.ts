import { and, asc, eq, gte, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { CLEANUP, cleanupCutoffs } from "@/lib/cleanup-rules";
import { processingJob } from "../schema";
import type { Executor } from "../types";
import { finish } from "./jobs";

export type StaleJob = {
  readonly jobId: string;
  /** The job's kind: `transcribe` jobs never send the take email (spec 0007). */
  readonly kind: string;
  readonly refundedSeconds: number;
  /** Trigger.dev run to cancel, when known. */
  readonly runId: string | null;
};

/**
 * Fails jobs that are stuck with the refundable `stale_run`: `queued` for longer than the
 * pick up window, or `running` past the task's maxDuration plus a margin (each kind has its own:
 * a `transcribe` job is stale after 50 minutes, the video kinds after 85). Uses `jobs.finish`,
 * so the take moves and the refund happens exactly as for any other failure.
 */
export async function failStaleJobs(
  db: Executor,
  now: Date,
  /**
   * Whether a run is still waiting its turn (Trigger.dev). A `queued` job whose run is waiting,
   * for instance behind its creator's concurrency limit, is not failed as `stale_run` until the
   * 6 hour backstop. Without it (or without a run ID) a queued job is stale after 15 minutes.
   * Asked at most `CLEANUP.queuedRunChecksPerSweep` times per call, so a slow API cannot eat
   * the rest of the cleanup; the answer for the rest is "waiting".
   */
  isRunWaiting?: (runId: string) => Promise<boolean>,
  /**
   * Whether a run has not ended (Trigger.dev). A `running` job past its usual limit whose run is
   * still alive is a late retry that waited in its creator's queue, not a stuck job: it is left
   * alone until the 6 hour backstop (`CLEANUP.runningBackstopMs` from `started_at`). Shares the
   * per sweep lookup cap with `isRunWaiting`. Without it (or without a run ID) a running job is
   * stale at its usual limit, as before.
   */
  isRunAlive?: (runId: string) => Promise<boolean>,
): Promise<readonly StaleJob[]> {
  const {
    queuedJobBefore,
    queuedBackstopBefore,
    runningJobBefore,
    runningBackstopBefore,
    transcribeRunningJobBefore,
  } = cleanupCutoffs(now);
  // A running job whose run may still be alive is left out of scan 1 until the backstop.
  const runningNeedsNoCheck = isRunAlive
    ? or(isNull(processingJob.triggerRunId), lt(processingJob.startedAt, runningBackstopBefore))
    : undefined;
  // Scan 1: everything that is stale without asking anyone. A queued job whose run may still be
  // waiting is left out here, so retained jobs can never crowd a stale one out of the batch.
  const needsNoCheck = isRunWaiting
    ? or(isNull(processingJob.triggerRunId), lt(processingJob.createdAt, queuedBackstopBefore))
    : undefined;
  const candidates = await db
    .select({ id: processingJob.id, kind: processingJob.kind })
    .from(processingJob)
    .where(
      or(
        and(
          eq(processingJob.status, "queued"),
          lt(processingJob.createdAt, queuedJobBefore),
          needsNoCheck,
        ),
        and(
          eq(processingJob.status, "running"),
          ne(processingJob.kind, "transcribe"),
          isNotNull(processingJob.startedAt),
          lt(processingJob.startedAt, runningJobBefore),
          runningNeedsNoCheck,
        ),
        and(
          eq(processingJob.status, "running"),
          eq(processingJob.kind, "transcribe"),
          isNotNull(processingJob.startedAt),
          lt(processingJob.startedAt, transcribeRunningJobBefore),
          runningNeedsNoCheck,
        ),
      ),
    )
    .orderBy(asc(processingJob.createdAt))
    .limit(CLEANUP.batchSize);

  const failed: StaleJob[] = [];
  const failStale = async (id: string, kind: string) => {
    const result = await finish(db, { jobId: id, status: "failed", failureCode: "stale_run", now });
    // `already_final`: it finished on its own meanwhile.
    if (result.ok) {
      failed.push({
        jobId: id,
        kind,
        refundedSeconds: result.data.refundedSeconds,
        runId: result.data.job.triggerRunId,
      });
    }
  };
  for (const { id, kind } of candidates) await failStale(id, kind);

  // Scan 2: queued jobs with a run, past 15 minutes. Ask Trigger.dev about a bounded number,
  // least recently checked first (a job found waiting is touched, so the next sweep asks about
  // the others): a run that has ended is failed, one that still waits is left alone.
  // Running jobs past their limit but before the backstop join the same queue of lookups, so the
  // cap is shared: both lists are least recently checked first and merged by that order.
  const select = {
    id: processingJob.id,
    kind: processingJob.kind,
    runId: processingJob.triggerRunId,
  };
  const waiting = isRunWaiting
    ? await db
        .select({ ...select, updatedAt: processingJob.updatedAt })
        .from(processingJob)
        .where(
          and(
            eq(processingJob.status, "queued"),
            lt(processingJob.createdAt, queuedJobBefore),
            isNotNull(processingJob.triggerRunId),
            gte(processingJob.createdAt, queuedBackstopBefore),
          ),
        )
        .orderBy(asc(processingJob.updatedAt))
        .limit(CLEANUP.queuedRunChecksPerSweep)
    : [];
  const running = isRunAlive
    ? await db
        .select({ ...select, updatedAt: processingJob.updatedAt })
        .from(processingJob)
        .where(
          and(
            eq(processingJob.status, "running"),
            isNotNull(processingJob.triggerRunId),
            isNotNull(processingJob.startedAt),
            gte(processingJob.startedAt, runningBackstopBefore),
            or(
              and(
                ne(processingJob.kind, "transcribe"),
                lt(processingJob.startedAt, runningJobBefore),
              ),
              and(
                eq(processingJob.kind, "transcribe"),
                lt(processingJob.startedAt, transcribeRunningJobBefore),
              ),
            ),
          ),
        )
        .orderBy(asc(processingJob.updatedAt))
        .limit(CLEANUP.queuedRunChecksPerSweep)
    : [];
  const lookups = [
    ...waiting.map((j) => ({ ...j, status: "queued" as const })),
    ...running.map((j) => ({ ...j, status: "running" as const })),
  ]
    .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
    .slice(0, CLEANUP.queuedRunChecksPerSweep);
  for (const { id, kind, runId, status } of lookups) {
    if (runId === null) continue;
    const check = status === "queued" ? isRunWaiting : isRunAlive;
    if (check && (await check(runId))) {
      await db
        .update(processingJob)
        .set({ updatedAt: now })
        .where(and(eq(processingJob.id, id), eq(processingJob.status, status)));
    } else {
      await failStale(id, kind);
    }
  }
  return failed;
}
