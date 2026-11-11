import { useSyncExternalStore } from "react";

/**
 * What the player and the transcript panel share on the take page (spec 0007, AC-2, AC-5): the
 * player's current time, a way to seek it, and the version of the caption track. A small store,
 * not React state in `TakeView`, so a time update re-renders only the one component that
 * asked (the panel reads which paragraph is playing, not the clock).
 */
export type PlayerBridge = {
  /** Seeks the player; the player registers itself here. A no op until it has mounted. */
  readonly seek: (ms: number) => void;
  readonly setSeek: (fn: ((ms: number) => void) | null) => void;
  readonly setTime: (ms: number) => void;
  readonly getTime: () => number;
  /** The caption track's `?v=`, or null while there is no transcript to show. */
  readonly setCaptions: (version: string | null) => void;
  readonly getCaptions: () => string | null;
  readonly subscribe: (listener: () => void) => () => void;
};

export function createPlayerBridge(): PlayerBridge {
  let time = 0;
  let captions: string | null = null;
  let seekFn: ((ms: number) => void) | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  return {
    seek: (ms) => seekFn?.(ms),
    setSeek: (fn) => {
      seekFn = fn;
    },
    setTime: (ms) => {
      time = ms;
      emit();
    },
    getTime: () => time,
    setCaptions: (version) => {
      if (version === captions) return;
      captions = version;
      emit();
    },
    getCaptions: () => captions,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The `?v=` of the caption track to show, or null. */
export function useCaptionsVersion(bridge: PlayerBridge): string | null {
  return useSyncExternalStore(bridge.subscribe, bridge.getCaptions, () => null);
}

/** The start of the paragraph being played, or null before the first one; changes rarely. */
export function useCurrentParagraph(
  bridge: PlayerBridge,
  starts: readonly number[],
): number | null {
  return useSyncExternalStore(
    bridge.subscribe,
    () => {
      const now = bridge.getTime();
      let current: number | null = null;
      for (const start of starts) if (start <= now) current = start;
      return current;
    },
    () => null,
  );
}
