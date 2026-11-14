import { describe, expect, it } from "vitest";
import {
  INITIAL_RECORDER,
  holdsCamera,
  recorderReducer,
  wouldLoseWork,
  type RecordedTake,
  type RecorderAction,
  type RecorderState,
} from "./recorder-state";

const take: RecordedTake = {
  blob: new Blob(["x"], { type: "video/webm" }),
  durationMs: 5000,
  fileName: "Recording.webm",
};

const run = (actions: readonly RecorderAction[], from: RecorderState = INITIAL_RECORDER) =>
  actions.reduce(recorderReducer, from);

describe("recorderReducer", () => {
  it("goes through the whole thread (AC-1)", () => {
    const end = run([
      { type: "request" },
      { type: "granted" },
      { type: "start", seconds: 3 },
      { type: "tick" },
      { type: "tick" },
      { type: "tick" },
      { type: "recording" },
      { type: "stopped", take },
      { type: "upload" },
      { type: "uploaded" },
    ]);
    expect(end).toEqual({ kind: "done" });
  });

  it("counts down to zero and no further", () => {
    const s = run([
      { type: "request" },
      { type: "granted" },
      { type: "start", seconds: 1 },
      { type: "tick" },
      { type: "tick" },
    ]);
    expect(s).toEqual({ kind: "countdown", secondsLeft: 0 });
  });

  it("shows a setup failure and lets the creator ask again", () => {
    const failed = run([{ type: "request" }, { type: "failed", failure: "denied" }]);
    expect(failed).toEqual({ kind: "failed", failure: "denied" });
    expect(recorderReducer(failed, { type: "request" })).toEqual({ kind: "requesting" });
  });

  it("keeps the take through a failed upload and retries it (AC-7)", () => {
    const failed = run([
      { type: "request" },
      { type: "granted" },
      { type: "start", seconds: 3 },
      { type: "recording" },
      { type: "stopped", take },
      { type: "upload" },
      { type: "upload_failed", message: "No connection" },
    ]);
    expect(failed).toMatchObject({ kind: "upload_failed", take, message: "No connection" });
    expect(recorderReducer(failed, { type: "upload" })).toEqual({ kind: "uploading", take });
    expect(recorderReducer(failed, { type: "again" })).toEqual({ kind: "requesting" });
  });

  it("records again from review (the camera is asked for again), and drops a too short take back to ready", () => {
    const review: RecorderState = { kind: "review", take };
    expect(recorderReducer(review, { type: "again" })).toEqual({ kind: "requesting" });
    expect(recorderReducer({ kind: "recording" }, { type: "discarded" })).toEqual({
      kind: "ready",
    });
  });

  it("ignores moves that are not allowed", () => {
    expect(recorderReducer(INITIAL_RECORDER, { type: "start", seconds: 3 })).toBe(INITIAL_RECORDER);
    expect(recorderReducer({ kind: "ready" }, { type: "stopped", take })).toEqual({
      kind: "ready",
    });
    expect(recorderReducer({ kind: "done" }, { type: "upload" })).toEqual({ kind: "done" });
  });

  it("leave resets from anywhere", () => {
    expect(recorderReducer({ kind: "recording" }, { type: "leave" })).toEqual(INITIAL_RECORDER);
  });
});

describe("derived flags", () => {
  it("holds the camera only while previewing or recording", () => {
    expect(holdsCamera({ kind: "ready" })).toBe(true);
    expect(holdsCamera({ kind: "recording" })).toBe(true);
    expect(holdsCamera({ kind: "review", take })).toBe(false);
  });
  it("warns before leaving once there is a take or a recording", () => {
    expect(wouldLoseWork({ kind: "ready" })).toBe(false);
    expect(wouldLoseWork({ kind: "recording" })).toBe(true);
    expect(wouldLoseWork({ kind: "review", take })).toBe(true);
    expect(wouldLoseWork({ kind: "done" })).toBe(false);
  });
});

describe("start_failed", () => {
  it("moves a countdown to a failure the person can retry from", () => {
    const failed = recorderReducer(
      { kind: "countdown", secondsLeft: 0 },
      { type: "start_failed", failure: "unavailable" },
    );
    expect(failed).toEqual({ kind: "failed", failure: "unavailable" });
    expect(recorderReducer(failed, { type: "request" })).toEqual({ kind: "requesting" });
  });
  it("is ignored outside the countdown", () => {
    const s = { kind: "recording" } as const;
    expect(recorderReducer(s, { type: "start_failed", failure: "unavailable" })).toBe(s);
  });
});
