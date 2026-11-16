"use client";

import { useEffect, useState } from "react";
import { callApi } from "@/components/takes/browser-io";

/** What the view only result route says (spec 0023 AC-10), narrowed by hand: it is our own route. */
export type GuestResult =
  | { readonly kind: "waiting" }
  | { readonly kind: "ready"; readonly playUrl: string }
  | { readonly kind: "failed" }
  | { readonly kind: "unavailable" };

const POLL_MS = 5000;
/** Ask for a new link this long before the old one expires. */
const REFRESH_EARLY_SECONDS = 60;

/**
 * Polls `GET /api/guest/take` while `active`: every few seconds until the take is ready, then
 * once more shortly before the play link expires. A failed take, an expired one or a 404 (every refusal is the same
 * 404) stops the polling and clears any player; network and storage errors are retried. The link is
 * kept in state only, never logged.
 */
export function useGuestResult(active: boolean): GuestResult {
  const [result, setResult] = useState<GuestResult>({ kind: "waiting" });
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: number | undefined;
    const next = (ms: number) => {
      if (!stopped) timer = window.setTimeout(() => void check(), ms);
    };
    const check = async () => {
      try {
        const reply = await callApi("/api/guest/take", "GET");
        if (stopped) return;
        const data = reply.data as {
          status?: unknown;
          playUrl?: unknown;
          expiresInSeconds?: unknown;
        } | null;
        if (reply.status === 404 || (reply.status === 200 && data?.status === "expired"))
          return setResult({ kind: "unavailable" });
        if (reply.status === 200 && data?.status === "failed") return setResult({ kind: "failed" });
        if (reply.status === 200 && typeof data?.playUrl === "string") {
          setResult({ kind: "ready", playUrl: data.playUrl });
          const seconds = typeof data.expiresInSeconds === "number" ? data.expiresInSeconds : 300;
          return next(Math.max(10, seconds - REFRESH_EARLY_SECONDS) * 1000);
        }
      } catch {
        // Try again at the next tick.
      }
      next(POLL_MS);
    };
    void check();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [active]);
  return result;
}
