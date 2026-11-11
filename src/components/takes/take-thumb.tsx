"use client";

import { useState } from "react";
import { Film } from "lucide-react";
import { Icon } from "@/components/ui/icon";

/**
 * A card's 16:9 thumbnail, or a placeholder when there is none or it fails to load (spec 0004,
 * Data model). Decorative: the card's title names the take.
 */
export function TakeThumb({ src }: { readonly src: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-t-md bg-stage-bg text-stage-text-muted">
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- images are unoptimized (spec 0001)
        <img
          src={src}
          alt=""
          loading="lazy"
          className="size-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon icon={Film} size="empty" />
      )}
    </div>
  );
}
