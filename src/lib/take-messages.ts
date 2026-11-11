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
