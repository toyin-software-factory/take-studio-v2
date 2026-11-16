"use client";

import Link from "next/link";
import { useState } from "react";
import { ClaimWaiting } from "@/components/claim/claim-waiting";
import { callApi } from "@/components/takes/browser-io";
import { Button } from "@/components/ui/button";

type State = "idle" | "working" | "failed";
type Pending = { readonly id: string; readonly target: string };

/** Spec 0023 C5: only the email matched, so ask before adding the video to this account. */
export function ClaimConfirm({ claimId }: { readonly claimId: string }) {
  const [state, setState] = useState<State>("idle");
  const [pending, setPending] = useState<Pending | null>(null);

  async function confirm() {
    setState("working");
    try {
      const res = await callApi("/api/guest/claim", "POST", { claimId });
      const data = res.data;
      const target =
        res.status === 200 && typeof data === "object" && data !== null && "target" in data
          ? (data as { target: unknown }).target
          : null;
      const waiting =
        typeof data === "object" && data !== null && "waiting" in data
          ? (data as { waiting: unknown }).waiting
          : null;
      if (typeof target === "string" && target.startsWith("/")) {
        // An upload that is still finishing is not ours yet: wait for it before opening the target.
        const [first] = Array.isArray(waiting) ? waiting : [];
        if (typeof first === "string") {
          setPending({ id: first, target });
          return;
        }
        window.location.assign(target);
        return;
      }
      setState("failed");
    } catch {
      setState("failed");
    }
  }

  if (pending) {
    return (
      <ClaimWaiting pendingId={pending.id} takeIds={[]} claimId={claimId} target={pending.target} />
    );
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-h2">Add this video to your library?</h1>
        <p className="text-muted-foreground">A video was added with your email.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={confirm} aria-disabled={state === "working"}>
          Add to my library
        </Button>
        <Button asChild variant="secondary">
          <Link href="/library">Not now</Link>
        </Button>
      </div>
      <p role="status" className="text-small text-muted-foreground">
        {state === "failed" ? "That didn't work. Please try again." : ""}
      </p>
    </>
  );
}
