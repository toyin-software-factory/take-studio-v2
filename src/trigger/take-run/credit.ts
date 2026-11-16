import { readFile } from "node:fs/promises";
import path from "node:path";
import { CREDIT_PNG_PATH, isUsableCreditPng } from "@/lib/credit-filter";
import { MediaToolError } from "../media";

/** The credited encode's own cap, a little over half of the render's 38 minute limit (spec 0026 AC-10). */
export const CREDIT_ENCODE_TIMEOUT_MS = 20 * 60_000;

/** The least a clean retry is given, however little is left (it is shorter than any real encode). */
const MIN_CLEAN_RETRY_MS = 60_000;

/**
 * The timeout of the clean retry after a failed credited encode (spec 0026 AC-10): what is left
 * of the render's own limit (`planMs`, below the job deadline and its margin), not a fixed half,
 * because download and probe time already came out of the budget. So the retry can never be cut
 * short by the job deadline while it still has time on its own clock.
 */
export function cleanRetryTimeoutMs(planMs: number, elapsedMs: number): number {
  return Math.max(MIN_CLEAN_RETRY_MS, planMs - elapsedMs);
}

/**
 * The path of the credit image when it is there and usable (spec 0026 AC-10), else null. The
 * file ships with the job through `additionalFiles` (`trigger.config.ts`) and is read from the
 * working directory, like the built in backgrounds.
 */
export async function usableCreditImage(): Promise<string | null> {
  const file = path.join(process.cwd(), CREDIT_PNG_PATH);
  try {
    return isUsableCreditPng(new Uint8Array(await readFile(file))) ? file : null;
  } catch {
    return null;
  }
}

/**
 * True when a credited encode failed in a way a clean encode may cure (spec 0026 AC-10): ffmpeg
 * ran and exited non zero, or the credited encode hit its own cap (`CREDIT_ENCODE_TIMEOUT_MS`,
 * which is below the render's whole limit). The job's deadline or an abort is never retried: it
 * rejects with the signal's reason, not a media tool error.
 */
export function creditedEncodeMayRetryClean(error: unknown): boolean {
  return (
    error instanceof MediaToolError &&
    error.tool === "ffmpeg" &&
    (error.timedOut || error.exitCode !== null)
  );
}
