"use client";

import { useCallback, useRef, useState, type RefObject } from "react";
import { stillAvailable } from "@/lib/recorder-devices";
import { openMedia } from "./recorder-media";
import type { useDevices } from "./use-devices";

type Inputs = {
  devices: ReturnType<typeof useDevices>;
  cameraId: string | null;
  micId: string | null;
  commit: (media: MediaStream) => void;
  mounted: RefObject<boolean>;
  kindNow: RefObject<string>;
  live: RefObject<MediaStream | null>;
};

/**
 * Switch camera or microphone while the preview is on. A device that has gone away falls
 * back to the browser's default. Some phones open one camera at a time: if the new one is
 * refused, the current one is let go and the request is tried again, and if that also
 * fails the old devices come back with a message (never a silent nothing).
 */
export function useChooseDevices({
  devices,
  cameraId,
  micId,
  commit,
  mounted,
  kindNow,
  live,
}: Inputs) {
  /** Counts device changes, so only the newest answer is used. */
  const selection = useRef(0);
  const [deviceNote, setDeviceNote] = useState<string | null>(null);
  /** True while a device change is in flight: the old stream may already be let go. */
  const [switching, setSwitching] = useState(false);

  const choose = useCallback(
    async (camera: string | null, mic: string | null) => {
      const mine = ++selection.current;
      const next = {
        camera: stillAvailable(devices.cameras, camera),
        mic: stillAvailable(devices.microphones, mic),
      };
      const previous = { camera: cameraId, mic: micId };
      // A result that arrives after Record was pressed (or after a newer change) is dropped.
      const current = () =>
        mounted.current && selection.current === mine && kindNow.current === "ready";
      const settle = (media: MediaStream): boolean => {
        if (!current()) {
          media.getTracks().forEach((track) => track.stop());
          return false;
        }
        commit(media);
        return true;
      };
      setDeviceNote(null);
      setSwitching(true);
      try {
        try {
          settle(await openMedia(next.camera, next.mic));
          return;
        } catch {
          if (!current()) return;
        }
        try {
          live.current?.getTracks().forEach((track) => track.stop());
          settle(await openMedia(next.camera, next.mic));
          return;
        } catch {
          if (!current()) return;
        }
        try {
          settle(await openMedia(previous.camera, previous.mic));
          if (current()) setDeviceNote("That camera or microphone could not be turned on.");
        } catch {
          if (!current()) return;
          setDeviceNote(
            "Neither the new nor the previous camera or microphone could be turned on. Choose again.",
          );
        }
      } finally {
        // Only the newest change decides when switching is over.
        if (mounted.current && selection.current === mine) setSwitching(false);
      }
    },
    [devices, cameraId, micId, commit, mounted, kindNow, live],
  );

  return { choose, deviceNote, setDeviceNote, switching };
}
