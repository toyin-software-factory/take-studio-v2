"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { RecordedTake } from "@/lib/recorder-state";
import { formatClock } from "@/lib/take-display";

/**
 * The review step (AC-1, AC-7): watch the take, then "Use this take", "Record again" or "Save
 * to your device". A failed upload keeps the take here with the message and a retry.
 */
export function RecordReview({
  take,
  failure,
  onUse,
  onAgain,
}: {
  readonly take: RecordedTake;
  readonly failure: string | null;
  readonly onUse: () => void;
  readonly onAgain: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const made = URL.createObjectURL(take.blob);
    queueMicrotask(() => setUrl(made));
    return () => URL.revokeObjectURL(made);
  }, [take.blob]);

  return (
    <div className="flex flex-col gap-4">
      {take.note ? (
        <Alert variant="warning" title="Recording stopped early">
          {take.note}
        </Alert>
      ) : null}
      {failure ? (
        <Alert variant="danger" title="This take wasn't uploaded">
          {failure} Your recording is still here.
        </Alert>
      ) : null}
      {url ? (
        <video
          src={url}
          controls
          playsInline
          aria-label="Your recording"
          className="aspect-video w-full rounded-lg bg-dark"
        />
      ) : null}
      <p className="mono text-small text-muted-foreground">{formatClock(take.durationMs)}</p>
      <div className="flex flex-wrap gap-3">
        <Button size="lg" onClick={onUse}>
          {failure ? "Try again" : "Use this take"}
        </Button>
        <Button size="lg" variant="secondary" onClick={onAgain}>
          Record again
        </Button>
        {url ? (
          <Button size="lg" variant="secondary" asChild>
            <a href={url} download={take.fileName}>
              <Icon icon={Download} /> Save to your device
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
