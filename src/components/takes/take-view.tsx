"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Icon } from "@/components/ui/icon";
import { type TakeDetail, takeDetailSchema } from "@/lib/take-api";
import {
  POLL,
  backgroundChangeActive,
  isInFlight,
  keepPolling,
  tabTitle,
} from "@/lib/take-display";
import { callApi } from "./browser-io";
import { createPlayerBridge } from "./player-bridge";
import { EmailSwitch } from "./email-switch";
import { TakeHeader } from "./take-header";
import { TakeResult } from "./take-result";
import { TakeSkeleton } from "./take-skeleton";
import { TakeStage } from "./take-stage";
import { BackgroundChange } from "./background-change";
import { TranscriptPanel } from "./transcript-panel";
import { usePoll, type PollResult } from "./use-poll";

type Stop = "signed_out" | "not_found" | null;

/**
 * The live take page (AC-8 to AC-10): reads GET /api/takes/{id} at once, then every 2 s while
 * the take is uploading or processing and the tab is visible (spec 0004, Flow step 7); backs
 * off on errors and stops on a final status, 401 or 404. Keeps the tab title current.
 */
export function TakeView({
  takeId,
  initialTitle,
  initialStatus,
  takeEmails,
}: {
  readonly takeId: string;
  readonly initialTitle: string;
  readonly initialStatus: string;
  /** Saved "email me when takes are ready" setting (spec 0006, AC-6). */
  readonly takeEmails: boolean;
}) {
  const [detail, setDetail] = useState<TakeDetail | null>(null);
  const [stop, setStop] = useState<Stop>(null);
  const [failures, setFailures] = useState(0);
  // What the player and the transcript panel share (time, seek, caption track).
  const [bridge] = useState(createPlayerBridge);

  const load = useCallback(async (): Promise<PollResult> => {
    const reply = await callApi(`/api/takes/${takeId}`, "GET").catch(() => null);
    const parsed = takeDetailSchema.safeParse(reply?.data);
    if (reply?.status === 401 || reply?.status === 404) {
      setStop(reply.status === 401 ? "signed_out" : "not_found");
      return "stop";
    }
    if (reply?.status !== 200 || !parsed.success) {
      setFailures((n) => n + 1);
      return "error";
    }
    setFailures(0);
    setDetail(parsed.data);
    // A background change leaves the take Ready, so keep checking while it runs (spec 0008). A
    // ready take is also checked now and then (`POLL.idleMs`) so a page left open, or a second
    // tab, picks up a change finished somewhere else (S3S-T13).
    return keepPolling(parsed.data) ? "continue" : "stop";
  }, [takeId]);

  const status = detail?.take.status ?? initialStatus;
  const title = detail?.take.title ?? initialTitle;
  const polling = detail === null || keepPolling(detail);
  const idle =
    detail !== null && !isInFlight(status) && !backgroundChangeActive(detail.backgroundJob);
  usePoll(load, idle ? POLL.idleMs : POLL.takeMs, stop === null && polling, {
    immediate: true,
  });

  useEffect(() => {
    document.title = tabTitle(status, title);
  }, [status, title]);

  const onRetried = useCallback(() => {
    setDetail((d) =>
      d
        ? {
            ...d,
            take: { ...d.take, status: "processing", failureCode: null, retryable: false },
            latestJob: null,
          }
        : d,
    );
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/"
        className="inline-flex w-fit items-center gap-1 rounded-sm text-small font-medium underline underline-offset-2 outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
      >
        <Icon icon={ArrowLeft} size="badge" />
        Your takes
      </Link>
      {stop === "signed_out" ? (
        <Alert variant="danger" title="You've been signed out">
          <Link href="/" className="underline underline-offset-2">
            Sign in again
          </Link>{" "}
          to see this take.
        </Alert>
      ) : null}
      {stop === "not_found" ? (
        <Alert variant="danger" title="We couldn't find that take">
          It may have been deleted. Your other takes are in your library.
        </Alert>
      ) : null}
      {failures >= 3 ? (
        <Alert variant="warning" title="Having trouble checking on this take">
          We&rsquo;ll keep trying. Check your connection.
        </Alert>
      ) : null}
      {detail ? (
        <>
          <TakeHeader
            take={detail.take}
            onRenamed={(t) => setDetail((d) => (d ? { ...d, take: t } : d))}
          />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
            <div className="flex min-w-0 flex-col gap-6">
              <TakeStage detail={detail} bridge={bridge} onRetried={onRetried} />
              <TakeResult detail={detail} />
              <BackgroundChange
                detail={detail}
                bridge={bridge}
                onStarted={(target) =>
                  setDetail((d) =>
                    d
                      ? {
                          ...d,
                          backgroundJob: {
                            status: "queued",
                            failureCode: null,
                            targetBackgroundId: target,
                          },
                        }
                      : d,
                  )
                }
                onUncertain={() => load()}
                onStale={() => void load()}
              />
            </div>
            {detail.take.status === "ready" || detail.take.status === "expired" ? (
              <TranscriptPanel takeId={detail.take.id} bridge={bridge} />
            ) : null}
          </div>
          <EmailSwitch initial={takeEmails} />
        </>
      ) : stop === null ? (
        <TakeSkeleton title={initialTitle} />
      ) : null}
    </div>
  );
}
