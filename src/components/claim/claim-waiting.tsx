"use client";

import { useEffect } from "react";
import { callApi } from "@/components/takes/browser-io";
import { claimTarget } from "@/lib/guest-rules";

const POLL_MS = 5000;

/**
 * Spec 0023 AC-4: the upload is still finishing. The take answers 404 until the claim moves it
 * (it looks like any unknown take), then 200: go there. No change to the takes API.
 */
export function ClaimWaiting({
  pendingId,
  takeIds,
}: {
  readonly pendingId: string;
  readonly takeIds: readonly string[];
}) {
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const res = await callApi(`/api/takes/${pendingId}`, "GET");
        if (res.status === 200 && !stopped) window.location.assign(claimTarget(takeIds));
      } catch {
        // Try again at the next tick.
      }
    };
    const timer = window.setInterval(() => void check(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [pendingId, takeIds]);

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-h2">Your video is still uploading</h1>
        <p role="status" className="text-muted-foreground">
          Keep this page open. It adds the video to your library as soon as it is done.
        </p>
      </div>
    </>
  );
}
