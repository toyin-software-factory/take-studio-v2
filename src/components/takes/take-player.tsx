"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { StageLetterbox } from "@/components/stage";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { mediaLinkSchema } from "@/lib/take-api";
import { callApi } from "./browser-io";
import { PlayerControls } from "./player-controls";
import { usePlayerKeys } from "./use-player-keys";

/** A fresh 1 hour play link, or an error. */
async function playLink(takeId: string): Promise<Link> {
  const reply = await callApi(`/api/takes/${takeId}/media?kind=play`, "GET").catch(() => null);
  const parsed = mediaLinkSchema.safeParse(reply?.data);
  return reply?.status === 200 && parsed.success
    ? { kind: "ready", url: parsed.data.url }
    : { kind: "error" };
}

type Link =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly url: string }
  | { readonly kind: "error" };

/**
 * The stage player (AC-9; design.md Video player): plays through a 1 hour signed link from
 * GET /api/takes/{id}/media?kind=play, in a 16:9 letterbox, with custom controls and keyboard
 * shortcuts (space or K play and pause, arrows seek 5 s, J and L seek 10 s). If the link has
 * expired, a fresh one is fetched once and playback resumes where it was.
 */
export function TakePlayer({ takeId }: { readonly takeId: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const resumeAt = useRef(0);
  const refreshed = useRef(false);
  const [link, setLink] = useState<Link>({ kind: "loading" });
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);

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
    if (v) v.currentTime = Math.min(Math.max(0, seconds), v.duration || 0);
  }, []);
  const seekBy = useCallback(
    (delta: number) => seekTo((video.current?.currentTime ?? 0) + delta),
    [seekTo],
  );
  const onKeyDown = usePlayerKeys(toggle, seekBy);

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
          playsInline
          preload="metadata"
          className="size-full object-contain"
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration);
            if (resumeAt.current > 0) e.currentTarget.currentTime = resumeAt.current;
          }}
          onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
          onError={() => {
            // Most likely the 1 hour link expired: get a new one once and carry on.
            if (refreshed.current) return setLink({ kind: "error" });
            refreshed.current = true;
            resumeAt.current = video.current?.currentTime ?? 0;
            fetchLink();
          }}
        />
      </StageLetterbox>
      <PlayerControls
        playing={playing}
        current={current}
        duration={duration}
        muted={muted}
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
