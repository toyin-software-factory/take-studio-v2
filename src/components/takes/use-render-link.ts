"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type Link, playLink } from "./play-link";
import type { Resume } from "./use-source-switch";

/**
 * The link to the latest render (AC-9, S3S-T13): fetched on mount, and again when a new render
 * appears (a change finished here or in another tab), swapping the source in place, resuming
 * where the viewer was. A swap that cannot get its link leaves the working video alone, retries
 * a few times, then says so (`swapFailed`) with a retry.
 */
export function useRenderLink(
  takeId: string,
  renderId: string | null,
  video: React.RefObject<HTMLVideoElement | null>,
  resume: React.RefObject<Resume>,
) {
  const [link, setLink] = useState<Link>({ kind: "loading" });
  const [swapFailed, setSwapFailed] = useState(false);
  const shownRender = useRef(renderId);
  const retrySwap = useRef<() => void>(() => undefined);

  const fetchLink = useCallback(() => {
    void playLink(takeId).then(setLink);
  }, [takeId]);

  useEffect(() => {
    let live = true;
    const swapping = shownRender.current !== renderId;
    shownRender.current = renderId;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = (retriesLeft: number) => {
      void playLink(takeId).then((next) => {
        if (!live) return;
        const playing = video.current;
        if (swapping && playing && next.kind !== "ready") {
          if (retriesLeft > 0) timer = setTimeout(() => attempt(retriesLeft - 1), 3000);
          else setSwapFailed(true);
          return;
        }
        // Read the place and the state just before the source changes: the viewer may have
        // played on, paused or pressed play while the link was being fetched.
        if (swapping && playing && resume.current) {
          resume.current.at = playing.currentTime;
          resume.current.playing = !playing.paused;
          resume.current.refreshed = false;
        }
        setSwapFailed(false);
        setLink(next);
      });
    };
    retrySwap.current = () => {
      setSwapFailed(false);
      attempt(0);
    };
    attempt(2);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [takeId, renderId, video, resume]);

  return { link, setLink, fetchLink, swapFailed, retrySwap: () => retrySwap.current() };
}
