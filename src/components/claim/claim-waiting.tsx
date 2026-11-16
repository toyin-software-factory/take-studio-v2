"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { callApi } from "@/components/takes/browser-io";
import { Button } from "@/components/ui/button";
import { claimPath, claimTarget } from "@/lib/guest-rules";

const POLL_MS = 5000;

/**
 * Spec 0023 AC-4: the upload is still finishing. The take answers 404 until the claim moves it
 * (it looks like any unknown take), then 200: go there. No change to the takes API.
 */
export function ClaimWaiting({
  pendingId,
  takeIds,
  claimId,
  target,
}: {
  readonly pendingId: string;
  readonly takeIds: readonly string[];
  readonly claimId: string;
  /** Where to go when done, when the server already chose it. */
  readonly target?: string;
}) {
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => {
    if (signedOut) return;
    let stopped = false;
    const check = async () => {
      try {
        const res = await callApi(`/api/takes/${pendingId}`, "GET");
        if (stopped) return;
        if (res.status === 401) {
          setSignedOut(true);
          return;
        }
        if (res.status === 200) window.location.assign(target ?? claimTarget(takeIds));
      } catch {
        // Try again at the next tick.
      }
    };
    const timer = window.setInterval(() => void check(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [pendingId, takeIds, target, signedOut]);

  if (signedOut) {
    return (
      <>
        <div className="flex flex-col gap-1">
          <h1 className="text-h2">You were signed out</h1>
          <p role="status" className="text-muted-foreground">
            Sign in again and we will finish adding your video.
          </p>
        </div>
        <Button asChild>
          <Link href={`/sign-in?return=${encodeURIComponent(claimPath(claimId))}`}>Sign in</Link>
        </Button>
      </>
    );
  }

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
