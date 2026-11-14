import { failureMessage } from "@/lib/take-display";
import { limitExceededMessage, resetsOn } from "@/lib/usage-rules";

/**
 * What a failed take says (spec 0014 AC-6, AC-9). The monthly limit gets the dated wording from
 * `limitExceededMessage` (back on 1 Dec, kept until, or already gone); every other failure keeps
 * the shared wording. The reset date comes from `now`, never typed.
 */
export function failedMessage(
  take: {
    readonly failureCode: string | null;
    readonly durationMs: number | null;
    readonly videoExpiresAt: string | null;
  },
  retryable: boolean,
  now: Date,
): string {
  if (take.failureCode !== "limit_exceeded") return failureMessage(take, retryable);
  const expires = take.videoExpiresAt === null ? null : new Date(take.videoExpiresAt);
  return limitExceededMessage({
    resetsOn: resetsOn(now),
    videoExpiresAt: expires !== null && !Number.isNaN(expires.getTime()) ? expires : null,
  });
}
