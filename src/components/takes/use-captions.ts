"use client";

import { type RefObject, useCallback, useEffect, useState } from "react";
import { type PlayerBridge, useCaptionsVersion } from "./player-bridge";

/** Shows or hides the caption track; `hidden` keeps its cues loaded without drawing them. */
function setTrackMode(video: HTMLVideoElement | null, on: boolean): void {
  const track = video?.textTracks[0];
  if (track) track.mode = on ? "showing" : "hidden";
}

/**
 * Captions on the player (spec 0007, AC-5): `version` is the track's `?v=` (null until a ready
 * transcript with words exists, so there is no CC button before that). Off by default. The
 * track is kept `hidden` when off, so its cues still load but show nothing.
 */
export function useCaptions(
  bridge: PlayerBridge,
  video: RefObject<HTMLVideoElement | null>,
  playerReady: boolean,
) {
  const version = useCaptionsVersion(bridge);
  const [on, setOn] = useState(false);
  useEffect(() => {
    setTrackMode(video.current, on);
  }, [video, version, on, playerReady]);
  const toggle = useCallback(() => setOn((value) => !value), []);
  return { version, on, toggle };
}
