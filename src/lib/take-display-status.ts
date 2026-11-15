import { isMediaFailure } from "./failure-codes";
import { isVideoExpired } from "./video-expiry";
import { uploadFailureMessage } from "./take-messages";
import { VIDEO_RETENTION_DAYS } from "./take-rules";

export type TakeStatusName =
  "uploading" | "uploaded" | "processing" | "ready" | "failed" | "expired";

/** Badge for a take status: a label and a tone (the icon is picked by the component). */
export type StatusBadge = {
  readonly label: string;
  readonly tone: "neutral" | "info" | "success" | "warning" | "danger";
};

const BADGES: Readonly<Record<TakeStatusName, StatusBadge>> = {
  uploading: { label: "Uploading", tone: "info" },
  uploaded: { label: "Queued", tone: "info" },
  processing: { label: "Processing", tone: "info" },
  ready: { label: "Ready", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
};

export function statusBadge(status: string): StatusBadge {
  return BADGES[status as TakeStatusName] ?? { label: "Unknown", tone: "neutral" };
}

/** Statuses where the take is still moving and its page or card should keep checking. */
export function isInFlight(status: string): boolean {
  return status === "uploading" || status === "uploaded" || status === "processing";
}

/**
 * The friendly message for a failed take: what happened, then what to do (design.md Voice).
 * Media failures use the shared wording from `take-messages.ts` (AC-4; the page has no frame
 * size, so a resolution failure gets its general sentence); our own failures say it wasn't the
 * creator's fault.
 */
export function failureMessage(
  take: {
    readonly failureCode: string | null;
    readonly durationMs: number | null;
  },
  retryable = true,
): string {
  if (isMediaFailure(take.failureCode)) {
    return uploadFailureMessage({ ...take, width: null, height: null, originalBytes: 0 });
  }
  // A take that can't be retried (no length was read, or the original is going) says to upload
  // again instead of "Try again", so the words match the button.
  const again = retryable ? "Try again." : "Upload the video again.";
  switch (take.failureCode) {
    case "limit_exceeded":
      // The dated version (kept until, back on) is `limitExceededMessage` in usage-rules.ts.
      return retryable
        ? "This month's allowance is used up. Your upload is kept: try again when your minutes come back, or delete it."
        : "This month's allowance was used up and this video can't be tried again. Upload the video again when your minutes come back.";
    case "timeout":
      return `Processing took too long and stopped. ${again}`;
    case "cancelled_while_running":
    case "cancelled_before_start":
      return `Processing was stopped before it finished. ${again}`;
    default:
      return `Something went wrong on our side while processing this video. ${again}`;
  }
}

/**
 * The status a card or page should show now: a ready take whose video has expired (the server
 * says so, or its expiry time has passed while the page stayed open) is `expired`, whatever
 * the last response said.
 */
export function effectiveStatus(
  status: string,
  videoExpiresAt: string | null,
  expired: boolean,
  now: Date,
): string {
  const past = isVideoExpired(videoExpiresAt, now);
  return status === "ready" && (expired || past) ? "expired" : status;
}

/** mm:ss, or h:mm:ss from an hour (design.md Voice). Negative or missing gives 0:00. */
export function formatClock(ms: number | null): string {
  const total = Math.max(0, Math.floor((ms ?? 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SHORT_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** "3 Dec" (design.md Voice). UTC, so server and browser agree. */
export function shortDate(iso: string): string {
  return SHORT_DATE.format(new Date(iso)).replace(/\.$/, "");
}

/** Fewer days than this left: the expiry note adds the days left (spec 0013 AC-1). */
export const EXPIRY_COUNTDOWN_DAYS = 8;

/** The transcript promise next to every expired video (AC-1, AC-2; the Privacy page says the same). */
export const TRANSCRIPT_KEPT = "Your transcript is kept.";

/** "Video removed on 3 Dec": the date the video was due to go, in UTC (AC-1, AC-2). */
export function videoRemovedNote(videoExpiresAt: string): string {
  return `Video removed on ${shortDate(videoExpiresAt)}`;
}

/** "Videos are kept for 30 days." from the one retention constant, so it cannot drift. */
export const RETENTION_NOTE = `Videos are kept for ${VIDEO_RETENTION_DAYS} days.`;

/**
 * Expiry note for a card or page (AC-1, design.md Expired video): "Video expires on 12 Dec",
 * with "(in 3 days)", "(in 1 day)" or "(in less than a day)" once fewer than 8 days remain (never
 * "today": the creator's day is not UTC); after expiry "Video removed on 3 Dec. Your transcript
 * is kept."; null before the upload completes.
 */
export function expiryNote(
  videoExpiresAt: string | null,
  expired: boolean,
  now: Date,
): string | null {
  if (!videoExpiresAt) return null;
  if (expired || isVideoExpired(videoExpiresAt, now))
    return `${videoRemovedNote(videoExpiresAt)}. ${TRANSCRIPT_KEPT}`;
  const date = `Video expires on ${shortDate(videoExpiresAt)}`;
  const days = Math.floor((new Date(videoExpiresAt).getTime() - now.getTime()) / DAY_MS);
  if (days >= EXPIRY_COUNTDOWN_DAYS) return date;
  if (days === 0) return `${date} (in less than a day)`;
  return `${date} (in ${days} ${days === 1 ? "day" : "days"})`;
}

/** "Removed 1:24 of pauses" (AC-9). */
export function removedNote(removedMs: number): string {
  return `Removed ${formatClock(removedMs)} of pauses`;
}

/** The AC-7 notes. */
export const TAKE_NOTES = {
  no_cuts: "No long pauses found. Your video is ready as is.",
  no_audio: "No audio found, so nothing was trimmed.",
} as const;
