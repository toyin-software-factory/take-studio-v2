import type { Container } from "./processing";
import { GUEST_MAX_BYTES, GUEST_MAX_SECONDS, GUEST_TTL_HOURS } from "./guest-rules";
import { checkFile } from "./upload-rules";

/**
 * The homepage drop box's words and rules (spec 0023 step 8, AC-1, AC-2, AC-13). Pure: the
 * numbers come from `guest-rules`, never typed here, so a settings change changes the copy.
 */

const megabytes = Math.round(GUEST_MAX_BYTES / (1024 * 1024));
const minutes = Math.round(GUEST_MAX_SECONDS / 60);

export const DROP_COPY = {
  heading: "Try it without an account",
  idle: "Drop your video here or choose a file",
  drag: "Drop to upload",
  choose: "Choose a file",
  rules: `No account needed. MP4 or MOV, up to ${megabytes} MB and ${minutes} minutes.`,
  uploading: "Uploading. Keep this tab open.",
  done: "Upload complete. We are working on your take.",
  cancel: "Cancel upload",
  tooBig: `That video is larger than we can take for a free try (${megabytes} MB). Choose a smaller file or sign in to upload a larger one.`,
  tooLong: `That video is longer than we can take for a free try (${minutes} ${minutes === 1 ? "minute" : "minutes"}). Trim it or sign in to upload a longer one.`,
  notVideo: "This file isn't an MP4 or MOV video. Choose an MP4 or MOV.",
  empty: "This file is empty. Choose another video.",
  limitHeading: "That's all the free tries for now",
  limit:
    "You have reached the free try limit for now. Sign in to keep going, or come back tomorrow.",
  pausedHeading: "Free tries are paused",
  paused:
    "Uploads without an account are paused for now. Sign in to upload. Nothing is lost by signing in: it takes one email.",
  unavailable: "Uploading without an account isn't available right now. Sign in to upload.",
  failed: "The upload stopped. Check your connection and try again.",
  kept: "We kept your file.",
  retry: "Try again",
  another: "Choose another file",
  signIn: "Sign in",
  emailLabel: "Where should we send it?",
  emailHint: "We will email one link to open your take. No password.",
  send: "Send me the link",
  sending: "Sending",
  invalidEmail: "Enter a real email address, like name@example.com.",
  sentHeading: "Check your email",
  spam: "Not there? Check your spam folder.",
  expiry: `If you do not open the link, we delete your upload after ${GUEST_TTL_HOURS} hours.`,
  resend: "Send it again",
  resent: "Another email is on its way.",
  change: "Use a different email",
  waiting: "Still uploading. Keep this tab open.",
  preparing: "We are working on your take. It will play here when it is ready.",
  ready: "Your take is ready.",
  keep: "Check your email to keep it. We delete it after 24 hours if you do not.",
  videoLabel: "Your finished take",
  resultGone: "This take is no longer available. Choose a file again to start a new one.",
  resultFailed: "We couldn't finish your take. Sign in to try the upload again.",
} as const;

/** The three steps of the card, for the small indicator in its head. */
export const DROP_STEPS = ["Choose", "Upload and email", "Check your email"] as const;

export const stepLabel = (step: number): string => `Step ${step} of ${DROP_STEPS.length}`;

/** The refusal screens carry a heading; the stop states with a heading only. */
export const REFUSAL_HEADING: Readonly<Partial<Record<DropRefusal, string>>> = {
  limit: DROP_COPY.limitHeading,
  paused: DROP_COPY.pausedHeading,
};

/** The step a card state is on: 1 choose, 2 upload and email, 3 check your email. */
export function dropStep(drop: string, emailSent: boolean): 1 | 2 | 3 {
  if (emailSent) return 3;
  return drop === "checking" || drop === "uploading" || drop === "done" ? 2 : 1;
}

export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const m = Math.floor(whole / 60);
  return `${m}:${String(whole % 60).padStart(2, "0")}`;
}

/** The small line under the file name while it uploads, for example "48.2 MB · 1:12". */
export const fileMeta = (bytes: number, seconds: number | null): string =>
  seconds === null ? formatBytes(bytes) : `${formatBytes(bytes)} · ${formatDuration(seconds)}`;

/**
 * Advice from the length the browser read from the video's metadata. `null` means it could not
 * be read in time: let it upload, the server check still applies.
 */
export function checkGuestDuration(
  seconds: number | null,
): { readonly ok: false; readonly message: string } | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  return seconds > GUEST_MAX_SECONDS ? { ok: false, message: DROP_COPY.tooLong } : null;
}

export const sentLine = (address: string): string =>
  `We sent a link to ${address}. Open it to keep your take.`;

export const percentLabel = (percent: number): string =>
  `${Math.max(0, Math.min(100, Math.round(percent)))}%`;

export type GuestFileCheck =
  | { readonly ok: true; readonly container: Container }
  | { readonly ok: false; readonly message: string };

/** The browser look before any upload: type, empty, and the guest size cap (advice only). */
export function checkGuestFile(file: {
  readonly name: string;
  readonly size: number;
  readonly type: string;
}): GuestFileCheck {
  const type = checkFile({ ...file, size: Math.min(file.size, 1) });
  if (!type.ok)
    return {
      ok: false,
      message: type.message.includes("empty") ? DROP_COPY.empty : DROP_COPY.notVideo,
    };
  if (type.container === "webm") return { ok: false, message: DROP_COPY.notVideo };
  if (file.size <= 0) return { ok: false, message: DROP_COPY.empty };
  if (file.size > GUEST_MAX_BYTES) return { ok: false, message: DROP_COPY.tooBig };
  return { ok: true, container: type.container };
}

export type DropRefusal = "limit" | "paused" | "unavailable" | "failed";

/**
 * Which screen a refused drop gets, from the error code the guest route sent. The limit codes
 * show the limit screen with no drop zone; an unknown code is a plain failure.
 */
export function refusalOf(code: string | null): DropRefusal {
  if (code === "guest_address_limit" || code === "guest_budget_spent") return "limit";
  if (code === "guest_paused") return "paused";
  if (code === "guest_unavailable") return "unavailable";
  return "failed";
}
