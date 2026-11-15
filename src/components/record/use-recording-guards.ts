"use client";

import { useEffect } from "react";
import { shouldRelockOnVisible } from "@/lib/recorder-devices";
import { wouldLoseWork, type RecorderState } from "@/lib/recorder-state";
import { keepAwake } from "./recorder-media";

/**
 * What protects a recording from the outside world: the screen stays on while recording (the
 * lock is asked for again when the page comes back, the browser releases it whenever the page
 * is hidden), a camera or microphone taken away mid recording ends it with what was captured
 * (a call), and a warning shows before leaving with a recording or a take.
 */
export function useRecordingGuards(
  state: RecorderState,
  stream: MediaStream | null,
  onHidden: () => void,
  onTrackLost: () => void,
) {
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
      if (document.visibilityState === "hidden") onHidden();
      else if (shouldRelockOnVisible(true, document.visibilityState)) hold();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      ended = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release().catch(() => undefined);
    };
  }, [state.kind, onHidden]);

  useEffect(() => {
    if (state.kind !== "recording" || !stream) return;
    const tracks = stream.getTracks();
    tracks.forEach((track) => track.addEventListener("ended", onTrackLost));
    return () => tracks.forEach((track) => track.removeEventListener("ended", onTrackLost));
  }, [state.kind, stream, onTrackLost]);

  useEffect(() => {
    if (!wouldLoseWork(state)) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);
}
