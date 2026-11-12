"use client";

import { useSyncExternalStore } from "react";
import { Pause, Play } from "lucide-react";
import { SERVER_FAN_STATE, fanStore } from "./motion/fan-state";

/**
 * The pause and play button for the hero fan (WCAG 2.2.2): visible whenever the cards are
 * turning, keyboard operable, named for what it will do, at least 44 px. It stays out of the page
 * until the loop exists, so there is no button under reduced motion or without scripts. The
 * choice holds for the visit.
 */
export function FanToggle() {
  const { ready, paused } = useSyncExternalStore(
    fanStore.subscribe,
    fanStore.get,
    () => SERVER_FAN_STATE,
  );
  if (!ready) return null;
  const Icon = paused ? Play : Pause;
  return (
    <button
      type="button"
      className="h-media-toggle h-fan-toggle"
      aria-label={paused ? "Play the card animation" : "Pause the card animation"}
      onClick={() => fanStore.setPaused(!paused)}
    >
      <Icon size={18} aria-hidden="true" />
    </button>
  );
}
