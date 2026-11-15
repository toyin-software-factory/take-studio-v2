"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { nextCameraId } from "@/lib/recorder-devices";
import { RECORDER, recordingLimitMs, shouldAutoStop, type PickedType } from "@/lib/recorder-rules";
import { INITIAL_RECORDER, recorderReducer } from "@/lib/recorder-state";
import { acquireMedia, checkBrowser, idsOf } from "./recorder-media";
import { useCountdownStart } from "./use-countdown-start";
import { useChooseDevices } from "./use-choose-devices";
import { useDevices } from "./use-devices";
import { useRecordingGuards } from "./use-recording-guards";

/**
 * Camera, microphone and MediaRecorder for the /record page (spec 0021 task 1). The pure
 * state machine decides what is allowed; this hook only talks to the browser: it turns the
 * camera on when asked, counts down, records in one second chunks, stops at the length limit
 * and gives the finished take back as one Blob. The camera is released whenever nothing needs it.
 *
 * `holdForVoice` (B2-T115): when the countdown reaches 0 and Follow my voice is still connecting,
 * the recorder waits up to `VOICE_HOLD_MS` for it, then starts anyway.
 */
export function useRecorder(limitSeconds: number | null = null, holdForVoice = false) {
  const [state, dispatch] = useReducer(recorderReducer, INITIAL_RECORDER);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const picked = useRef<PickedType | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const mounted = useRef(true);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [micId, setMicId] = useState<string | null>(null);
  /** Why the recorder stopped without Stop being pressed (AC-7); read in `onstop`. */
  const stoppedByPerson = useRef(false);
  const hiddenDuring = useRef(false);
  const trackEnded = useRef(false);
  const live = useRef<MediaStream | null>(null);
  const devices = useDevices(stream);
  const limitMs = recordingLimitMs(limitSeconds);

  /** Let the current stream go and keep `next` (null: nothing) in its place. */
  const swap = useCallback((next: MediaStream | null) => {
    setStream((now) => {
      now?.getTracks().forEach((track) => track.stop());
      return next;
    });
  }, []);
  const release = useCallback(() => swap(null), [swap]);

  const commit = useCallback(
    (media: MediaStream) => {
      const ids = idsOf(media);
      setCameraId(ids.camera);
      setMicId(ids.mic);
      swap(media);
    },
    [swap],
  );

  const acquire = useCallback(
    async (camera: string | null = null, mic: string | null = null) => {
      const { picked: type, problem } = checkBrowser();
      picked.current = type;
      if (problem) {
        dispatch({ type: "failed", failure: problem });
        return;
      }
      const got = await acquireMedia(camera, mic, () => mounted.current);
      if (!got) return;
      if ("failure" in got) dispatch({ type: "failed", failure: got.failure });
      else {
        if (!mounted.current) {
          got.media.getTracks().forEach((track) => track.stop());
          return;
        }
        commit(got.media);
        dispatch({ type: "granted" });
      }
    },
    [commit],
  );

  const kindNow = useRef(state.kind);
  useEffect(() => {
    kindNow.current = state.kind;
  }, [state.kind]);

  const { choose, deviceNote, setDeviceNote, switching } = useChooseDevices({
    devices,
    cameraId,
    micId,
    commit,
    mounted,
    kindNow,
    live,
  });

  const flip = useCallback(() => {
    const target = nextCameraId(devices.cameras, cameraId);
    if (target) void choose(target, micId);
  }, [devices.cameras, cameraId, micId, choose]);

  const request = useCallback(() => {
    dispatch({ type: "request" });
    return acquire(cameraId, micId);
  }, [acquire, cameraId, micId]);

  /** Record again: the camera was released after the take, so ask for it again. */
  const again = useCallback(() => {
    dispatch({ type: "again" });
    return acquire(cameraId, micId);
  }, [acquire, cameraId, micId]);

  const { resetHold } = useCountdownStart({
    state,
    dispatch,
    stream,
    holdForVoice,
    release,
    setElapsedMs,
    refs: {
      pickedRef: picked,
      recorderRef: recorder,
      chunksRef: chunks,
      startedAtRef: startedAt,
      stoppedByPersonRef: stoppedByPerson,
      hiddenDuringRef: hiddenDuring,
      trackEndedRef: trackEnded,
    },
  });

  const begin = useCallback(() => {
    // Never start a countdown on a stream that was let go (a device change that failed).
    if (!live.current?.getVideoTracks().some((track) => track.readyState === "live")) {
      setDeviceNote("The camera is off. Choose a camera again.");
      return;
    }
    resetHold();
    dispatch({ type: "start", seconds: RECORDER.countdownSeconds });
  }, [live, setDeviceNote, resetHold]);

  /** Back to the script: let the camera go (stopping its tracks) and forget the ended stream. */
  const leave = useCallback(() => {
    release();
    dispatch({ type: "leave" });
  }, [release]);

  const stop = useCallback(() => {
    stoppedByPerson.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  // Timer, and the automatic stop at the limit.
  useEffect(() => {
    if (state.kind !== "recording") return;
    const timer = setInterval(() => {
      const elapsed = performance.now() - startedAt.current;
      setElapsedMs(elapsed);
      if (shouldAutoStop(elapsed, limitMs)) stop();
    }, 250);
    return () => clearInterval(timer);
  }, [state.kind, limitMs, stop]);

  const onHidden = useCallback(() => {
    hiddenDuring.current = true;
  }, []);
  const onTrackLost = useCallback(() => {
    trackEnded.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);
  useRecordingGuards(state, stream, onHidden, onTrackLost);

  // Leaving the page turns everything off.
  useEffect(() => {
    live.current = stream;
  }, [stream]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      live.current?.getTracks().forEach((track) => track.stop());
      if (recorder.current?.state === "recording") {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
    };
  }, []);

  const canFlip = devices.cameras.length > 1;
  return {
    state,
    dispatch,
    stream,
    elapsedMs,
    limitMs,
    request,
    again,
    begin,
    leave,
    stop,
    devices,
    deviceNote,
    switching,
    cameraId,
    micId,
    chooseCamera: (id: string) => void choose(id, micId),
    chooseMic: (id: string) => void choose(cameraId, id),
    flip: canFlip ? flip : null,
  };
}
