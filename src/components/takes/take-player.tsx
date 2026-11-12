"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { StageLetterbox } from "@/components/stage";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { BackgroundPreviewOverlay } from "./background-preview-overlay";
import { previewStatusText } from "@/lib/take-display";
import { type PlayerBridge, usePreviewOverlay } from "./player-bridge";
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
  renderId,
  bridge,
}: {
  readonly takeId: string;
  /** The latest render's id: when it changes the video was made again (S3S-T13). */
  readonly renderId: string | null;
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
  const poster = usePoster(takeId).url;
  const shownRender = useRef(renderId);
  const controlsRef = useRef<HTMLDivElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  // A still covers the video: the transport is hidden and the video paused (S3S-T14).
  const preview = usePreviewOverlay(bridge);
  const stillShown = preview !== null;
  const retrySwap = useRef<() => void>(() => undefined);
  const [swapFailed, setSwapFailed] = useState(false);

  const fetchLink = useCallback(() => {
    void playLink(takeId).then(setLink);
  }, [takeId]);

  useEffect(() => {
    let live = true;
    // A new render (a background change finished, here or in another tab): fetch its link and
    // swap the source without a reload, resuming where the viewer was and keeping paused or
    // playing. The video element stays mounted, so only `src` changes.
    const swapping = shownRender.current !== renderId;
    shownRender.current = renderId;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = (retriesLeft: number) => {
      void playLink(takeId).then((next) => {
        if (!live) return;
        const playing = video.current;
        // A swap that cannot get its link leaves the working video alone: try again a few
        // times, then say so with a button (the new link is applied only once it is in hand).
        if (swapping && playing && next.kind !== "ready") {
          if (retriesLeft > 0) timer = setTimeout(() => attempt(retriesLeft - 1), 3000);
          else setSwapFailed(true);
          return;
        }
        // Read the position and the state now, just before the source changes: the viewer may
        // have played on, paused or pressed play while the link was being fetched.
        if (swapping && playing) {
          resumeAt.current = playing.currentTime;
          resumePlaying.current = !playing.paused;
          refreshed.current = false;
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
  }, [takeId, renderId]);

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
  const playerKeys = usePlayerKeys(toggle, seekBy);
  // No shortcuts while a still covers the video: they would act on a video nobody can see.
  const onKeyDown = stillShown ? undefined : playerKeys;
  // The transcript panel seeks through the bridge (times on the trimmed video, in ms).
  useEffect(() => {
    bridge.setSeek((ms) => seekTo(ms / 1000));
    return () => bridge.setSeek(null);
  }, [bridge, seekTo]);

  // Runs before the browser paints, while focus is still where it was: a control that is about
  // to be hidden hands focus to "Back to your video" so it is never left on a hidden button.
  useLayoutEffect(() => {
    if (!stillShown) return;
    video.current?.pause();
    if (controlsRef.current?.contains(document.activeElement)) backButton.current?.focus();
  }, [stillShown]);

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
      <StageLetterbox className="relative">
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
            if (resumeAt.current > 0) {
              e.currentTarget.currentTime = Math.min(resumeAt.current, e.currentTarget.duration);
              resumeAt.current = 0;
            }
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
        <BackgroundPreviewOverlay bridge={bridge} />
      </StageLetterbox>
      {swapFailed ? (
        <p role="status" className="text-small text-stage-text-muted">
          A new version of this video is ready, but it didn&rsquo;t load.{" "}
          <button
            type="button"
            onClick={() => retrySwap.current()}
            className="underline underline-offset-2"
          >
            Try again
          </button>
        </p>
      ) : null}
      {/* The status region is always in the page so the line is announced when it fills. */}
      <div className={`flex flex-wrap items-center gap-3 ${preview ? "" : "-mb-3"}`}>
        <p role="status" className="min-w-0 flex-1 text-small">
          {preview ? previewStatusText(preview) : null}
        </p>
        {preview ? (
          <Button ref={backButton} variant="secondary" onClick={() => bridge.back()}>
            Back to your video
          </Button>
        ) : null}
      </div>
      <div ref={controlsRef} hidden={stillShown} inert={stillShown}>
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
    </div>
  );
}
