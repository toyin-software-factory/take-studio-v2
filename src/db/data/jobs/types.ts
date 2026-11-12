import type { FailureCode } from "@/lib/failure-codes";
import type { JobStep, ProcessingJob, Take } from "../../types";

export type StartedJob = ProcessingJob & { readonly steps: readonly JobStep[] };

export type FinishStatus = "succeeded" | "failed" | "cancelled";

export type FinishResult = {
  readonly job: ProcessingJob;
  readonly take: Take;
  /** Seconds given back by this call (0 when nothing was refunded). */
  readonly refundedSeconds: number;
  /** File keys queued for deletion in this transaction. */
  readonly queuedKeys: readonly string[];
};

export type FinishError = "not_found" | "already_final" | "invalid" | "invalid_transition";

export type FinishInput = {
  readonly jobId: string;
  readonly status: FinishStatus;
  /** Required for `failed` and `cancelled`; must be null for `succeeded`. */
  readonly failureCode?: FailureCode | null;
  readonly now?: Date;
};
