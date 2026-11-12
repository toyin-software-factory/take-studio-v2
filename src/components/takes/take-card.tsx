"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { TakeCard as TakeCardData } from "@/lib/take-api";
import { effectiveStatus, expiryNote, failureMessage, formatClock } from "@/lib/take-display";
import { StatusBadge } from "./status-badge";
import { TakeThumb } from "./take-thumb";
import { UPLOAD_INPUT_ID } from "./upload-area";
import { useRetry } from "./use-retry";

/**
 * One take in the library (AC-1, AC-10; design.md Take card): 16:9 thumbnail, title (the link
 * to the take page, stretched over the card), duration in mono, status badge, expiry note. A
 * failed take shows its friendly message and "Try again" or "Upload another video".
 */
export function TakeCard({
  take,
  now,
  onRetried,
}: {
  readonly take: TakeCardData;
  readonly now: Date;
  readonly onRetried: (id: string) => void;
}) {
  const { retry, pending } = useRetry(take.id, () => onRetried(take.id));
  const status = effectiveStatus(take.status, take.videoExpiresAt, take.expired, now);
  const expired = take.expired || status === "expired";
  const expiry = expiryNote(take.videoExpiresAt, expired, now);
  const failed = status === "failed";

  return (
    <li className="group relative flex flex-col gap-3">
      <TakeThumb takeId={take.id} available={status !== "uploading" && !expired} status={status} />
      <div className="flex flex-1 flex-col gap-2">
        <h3 className="text-h4">
          <Link
            href={`/takes/${take.id}`}
            className="line-clamp-2 rounded-sm outline-hidden after:absolute after:inset-0 after:rounded-md after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring focus-visible:after:outline-solid"
          >
            {take.title}
          </Link>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={status} />
          {take.durationMs !== null ? (
            <span className="mono text-small text-muted-foreground">
              <span className="sr-only">Length </span>
              {formatClock(take.durationMs)}
            </span>
          ) : null}
        </div>
        {failed ? <p className="text-small">{failureMessage(take, take.retryable)}</p> : null}
        {expiry ? <p className="text-small text-muted-foreground">{expiry}</p> : null}
        {failed ? (
          // Above the stretched link, so the button gets the click.
          <div className="relative mt-auto pt-1">
            {take.retryable ? (
              <Button size="sm" loading={pending} onClick={() => void retry()}>
                Try again
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => document.getElementById(UPLOAD_INPUT_ID)?.click()}
              >
                Upload another video
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </li>
  );
}
