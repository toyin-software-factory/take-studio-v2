"use client";

import { useEffect, useState } from "react";
import { LEVEL_STEPS, levelLabel, levelOf, litSegments } from "@/lib/recorder-devices";

export type Level = { readonly lit: number; readonly label: string };

const SILENT: Level = { lit: 0, label: levelLabel(0) };

/**
 * The microphone level for the meter (spec 0021 task 3): ten looks a second at the stream's
 * audio, kept as lit segments and a word. State only changes when either changes, so the page
 * does not redraw for every frame, and the word is what a screen reader hears.
 */
export function useLevel(stream: MediaStream | null): Level {
  const [level, setLevel] = useState<Level>(SILENT);
  useEffect(() => {
    const Ctx = typeof window === "undefined" ? undefined : window.AudioContext;
    if (!stream || !Ctx || stream.getAudioTracks().length === 0) {
      queueMicrotask(() => setLevel(SILENT));
      return;
    }
    let context: AudioContext;
    try {
      context = new Ctx();
    } catch {
      return;
    }
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      const value = levelOf(samples);
      const next = { lit: Math.min(LEVEL_STEPS, litSegments(value)), label: levelLabel(value) };
      setLevel((now) => (now.lit === next.lit && now.label === next.label ? now : next));
    }, 100);
    return () => {
      clearInterval(timer);
      void context.close().catch(() => undefined);
    };
  }, [stream]);
  return level;
}
