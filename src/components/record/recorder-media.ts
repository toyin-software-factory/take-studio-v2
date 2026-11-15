import { interruptionNote, interruptionReason, setupProblem } from "@/lib/recorder-devices";
import {
  RECORDER,
  classifyMediaError,
  isLongEnough,
  pickMimeType,
  recordingFileName,
  type PickedType,
  type SetupFailure,
} from "@/lib/recorder-rules";
import type { RecorderAction } from "@/lib/recorder-state";

/** Wake lock where the browser has it, so the screen stays on while recording; best effort. */
export async function keepAwake(): Promise<WakeLockSentinel | null> {
  try {
    return (await navigator.wakeLock?.request("screen")) ?? null;
  } catch {
    return null;
  }
}

/** Ask the browser for the camera and microphone, the chosen ones or its defaults (AC-1). */
export function openMedia(camera: string | null, mic: string | null): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      ...(camera ? { deviceId: { exact: camera } } : { facingMode: "user" }),
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    },
    audio: mic ? { deviceId: { exact: mic } } : true,
  });
}

/**
 * Open the chosen devices. A remembered device that is gone (an unplugged microphone) must not
 * block the camera for good: ask again with the browser's defaults.
 */
export async function openWithFallback(
  camera: string | null,
  mic: string | null,
): Promise<MediaStream> {
  try {
    return await openMedia(camera, mic);
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const gone = name === "OverconstrainedError" || name === "NotFoundError";
    if (!gone || (!camera && !mic)) throw error;
    return openMedia(null, null);
  }
}

/** The type to record in, or why this browser cannot record at all (AC-5). */
export function checkBrowser(): { picked: PickedType | null; problem: SetupFailure | null } {
  const hasRecorder = typeof MediaRecorder !== "undefined";
  const picked = hasRecorder ? pickMimeType((type) => MediaRecorder.isTypeSupported(type)) : null;
  const problem = setupProblem({
    secure: typeof window !== "undefined" && window.isSecureContext,
    hasGetUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
    hasMediaRecorder: hasRecorder,
    hasRecordableType: picked !== null,
  });
  return { picked, problem };
}

/** A MediaRecorder on the stream in the picked type; every chunk goes to `onChunk`. */
export function createRecorder(
  stream: MediaStream,
  mimeType: string,
  onChunk: (chunk: Blob) => void,
): MediaRecorder {
  const made = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: RECORDER.videoBitsPerSecond,
    audioBitsPerSecond: RECORDER.audioBitsPerSecond,
  });
  made.ondataavailable = (event) => {
    if (event.data.size > 0) onChunk(event.data);
  };
  return made;
}

/** The ids of the devices a stream actually uses (the browser may have chosen them). */
export function idsOf(media: MediaStream) {
  return {
    camera: media.getVideoTracks()[0]?.getSettings().deviceId ?? null,
    mic: media.getAudioTracks()[0]?.getSettings().deviceId ?? null,
  };
}

type Finished = {
  blob: Blob;
  durationMs: number;
  container: PickedType["container"];
  stoppedByPerson: boolean;
  hiddenDuring: boolean;
  trackEnded: boolean;
};

/**
 * What a finished recording becomes: nothing if it is too short or empty, otherwise the take.
 * When the browser ended it (page hidden, camera taken) the take keeps what was captured, with
 * a note saying why.
 */
export function finishedAction(done: Finished): RecorderAction {
  if (!isLongEnough(done.durationMs) || done.blob.size === 0) return { type: "discarded" };
  const note = done.stoppedByPerson
    ? undefined
    : interruptionNote(
        interruptionReason({ wasHidden: done.hiddenDuring, trackEnded: done.trackEnded }),
      );
  const fileName = recordingFileName(new Date(), done.container);
  return {
    type: "stopped",
    take: { blob: done.blob, durationMs: done.durationMs, fileName, note },
  };
}

/**
 * Open the devices for the page. `null` when the page was left while the browser was asking
 * (the stream is stopped: nothing may keep the camera on), else the stream or why it failed.
 */
export async function acquireMedia(
  camera: string | null,
  mic: string | null,
  stillHere: () => boolean,
): Promise<{ media: MediaStream } | { failure: SetupFailure } | null> {
  try {
    const media = await openWithFallback(camera, mic);
    if (stillHere()) return { media };
    media.getTracks().forEach((track) => track.stop());
    return null;
  } catch (error) {
    if (!stillHere()) return null;
    return { failure: classifyMediaError(error instanceof Error ? error.name : "") };
  }
}
