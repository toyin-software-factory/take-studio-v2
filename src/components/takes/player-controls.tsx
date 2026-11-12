"use client";

import { Captions, Maximize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Slider } from "@/components/ui/slider";
import { formatClock } from "@/lib/take-display";

/**
 * The player's control bar on the stage: play or pause, the seek slider, time in mono, mute
 * and full screen. Icon buttons have names that follow their state.
 */
export function PlayerControls({
  playing,
  current,
  duration,
  muted,
  captions,
  onToggle,
  onSeek,
  onMute,
  onFullscreen,
}: {
  readonly playing: boolean;
  readonly current: number;
  readonly duration: number;
  readonly muted: boolean;
  /** The CC button (spec 0007, AC-5); null while there are no captions. */
  readonly captions: { readonly on: boolean; readonly onToggle: () => void } | null;
  readonly onToggle: () => void;
  readonly onSeek: (seconds: number) => void;
  readonly onMute: () => void;
  readonly onFullscreen: () => void;
}) {
  const known = Number.isFinite(duration) && duration > 0;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line-dark bg-glass px-2 py-1 [backdrop-filter:var(--blur-glass)] sm:gap-3">
      <Button
        variant="ghost"
        size="icon"
        aria-label={playing ? "Pause" : "Play"}
        onClick={onToggle}
      >
        <Icon icon={playing ? Pause : Play} size="stage" />
      </Button>
      <Slider
        aria-label="Seek"
        min={0}
        max={known ? duration : 1}
        step={0.1}
        value={[known ? Math.min(current, duration) : 0]}
        disabled={!known}
        onValueChange={([seconds]) => onSeek(seconds ?? 0)}
        className="flex-1"
      />
      <span className="mono shrink-0 text-small whitespace-nowrap">
        {formatClock(current * 1000)}
        <span className="text-stage-text-muted"> / {formatClock(known ? duration * 1000 : 0)}</span>
      </span>
      {captions ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Captions"
          aria-pressed={captions.on}
          onClick={captions.onToggle}
          className={captions.on ? "bg-selected-surface text-text" : undefined}
        >
          <Icon icon={Captions} size="stage" />
        </Button>
      ) : null}
      <Button variant="ghost" size="icon" aria-label={muted ? "Unmute" : "Mute"} onClick={onMute}>
        <Icon icon={muted ? VolumeX : Volume2} size="stage" />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Full screen" onClick={onFullscreen}>
        <Icon icon={Maximize} size="stage" />
      </Button>
    </div>
  );
}
