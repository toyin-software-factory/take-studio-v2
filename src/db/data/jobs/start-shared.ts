import type { StepName } from "@/lib/processing";
import { type Result, err } from "@/lib/result";
import { jobStep, processingJob } from "../../schema";
import { runTx } from "../../tx";
import { type Executor, type Tx, pgErrorCode } from "../../types";
import type { StartedJob } from "./types";

/** The partial unique index that allows one queued or running job per take. */
const ONE_ACTIVE_JOB_INDEX = "processing_job_one_active_per_take_uidx";

/**
 * Runs a start function in one transaction. The partial unique index is the last guard against
 * two active jobs on one take (AC-4): its violation comes back as `conflict` (each start has its
 * own name for it) instead of being thrown. Any other error propagates.
 */
export async function runStart<T, E extends string>(
  db: Executor,
  conflict: E,
  fn: (tx: Tx) => Promise<Result<T, E>>,
): Promise<Result<T, E>> {
  try {
    return await runTx(db, fn);
  } catch (error) {
    const { code, constraint } = pgErrorCode(error);
    if (code === "23505" && constraint === ONE_ACTIVE_JOB_INDEX) return err(conflict);
    throw error;
  }
}

/**
 * Inserts a `queued` job and its ordered `pending` steps in the caller's transaction. Returns
 * null when the insert gave back no row (the caller answers with its own conflict error).
 */
export async function startJobRow(
  tx: Tx,
  input: {
    readonly job: Omit<typeof processingJob.$inferInsert, "id" | "status">;
    readonly stepNames: readonly StepName[];
  },
): Promise<StartedJob | null> {
  const jobId = crypto.randomUUID();
  const [job] = await tx
    .insert(processingJob)
    .values({ ...input.job, id: jobId, status: "queued" })
    .returning();
  if (!job) return null;

  const steps = await tx
    .insert(jobStep)
    .values(
      input.stepNames.map((name, position) => ({
        id: crypto.randomUUID(),
        jobId,
        name,
        position,
        status: "pending",
        progress: 0,
      })),
    )
    .returning();

  return { ...job, steps: [...steps].sort((a, b) => a.position - b.position) };
}
