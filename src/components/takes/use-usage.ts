"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { callApi } from "./browser-io";
import type { UsageView } from "./usage-meter";

const usageBody = z.object({
  usedSeconds: z.number(),
  allowanceSeconds: z.number(),
  remainingSeconds: z.number(),
  resetsOn: z.string(),
});

/**
 * The usage numbers for the library (spec 0014 AC-8). The page passes the first read, so the
 * meter is there on first paint; `refreshKey` changing (an upload was refused or cancelled)
 * or the reset date passing reads GET /api/usage again. A failed read keeps what is on screen. `enforced` only comes from
 * the page, because the endpoint does not tell it.
 */
export function useUsage(initial: UsageView | null, refreshKey: string): UsageView | null {
  const [usage, setUsage] = useState(initial);
  const enforced = initial?.enforced ?? false;
  const resetsOn = usage?.resetsOn;
  const [resetTick, setResetTick] = useState(0);
  // The allowance resets at the start of the next UTC month: read again then, and when a tab that
  // was asleep over the boundary comes back, so a blocked creator is not stuck until a reload.
  useEffect(() => {
    if (!enforced || !resetsOn) return;
    const resetAt = Date.parse(`${resetsOn}T00:00:00Z`);
    if (Number.isNaN(resetAt)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(timer);
      if (Date.now() >= resetAt) {
        setResetTick((n) => n + 1);
        return;
      }
      // setTimeout cannot wait longer than 2^31 ms (about 24.8 days): wake early, check again.
      timer = setTimeout(check, Math.min(resetAt - Date.now(), 2 ** 31 - 1));
    };
    check();
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enforced, resetsOn]);
  useEffect(() => {
    if (refreshKey === "" && resetTick === 0) return;
    let live = true;
    void callApi("/api/usage", "GET")
      .then((reply) => {
        const parsed = usageBody.safeParse(reply.data);
        if (live && reply.status === 200 && parsed.success) setUsage({ ...parsed.data, enforced });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [refreshKey, resetTick, enforced]);
  return usage;
}
