import { isRefundable } from "./failure-codes";

/**
 * Pure charging and refund rules (spec 0002, AC-6, AC-13). Usage is counted in seconds;
 * the limit check against the allowance arrives in slice 6, charges are recorded now.
 */

/** Seconds charged for processing a take of this length: `ceil(duration_ms / 1000)`. */
export function chargeSeconds(durationMs: number): number {
  return Math.max(0, Math.ceil(durationMs / 1000));
}

/** First day of the UTC month of `at`, as `YYYY-MM-01` (the `charged_month` value). */
export function chargedMonth(at: Date): string {
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

type RefundInput = {
  readonly secondsCharged: number;
  readonly refunded: boolean;
  readonly failureCode: string | null;
};

/**
 * Seconds to give back when a job ends with `failureCode`: the full charge when the code is
 * refundable and the job has not been refunded yet, else 0. Never negative.
 */
export function refundSeconds(job: RefundInput): number {
  if (job.refunded || job.failureCode === null || !isRefundable(job.failureCode)) return 0;
  return Math.max(0, job.secondsCharged);
}
