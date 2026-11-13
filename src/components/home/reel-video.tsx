"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { Pause, Play } from "lucide-react";
import { REEL } from "./content";
import { imagePath, largestWidth, videoPath } from "./media";

/**
 * The reel video with its own play and pause button (WCAG 2.2.2). Without scripts it keeps the
 * browser's controls. Once the page has hydrated the native controls give way to the button,
 * which is named for what it will do and is at least 44 px. A pause the visitor chooses is kept
 * in `data-user-paused`, so the scroll driven autoplay (`motion/reel.ts`) never restarts it.
 */
export function ReelVideo() {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const enhanced = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

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
    <>
      <video
        ref={video}
        controls={!enhanced}
        muted
        loop
        playsInline
        preload="none"
        poster={imagePath("reel-poster", largestWidth("reel-poster"), "jpg")}
        aria-label={REEL.label}
        data-check="s2-reel-media"
        width={1280}
        height={720}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      >
        <source src={videoPath("reel", "webm")} type="video/webm" />
        <source src={videoPath("reel", "mp4")} type="video/mp4" />
      </video>
      {enhanced ? (
        <button
          type="button"
          className="h-media-toggle h-reel-toggle"
          aria-label={playing ? "Pause the reel" : "Play the reel"}
          data-check="s2-reel-cta"
          onClick={toggle}
        >
          {playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
        </button>
      ) : null}
    </>
  );
}
