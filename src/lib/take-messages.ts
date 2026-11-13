import { NO_GREEN_SCREEN_NOTE } from "./take-display";
import { MEDIA_LIMITS } from "./take-rules";

/**
 * Friendly messages for a take that failed on upload (spec 0004 AC-4), naming the problem and
 * the limit. The pages show these with "Upload another video". Unknown codes get a generic one.
 */

type FailedTake = {
  readonly failureCode: string | null;
  readonly durationMs: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly originalBytes: number;
};

const minutes = (ms: number) => Math.ceil(ms / 60_000);

export function uploadFailureMessage(take: FailedTake): string {
  const limitMinutes = MEDIA_LIMITS.maxDurationMs / 60_000;
  switch (take.failureCode) {
    case "too_long":
      return take.durationMs
        ? `This video is ${minutes(take.durationMs)} minutes long. The limit is ${limitMinutes} minutes.`
        : `This video is longer than ${limitMinutes} minutes, the limit.`;
    case "too_large":
      return "This video is over 2 GB. The limit is 2 GB.";
    case "resolution_exceeded":
      return take.width && take.height
        ? `This video is ${take.width}×${take.height}. The limit is 1080p (1920×1080).`
        : "This video is bigger than 1080p, the limit.";
    case "invalid_media":
      return "This file isn't a video we can read. Use an MP4 or MOV.";
    case "corrupt_upload":
      return "This video couldn't be read. It may be damaged, or the upload didn't finish.";
    case "upload_abandoned":
      return "This upload didn't finish.";
    default:
      return "Something went wrong with this video.";
  }
}

/** Every code `POST /api/takes/{id}/changes` (spec 0011) can answer with. */
export type ChangeErrorCode =
  | "not_found"
  | "invalid"
  | "job_active"
  | "invalid_transition"
  | "original_gone"
  | "nothing_changed"
  | "no_green_screen"
  | "background_not_ready"
  | "background_missing"
  | "stale"
  | "change_limit"
  | "dispatch_failed";

/** One friendly line per refusal of a change render (spec 0011, AC-8). */
export const CHANGE_MESSAGES: Readonly<Record<ChangeErrorCode, string>> = {
  not_found: "We couldn't find that take, cut or background.",
  invalid: "Those changes would remove the whole take. Keep at least some of it.",
  job_active: "A change is already being rendered. It'll show here when it's done.",
  invalid_transition: "This take isn't ready yet. Try again when it is.",
  original_gone: "The original has expired, so cuts can't be changed.",
  nothing_changed: "Nothing is different from the current video.",
  no_green_screen: NO_GREEN_SCREEN_NOTE,
  background_not_ready: "That background isn't ready yet. Try again in a moment.",
  background_missing: "The background on this take was deleted. Pick a background to render.",
  stale: "This take changed in another tab. We've loaded the latest version.",
  change_limit: "You've made a lot of changes in the last hour. Please try again later.",
  dispatch_failed: "The new video didn't start. Please try again.",
};
