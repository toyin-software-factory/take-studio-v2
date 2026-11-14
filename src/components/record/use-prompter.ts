"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deviceStore, loadSettings, saveSettings } from "@/lib/prompter-storage";
import {
  DEFAULT_SETTINGS,
  advance,
  commandForKey,
  countWords,
  splitLines,
  stepSize,
  stepWpm,
  type PrompterCommand,
  type PrompterSettings,
} from "@/lib/teleprompter";

/** True when the device asks for less motion; follows changes while the page is open. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/**
 * The teleprompter's state (spec 0021 task 2). The position is kept as words passed in a ref
 * and only grows by the time of each frame at the speed in force then, so changing the speed
 * never makes the text jump, and paused time adds nothing. Pausing never touches the recorder.
 * Speed and size are remembered per creator on the device.
 */
export function usePrompter(script: string, creatorId: string, active: boolean) {
  const lines = useMemo(() => splitLines(script), [script]);
  const total = useMemo(() => countWords(script), [script]);
  const [settings, setSettings] = useState<PrompterSettings>(DEFAULT_SETTINGS);
  const [paused, setPaused] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const reducedMotion = useReducedMotion();
  const position = useRef(0);
  const [lineIndex, setLineIndex] = useState(0);
  const wpm = useRef(settings.wpm);
  useEffect(() => {
    wpm.current = settings.wpm;
  }, [settings.wpm]);

  // Device storage is only readable in the browser, so it is read after hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reading an external store
  useEffect(() => setSettings(loadSettings(deviceStore(), creatorId)), [creatorId]);

  const change = useCallback(
    (next: PrompterSettings, message: string) => {
      setSettings(next);
      saveSettings(deviceStore(), creatorId, next);
      setAnnouncement(message);
    },
    [creatorId],
  );

  const run = useCallback(
    (command: PrompterCommand) => {
      if (command === "toggle") {
        setPaused((was) => {
          setAnnouncement(was ? "Script resumed" : "Script paused");
          return !was;
        });
      } else if (command === "faster" || command === "slower") {
        const next = stepWpm(settings.wpm, command === "faster" ? 1 : -1);
        change({ ...settings, wpm: next }, `Speed ${next} words a minute`);
      } else {
        const next = stepSize(settings.size, command === "larger" ? 1 : -1);
        change({ ...settings, size: next }, `Text size ${next}`);
      }
    },
    [settings, change],
  );

  // Keyboard shortcuts; never while a text field has focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const command = commandForKey(event.key, target, {
        ctrl: event.ctrlKey,
        alt: event.altKey,
        meta: event.metaKey,
      });
      if (!command) return;
      event.preventDefault();
      run(command);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run]);

  // The clock: one frame at a time, each step at the speed in force during it.
  const running = active && !paused;
  useEffect(() => {
    if (!active) position.current = 0;
  }, [active]);
  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      position.current = advance(position.current, now - last, wpm.current, total);
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, total]);

  const setFollow = useCallback(
    (on: boolean) =>
      change({ ...settings, follow: on }, on ? "Follow my voice on" : "Follow my voice off"),
    [settings, change],
  );
  const markFollowDisclosed = useCallback(() => {
    const next = { ...settings, followDisclosed: true };
    setSettings(next);
    saveSettings(deviceStore(), creatorId, next);
  }, [settings, creatorId]);

  return {
    setFollow,
    markFollowDisclosed,
    lines,
    total,
    settings,
    paused,
    announcement,
    reducedMotion,
    position,
    lineIndex,
    setLineIndex,
    run,
    active,
  };
}

export type Prompter = ReturnType<typeof usePrompter>;
