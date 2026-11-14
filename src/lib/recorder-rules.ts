import { MEDIA_LIMITS } from "./take-rules";

/**
 * Browser recorder rules (spec 0021, AC-1, AC-3, AC-4, AC-5). Pure: the page passes in what
 * the browser says (which types it can record, which error it threw), so every rule is unit
 * tested without a camera.
 */

/** Recorder settings (spec 0021, Configuration). */
export const RECORDER = {
  /** Tried in order; the first one `MediaRecorder.isTypeSupported` accepts wins (AC-4). */
  mimePreference: [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ],
  videoBitsPerSecond: 4_000_000,
  audioBitsPerSecond: 128_000,
  /** A chunk every second, so a long take is not one giant buffer at the end. */
  timesliceMs: 1000,
  countdownSeconds: 3,
  /** The timer warns when this many seconds are left. */
  warnSecondsLeft: 60,
  /** Shorter than this is not a take (a tap on Stop by mistake). */
  minDurationMs: 1000,
} as const;

export type RecordingContainer = "mp4" | "webm";

export type PickedType = {
  readonly mimeType: string;
  readonly container: RecordingContainer;
};

/** AC-4: the first preferred type this browser can record, or null when none. */
export function pickMimeType(isSupported: (mimeType: string) => boolean): PickedType | null {
  for (const mimeType of RECORDER.mimePreference) {
    if (isSupported(mimeType)) {
      return { mimeType, container: mimeType.startsWith("video/mp4") ? "mp4" : "webm" };
    }
  }
  return null;
}

/** The content type to stamp on the file: the type without its codec list. */
export function baseType(mimeType: string): string {
  return mimeType.split(";")[0] ?? mimeType;
}

/** `Recording 2026-11-14 13.48.mp4` from the device clock (spec 0021, Value sourcing). */
export function recordingFileName(now: Date, container: RecordingContainer): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `Recording ${day} ${pad(now.getHours())}.${pad(now.getMinutes())}.${container}`;
}

/**
 * How long this recording may run: the 10 minute cap, or less when the monthly allowance is
 * lower. Usage is only used when it is switched on (`enforced`); the usage limit itself comes
 * in spec 0021 task 4, so this takes null until then.
 */
export function recordingLimitMs(remainingSeconds: number | null): number {
  if (remainingSeconds === null) return MEDIA_LIMITS.maxDurationMs;
  return Math.max(0, Math.min(MEDIA_LIMITS.maxDurationMs, remainingSeconds * 1000));
}

/** Why the camera could not start (AC-5). */
export type SetupFailure = "denied" | "unavailable" | "in_use" | "unsupported";

/** The words for each setup failure; each ends with the way out, "Upload a file instead". */
export const SETUP_MESSAGES: Readonly<Record<SetupFailure, { title: string; body: string }>> = {
  denied: {
    title: "Camera or microphone is blocked",
    body: "Allow both in your browser's site settings, then try again.",
  },
  unavailable: {
    title: "No camera or microphone found",
    body: "Plug one in or check that this device has them, then try again.",
  },
  in_use: {
    title: "Your camera or microphone is busy",
    body: "Close other apps or tabs that use it, then try again.",
  },
  unsupported: {
    title: "This browser can't record here",
    body: "Recording needs a secure page and a recent browser.",
  },
};

/** Maps a `getUserMedia` error name to a failure; unknown errors read as "unavailable". */
export function classifyMediaError(name: string): SetupFailure {
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "denied";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "in_use";
    case "NotFoundError":
    case "OverconstrainedError":
    case "DevicesNotFoundError":
      return "unavailable";
    case "TypeError":
      return "unsupported";
    default:
      return "unavailable";
  }
}

/** Whether a recording this long is a take (AC-1). */
export function isLongEnough(durationMs: number): boolean {
  return durationMs >= RECORDER.minDurationMs;
}

/** Words per minute for the plain script scroll (spec 0021 task 2 makes it adjustable). */
export const PLAIN_SCROLL_WPM = 140;

/** Words in a script, for the scroll time. */
export function wordCount(script: string): number {
  const words = script.trim().split(/\s+/);
  return words[0] === "" ? 0 : words.length;
}

/**
 * How far through the script the scroll is, 0 to 1, after `elapsedMs` of recording at `wpm`.
 * An empty script stays at 0.
 */
export function scrollFraction(elapsedMs: number, words: number, wpm = PLAIN_SCROLL_WPM): number {
  if (words <= 0 || wpm <= 0) return 0;
  const totalMs = (words / wpm) * 60_000;
  return Math.min(1, Math.max(0, elapsedMs) / totalMs);
}
