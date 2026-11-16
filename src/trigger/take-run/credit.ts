import { readFile } from "node:fs/promises";
import path from "node:path";
import { CREDIT_PNG_PATH, isUsableCreditPng } from "@/lib/credit-filter";
import { MediaToolError } from "../media";

/** The credited encode's own cap, half of the render's 40 minutes (spec 0026 AC-10). */
export const CREDIT_ENCODE_TIMEOUT_MS = 20 * 60_000;

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
