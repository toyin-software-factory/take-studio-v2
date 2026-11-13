"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  originalToOutput,
  outputToOriginal,
  pendingTotalMs,
  playEnd,
  skipTarget,
} from "@/lib/cut-playback";
import type { Range } from "@/lib/cut-rules";
import type { PlayerBridge } from "./player-bridge";
import type { CutReview } from "./use-cut-review";

/** What the next `loadedmetadata` should do: where to resume, and whether to play. */
export type Resume = { at: number; playing: boolean; refreshed: boolean };

type Source = "render" | "original";

/**
 * Which recording the player shows (spec 0011, AC-3): the latest render, or the original while
 * cut changes are pending (skipping the pending cuts every frame). Switching keeps the place, the
 * play state, the volume and the speed, mapping the position through the removed ranges. It also
 * publishes the playhead on the original's timeline and answers the timeline's seeks.
 */
export function useSourceSwitch(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  resumeRef: React.RefObject<Resume>,
  review: CutReview,
  durationMs: number,
  bridge: PlayerBridge,
  player: {
    readonly mounted: boolean;
    readonly stillPreview: boolean;
    /** Removed ranges of the render the player actually shows (they trail `review`'s). */
    readonly renderRanges: readonly Range[];
  },
) {
  const { mounted, stillPreview, renderRanges } = player;
  const originalUrl = review.originalState.kind === "ready" ? review.originalState.url : null;
  const desired: Source = review.cutEdits && originalUrl ? "original" : "render";
  const [active, setActive] = useState<Source>("render");
  // The last good link stays, so the src does not flip early when the state turns to failed.
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  if (originalUrl && originalUrl !== lastUrl) setLastUrl(originalUrl);
  const ranges = review.ranges;
  const live = useRef({ active, ranges, renderRanges, durationMs, stillPreview });
  useEffect(() => {
    live.current = { active, ranges, renderRanges, durationMs, stillPreview };
  });

  // Capture the place and state just before the source changes, then switch.
  useEffect(() => {
    if (desired === active) return;
    const v = videoRef.current;
    if (v && resumeRef.current) {
      const head =
        active === "render"
          ? outputToOriginal(v.currentTime * 1000, renderRanges)
          : v.currentTime * 1000;
      resumeRef.current = {
        ...resumeRef.current,
        at: (desired === "render" ? originalToOutput(head, renderRanges) : head) / 1000,
        playing: !v.paused,
      };
      v.defaultPlaybackRate = v.playbackRate;
    }
    // The position is captured above, before the src changes: it has to be a state change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActive(desired);
  }, [desired, active, videoRef, resumeRef, renderRanges]);

  /** Publishes the playhead (original ms) and the transcript time (render ms). */
  const publish = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const { active: a, renderRanges: rr } = live.current;
    const ms = v.currentTime * 1000;
    const head = a === "render" ? outputToOriginal(ms, rr) : ms;
    bridge.setHead(Math.round(head / 50) * 50);
    bridge.setTime(a === "render" ? ms : originalToOutput(ms, rr));
  }, [videoRef, bridge]);

  // One loop per frame: publish, skip pending cuts, stop at the end of the last kept range.
  useEffect(() => {
    // The <video> only exists once the link is ready, so the loop starts then.
    const v = mounted ? videoRef.current : null;
    if (!v) return;
    let stopped = false;
    let handle = 0;
    const tick = () => {
      if (stopped) return;
      const { active: a, ranges: rs, durationMs: total } = live.current;
      if (a === "original" && !v.paused) {
        const ms = v.currentTime * 1000;
        const target = skipTarget(ms, rs);
        const end = playEnd(rs, total);
        if (ms >= end) {
          v.pause();
          v.currentTime = end / 1000;
        } else if (target !== null) v.currentTime = target / 1000;
      }
      publish();
      schedule();
    };
    const schedule = () => {
      handle =
        "requestVideoFrameCallback" in v
          ? v.requestVideoFrameCallback(tick)
          : requestAnimationFrame(tick);
    };
    schedule();
    return () => {
      stopped = true;
      if ("cancelVideoFrameCallback" in v) v.cancelVideoFrameCallback(handle);
      else cancelAnimationFrame(handle);
    };
  }, [videoRef, publish, mounted]);

  /** Video seconds for a time on the render's own timeline (the transcript's clicks). */
  const videoSecondsForRender = useCallback(
    (ms: number) =>
      (live.current.active === "original" ? outputToOriginal(ms, live.current.renderRanges) : ms) /
      1000,
    [],
  );

  useEffect(() => {
    bridge.setSeekOriginal((ms) => {
      const v = videoRef.current;
      if (!v) return;
      const { active: a, renderRanges: rr } = live.current;
      v.currentTime = (a === "render" ? originalToOutput(ms, rr) : ms) / 1000;
      // A still preview keeps the video paused under it.
      if (!live.current.stillPreview) void v.play().catch(() => undefined);
    });
    return () => bridge.setSeekOriginal(null);
  }, [bridge, videoRef]);

  const onOriginal = active === "original";
  return {
    active,
    originalUrl: onOriginal ? (originalUrl ?? lastUrl) : null,
    /** The controls show the previewed videoRef: position and length with the pending cuts out. */
    displayTime: (seconds: number) =>
      onOriginal ? originalToOutput(seconds * 1000, ranges) / 1000 : seconds,
    displayDuration: (seconds: number) =>
      onOriginal ? pendingTotalMs(durationMs, ranges) / 1000 : seconds,
    videoTime: (displaySeconds: number) =>
      onOriginal ? outputToOriginal(displaySeconds * 1000, ranges) / 1000 : displaySeconds,
    videoSecondsForRender,
    publish,
  };
}
