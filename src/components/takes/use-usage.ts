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
 * reads GET /api/usage again. A failed read keeps what is on screen. `enforced` only comes from
 * the page, because the endpoint does not tell it.
 */
export function useUsage(initial: UsageView | null, refreshKey: string): UsageView | null {
  const [usage, setUsage] = useState(initial);
  const enforced = initial?.enforced ?? false;
  useEffect(() => {
    if (refreshKey === "") return;
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
  }, [refreshKey, enforced]);
  return usage;
}
