"use client";

import { DROP_COPY } from "@/lib/guest-drop";
import { useGuestResult } from "./use-guest-result";

/**
 * The finished take in the drop card (spec 0023 AC-10): view only. A native player with the
 * download item left out of its menu, no transcript, no edit. "Check your email to keep it" stays
 * visible. The route offers no caption track, so none is shown.
 */
export function DropResult() {
  const result = useGuestResult(true);
  return (
    <div className="h-drop-result">
      <p className="h-drop-muted" role="status">
        {result.kind === "ready"
          ? DROP_COPY.ready
          : result.kind === "failed"
            ? DROP_COPY.resultFailed
            : DROP_COPY.preparing}
      </p>
      {result.kind === "ready" ? (
        <video
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
