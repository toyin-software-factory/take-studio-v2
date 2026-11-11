"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { StageLetterbox } from "@/components/stage";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { type PlayerBridge } from "./player-bridge";
import { PlayerControls } from "./player-controls";
import { type Link, playLink } from "./play-link";
import { useCaptions } from "./use-captions";
import { usePoster } from "./use-poster";
import { usePlayerKeys } from "./use-player-keys";

/**
 * The stage player (AC-9; design.md Video player): plays through a 1 hour signed link from
 * GET /api/takes/{id}/media?kind=play, in a 16:9 letterbox, with custom controls and keyboard
 * shortcuts (space or K play and pause, arrows seek 5 s, J and L seek 10 s). If the link has
 * expired, a fresh one is fetched once and playback resumes where it was.
 */
export function TakePlayer({
  takeId,
  bridge,
}: {
  readonly takeId: string;
  readonly bridge: PlayerBridge;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const resumeAt = useRef(0);
  const refreshed = useRef(false);
  const resumePlaying = useRef(false);
  const [link, setLink] = useState<Link>({ kind: "loading" });
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const captions = useCaptions(bridge, video, link.kind === "ready");
  const poster = usePoster(takeId);

  const fetchLink = useCallback(() => {
    void playLink(takeId).then(setLink);
  }, [takeId]);

  useEffect(() => {
    let live = true;
    void playLink(takeId).then((next) => {
      if (live) setLink(next);
    });
    return () => {
      live = false;
    };
  }, [takeId]);

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, []);
  const seekTo = useCallback((seconds: number) => {
    const v = video.current;
    // Before the metadata loads the duration is NaN: keep the time (the browser applies it once it
    // loads) instead of clamping it to 0, so a transcript click on a still loading video works.
    if (v)
      v.currentTime = Number.isFinite(v.duration)
        ? Math.min(Math.max(0, seconds), v.duration)
        : Math.max(0, seconds);
  }, []);
  const seekBy = useCallback(
    (delta: number) => seekTo((video.current?.currentTime ?? 0) + delta),
    [seekTo],
  );
  const onKeyDown = usePlayerKeys(toggle, seekBy);
  // The transcript panel seeks through the bridge (times on the trimmed video, in ms).
  useEffect(() => {
    bridge.setSeek((ms) => seekTo(ms / 1000));
    return () => bridge.setSeek(null);
  }, [bridge, seekTo]);

  if (link.kind === "loading") return <Skeleton className="aspect-video w-full" />;
  if (link.kind === "error") {
    return (
      <StageLetterbox className="flex-col gap-3 px-4 text-center">
        <Icon icon={CircleAlert} size="empty" className="text-stage-text-muted" />
        <p role="alert">The video didn&rsquo;t load. Check your connection and try again.</p>
        <Button
          onClick={() => {
            setLink({ kind: "loading" });
            fetchLink();
          }}
        >
          Retry
        </Button>
      </StageLetterbox>
    );
  }

  return (
    <div
      role="group"
      aria-label="Video player"
      onKeyDown={onKeyDown}
      className="flex flex-col gap-3"
    >
      <StageLetterbox>
        <video
          ref={video}
          src={link.url}
          poster={poster ?? undefined}
          playsInline
          preload="metadata"
          className="size-full object-contain"
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => {
            setPlaying(false);
            // A pause while the new link is loading means: stay paused when it arrives.
            resumePlaying.current = false;
          }}
          onTimeUpdate={(e) => {
            setCurrent(e.currentTarget.currentTime);
            bridge.setTime(e.currentTarget.currentTime * 1000);
          }}
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration);
            if (resumeAt.current > 0) e.currentTarget.currentTime = resumeAt.current;
            // A replacement link loads paused; carry on if it was playing when the link failed.
            if (resumePlaying.current) void e.currentTarget.play().catch(() => undefined);
            resumePlaying.current = false;
          }}
          onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
          onError={() => {
            // Most likely the 1 hour link expired: get a new one once and carry on.
            if (refreshed.current) return setLink({ kind: "error" });
            refreshed.current = true;
            resumeAt.current = video.current?.currentTime ?? 0;
            resumePlaying.current = video.current?.paused === false;
            fetchLink();
          }}
        >
          {captions.version ? (
            <track
              key={captions.version}
              kind="captions"
              srcLang="en"
              label="English"
              src={`/api/takes/${takeId}/transcript/vtt?v=${encodeURIComponent(captions.version)}`}
            />
          ) : null}
        </video>
      </StageLetterbox>
      <PlayerControls
        playing={playing}
        current={current}
        duration={duration}
        muted={muted}
        captions={captions.version ? { on: captions.on, onToggle: captions.toggle } : null}
        onToggle={toggle}
        onSeek={seekTo}
        onMute={() => {
          if (video.current) video.current.muted = !video.current.muted;
        }}
        onFullscreen={() => void video.current?.requestFullscreen?.().catch(() => undefined)}
      />
    </div>
  );
}
