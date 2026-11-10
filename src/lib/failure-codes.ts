/**
 * Failure code registry (spec 0002, "Failure code registry"; AC-13).
 * Stored as text on take, processing_job and job_step. The `refundable` flag decides
 * whether finishing a job with this code gives the charged seconds back.
 * Add codes only; never rename or remove one (old rows keep their code).
 */
export const FAILURE_CODES = {
  // Refundable: the failure is ours, not the creator's.
  internal_error: { refundable: true },
  ffmpeg_error: { refundable: true },
  trigger_failed: { refundable: true },
  timeout: { refundable: true },
  stale_run: { refundable: true },
  provider_error: { refundable: true },
  cancelled_before_start: { refundable: true },
  // Not refundable: the media was rejected, or the creator cancelled a running job.
  invalid_media: { refundable: false },
  too_long: { refundable: false },
  too_large: { refundable: false },
  resolution_exceeded: { refundable: false },
  corrupt_upload: { refundable: false },
  cancelled_while_running: { refundable: false },
} as const satisfies Readonly<Record<string, { readonly refundable: boolean }>>;

export type FailureCode = keyof typeof FAILURE_CODES;

export const FAILURE_CODE_VALUES = Object.keys(FAILURE_CODES) as readonly FailureCode[];

/** True when `value` is a code this version of the app knows. */
export function isFailureCode(value: string): value is FailureCode {
  return Object.hasOwn(FAILURE_CODES, value);
}

/**
 * Whether a failure code earns a refund. Unknown codes (written by a newer deploy
 * while this one still runs) are treated as not refundable, so a refund is never
 * given twice by mistake; the newer code refunds them on its own path.
 */
export function isRefundable(code: string): boolean {
  return isFailureCode(code) && FAILURE_CODES[code].refundable;
}
