"use client";

import { Loader2 } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { type PlayerBridge, usePreviewOverlay } from "./player-bridge";

/**
 * The still of the take on a background, shown over the video on the stage while the creator
 * tries one (spec 0008, AC-4). The video keeps playing underneath. A chip says it is a preview,
 * not the finished video; while the still is made a scrim with a spinner covers the stage.
 */
export function BackgroundPreviewOverlay({ bridge }: { readonly bridge: PlayerBridge }) {
  const preview = usePreviewOverlay(bridge);
  if (!preview) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center bg-stage-bg"
      aria-live="polite"
    >
      {preview.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- a presigned R2 link
        <img
          src={preview.url}
          alt={`Preview of your take on ${preview.label}`}
          className="size-full object-contain"
        />
      ) : (
        <p role="status" className="flex items-center gap-2 text-stage-text">
          <Icon icon={Loader2} size="ui" className="animate-spin motion-reduce:animate-none" />
          Making a preview with {preview.label}
        </p>
      )}
      <span className="absolute top-2 left-2 rounded-sm bg-stage-raised px-2 py-1 text-small text-stage-text">
        Preview, not your video yet
      </span>
    </div>
  );
}
