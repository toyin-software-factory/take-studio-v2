"use client";

import { useCallback, type KeyboardEvent } from "react";

/**
 * Player keyboard shortcuts (design.md Video player): space or K play and pause, J and L seek
 * 10 s, left and right arrows seek 5 s. Keys typed into a button or the seek slider keep their
 * own meaning (a button's space presses it; the slider's arrows move it).
 */
export function usePlayerKeys(toggle: () => void, seekBy: (seconds: number) => void) {
  return useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement;
      const onButton = target.closest("button") !== null;
      const onSlider = target.getAttribute("role") === "slider";
      const key = event.key.toLowerCase();

      const action =
        key === "k" || (key === " " && !onButton)
          ? toggle
          : key === "j"
            ? () => seekBy(-10)
            : key === "l"
              ? () => seekBy(10)
              : key === "arrowleft" && !onSlider
                ? () => seekBy(-5)
                : key === "arrowright" && !onSlider
                  ? () => seekBy(5)
                  : null;
      if (!action) return;
      event.preventDefault();
      action();
    },
    [toggle, seekBy],
  );
}
