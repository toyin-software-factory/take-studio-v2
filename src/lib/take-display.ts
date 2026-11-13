import { isMediaFailure } from "./failure-codes";
import { isVideoExpired } from "./video-expiry";
import { uploadFailureMessage } from "./take-messages";

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

/**
 * Expiry note for a card or page (AC-1, design.md Expired video): "Video expires in 12 days",
 * "Video expires in less than a day" (never "today": the creator's day is not UTC), "Video
 * expired on 3 Dec"; null before the upload completes.
 */
export function expiryNote(
  videoExpiresAt: string | null,
  expired: boolean,
  now: Date,
): string | null {
  if (!videoExpiresAt) return null;
  const left = new Date(videoExpiresAt).getTime() - now.getTime();
  if (expired || isVideoExpired(videoExpiresAt, now))
    return `Video expired on ${shortDate(videoExpiresAt)}`;
  const days = Math.floor(left / DAY_MS);
  if (days === 0) return "Video expires in less than a day";
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

/**
 * Weights of the live steps in the overall bar (AC-8): trim 10 %, background 5 % (only when the
 * job has one; the bar divides by the steps it has), render 90 % of the rest.
 */
const STEP_WEIGHTS: Readonly<Record<string, number>> = { trim: 10, background: 5, render: 85 };

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
  /** A ready take that nothing is changing: a slow check that finds a change made elsewhere. */
  idleMs: 15_000,
  cardMs: 5000,
  maxBackoffMs: 10_000,
} as const;

/** Next delay after `failures` errors in a row: the base, doubling, capped at 10 s. */
export function pollDelay(baseMs: number, failures: number): number {
  // The cap never lowers a base that is already above it (the idle check, `POLL.idleMs`).
  return Math.min(baseMs * 2 ** failures, Math.max(POLL.maxBackoffMs, baseMs));
}

/** True while a background change is queued or running (the take itself stays Ready). */
export function backgroundChangeActive(
  job: { readonly status: string } | null | undefined,
): boolean {
  return job?.status === "queued" || job?.status === "running";
}

/** What the take page says about a background change that failed (spec 0008, AC-5). */
export function backgroundFailureMessage(failureCode: string | null): string {
  return failureCode === "background_missing"
    ? "That background isn't available any more. Pick another one."
    : "The new background didn't finish. Your video is unchanged. Try again.";
}

/** The note shown when the take has no usable green screen (spec 0008, AC-3). */
export const NO_GREEN_SCREEN_NOTE =
  "We couldn't find a green screen in this take, so we kept the original background.";

/**
 * True while the take page keeps checking the take: while it is uploading or processing, while a
 * background change runs, and, slowly, while it is ready (so a second tab sees a change finished
 * in the first). A failed or expired take is final.
 */
export function keepPolling(detail: {
  readonly take: { readonly status: string; readonly expired: boolean };
  readonly backgroundJob?: { readonly status: string } | null;
}): boolean {
  if (isInFlight(detail.take.status) || backgroundChangeActive(detail.backgroundJob)) return true;
  return detail.take.status === "ready" && !detail.take.expired;
}

/**
 * The line on the stage while a still preview covers the video (S3S-T14, spec 0011): it says the
 * picture is a still, not a video, and that the pending bar's Render makes it.
 */
export function previewStatusText(preview: { readonly kind: "making" | "image" }): string {
  if (preview.kind === "making") return "Making a still preview. Your video is paused.";
  return "Still preview, not a video. Press \u201cRender\u201d to make it.";
}
