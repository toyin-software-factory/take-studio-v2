"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { TakeCard as TakeCardData } from "@/lib/take-api";
import { expiryNote, failureMessage, formatClock, isMediaFailure } from "@/lib/take-display";
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
  thumbUrl,
  now,
  onRetried,
}: {
  readonly take: TakeCardData;
  readonly thumbUrl: string | null;
  readonly now: Date;
  readonly onRetried: (id: string) => void;
}) {
  const { retry, pending } = useRetry(take.id, () => onRetried(take.id));
  const expiry = expiryNote(take.videoExpiresAt, take.expired, now);
  const failed = take.status === "failed";

  return (
    <li className="relative flex flex-col rounded-md bg-surface shadow-card transition-shadow focus-within:shadow-overlay hover:shadow-overlay">
      <TakeThumb src={thumbUrl} />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="text-body font-semibold">
          <Link
            href={`/takes/${take.id}`}
            className="line-clamp-2 rounded-sm outline-hidden after:absolute after:inset-0 after:rounded-md after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring focus-visible:after:outline-solid"
          >
            {take.title}
          </Link>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={take.status} />
          {take.durationMs !== null ? (
            <span className="mono text-small text-text-muted">
              <span className="sr-only">Length </span>
              {formatClock(take.durationMs)}
            </span>
          ) : null}
        </div>
        {failed ? <p className="text-small">{failureMessage(take)}</p> : null}
        {expiry ? <p className="text-small text-text-muted">{expiry}</p> : null}
        {failed ? (
          // Above the stretched link, so the button gets the click.
          <div className="relative mt-auto pt-1">
            {take.retryable ? (
              <Button size="sm" loading={pending} onClick={() => void retry()}>
                Try again
              </Button>
            ) : isMediaFailure(take.failureCode) ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => document.getElementById(UPLOAD_INPUT_ID)?.click()}
              >
                Upload another video
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
