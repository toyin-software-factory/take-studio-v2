"use client";

import { useCallback, useRef, useState } from "react";
import { type TranscriptViewData, apiMessage, transcriptViewSchema } from "@/lib/take-api";
import { POLL } from "@/lib/take-display";
import { callApi } from "./browser-io";
import { type PollResult, usePoll } from "./use-poll";

/** About 30 s of 2 s checks for a transcript job that has not appeared yet. */
const NONE_CHECKS = 15;

/** A start refusal: its message, shown until the rule above clears it. */
type StartError = { readonly message: string };

/**
 * Reads GET /api/takes/{id}/transcript, polls every 2 s while it is being made, and starts the
 * job (Make transcript / Try again, spec 0007, AC-9). Behaviour kept from the first panel:
 * - a load error shows beside a view that already loaded, and no "we'll keep trying" follows a
 *   401 or 404 (the take page already says so);
 * - a start message (`original_gone`, `not_ready`, a failed start, "still being made") stays until
 *   the creator acts again, and is cleared only when a job this page saw in `making` has since
 *   finished. A 409 `job_active` counts as having seen one, since the server says one is running.
 */
export function useTranscript(takeId: string) {
  const [view, setView] = useState<TranscriptViewData | null>(null);
  const [stopped, setStopped] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<StartError | null>(null);
  // `process-take` marks the video Ready a moment before it creates the transcript job, so a
  // first read can say `none`: keep checking for a short while before believing it.
  const noneChecks = useRef(0);
  const [noneSeen, setNoneSeen] = useState(0);
  // True once this page has seen a job making (or been told one is running).
  const sawMaking = useRef(false);

  const load = useCallback(async (): Promise<PollResult> => {
    const reply = await callApi(`/api/takes/${takeId}/transcript`, "GET").catch(() => null);
    const parsed = transcriptViewSchema.safeParse(reply?.data);
    if (reply?.status === 401 || reply?.status === 404) {
      setLoadFailed(false);
      setStopped(true);
      return "stop";
    }
    if (reply?.status !== 200 || !parsed.success) {
      setLoadFailed(true);
      return "error";
    }
    setLoadFailed(false);
    setView(parsed.data);
    if (parsed.data.state === "making") {
      sawMaking.current = true;
      return "continue";
    }
    if (sawMaking.current) {
      // The job this page saw making has finished: an old start message no longer applies.
      sawMaking.current = false;
      setStartError(null);
    }
    if (parsed.data.state === "none") {
      noneChecks.current += 1;
      setNoneSeen(noneChecks.current);
      if (noneChecks.current < NONE_CHECKS) return "continue";
    }
    return "stop";
  }, [takeId]);

  const make = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    try {
      const reply = await callApi(`/api/takes/${takeId}/transcript`, "POST");
      if (reply.status === 202) {
        noneChecks.current = 0;
        setNoneSeen(0);
        setView((v) => (v ? { ...v, state: "making", canMake: false } : v));
      } else {
        const data = reply.data as { error?: unknown } | null;
        if (data?.error === "job_active") sawMaking.current = true;
        setStartError({
          message: apiMessage(reply.data, "The transcript didn't start. Please try again."),
        });
        // Another tab may have started it (or the take changed): refresh, and polling resumes
        // by itself if the view now says `making`.
        if (reply.status === 409) await load();
      }
    } catch {
      setStartError({
        message: "The transcript didn't start. Check your connection and try again.",
      });
    } finally {
      setStarting(false);
    }
  }, [takeId, load]);

  usePoll(
    load,
    POLL.takeMs,
    !stopped &&
      (view === null ||
        view.state === "making" ||
        (view.state === "none" && noneSeen < NONE_CHECKS)),
    { immediate: true },
  );

  return {
    view,
    loadError: loadFailed && !stopped,
    starting,
    startError: startError?.message ?? null,
    make,
  };
}
