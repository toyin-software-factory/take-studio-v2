"use client";

import { useRef } from "react";
import { DROP_COPY } from "@/lib/guest-drop";
import { useGuestResult } from "./use-guest-result";

/**
 * The finished take in the drop card (spec 0023 AC-10): view only. A native player with the
 * download item left out of its menu, no transcript, no edit. "Check your email to keep it" stays
 * visible. The route offers no caption track, so none is shown.
 */
export function DropResult() {
  const result = useGuestResult(true);
  const video = useRef<HTMLVideoElement>(null);
  // Where the viewer is and whether it plays, kept from the player's own events. A new play link
  // reloads the media and resets it, so the place is put back once the new metadata is in.
  const place = useRef({ time: 0, playing: false });
  const track = () => {
    const el = video.current;
    // While a new link loads the player has no metadata (readyState 0) and reports a reset
    // position and a pause. Those events must not replace the place that was kept.
    if (el && el.readyState >= HTMLMediaElement.HAVE_METADATA)
      place.current = { time: el.currentTime, playing: !el.paused };
  };
  const restore = () => {
    const el = video.current;
    const { time, playing } = place.current;
    if (!el || time <= 0) return;
    el.currentTime = time;
    if (playing) void el.play().catch(() => undefined);
  };
  return (
    <div className="h-drop-result">
      <p className="h-drop-muted" role="status">
        {result.kind === "ready"
          ? DROP_COPY.ready
          : result.kind === "failed"
            ? DROP_COPY.resultFailed
            : result.kind === "unavailable"
              ? DROP_COPY.resultGone
              : DROP_COPY.preparing}
      </p>
      {result.kind === "ready" ? (
        <video
          ref={video}
          onLoadedMetadata={restore}
          onTimeUpdate={track}
          onPlay={track}
          onPause={track}
          className="h-drop-video"
          src={result.playUrl}
          controls
          playsInline
          preload="metadata"
          controlsList="nodownload noplaybackrate"
          disablePictureInPicture
          aria-label={DROP_COPY.videoLabel}
          onContextMenu={(event) => event.preventDefault()}
        />
      ) : null}
      <p className="h-drop-muted">{DROP_COPY.keep}</p>
    </div>
  );
}
