/**
 * Voice following state (spec 0021 step 2, AC-12), pure: one reducer, no timers of its own. The
 * hook feeds it events and a clock tick. After `FOLLOW_FALLBACK_MS` with no matched word, or when
 * the connection drops, the status becomes "fallback" and the prompter keeps its timed scroll with
 * a visible note. A matched word brings following back unless the connection is gone.
 *
 * B2-T115: following starts at the 3 2 1 countdown (`early`), so the socket is open before the
 * creator reads. "connecting" becomes "ready" when the socket opens. The no match clock only runs
 * once recording has started, and a socket still not open when recording starts after the hold
 * becomes the unavailable fallback.
 */

/** Same number as `TELEPROMPTER.followFallbackMs` in the spec's config. */
export const FOLLOW_FALLBACK_MS = 5000;

/** The longest the countdown waits at 0 for the voice service to connect (B2-T115). */
export const VOICE_HOLD_MS = 5000;

export const FOLLOW_NOTE_NO_MATCH =
  "Can't hear your place in the script, so it is scrolling on a timer.";
export const FOLLOW_NOTE_DROPPED = "Voice following disconnected, so it is scrolling on a timer.";
export const FOLLOW_NOTE_UNAVAILABLE =
  "Voice following isn't available right now, so it is scrolling on a timer.";

/** "ready" is the socket open and nothing matched yet. */
export type FollowStatus = "off" | "connecting" | "ready" | "following" | "fallback";

export type FollowState = {
  readonly status: FollowStatus;
  /** Index of the last script word matched, or null before the first match. */
  readonly wordIndex: number | null;
  readonly note: string | null;
  /** Clock time (ms) of the last match or of the moment following started. */
  readonly lastActivityAt: number;
  /** True once the socket is gone: a match no longer brings following back. */
  readonly dropped: boolean;
  /** True once recording has started: only then does the no match clock run. */
  readonly recording: boolean;
  /** Started at the countdown, so a socket still connecting when recording starts is unavailable. */
  readonly early: boolean;
};

export type FollowEvent =
  /** `early` is true when following starts at the countdown, before recording. */
  | { readonly type: "start"; readonly now: number; readonly early?: boolean }
  /** Recording has started (the countdown ended). */
  | { readonly type: "recording"; readonly now: number }
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
  recording: false,
  early: false,
};

/**
 * Should the countdown keep waiting at 0 for the voice service? Only while following is on, the
 * socket is still connecting and less than `VOICE_HOLD_MS` has passed since the countdown hit 0.
 */
export function holdCountdown(args: {
  readonly enabled: boolean;
  readonly status: FollowStatus;
  readonly heldMs: number;
}): boolean {
  return args.enabled && args.status === "connecting" && args.heldMs < VOICE_HOLD_MS;
}

export function followReducer(state: FollowState, event: FollowEvent): FollowState {
  switch (event.type) {
    case "start":
      return {
        ...FOLLOW_OFF,
        status: "connecting",
        lastActivityAt: event.now,
        recording: !event.early,
        early: event.early === true,
      };
    case "recording":
      if (state.status === "off") return state;
      // Not open when recording starts after the hold: the timer takes over with the unavailable note.
      if (state.early && state.status === "connecting") {
        return { ...state, status: "fallback", note: FOLLOW_NOTE_UNAVAILABLE, dropped: true };
      }
      return { ...state, recording: true, early: false, lastActivityAt: event.now };
    case "stop":
      return FOLLOW_OFF;
    case "open":
      return state.status === "connecting"
        ? { ...state, status: "ready", lastActivityAt: event.now }
        : state;
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
      if (state.status === "off" || state.status === "fallback" || !state.recording) return state;
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
