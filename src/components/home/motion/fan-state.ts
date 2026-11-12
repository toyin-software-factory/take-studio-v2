/**
 * The hero fan's loop state, shared by the loop (`fan.ts`) and the pause button (`FanToggle`).
 * `ready` is true only while the loop can run (scripts loaded, motion allowed), so the button
 * shows only when there is something to pause (WCAG 2.2.2). The pause choice holds for the
 * visit (sessionStorage), not longer.
 */
type FanState = { readonly ready: boolean; readonly paused: boolean };

const KEY = "take-studio:fan-paused";
const listeners = new Set<() => void>();
let state: FanState = { ready: false, paused: false };

function readStored(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function set(next: FanState) {
  if (next.ready === state.ready && next.paused === state.paused) return;
  state = next;
  listeners.forEach((listener) => listener());
}

export const fanStore = {
  get: (): FanState => state,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** The loop is set up (or torn down): the button appears (or goes). */
  setReady: (ready: boolean) => set({ ready, paused: ready ? readStored() : state.paused }),
  setPaused: (paused: boolean) => {
    try {
      window.sessionStorage.setItem(KEY, paused ? "1" : "0");
    } catch {
      /* the choice then holds until the page is left */
    }
    set({ ...state, paused });
  },
};

/** The server snapshot: nothing to show. */
export const SERVER_FAN_STATE: FanState = { ready: false, paused: false };
