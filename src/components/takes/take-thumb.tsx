"use client";

import { useEffect, useRef, useState } from "react";
import { Film } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { mediaLinkSchema } from "@/lib/take-api";
import { callApi } from "./browser-io";

/**
 * A card's 16:9 thumbnail (spec 0004, Data model). Once the card scrolls near the viewport it
 * asks GET /api/takes/{id}/media?kind=thumb for a 1 hour link; with no file, no link or an
 * image that fails to load it keeps the placeholder. Decorative: the title names the take.
 */
export function TakeThumb({
  takeId,
  available,
}: {
  readonly takeId: string;
  /** False while there can be no thumbnail yet (still uploading) or any more (expired). */
  readonly available: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!available || !el || src) return;
    let live = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        void callApi(`/api/takes/${takeId}/media?kind=thumb`, "GET")
          .then((reply) => {
            const link = mediaLinkSchema.safeParse(reply.data);
            if (live && reply.status === 200 && link.success) setSrc(link.data.url);
          })
          .catch(() => undefined);
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [takeId, available, src]);

  return (
    <div
      ref={box}
      className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-t-md bg-stage-bg text-stage-text-muted"
    >
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- images are unoptimized (spec 0001)
        <img
          src={src}
          alt=""
          className="size-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon icon={Film} size="empty" />
      )}
    </div>
  );
}
