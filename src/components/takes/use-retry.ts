"use client";

import { useCallback, useState } from "react";
import { notify } from "@/components/ui/sonner";
import { apiMessage } from "@/lib/take-api";
import { callApi } from "./browser-io";

/**
 * "Try again" for a failed take (AC-10): POST /api/takes/{id}/retry. Calls `onStarted` when
 * the new run is accepted, and shows the server's friendly message as an error toast if not.
 */
export function useRetry(takeId: string, onStarted: () => void) {
  const [pending, setPending] = useState(false);
  const retry = useCallback(async () => {
    setPending(true);
    try {
      const reply = await callApi(`/api/takes/${takeId}/retry`, "POST");
      if (reply.status === 202) onStarted();
      else
        notify("error", { title: apiMessage(reply.data, "That didn't work. Please try again.") });
    } catch {
      notify("error", { title: "You seem to be offline. Check your connection and try again." });
    } finally {
      setPending(false);
    }
  }, [takeId, onStarted]);
  return { retry, pending };
}
