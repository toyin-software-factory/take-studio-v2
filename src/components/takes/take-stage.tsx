"use client";

import Link from "next/link";
import { CircleAlert, Clock } from "lucide-react";
import { Stage, StageLetterbox } from "@/components/stage";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { TakeDetail } from "@/lib/take-api";
import { expiryNote, failureMessage } from "@/lib/take-display";
import type { PlayerBridge } from "./player-bridge";
import { ProcessingSteps } from "./processing-steps";
import { TakePlayer } from "./take-player";
import { useRetry } from "./use-retry";

/** A message in the middle of the stage, in the player's 16:9 box. */
function StageMessage({
  icon,
  title,
  children,
}: {
  readonly icon: typeof Clock;
  readonly title: string;
  readonly children?: React.ReactNode;
}) {
  return (
    <StageLetterbox className="flex-col gap-3 px-4 text-center">
      <Icon icon={icon} size="empty" className="text-stage-text-muted" />
      <h2 className="text-h3 font-semibold">{title}</h2>
      {children}
    </StageLetterbox>
  );
}

function Failed({
  detail,
  onRetried,
}: {
  readonly detail: TakeDetail;
  readonly onRetried: () => void;
}) {
  const { take } = detail;
  const { retry, pending } = useRetry(take.id, onRetried);
  return (
    <StageMessage icon={CircleAlert} title="This take didn't finish">
      <p role="alert" className="max-w-prose text-stage-text-muted">
        {failureMessage(take, take.retryable)}
      </p>
      {take.retryable ? (
        <Button loading={pending} onClick={() => void retry()}>
          Try again
        </Button>
      ) : (
        <Button asChild>
          <Link href="/">Upload another video</Link>
        </Button>
      )}
    </StageMessage>
  );
}

/**
 * The dark stage of the take page (AC-8 to AC-10; design.md Light app, dark stage): step
 * progress while uploading or processing, the player when ready, the failure with its action,
 * or the expiry note once the video is gone.
 */
export function TakeStage({
  detail,
  bridge,
  onRetried,
}: {
  readonly detail: TakeDetail;
  readonly bridge: PlayerBridge;
  readonly onRetried: () => void;
}) {
  const { take, latestJob } = detail;
  const label = take.status === "ready" && !take.expired ? "Player" : "Processing";
  return (
    <Stage label={label}>
      {take.expired || take.status === "expired" ? (
        <StageMessage
          icon={Clock}
          title={expiryNote(take.videoExpiresAt, true, new Date()) ?? "Video expired"}
        >
          <p className="text-stage-text-muted">Videos are kept for 30 days.</p>
        </StageMessage>
      ) : take.status === "ready" ? (
        <TakePlayer takeId={take.id} renderId={detail.latestRender?.id ?? null} bridge={bridge} />
      ) : take.status === "failed" ? (
        <Failed detail={detail} onRetried={onRetried} />
      ) : (
        <ProcessingSteps status={take.status} steps={latestJob?.steps ?? []} />
      )}
    </Stage>
  );
}
