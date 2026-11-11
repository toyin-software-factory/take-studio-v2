"use client";

import { useEffect, useState } from "react";
import { mediaLinkSchema } from "@/lib/take-api";
import { callApi } from "./browser-io";

/**
 * The take's thumbnail link, used as the video's `poster` (iOS Safari paints no first frame
 * without one, so the stage would stay dark before play). Null when the take has no thumbnail
 * or the link fails: the video then simply has no poster.
 */
export function usePoster(takeId: string): string | null {
  const [poster, setPoster] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void callApi(`/api/takes/${takeId}/media?kind=thumb`, "GET")
      .then((reply) => {
        const parsed = mediaLinkSchema.safeParse(reply.data);
        if (live) setPoster(reply.status === 200 && parsed.success ? parsed.data.url : null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [takeId]);
  return poster;
}
