"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pause, Play } from "lucide-react";
import { type HomeImage, videoPath } from "./media";
import { Picture } from "./picture";

type TileVideoProps = {
  readonly title: string;
  readonly media: HomeImage;
  readonly width: number;
  readonly height: number;
};

/** Share of the tile that must be in view before it plays on a touch screen (recipe 7.9). */
const IN_VIEW_RATIO = 0.6;

/**
 * One capability tile (recipe 7.9): the poster, and over it a silent looping video that fades in.
 * With a mouse it plays while the pointer or keyboard focus is on the tile; on a touch screen it
 * plays while 60% of it is in view; under reduced motion it never starts by itself. Whatever
 * plays has a labelled play and pause button of at least 44 px (WCAG 2.2.2), and a pause the
 * visitor chooses is kept (`data-user-paused`) until they press play. Without scripts it keeps the
 * browser's controls. The sources load only when the video first plays (`preload="none"`).
 */
export function TileVideo({ title, media, width, height }: TileVideoProps) {
  const tile = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const enhanced = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  useEffect(() => {
    const box = tile.current;
    const el = video.current;
    if (!box || !el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");

    const start = () => {
      if (reduced.matches || el.dataset.userPaused) return;
      el.play().catch(() => undefined);
    };
    const stop = () => el.pause();

    const cleanups: (() => void)[] = [];
    const listen = (type: string, fn: () => void) => {
      box.addEventListener(type, fn);
      cleanups.push(() => box.removeEventListener(type, fn));
    };
    if (fine.matches) {
      listen("pointerenter", start);
      listen("pointerleave", stop);
      listen("focusin", start);
      listen("focusout", stop);
    } else {
      const io = new IntersectionObserver(
        ([entry]) => (entry && entry.intersectionRatio >= IN_VIEW_RATIO ? start() : stop()),
        { threshold: [0, IN_VIEW_RATIO] },
      );
      io.observe(box);
      cleanups.push(() => io.disconnect());
    }
    // Turning reduced motion on while the page is open stops what is playing.
    const onReduced = () => reduced.matches && el.pause();
    reduced.addEventListener("change", onReduced);
    cleanups.push(() => reduced.removeEventListener("change", onReduced));
    return () => cleanups.forEach((fn) => fn());
  }, []);

  const toggle = () => {
    const el = video.current;
    if (!el) return;
    if (el.paused) {
      delete el.dataset.userPaused;
      el.play().catch(() => undefined);
    } else {
      el.dataset.userPaused = "1";
      el.pause();
    }
  };

  return (
    <div
      ref={tile}
      className="h-tile-media"
      data-playing={playing}
      data-cursor="play"
      onClick={(event) => {
        // A click on the picture is the same as the button; the button handles its own click.
        if (!(event.target as HTMLElement).closest("button")) toggle();
      }}
    >
      <Picture
        name={media}
        alt=""
        sizes="(min-width: 1200px) 30vw, (min-width: 810px) 45vw, 92vw"
        className="h-tile-poster"
      />
      <video
        ref={video}
        controls={!enhanced}
        muted
        loop
        playsInline
        preload="none"
        aria-label={`${title}: short silent loop`}
        width={width}
        height={height}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      >
        <source src={videoPath(media as "tile-pauses", "webm")} type="video/webm" />
        <source src={videoPath(media as "tile-pauses", "mp4")} type="video/mp4" />
      </video>
      {enhanced ? (
        <button
          type="button"
          className="h-media-toggle h-tile-toggle"
          aria-label={playing ? `Pause the ${title} loop` : `Play the ${title} loop`}
          onClick={toggle}
        >
          {playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
        </button>
      ) : null}
    </div>
  );
}
