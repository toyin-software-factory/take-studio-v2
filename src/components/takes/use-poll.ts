"use client";

import { useEffect, useRef } from "react";
import { pollDelay } from "@/lib/take-display";

/** What one poll found: keep going, stop for good, or back off after an error. */
export type PollResult = "continue" | "stop" | "error";

/**
 * Calls `tick` every `baseMs` while `enabled` and the tab is visible (spec 0004, Flow step 7):
 * pauses while hidden and checks at once on return, backs off on errors (2 → 10 s), and stops
 * when `tick` says so. One tick at a time; the latest `tick` is always used. `immediate` runs
 * the first tick at once instead of after `baseMs`.
 */
export function usePoll(
  tick: () => Promise<PollResult>,
  baseMs: number,
  enabled: boolean,
  options: { readonly immediate?: boolean } = {},
) {
  const immediate = options.immediate ?? false;
  const tickRef = useRef(tick);
  useEffect(() => {
    tickRef.current = tick;
  });

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let stopped = false;
    let running = false;

    const schedule = (ms: number) => {
      clearTimeout(timer);
      if (!stopped && !document.hidden) timer = setTimeout(() => void run(), ms);
    };
    const run = async () => {
      if (running || stopped) return;
      running = true;
      const result = await tickRef.current().catch((): PollResult => "error");
      running = false;
      if (stopped) return;
      if (result === "stop") {
        stopped = true;
        return;
      }
      failures = result === "error" ? failures + 1 : 0;
      schedule(pollDelay(baseMs, failures));
    };
    const onVisibility = () => {
      if (document.hidden) clearTimeout(timer);
      else void run();
    };

    document.addEventListener("visibilitychange", onVisibility);
    schedule(immediate ? 0 : baseMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [baseMs, enabled, immediate]);
}
