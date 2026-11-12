"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LINK_REFRESH_MS } from "@/lib/background-start";
import { mediaLinkSchema } from "@/lib/take-api";
import { callApi } from "./browser-io";

/**
 * The take's thumbnail link: the video's `poster` (iOS Safari paints no first frame without one,
 * so the stage would stay dark before play) and the "Keep original" picture. `url` is null when
 * the take has no thumbnail or the link fails. The link lasts 1 hour, and a phone tab can sit
 * for longer (or come back from the page cache with the old page), so the link is fetched again
 * when the tab becomes visible after `LINK_REFRESH_MS`, and `refresh` fetches one at once (an
 * image that failed to load calls it; S3S-T13).
 */
export function usePoster(takeId: string): {
  readonly url: string | null;
  readonly refresh: () => void;
} {
  const [url, setUrl] = useState<string | null>(null);
  const fetchedAt = useRef(0);
  const live = useRef(true);
  const lastRefresh = useRef(0);

  const load = useCallback(() => {
    void callApi(`/api/takes/${takeId}/media?kind=thumb`, "GET")
      .then((reply) => {
        const parsed = mediaLinkSchema.safeParse(reply.data);
        if (!live.current) return;
        fetchedAt.current = Date.now();
        setUrl(reply.status === 200 && parsed.success ? parsed.data.url : null);
      })
      .catch(() => undefined);
  }, [takeId]);

  useEffect(() => {
    live.current = true;
    load();
    const onShow = () => {
      if (!document.hidden && Date.now() - fetchedAt.current > LINK_REFRESH_MS) load();
    };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("pageshow", onShow);
    return () => {
      live.current = false;
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("pageshow", onShow);
    };
  }, [load]);

  // At most one fetch per 10 s however many images fail, so a thumbnail that never loads cannot loop.
  const refresh = useCallback(() => {
    if (Date.now() - lastRefresh.current < 10_000) return;
    lastRefresh.current = Date.now();
    load();
  }, [load]);

  return { url, refresh };
}
