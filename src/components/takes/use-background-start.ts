"use client";

import { useState } from "react";
import { ORIGINAL_BACKGROUND } from "@/lib/background-api";
import { apiMessage } from "@/lib/take-api";
import { callApi } from "./browser-io";
import type { PollResult } from "./use-poll";

/**
 * Starts a background change (PUT /api/takes/{id}/background, spec 0008, AC-5, AC-6). A refusal
 * shows its friendly message. If the response is lost the request may still have reached the
 * server, so the page looks at the take again before saying anything is wrong; when looking
 * fails too, `uncertain` stays true until the creator acts again.
 */
export function useBackgroundStart(
  takeId: string,
  choice: string,
  onStarted: (target: string | null) => void,
  onUncertain: () => Promise<PollResult>,
) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [uncertain, setUncertain] = useState(false);

  const change = async () => {
    setStarting(true);
    setError(null);
    setUncertain(false);
    const target = choice === ORIGINAL_BACKGROUND ? null : choice;
    try {
      const reply = await callApi(`/api/takes/${takeId}/background`, "PUT", {
        backgroundId: choice,
      });
      if (reply.status === 202) onStarted(target);
      else setError(apiMessage(reply.data, "The change didn't start. Please try again."));
    } catch {
      setChecking(true);
      try {
        setUncertain((await onUncertain()) === "error");
      } finally {
        setChecking(false);
      }
    } finally {
      setStarting(false);
    }
  };

  return { change, starting, error, checking, uncertain };
}
