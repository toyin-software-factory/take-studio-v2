import type { SetupFailure } from "./recorder-rules";

/**
 * The recorder's state machine (spec 0021, State transitions). A pure reducer: the page turns
 * browser events into actions, and anything not listed as an allowed move changes nothing.
 *
 * idle -> requesting -> (failed | ready) -> countdown -> recording -> review
 *   -> uploading -> (done | upload_failed -> uploading)
 */

export type RecordedTake = {
  readonly blob: Blob;
  readonly durationMs: number;
  readonly fileName: string;
};

export type RecorderState =
  | { readonly kind: "idle" }
  | { readonly kind: "requesting" }
  | { readonly kind: "failed"; readonly failure: SetupFailure }
  | { readonly kind: "ready" }
  | { readonly kind: "countdown"; readonly secondsLeft: number }
  | { readonly kind: "recording" }
  | { readonly kind: "review"; readonly take: RecordedTake }
  | { readonly kind: "uploading"; readonly take: RecordedTake }
  | { readonly kind: "upload_failed"; readonly take: RecordedTake; readonly message: string }
  | { readonly kind: "done" };

export type RecorderAction =
  | { readonly type: "request" }
  | { readonly type: "granted" }
  | { readonly type: "failed"; readonly failure: SetupFailure }
  | { readonly type: "start"; readonly seconds: number }
  | { readonly type: "tick" }
  | { readonly type: "recording" }
  | { readonly type: "stopped"; readonly take: RecordedTake }
  /** Stopped too early to be a take: back to ready with nothing kept. */
  | { readonly type: "discarded" }
  | { readonly type: "again" }
  | { readonly type: "upload" }
  | { readonly type: "upload_failed"; readonly message: string }
  | { readonly type: "uploaded" }
  | { readonly type: "leave" };

export const INITIAL_RECORDER: RecorderState = { kind: "idle" };

export function recorderReducer(state: RecorderState, action: RecorderAction): RecorderState {
  switch (action.type) {
    case "request":
      return state.kind === "idle" || state.kind === "failed" ? { kind: "requesting" } : state;
    case "granted":
      return state.kind === "requesting" ? { kind: "ready" } : state;
    case "failed":
      return state.kind === "requesting" ? { kind: "failed", failure: action.failure } : state;
    case "start":
      return state.kind === "ready" ? { kind: "countdown", secondsLeft: action.seconds } : state;
    case "tick":
      if (state.kind !== "countdown") return state;
      // Reaching zero is the caller's cue to start the recorder; recording confirms it.
      return { kind: "countdown", secondsLeft: Math.max(0, state.secondsLeft - 1) };
    case "recording":
      return state.kind === "countdown" ? { kind: "recording" } : state;
    case "stopped":
      return state.kind === "recording" ? { kind: "review", take: action.take } : state;
    case "discarded":
      return state.kind === "recording" ? { kind: "ready" } : state;
    case "again":
      // The camera was released after the take, so asking for it again is the next step.
      return state.kind === "review" || state.kind === "upload_failed"
        ? { kind: "requesting" }
        : state;
    case "upload":
      return state.kind === "review" || state.kind === "upload_failed"
        ? { kind: "uploading", take: state.take }
        : state;
    case "upload_failed":
      return state.kind === "uploading"
        ? { kind: "upload_failed", take: state.take, message: action.message }
        : state;
    case "uploaded":
      return state.kind === "uploading" ? { kind: "done" } : state;
    case "leave":
      // Any state can end here; the page releases the camera.
      return INITIAL_RECORDER;
  }
}

/** True while camera and microphone must stay on (preview, countdown, recording). */
export function holdsCamera(state: RecorderState): boolean {
  return state.kind === "ready" || state.kind === "countdown" || state.kind === "recording";
}

/** True while leaving the page would lose a take (recording, review, upload). */
export function wouldLoseWork(state: RecorderState): boolean {
  return (
    state.kind === "recording" ||
    state.kind === "review" ||
    state.kind === "uploading" ||
    state.kind === "upload_failed"
  );
}
