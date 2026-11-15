"use client";

import { useEffect, useState, type Dispatch, type MutableRefObject } from "react";
import { VOICE_HOLD_MS } from "@/lib/follow-state";
import { RECORDER, baseType, type PickedType } from "@/lib/recorder-rules";
import type { RecorderAction, RecorderState } from "@/lib/recorder-state";
import { createRecorder, finishedAction } from "./recorder-media";

type Ref<T> = MutableRefObject<T>;

type Args = {
  readonly state: RecorderState;
  readonly dispatch: Dispatch<RecorderAction>;
  readonly stream: MediaStream | null;
  readonly holdForVoice: boolean;
  readonly release: () => void;
  readonly setElapsedMs: (ms: number) => void;
  readonly refs: {
    readonly pickedRef: Ref<PickedType | null>;
    readonly recorderRef: Ref<MediaRecorder | null>;
    readonly chunksRef: Ref<Blob[]>;
    readonly startedAtRef: Ref<number>;
    readonly stoppedByPersonRef: Ref<boolean>;
    readonly hiddenDuringRef: Ref<boolean>;
    readonly trackEndedRef: Ref<boolean>;
  };
};

/**
 * The countdown of `useRecorder`, in its own hook: one tick a second, then at zero the
 * MediaRecorder starts. When Follow my voice is still connecting the recorder waits at 0 for up
 * to `VOICE_HOLD_MS` (B2-T115), then starts anyway.
 */
export function useCountdownStart({
  state,
  dispatch,
  stream,
  holdForVoice,
  release,
  setElapsedMs,
  refs,
}: Args) {
  const [holdExpired, setHoldExpired] = useState(false);
  const {
    pickedRef,
    recorderRef,
    chunksRef,
    startedAtRef,
    stoppedByPersonRef,
    hiddenDuringRef,
    trackEndedRef,
  } = refs;

  useEffect(() => {
    if (state.kind !== "countdown" || !stream || !pickedRef.current) return;
    if (state.secondsLeft > 0) {
      const timer = setTimeout(() => dispatch({ type: "tick" }), 1000);
      return () => clearTimeout(timer);
    }
    if (recorderRef.current) return;
    if (holdForVoice && !holdExpired) {
      const timer = setTimeout(() => setHoldExpired(true), VOICE_HOLD_MS);
      return () => clearTimeout(timer);
    }
    const { mimeType, container } = pickedRef.current;
    const next = createRecorder(stream, mimeType, (chunk) => chunksRef.current.push(chunk));
    chunksRef.current = [];
    stoppedByPersonRef.current = false;
    hiddenDuringRef.current = false;
    trackEndedRef.current = false;
    next.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: baseType(mimeType) });
      const action = finishedAction({
        blob,
        durationMs: performance.now() - startedAtRef.current,
        container,
        stoppedByPerson: stoppedByPersonRef.current,
        hiddenDuring: hiddenDuringRef.current,
        trackEnded: trackEndedRef.current,
      });
      chunksRef.current = [];
      recorderRef.current = null;
      if (action.type !== "discarded") release();
      dispatch(action);
    };
    recorderRef.current = next;
    startedAtRef.current = performance.now();
    setElapsedMs(0);
    try {
      next.start(RECORDER.timesliceMs);
    } catch {
      // For example the camera went away during the countdown: let the person turn it on again.
      next.onstop = null;
      recorderRef.current = null;
      chunksRef.current = [];
      release();
      dispatch({ type: "start_failed", failure: "unavailable" });
      return;
    }
    dispatch({ type: "recording" });
  }, [
    state,
    stream,
    release,
    holdForVoice,
    holdExpired,
    dispatch,
    setElapsedMs,
    pickedRef,
    recorderRef,
    chunksRef,
    startedAtRef,
    stoppedByPersonRef,
    hiddenDuringRef,
    trackEndedRef,
  ]);

  /** Call when a new countdown begins, so the voice hold starts fresh. */
  return { resetHold: () => setHoldExpired(false) };
}
