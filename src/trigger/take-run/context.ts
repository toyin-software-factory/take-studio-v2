import type { JobDb } from "@/db/client/job";
import { updateStep } from "@/db/data/jobs";
import type { ProcessingJob, Take } from "@/db/types";
import type { ProbeFacts } from "@/lib/probe";
import type { StepName } from "@/lib/processing";
import type { R2 } from "@/lib/r2";

/** What one attempt of `process-take` has after the load, download and probe. */
export type RunContext = {
  readonly client: JobDb;
  readonly r2: R2;
  readonly signal: AbortSignal;
  readonly job: ProcessingJob;
  readonly take: Take;
  /** The attempt's temp folder; `processJob` removes it when the attempt ends. */
  readonly work: string;
  /** The downloaded original. */
  readonly source: string;
  readonly facts: ProbeFacts;
};

/** What a run returns (IDs and numbers only): `outcome` says what happened. */
export type RunResult =
  | { readonly jobId: string; readonly takeId: string; readonly outcome: "no_audio" | "no_cuts" }
  /** The job was cancelled or finished meanwhile (the finish was refused): nothing was sent. */
  | { readonly jobId: string; readonly takeId: string; readonly outcome: "not_finished" }
  | {
      readonly jobId: string;
      readonly takeId: string;
      readonly outcome: "rendered";
      readonly renderId: string;
      readonly keyed: boolean;
      readonly removedMs: number;
      readonly renderMs: number;
    };

/** Writes one step's status and progress. */
export function setStep(
  ctx: RunContext,
  name: StepName,
  status: "running" | "succeeded" | "skipped",
  progress: number,
) {
  return updateStep(ctx.client, { jobId: ctx.job.id, name, status, progress });
}
