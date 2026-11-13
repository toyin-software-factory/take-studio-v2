import { NO_GREEN_SCREEN_NOTE } from "./take-display";

/** Every code `POST /api/takes/{id}/changes` (spec 0011) can answer with. */
export type ChangeErrorCode =
  | "not_found"
  | "invalid"
  | "job_active"
  | "invalid_transition"
  | "original_gone"
  | "nothing_changed"
  | "no_green_screen"
  | "background_not_ready"
  | "background_missing"
  | "stale"
  | "change_limit"
  | "dispatch_failed";

/** One friendly line per refusal of a change render (spec 0011, AC-8). */
export const CHANGE_MESSAGES: Readonly<Record<ChangeErrorCode, string>> = {
  not_found: "We couldn't find that take, cut or background.",
  invalid: "Those changes would remove the whole take. Keep at least some of it.",
  job_active: "A change is already being rendered. It'll show here when it's done.",
  invalid_transition: "This take isn't ready yet. Try again when it is.",
  original_gone: "The original has expired, so cuts can't be changed.",
  nothing_changed: "Nothing is different from the current video.",
  no_green_screen: NO_GREEN_SCREEN_NOTE,
  background_not_ready: "That background isn't ready yet. Try again in a moment.",
  background_missing: "The background on this take was deleted. Pick a background to render.",
  stale: "This take changed in another tab. We've loaded the latest version.",
  change_limit: "You've made a lot of changes in the last hour. Please try again later.",
  dispatch_failed: "The new video didn't start. Please try again.",
};
