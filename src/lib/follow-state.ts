/**
 * Voice following state (spec 0021 step 2, AC-12), pure: one reducer, no timers of its own. The
 * hook feeds it events and a clock tick. After `FOLLOW_FALLBACK_MS` with no matched word, or when
 * the connection drops, the status becomes "fallback" and the prompter keeps its timed scroll with
 * a visible note. A matched word brings following back unless the connection is gone.
 */

/** Same number as `TELEPROMPTER.followFallbackMs` in the spec's config. */
export const FOLLOW_FALLBACK_MS = 5000;

export const FOLLOW_NOTE_NO_MATCH =
  "Can't hear your place in the script, so it is scrolling on a timer.";
export const FOLLOW_NOTE_DROPPED = "Voice following disconnected, so it is scrolling on a timer.";
export const FOLLOW_NOTE_UNAVAILABLE =
  "Voice following isn't available right now, so it is scrolling on a timer.";

export type FollowStatus = "off" | "connecting" | "following" | "fallback";

export type FollowState = {
  readonly status: FollowStatus;
  /** Index of the last script word matched, or null before the first match. */
  readonly wordIndex: number | null;
  readonly note: string | null;
  /** Clock time (ms) of the last match or of the moment following started. */
  readonly lastActivityAt: number;
  /** True once the socket is gone: a match no longer brings following back. */
  readonly dropped: boolean;
};

export type FollowEvent =
  | { readonly type: "start"; readonly now: number }
  | { readonly type: "open"; readonly now: number }
  | { readonly type: "match"; readonly index: number; readonly now: number }
  | { readonly type: "tick"; readonly now: number }
  | { readonly type: "closed" }
  | { readonly type: "unavailable" }
  | { readonly type: "stop" };

export const FOLLOW_OFF: FollowState = {
  status: "off",
  wordIndex: null,
  note: null,
  lastActivityAt: 0,
  dropped: false,
};

export function followReducer(state: FollowState, event: FollowEvent): FollowState {
  switch (event.type) {
    case "start":
      return { ...FOLLOW_OFF, status: "connecting", lastActivityAt: event.now };
    case "stop":
      return FOLLOW_OFF;
    case "open":
      return state.status === "connecting" ? { ...state, lastActivityAt: event.now } : state;
    case "match":
      if (state.status === "off" || state.dropped) return state;
      return {
        ...state,
        status: "following",
        wordIndex: Math.max(state.wordIndex ?? -1, event.index),
        note: null,
        lastActivityAt: event.now,
      };
    case "tick":
      if (state.status !== "connecting" && state.status !== "following") return state;
      return event.now - state.lastActivityAt >= FOLLOW_FALLBACK_MS
        ? { ...state, status: "fallback", note: FOLLOW_NOTE_NO_MATCH }
        : state;
    case "closed":
      return state.status === "off" || state.dropped
        ? state
        : { ...state, status: "fallback", note: FOLLOW_NOTE_DROPPED, dropped: true };
    case "unavailable":
      return state.status === "off"
        ? state
        : { ...state, status: "fallback", note: FOLLOW_NOTE_UNAVAILABLE, dropped: true };
  }
}
