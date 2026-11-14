"use client";

import { useEffect, useState } from "react";
import { deviceChoices, type DeviceChoices } from "@/lib/recorder-devices";

const NONE: DeviceChoices = { cameras: [], microphones: [] };

/**
 * The cameras and microphones the browser lists (spec 0021 task 3). Labels only appear once
 * permission is granted, so the list is read again when a stream starts and whenever a device
 * is plugged in or out.
 */
export function useDevices(stream: MediaStream | null): DeviceChoices {
  const [choices, setChoices] = useState<DeviceChoices>(NONE);
  useEffect(() => {
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (!stream || !media?.enumerateDevices) {
      queueMicrotask(() => setChoices(NONE));
      return;
    }
    let live = true;
    const read = () =>
      void media
        .enumerateDevices()
        .then((devices) => live && setChoices(deviceChoices(devices)))
        .catch(() => undefined);
    read();
    media.addEventListener?.("devicechange", read);
    return () => {
      live = false;
      media.removeEventListener?.("devicechange", read);
    };
  }, [stream]);
  return choices;
}
