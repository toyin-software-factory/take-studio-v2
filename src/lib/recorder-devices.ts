import type { SetupFailure } from "./recorder-rules";

/**
 * Devices, level meter and interruptions for the /record page (spec 0021 task 3, AC-5, AC-7,
 * AC-10). Pure: the page passes in what the browser reports, so each rule is unit tested
 * without a camera.
 */

/** What the browser offers, as the setup check needs it. */
export type BrowserSupport = {
  readonly secure: boolean;
  readonly hasGetUserMedia: boolean;
  readonly hasMediaRecorder: boolean;
  /** True when `pickMimeType` found a type this browser can record. */
  readonly hasRecordableType: boolean;
};

/** AC-5: why recording cannot start before the camera is even asked for, or null when it can. */
export function setupProblem(support: BrowserSupport): SetupFailure | null {
  if (!support.secure) return "insecure";
  if (!support.hasGetUserMedia || !support.hasMediaRecorder || !support.hasRecordableType) {
    return "unsupported";
  }
  return null;
}

/**
 * AC-5: a phone with a camera but no `MediaRecorder` (an older Safari) can still make a take
 * with the native camera through a file input. Only for the "unsupported" failure on a touch
 * device; an insecure page cannot use it either way, so it also offers the file input.
 */
export function offersNativeCamera(failure: SetupFailure | null, touch: boolean): boolean {
  return touch && (failure === "unsupported" || failure === "insecure");
}

export type DeviceInfo = {
  readonly deviceId: string;
  readonly kind: MediaDeviceKind;
  readonly label: string;
};

export type DeviceChoice = { readonly id: string; readonly label: string };

export type DeviceChoices = {
  readonly cameras: readonly DeviceChoice[];
  readonly microphones: readonly DeviceChoice[];
};

/** Cameras and microphones for the pickers; a device with no label yet reads "Camera 2". */
export function deviceChoices(devices: readonly DeviceInfo[]): DeviceChoices {
  const pick = (kind: MediaDeviceKind, word: string): DeviceChoice[] =>
    devices
      .filter((d) => d.kind === kind && d.deviceId !== "")
      .map((d, i) => ({ id: d.deviceId, label: d.label.trim() || `${word} ${i + 1}` }));
  return { cameras: pick("videoinput", "Camera"), microphones: pick("audioinput", "Microphone") };
}

/** The camera after this one (wraps), for "Flip camera"; null when there is nothing to flip to. */
export function nextCameraId(
  cameras: readonly DeviceChoice[],
  currentId: string | null,
): string | null {
  if (cameras.length < 2) return null;
  // The browser's default camera is the first one, so flipping from it goes to the second.
  const at = Math.max(
    0,
    cameras.findIndex((c) => c.id === currentId),
  );
  return cameras[(at + 1) % cameras.length]?.id ?? null;
}

/** The chosen id when it is still plugged in, otherwise null (the browser's default). */
export function stillAvailable(choices: readonly DeviceChoice[], id: string | null): string | null {
  return id !== null && choices.some((c) => c.id === id) ? id : null;
}

/** Segments in the level meter. */
export const LEVEL_STEPS = 12;

/** 0 to 1 loudness of one analyser frame (unsigned bytes centred on 128): the RMS, boosted. */
export function levelOf(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = ((samples[i] ?? 128) - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * 3);
}

/** How many of the segments are lit for a level. */
export function litSegments(level: number, steps = LEVEL_STEPS): number {
  return Math.round(Math.min(1, Math.max(0, level)) * steps);
}

/** The text alternative for the meter (AC-9), changing only when the word changes. */
export function levelLabel(level: number): string {
  if (level < 0.04) return "No sound yet";
  if (level < 0.2) return "Quiet";
  if (level < 0.85) return "Good";
  return "Too loud";
}

/** Why a recording ended before the creator pressed Stop (AC-7). */
export type Interruption = "background" | "device_lost" | "unknown";

/** The note shown in the review step for an interrupted recording. */
export function interruptionNote(reason: Interruption): string {
  switch (reason) {
    case "background":
      return "The recording stopped because this page went to the background. What was captured is below.";
    case "device_lost":
      return "The recording stopped because the camera or microphone was taken away. What was captured is below.";
    case "unknown":
      return "The recording stopped on its own. What was captured is below.";
  }
}

/**
 * Why the browser stopped a recording the creator did not stop: the page was hidden during it
 * (a phone locked or switched app) or a track ended (a call took the camera).
 */
export function interruptionReason(input: {
  readonly wasHidden: boolean;
  readonly trackEnded: boolean;
}): Interruption {
  if (input.trackEnded) return "device_lost";
  return input.wasHidden ? "background" : "unknown";
}

/** True when a visibility change should ask for the screen wake lock again (it is released on hide). */
export function shouldRelockOnVisible(recording: boolean, visibility: DocumentVisibilityState) {
  return recording && visibility === "visible";
}
