"use client";

import { useEffect, useRef } from "react";
import { Circle, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { shouldWarn } from "@/lib/recorder-rules";
import { formatClock } from "@/lib/take-display";
import type { RecorderState } from "@/lib/recorder-state";
import { ScriptScroll } from "./script-scroll";

/**
 * The live preview (mirrored, display only: the file is never mirrored), the script over it,
 * the 3 2 1 countdown, the timer and the Record and Stop buttons. The countdown and the
 * 60 second warning are spoken through one polite status line.
 */
export function RecordStage({
  state,
  stream,
  script,
  elapsedMs,
  limitMs,
  onRecord,
  onStop,
}: {
  readonly state: RecorderState;
  readonly stream: MediaStream | null;
  readonly script: string;
  readonly elapsedMs: number;
  readonly limitMs: number;
  readonly onRecord: () => void;
  readonly onStop: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);

  const recording = state.kind === "recording";
  const countdown = state.kind === "countdown";
  const leftMs = Math.max(0, limitMs - elapsedMs);
  const warn = recording && shouldWarn(elapsedMs, limitMs);
  const status = countdown
    ? `Recording starts in ${state.secondsLeft}`
    : warn
      ? "One minute left"
      : recording
        ? "Recording"
        : "";

  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-video overflow-hidden rounded-lg bg-dark">
        {/* Muted: no echo of your own voice. Mirrored for the creator only. */}
        <video
          ref={video}
          autoPlay
          muted
          playsInline
          aria-label="Camera preview"
          className="size-full -scale-x-100 object-cover"
        />
        <div className="pointer-events-none absolute inset-x-3 top-3 bottom-12 flex flex-col gap-2">
          <ScriptScroll script={script} elapsedMs={elapsedMs} active={recording} />
        </div>
        {countdown && state.secondsLeft > 0 ? (
          <div
            aria-hidden="true"
            className="absolute inset-0 grid place-items-center bg-glass text-[8rem] leading-none font-medium text-on-dark"
          >
            {state.secondsLeft}
          </div>
        ) : null}
        <span
          data-testid={recording ? "record-timer" : "record-limit"}
          className="mono absolute bottom-3 left-3 rounded-md bg-nav-glass-dark px-2 py-1 text-small text-on-dark"
        >
          {recording
            ? `${formatClock(elapsedMs)} / ${formatClock(limitMs)}`
            : `Up to ${formatClock(limitMs)}`}
        </span>
      </div>
      <p role="status" className="sr-only">
        {status}
      </p>
      {warn ? (
        <p className="text-small font-medium text-destructive">
          {formatClock(leftMs)} left. The recording stops by itself at the limit.
        </p>
      ) : null}
      <div className="flex gap-3">
        {recording ? (
          <Button size="lg" variant="destructive" onClick={onStop}>
            <Icon icon={Square} /> Stop
          </Button>
        ) : (
          <Button size="lg" disabled={countdown || limitMs <= 0} onClick={onRecord}>
            <Icon icon={Circle} /> {countdown ? "Starting…" : "Record"}
          </Button>
        )}
      </div>
    </div>
  );
}
