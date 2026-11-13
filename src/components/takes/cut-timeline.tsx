"use client";

import { useEffect, useRef, useState } from "react";
import { StagePanel } from "@/components/stage";
import { summaryLine, timelineWidth } from "@/lib/cut-review";
import { CutBlock } from "./cut-block";
import { type PlayerBridge, useHead } from "./player-bridge";
import type { CutReview } from "./use-cut-review";
import { useWaveform } from "./use-waveform";
import { WaveformTrack } from "./waveform-track";

/** The width of an element, kept current. */
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * The timeline of the whole original under the player (spec 0011, AC-1, AC-2, AC-10, AC-11):
 * waveform or plain track, the numbered cut blocks, the playhead and the summary line. It
 * scrolls sideways inside itself, never the page. Time order in the DOM is the tab order.
 */
export function CutTimeline({
  takeId,
  durationMs,
  review,
  bridge,
}: {
  readonly takeId: string;
  readonly durationMs: number;
  readonly review: CutReview;
  readonly bridge: PlayerBridge;
}) {
  const box = useRef<HTMLDivElement>(null);
  const container = useWidth(box);
  const widthPx = timelineWidth(container, durationMs);
  const head = useHead(bridge);
  const values = useWaveform(takeId, review.waveformKey);
  const cutMs = review.numbered
    .filter((c) => review.applied(c.id))
    .map((c) => ({ ms: c.endMs - c.startMs }));
  const disabled = review.locked || review.readOnly;

  return (
    <StagePanel className="flex flex-col gap-2">
      <div
        ref={box}
        role="region"
        aria-label="Cut timeline"
        tabIndex={0}
        className="overflow-x-auto overscroll-x-contain"
      >
        <div className="relative h-16" style={{ width: widthPx }}>
          <WaveformTrack values={values} />
          {review.numbered.map((cut) => (
            <CutBlock
              key={cut.id}
              cut={cut}
              applied={review.applied(cut.id)}
              durationMs={durationMs}
              widthPx={widthPx}
              disabled={disabled}
              onPress={() => {
                review.toggle(cut.id);
                bridge.seekOriginal(Math.max(0, cut.startMs - 1000));
              }}
            />
          ))}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-stage-text"
            style={{ left: Math.min(widthPx, (head / durationMs) * widthPx) }}
          />
        </div>
      </div>
      <p role="status" className="text-small">
        {summaryLine(cutMs)}
      </p>
    </StagePanel>
  );
}
