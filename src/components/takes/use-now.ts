"use client";

import { useEffect, useState } from "react";

/**
 * The current time, starting from the server's clock and moving on every `everyMs` while the
 * tab is visible, so expiry notes on a library left open stay true.
 */
export function useNow(startIso: string, everyMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date(startIso));
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") setNow(new Date());
    };
    const timer = setInterval(tick, everyMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [everyMs]);
  return now;
}
