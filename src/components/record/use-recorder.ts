"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  interruptionNote,
  interruptionReason,
  nextCameraId,
  setupProblem,
  shouldRelockOnVisible,
  stillAvailable,
} from "@/lib/recorder-devices";
import {
  RECORDER,
  baseType,
  classifyMediaError,
  isLongEnough,
  pickMimeType,
  recordingFileName,
  recordingLimitMs,
  shouldAutoStop,
  type PickedType,
  type SetupFailure,
} from "@/lib/recorder-rules";
import { INITIAL_RECORDER, recorderReducer, wouldLoseWork } from "@/lib/recorder-state";
import { useDevices } from "./use-devices";

/** Wake lock where the browser has it, so the screen stays on while recording; best effort. */
async function keepAwake(): Promise<WakeLockSentinel | null> {
  try {
    return (await navigator.wakeLock?.request("screen")) ?? null;
  } catch {
    return null;
  }
}

/** Ask the browser for the camera and microphone, the chosen ones or its defaults (AC-1). */
function openMedia(camera: string | null, mic: string | null): Promise<MediaStream> {
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

/** The type to record in, or why this browser cannot record at all (AC-5). */
function checkBrowser(): { picked: PickedType | null; problem: SetupFailure | null } {
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

/**
 * Camera, microphone and MediaRecorder for the /record page (spec 0021 task 1). The pure
 * state machine decides what is allowed; this hook only talks to the browser: it turns the
 * camera on when asked, counts down, records in one second chunks, stops at the length limit
 * and gives the finished take back as one Blob. The camera is released whenever nothing needs
 * it, and a warning shows before leaving with a recording or a take.
 */
export function useRecorder(limitSeconds: number | null = null) {
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
  const devices = useDevices(stream);
  const limitMs = recordingLimitMs(limitSeconds);

  const release = useCallback(() => {
    setStream((now) => {
      now?.getTracks().forEach((track) => track.stop());
      return null;
    });
  }, []);

  const acquire = useCallback(async (camera: string | null = null, mic: string | null = null) => {
    const { picked: type, problem } = checkBrowser();
    picked.current = type;
    if (problem) {
      dispatch({ type: "failed", failure: problem });
      return;
    }
    try {
      const media = await openMedia(camera, mic);
      if (!mounted.current) {
        // The page was left while the browser was asking: nothing may keep the camera on.
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      setCameraId(camera);
      setMicId(mic);
      setStream((now) => {
        now?.getTracks().forEach((track) => track.stop());
        return media;
      });
      dispatch({ type: "granted" });
    } catch (error) {
      if (!mounted.current) return;
      const name = error instanceof Error ? error.name : "";
      dispatch({ type: "failed", failure: classifyMediaError(name) });
    }
  }, []);

  /**
   * Switch camera or microphone while the preview is on. A device that has gone away falls
   * back to the browser's default instead of leaving the creator with a dead preview.
   */
  const choose = useCallback(
    async (camera: string | null, mic: string | null) => {
      const next = {
        camera: stillAvailable(devices.cameras, camera),
        mic: stillAvailable(devices.microphones, mic),
      };
      try {
        const media = await openMedia(next.camera, next.mic);
        if (!mounted.current) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        setCameraId(next.camera);
        setMicId(next.mic);
        setStream((now) => {
          now?.getTracks().forEach((track) => track.stop());
          return media;
        });
      } catch {
        // The old stream is still running; keep it.
      }
    },
    [devices],
  );

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

  const begin = useCallback(
    () => dispatch({ type: "start", seconds: RECORDER.countdownSeconds }),
    [],
  );

  const stop = useCallback(() => {
    stoppedByPerson.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  // Countdown: one tick a second; at zero the recorder starts.
  useEffect(() => {
    if (state.kind !== "countdown" || !stream || !picked.current) return;
    if (state.secondsLeft > 0) {
      const timer = setTimeout(() => dispatch({ type: "tick" }), 1000);
      return () => clearTimeout(timer);
    }
    if (recorder.current) return;
    const { mimeType, container } = picked.current;
    const next = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: RECORDER.videoBitsPerSecond,
      audioBitsPerSecond: RECORDER.audioBitsPerSecond,
    });
    chunks.current = [];
    stoppedByPerson.current = false;
    hiddenDuring.current = false;
    trackEnded.current = false;
    next.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };
    next.onstop = () => {
      const durationMs = performance.now() - startedAt.current;
      const blob = new Blob(chunks.current, { type: baseType(mimeType) });
      chunks.current = [];
      recorder.current = null;
      if (!isLongEnough(durationMs) || blob.size === 0) dispatch({ type: "discarded" });
      else {
        release();
        // The browser ended it (page hidden, camera taken): keep what was captured and say why.
        const note = stoppedByPerson.current
          ? undefined
          : interruptionNote(
              interruptionReason({
                wasHidden: hiddenDuring.current,
                trackEnded: trackEnded.current,
              }),
            );
        dispatch({
          type: "stopped",
          take: { blob, durationMs, fileName: recordingFileName(new Date(), container), note },
        });
      }
    };
    recorder.current = next;
    startedAt.current = performance.now();
    setElapsedMs(0);
    try {
      next.start(RECORDER.timesliceMs);
    } catch {
      // For example the camera went away during the countdown: let the person turn it on again.
      next.onstop = null;
      recorder.current = null;
      chunks.current = [];
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the camera must be let go when the recorder cannot start
      release();
      dispatch({ type: "start_failed", failure: "unavailable" });
      return;
    }
    dispatch({ type: "recording" });
  }, [state, stream, release]);

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

  // The screen stays on while recording, and the lock is asked for again when the page comes
  // back (the browser releases it whenever the page is hidden).
  useEffect(() => {
    if (state.kind !== "recording") return;
    let lock: WakeLockSentinel | null = null;
    let ended = false;
    const hold = () =>
      void keepAwake().then((got) => {
        if (ended) void got?.release().catch(() => undefined);
        else lock = got;
      });
    hold();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenDuring.current = true;
      else if (shouldRelockOnVisible(true, document.visibilityState)) hold();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      ended = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release().catch(() => undefined);
    };
  }, [state.kind]);

  // A camera or microphone taken away mid recording (a call) ends it with what was captured.
  useEffect(() => {
    if (state.kind !== "recording" || !stream) return;
    const lost = () => {
      trackEnded.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
    };
    const tracks = stream.getTracks();
    tracks.forEach((track) => track.addEventListener("ended", lost));
    return () => tracks.forEach((track) => track.removeEventListener("ended", lost));
  }, [state.kind, stream]);

  useEffect(() => {
    if (!wouldLoseWork(state)) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);

  // Leaving the page turns everything off.
  const live = useRef<MediaStream | null>(null);
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
    stop,
    devices,
    cameraId,
    micId,
    chooseCamera: (id: string) => void choose(id, micId),
    chooseMic: (id: string) => void choose(cameraId, id),
    flip: canFlip ? flip : null,
  };
}
