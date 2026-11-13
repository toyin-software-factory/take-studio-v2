"use client";

import { useCallback, useRef, useState } from "react";
import { DELETE_MESSAGES, deleteOutcome } from "@/lib/take-delete";
import { callApi } from "./browser-io";

export type DeleteState = {
  readonly pending: boolean;
  /** The line for the dialog's `role="alert"`, or null. */
  readonly error: string | null;
  /** Runs the delete. Resolves true when the take is gone (204, or 404 on a retry). */
  readonly run: () => Promise<boolean>;
  readonly reset: () => void;
};

/**
 * DELETE /api/takes/{id} for the confirm dialog (spec 0013 AC-4). A second click while a
 * request runs is ignored. A network failure or timeout is "unknown": the dialog stays open,
 * the button stays enabled, and a retry that gets 404 counts as done.
 */
export function useDeleteTake(takeId: string): DeleteState {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const run = useCallback(async () => {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const status = await callApi(`/api/takes/${takeId}`, "DELETE")
        .then((r) => r.status)
        .catch(() => null);
      const outcome = deleteOutcome(status);
      if (outcome === "done") return true;
      setError(DELETE_MESSAGES[outcome]);
      return false;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, [takeId]);

  const reset = useCallback(() => setError(null), []);
  return { pending, error, run, reset };
}
