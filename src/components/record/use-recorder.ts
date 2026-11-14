"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  RECORDER,
  baseType,
  classifyMediaError,
  isLongEnough,
  pickMimeType,
  recordingFileName,
  recordingLimitMs,
  type PickedType,
} from "@/lib/recorder-rules";
import { INITIAL_RECORDER, recorderReducer, wouldLoseWork } from "@/lib/recorder-state";

/** Wake lock where the browser has it, so the screen stays on while recording; best effort. */
async function keepAwake(): Promise<WakeLockSentinel | null> {
  try {
    return (await navigator.wakeLock?.request("screen")) ?? null;
  } catch {
    return null;
  }
}

function canRecord(): PickedType | null {
  if (typeof window === "undefined" || !window.isSecureContext) return null;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return null;
  return pickMimeType((type) => MediaRecorder.isTypeSupported(type));
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
  const limitMs = recordingLimitMs(limitSeconds);

  const release = useCallback(() => {
    setStream((now) => {
      now?.getTracks().forEach((track) => track.stop());
      return null;
    });
  }, []);

  const acquire = useCallback(async () => {
    picked.current = canRecord();
    if (!picked.current) {
      dispatch({ type: "failed", failure: "unsupported" });
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: true,
      });
      setStream(media);
      dispatch({ type: "granted" });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      dispatch({ type: "failed", failure: classifyMediaError(name) });
    }
  }, []);

  const request = useCallback(() => {
    dispatch({ type: "request" });
    return acquire();
  }, [acquire]);

  /** Record again: the camera was released after the take, so ask for it again. */
  const again = useCallback(() => {
    dispatch({ type: "again" });
    return acquire();
  }, [acquire]);

  const begin = useCallback(
    () => dispatch({ type: "start", seconds: RECORDER.countdownSeconds }),
    [],
  );

  const stop = useCallback(() => {
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
        dispatch({
          type: "stopped",
          take: { blob, durationMs, fileName: recordingFileName(new Date(), container) },
        });
      }
    };
    recorder.current = next;
    startedAt.current = performance.now();
    setElapsedMs(0);
    next.start(RECORDER.timesliceMs);
    dispatch({ type: "recording" });
  }, [state, stream, release]);

  // Timer, and the automatic stop at the limit.
  useEffect(() => {
    if (state.kind !== "recording") return;
    const timer = setInterval(() => {
      const elapsed = performance.now() - startedAt.current;
      setElapsedMs(elapsed);
      if (elapsed >= limitMs) stop();
    }, 250);
    return () => clearInterval(timer);
  }, [state.kind, limitMs, stop]);

  // The screen stays on while recording.
  useEffect(() => {
    if (state.kind !== "recording") return;
    let lock: WakeLockSentinel | null = null;
    void keepAwake().then((got) => (lock = got));
    return () => void lock?.release().catch(() => undefined);
  }, [state.kind]);

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
  useEffect(
    () => () => {
      live.current?.getTracks().forEach((track) => track.stop());
      if (recorder.current?.state === "recording") {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
    },
    [],
  );

  return { state, dispatch, stream, elapsedMs, limitMs, request, again, begin, stop };
}
