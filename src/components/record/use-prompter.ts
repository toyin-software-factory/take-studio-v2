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
 * never makes the text jump, and paused time adds nothing. Shortcuts only work while the stage shows
 * the prompter (`onStage`, with a script), so they never act on a hidden one. Pausing never touches the recorder.
 * Speed and size are remembered per creator on the device.
 */
export function usePrompter(script: string, creatorId: string, active: boolean, onStage: boolean) {
  const lines = useMemo(() => splitLines(script), [script]);
  const total = useMemo(() => countWords(script), [script]);
  const [settings, setSettings] = useState<PrompterSettings>(DEFAULT_SETTINGS);
  const [paused, setPaused] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const pausedNow = useRef(false);
  const reducedMotion = useReducedMotion();
  const position = useRef(0);
  // True while Follow my voice is connecting: the clock stands still (written by the page).
  const holdStill = useRef(false);
  const setStill = useCallback((still: boolean) => {
    holdStill.current = still;
  }, []);
  /** Words passed so far, read on demand (never during render). */
  const getPosition = useCallback(() => position.current, []);
  const [lineIndex, setLineIndex] = useState(0);
  // The latest settings, written the moment they change, so two changes in one tick (the first
  // use dialog marks it seen and turns follow on) never overwrite each other.
  const latest = useRef(settings);
  const wpm = useRef(settings.wpm);
  useEffect(() => {
    wpm.current = settings.wpm;
  }, [settings.wpm]);

  // Device storage is only readable in the browser, so it is read after hydration.
  useEffect(() => {
    const loaded = loadSettings(deviceStore(), creatorId);
    latest.current = loaded;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading an external store
    setSettings(loaded);
  }, [creatorId]);

  const change = useCallback(
    (next: PrompterSettings, message: string) => {
      latest.current = next;
      setSettings(next);
      saveSettings(deviceStore(), creatorId, next);
      setAnnouncement(message);
    },
    [creatorId],
  );

  const run = useCallback(
    (command: PrompterCommand) => {
      if (command === "toggle") {
        // The state updater stays pure: the latest value is read from a ref, then both are set.
        const next = !pausedNow.current;
        pausedNow.current = next;
        setPaused(next);
        setAnnouncement(next ? "Script paused" : "Script resumed");
      } else if (command === "faster" || command === "slower") {
        const next = stepWpm(latest.current.wpm, command === "faster" ? 1 : -1);
        change({ ...latest.current, wpm: next }, `Speed ${next} words a minute`);
      } else {
        const next = stepSize(latest.current.size, command === "larger" ? 1 : -1);
        change({ ...latest.current, size: next }, `Text size ${next}`);
      }
    },
    [change],
  );

  // Keyboard shortcuts; never while a text field has focus.
  useEffect(() => {
    if (!onStage || total === 0) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const command = commandForKey(event.key, target, {
        ctrl: event.ctrlKey,
        alt: event.altKey,
        meta: event.metaKey,
        modalOpen:
          document.querySelector(
            '[data-slot="dialog-content"][data-state="open"], [role="dialog"][data-state="open"], dialog[open]',
          ) !== null,
      });
      if (!command) return;
      event.preventDefault();
      run(command);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, onStage, total]);

  // The clock: one frame at a time, each step at the speed in force during it.
  const running = active && !paused;
  useEffect(() => {
    if (!active) {
      position.current = 0;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the highlight restarts with the position
      setLineIndex(0);
      // A pause belongs to one take: the next one starts running.
      pausedNow.current = false;
      setPaused(false);
    }
  }, [active]);
  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      if (!holdStill.current) {
        position.current = advance(position.current, now - last, wpm.current, total);
      }
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, total]);

  const setFollow = useCallback(
    (on: boolean) =>
      change({ ...latest.current, follow: on }, on ? "Follow my voice on" : "Follow my voice off"),
    [change],
  );
  const markFollowDisclosed = useCallback(() => {
    const next = { ...latest.current, followDisclosed: true };
    latest.current = next;
    setSettings(next);
    saveSettings(deviceStore(), creatorId, next);
  }, [creatorId]);

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
    setStill,
    getPosition,
    lineIndex,
    setLineIndex,
    run,
    active,
  };
}

export type Prompter = ReturnType<typeof usePrompter>;
