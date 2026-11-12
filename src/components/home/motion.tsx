"use client";

import { useEffect } from "react";

/**
 * Starts the homepage motion after the page has hydrated (spec 0010, AC-4, AC-5, AC-8). It
 * renders nothing. The animation libraries are fetched by this dynamic import, so they are
 * never part of the first load and never reach a signed in page, which does not render this.
 */
export function HomeMotion() {
  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    void import("./motion/start").then(({ startHomeMotion }) => {
      if (!cancelled) stop = startHomeMotion();
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
  return null;
}
