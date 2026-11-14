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
import { MissedButton } from "./missed-button";
import { PlayerControls } from "./player-controls";
import { playerNotice } from "./player-notice";
import type { CutReview } from "./use-cut-review";
import { useRenderLink } from "./use-render-link";
import { type Resume, useSourceSwitch } from "./use-source-switch";
import { enterFullscreen } from "@/lib/fullscreen";
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
  review,
  durationMs,
}: {
  readonly takeId: string;
  /** The latest render's id: when it changes the video was made again (S3S-T13). */
  readonly renderId: string | null;
  readonly bridge: PlayerBridge;
  /** The cut review state: which source plays, the pending cuts to skip (spec 0011). */
  readonly review: CutReview;
  /** The original's length in ms (the timeline and the preview's end). */
  readonly durationMs: number;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const resume = useRef<Resume>({ at: 0, playing: false, refreshed: false });
  const { link, setLink, fetchLink, swapFailed, retrySwap, shownRanges } = useRenderLink(
    takeId,
    renderId,
    video,
    resume,
    review.renderRanges,
  );
  // A still covers the video: the transport is hidden and the video paused (S3S-T14).
  const preview = usePreviewOverlay(bridge);
  const stillShown = preview !== null;
  const source = useSourceSwitch(video, resume, review, durationMs, bridge, {
    mounted: link.kind === "ready",
    stillPreview: stillShown,
    renderRanges: shownRanges,
  });
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const captions = useCaptions(bridge, video, link.kind === "ready", source.active);
  const poster = usePoster(takeId).url;
  const controlsRef = useRef<HTMLDivElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);

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
  const { videoSecondsForRender } = source;
  useEffect(() => {
    bridge.setSeek((ms) => seekTo(videoSecondsForRender(ms)));
    return () => bridge.setSeek(null);
  }, [bridge, seekTo, videoSecondsForRender]);

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
          src={source.originalUrl ?? link.url}
          poster={poster ?? undefined}
          playsInline
          preload="metadata"
          className="size-full object-contain"
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => {
            setPlaying(false);
            // A pause while the new link is loading means: stay paused when it arrives.
            resume.current.playing = false;
          }}
          onTimeUpdate={(e) => {
            setCurrent(e.currentTarget.currentTime);
            source.publish();
          }}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            setDuration(v.duration);
            if (resume.current.at > 0) {
              v.currentTime = Math.min(resume.current.at, v.duration);
              resume.current.at = 0;
            }
            // A replacement link loads paused; carry on if it was playing when the link failed.
            if (resume.current.playing) void v.play().catch(() => undefined);
            resume.current.playing = false;
            resume.current.refreshed = false;
          }}
          onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
          onError={() => {
            const v = video.current;
            // Most likely the 1 hour link expired: get a new one once and carry on.
            if (resume.current.refreshed) {
              return source.active === "original"
                ? review.original.fail()
                : setLink({ kind: "error" });
            }
            resume.current.refreshed = true;
            resume.current.at = v?.currentTime ?? 0;
            resume.current.playing = v?.paused === false;
            if (source.active === "original") void review.original.refresh();
            else fetchLink();
          }}
        >
          {captions.version ? (
            <track
              key={`${captions.version}.${source.active}`}
              kind="captions"
              srcLang="en"
              label="English"
              src={`/api/takes/${takeId}/transcript/vtt?v=${encodeURIComponent(captions.version)}${source.active === "original" ? "&timeline=original" : ""}`}
            />
          ) : null}
        </video>
        <BackgroundPreviewOverlay bridge={bridge} />
      </StageLetterbox>
      {swapFailed ? (
        <p role="status" className="text-small text-stage-text-muted">
          A new version of this video is ready, but it didn&rsquo;t load.{" "}
          <button type="button" onClick={retrySwap} className="underline underline-offset-2">
            Try again
          </button>
        </p>
      ) : null}
      {/* The status region is always in the page so the line is announced when it fills. */}
      <div className={`flex flex-wrap items-center gap-3 ${preview ? "" : "-mb-3"}`}>
        <p role="status" className="min-w-0 flex-1 text-small">
          {preview ? previewStatusText(preview) : playerNotice(source.active, review.originalState)}
        </p>
        {!preview && review.originalState.kind === "failed" ? (
          <Button variant="secondary" onClick={() => review.original.retry()}>
            Try again
          </Button>
        ) : null}
        {preview ? (
          <Button ref={backButton} variant="secondary" onClick={() => bridge.back()}>
            Back to your video
          </Button>
        ) : null}
      </div>
      <div ref={controlsRef} hidden={stillShown} inert={stillShown}>
        <PlayerControls
          playing={playing}
          current={source.displayTime(current)}
          duration={source.displayDuration(duration)}
          muted={muted}
          captions={captions.version ? { on: captions.on, onToggle: captions.toggle } : null}
          onToggle={toggle}
          onSeek={(seconds) => seekTo(source.videoTime(seconds))}
          onMute={() => {
            if (video.current) video.current.muted = !video.current.muted;
          }}
          onFullscreen={() => void enterFullscreen(video.current)}
        />
        {/* Only on the finished video: on the original preview the time is not the edited time. */}
        {source.active === "render" ? (
          <div className="mt-3">
            <MissedButton
              takeId={takeId}
              playheadMs={() => (video.current?.currentTime ?? 0) * 1000}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
