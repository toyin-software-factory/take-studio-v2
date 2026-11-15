/**
 * Pure display rules for the library and take pages (spec 0004, AC-1, AC-4, AC-7 to AC-10,
 * design.md Voice): status labels, friendly failure messages, mm:ss times, expiry notes, the
 * weighted overall progress, tab titles and the polling schedule. No React, no I/O.
 *
 * Split by job (B2-T116): `take-display-status` (status, failures, clock, notes),
 * `take-display-steps` (step progress and tab titles) and `take-display-poll` (polling and the
 * background notes). This file only re-exports them.
 */
export {
  EXPIRY_COUNTDOWN_DAYS,
  RETENTION_NOTE,
  TAKE_NOTES,
  TRANSCRIPT_KEPT,
  effectiveStatus,
  expiryNote,
  failureMessage,
  formatClock,
  isInFlight,
  removedNote,
  shortDate,
  statusBadge,
  videoRemovedNote,
  type StatusBadge,
  type TakeStatusName,
} from "./take-display-status";
export {
  overallPercent,
  stepLabel,
  stepPercent,
  stepStatusText,
  tabTitle,
  type StepView,
} from "./take-display-steps";
export {
  NO_GREEN_SCREEN_NOTE,
  POLL,
  backgroundChangeActive,
  backgroundFailureMessage,
  keepPolling,
  pollDelay,
  previewStatusText,
} from "./take-display-poll";
