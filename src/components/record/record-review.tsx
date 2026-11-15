"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import type { RecordedTake } from "@/lib/recorder-state";
import { formatClock } from "@/lib/take-display";
import type { UploadState } from "@/components/takes/use-upload";
import { ReviewPanel } from "./review-panel";

/**
 * The review step (AC-1, AC-7, B2-T129): the take on the dark stage with a big play button, and
 * "Use this take", "Record again" and "Save to device" beside it. While the upload runs the same
 * stage stays and the buttons give way to the progress. A failed upload keeps the take here with
 * the message and a retry.
 */
export function RecordReview({
  take,
  failure,
  upload,
  onUse,
  onAgain,
  onCancel,
}: {
  readonly take: RecordedTake;
  readonly failure: string | null;
  /** Set while "Use this take" is sending the file; null while the take is only being reviewed. */
  readonly upload: UploadState | null;
  readonly onUse: () => void;
  readonly onAgain: () => void;
  readonly onCancel: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const made = URL.createObjectURL(take.blob);
    queueMicrotask(() => setUrl(made));
    return () => URL.revokeObjectURL(made);
  }, [take.blob]);

  return (
    <section className="rst rvw" aria-label="Camera" data-check="s2-stage" data-check-section="">
      <div className="rst-col">
        <div className="rst-cam">
          {url ? (
            <video
              ref={video}
              src={url}
              controls={started}
              playsInline
              aria-label="Your recording"
              data-check="s2-stage-media"
              className="size-full object-cover"
              onPlay={() => setStarted(true)}
            />
          ) : null}
          {started || !url ? null : (
            <button
              type="button"
              className="rvw-play"
              aria-label="Play your take"
              data-check="s2-stage-cta-2"
              onClick={() => void video.current?.play()}
            >
              <Icon icon={Play} className="fill-current" />
            </button>
          )}
          {started ? null : (
            <div className="rst-top">
              <span className="rst-pill">
                <i aria-hidden="true" />
                <span>{formatClock(take.durationMs)}</span>
              </span>
            </div>
          )}
        </div>
      </div>
      <ReviewPanel
        take={take}
        url={url}
        failure={failure}
        upload={upload}
        onUse={onUse}
        onAgain={onAgain}
        onCancel={onCancel}
      />
    </section>
  );
}
