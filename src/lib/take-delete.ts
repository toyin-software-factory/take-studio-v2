/**
 * What a DELETE /api/takes/{id} answer means for the dialog (spec 0013 AC-3, AC-4). Pure.
 *
 * - `done`: 204, or 404 (already gone: a retry after a lost reply lands here, so it counts as
 *   success).
 * - `signed_out`: 401.
 * - `failed`: the server answered with something else (403, 500, ...): nothing was deleted
 *   as far as the server says, so "Try again".
 * - `unknown`: no answer at all (network failure or timeout): the server may have committed
 *   before the reply was lost, so the wording says we could not confirm.
 */
export type DeleteOutcome = "done" | "signed_out" | "failed" | "unknown";

export function deleteOutcome(status: number | null): DeleteOutcome {
  if (status === null || status === 0) return "unknown";
  if (status === 204 || status === 404) return "done";
  if (status === 401) return "signed_out";
  return "failed";
}

/** The dialog's error line for a non final outcome (AC-4). */
export const DELETE_MESSAGES = {
  failed: "We couldn't delete this take. Try again.",
  unknown: "We couldn't confirm the delete. Try again to check.",
  signed_out: "You've been signed out. Sign in again to delete this take.",
} as const;

export const DELETE_WARNING =
  "This removes the video, the original, the transcript and every edit. You can't undo it.";

/** The polite status the library shows after a delete (AC-4, AC-5). */
export const DELETED_MESSAGE = "Take deleted.";

/** Query flag the take page adds when it sends the creator back to the library. */
export const DELETED_PARAM = "deleted";

/**
 * The list after a card is deleted (AC-5): the card leaves at once, and focus goes to the next
 * card's link, else the previous one, else (empty list) the upload area.
 */
export function afterCardDelete<T extends { readonly id: string }>(
  takes: readonly T[],
  id: string,
): { readonly takes: readonly T[]; readonly focusId: string | null } {
  const at = takes.findIndex((t) => t.id === id);
  if (at === -1) return { takes, focusId: null };
  const rest = takes.filter((t) => t.id !== id);
  const next = rest[at] ?? rest[at - 1] ?? null;
  return { takes: rest, focusId: next?.id ?? null };
}

/** The "N takes" count line the library shows (AC-5: it updates after a delete). */
export function takeCountText(count: number, hasMore: boolean): string {
  const n = `${count}${hasMore ? "+" : ""}`;
  return `${n} ${count === 1 && !hasMore ? "take" : "takes"}`;
}
