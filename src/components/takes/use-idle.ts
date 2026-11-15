"use client";

import { useEffect, useState } from "react";

/**
 * False on the first render, true once the browser is idle after the page has loaded (or after
 * `timeoutMs` when it never reports idle). Used to start loading click-only panels after the
 * first paint, so they stay out of the first load but are ready before most clicks (B2-T154).
 */
export function useIdle(timeoutMs = 2500): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    const go = () => setIdle(true);
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(go, { timeout: timeoutMs });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(go, timeoutMs);
    return () => window.clearTimeout(id);
  }, [timeoutMs]);
  return idle;
}
