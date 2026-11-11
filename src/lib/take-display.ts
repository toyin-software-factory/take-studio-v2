import { MEDIA_LIMITS } from "./take-rules";

/**
 * Pure display rules for the library and take pages (spec 0004, AC-1, AC-4, AC-7 to AC-10,
 * design.md Voice): status labels, friendly failure messages, mm:ss times, expiry notes, the
 * weighted overall progress, tab titles and the polling schedule. No React, no I/O.
 */

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
 * Failures caused by the uploaded media itself: "Upload another video". Same set as
 * `isMediaFailure` in #32 (src/lib/failure-codes.ts); switch to that import once it lands.
 */
const MEDIA_FAILURES: ReadonlySet<string> = new Set([
  "invalid_media",
  "too_long",
  "too_large",
  "resolution_exceeded",
  "corrupt_upload",
  "upload_abandoned",
]);

export function isMediaFailure(code: string | null): boolean {
  return code !== null && MEDIA_FAILURES.has(code);
}

const minutesOf = (ms: number) => Math.ceil(ms / 60_000);

/**
 * The friendly message for a failed take: what happened, then what to do (design.md Voice).
 * Media failures name the limit (AC-4, same wording as `take-messages.ts` in #32); our own
 * failures say it wasn't the creator's fault.
 */
export function failureMessage(take: {
  readonly failureCode: string | null;
  readonly durationMs: number | null;
}): string {
  const limit = MEDIA_LIMITS.maxDurationMs / 60_000;
  switch (take.failureCode) {
    case "too_long":
      return take.durationMs
        ? `This video is ${minutesOf(take.durationMs)} minutes long. The limit is ${limit} minutes.`
        : `This video is longer than ${limit} minutes, the limit.`;
    case "too_large":
      return "This video is over 2 GB. The limit is 2 GB.";
    case "resolution_exceeded":
      return "This video is bigger than 1080p, the limit.";
    case "invalid_media":
      return "This file isn't a video we can read. Use an MP4 or MOV.";
    case "corrupt_upload":
      return "This video couldn't be read. It may be damaged, or the upload didn't finish.";
    case "upload_abandoned":
      return "This upload didn't finish.";
    case "timeout":
      return "Processing took too long and stopped. Try again.";
    case "cancelled_while_running":
    case "cancelled_before_start":
      return "Processing was stopped before it finished. Try again.";
    default:
      return "Something went wrong on our side while processing this video. Try again.";
  }
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
const SHORT_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** "3 Dec" (design.md Voice). UTC, so server and browser agree. */
export function shortDate(iso: string): string {
  return SHORT_DATE.format(new Date(iso)).replace(/\.$/, "");
}

/**
 * Expiry note for a card or page (AC-1, design.md Expired video): "Video expires in 12 days",
 * "Video expires today", "Video expired on 3 Dec"; null before the upload completes.
 */
export function expiryNote(
  videoExpiresAt: string | null,
  expired: boolean,
  now: Date,
): string | null {
  if (!videoExpiresAt) return null;
  const left = new Date(videoExpiresAt).getTime() - now.getTime();
  if (expired || left <= 0) return `Video expired on ${shortDate(videoExpiresAt)}`;
  const days = Math.floor(left / DAY_MS);
  if (days === 0) return "Video expires today";
  return `Video expires in ${days} ${days === 1 ? "day" : "days"}`;
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

export type StepView = {
  readonly name: string;
  readonly status: string;
  readonly progress: number | null;
};

/** Weights of the live steps in the overall bar (AC-8): trim 10 %, render 90 %. */
const STEP_WEIGHTS: Readonly<Record<string, number>> = { trim: 10, render: 90 };

/** A step's own percent: done or skipped is 100, pending 0, running its reported progress. */
export function stepPercent(step: StepView): number {
  if (step.status === "succeeded" || step.status === "skipped") return 100;
  if (step.status === "running") return Math.min(100, Math.max(0, step.progress ?? 0));
  return 0;
}

/** Overall percent across the job's steps with their weights (unknown steps weigh 0). */
export function overallPercent(steps: readonly StepView[]): number {
  const total = steps.reduce((sum, s) => sum + (STEP_WEIGHTS[s.name] ?? 0), 0);
  if (total === 0) return 0;
  const done = steps.reduce((sum, s) => sum + (STEP_WEIGHTS[s.name] ?? 0) * stepPercent(s), 0);
  return Math.floor(done / total);
}

const STEP_LABELS: Readonly<Record<string, string>> = {
  trim: "Find pauses",
  transcript: "Transcript",
  background: "Background",
  ai_edit: "AI edit",
  render: "Make the video",
};

export function stepLabel(name: string): string {
  return STEP_LABELS[name] ?? name;
}

const STEP_STATUS_TEXT: Readonly<Record<string, string>> = {
  pending: "Waiting",
  running: "In progress",
  succeeded: "Done",
  failed: "Failed",
  skipped: "Skipped",
};

export function stepStatusText(step: StepView): string {
  if (step.status === "running" && step.progress !== null) return `${stepPercent(step)}%`;
  return STEP_STATUS_TEXT[step.status] ?? step.status;
}

/** Tab title (AC-8): "Processing… · My take · Take Studio", "Ready · My take · Take Studio". */
export function tabTitle(status: string, title: string): string {
  const prefix: Readonly<Record<string, string>> = {
    uploading: "Uploading…",
    uploaded: "Processing…",
    processing: "Processing…",
    ready: "Ready",
    failed: "Failed",
    expired: "Expired",
  };
  const lead = prefix[status];
  return lead ? `${lead} · ${title} · Take Studio` : `${title} · Take Studio`;
}

/** Poll intervals (spec 0004, Flow step 7, AC-8). */
export const POLL = {
  takeMs: 2000,
  cardMs: 5000,
  maxBackoffMs: 10_000,
} as const;

/** Next delay after `failures` errors in a row: the base, doubling, capped at 10 s. */
export function pollDelay(baseMs: number, failures: number): number {
  return Math.min(baseMs * 2 ** failures, POLL.maxBackoffMs);
}
