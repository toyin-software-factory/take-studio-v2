"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { type TakeDetail, takeDetailSchema } from "@/lib/take-api";
import {
  POLL,
  backgroundChangeActive,
  effectiveStatus,
  isInFlight,
  keepPolling,
  tabTitle,
} from "@/lib/take-display";
import { usePublishCurrentTake } from "@/components/shell/current-take";
import { DELETED_PARAM } from "@/lib/take-delete";
import { callApi } from "./browser-io";
import { DeleteTakeDialog } from "./delete-take-dialog";
import { createPlayerBridge } from "./player-bridge";
import { TakeHeader } from "./take-header";
import { TakeResult } from "./take-result";
import { TakeSkeleton } from "./take-skeleton";
import { useCutReview } from "./use-cut-review";
import { useLeaveGuard } from "./use-leave-guard";
import { TakeStage } from "./take-stage";
import { TakeInspector } from "./take-inspector";
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
  takeEmails: savedEmails,
}: {
  readonly takeId: string;
  readonly initialTitle: string;
  readonly initialStatus: string;
  /** Saved "email me when takes are ready" setting (spec 0006, AC-6). */
  readonly takeEmails: boolean;
}) {
  const [detail, setDetail] = useState<TakeDetail | null>(null);
  // The email setting lives here, above the inspector, so a change saved while the take was
  // processing is still shown after the inspector swaps to its ready tabs.
  const [takeEmails, setTakeEmails] = useState(savedEmails);
  const [stop, setStop] = useState<Stop>(null);
  const [failures, setFailures] = useState(0);
  // What the player and the transcript panel share (time, seek, caption track).
  const [bridge] = useState(createPlayerBridge);
  // The delete dialog (spec 0013 AC-4): opened from the header menu or the Details tab; focus
  // goes back to whichever control opened it. Once deleted, polling stops for good.
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [gone, setGone] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const openDelete = useCallback((from: HTMLElement | null) => {
    opener.current = from;
    setDeleteOpen(true);
  }, []);

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
  const review = useCutReview(detail, load, takeId);
  useLeaveGuard(review.unsent);
  const polling = detail === null || keepPolling(detail);
  const idle =
    detail !== null && !isInFlight(status) && !backgroundChangeActive(detail.backgroundJob);
  usePoll(load, idle ? POLL.idleMs : POLL.takeMs, stop === null && !gone && polling, {
    immediate: true,
  });

  useEffect(() => {
    document.title = tabTitle(status, title);
  }, [status, title]);
  // The top bar's breadcrumb and chip follow the live take (a rename, processing to ready).
  usePublishCurrentTake(
    title,
    detail
      ? effectiveStatus(
          detail.take.status,
          detail.take.videoExpiresAt,
          detail.take.expired,
          new Date(),
        )
      : status,
  );

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
      {stop === "signed_out" ? (
        <Alert variant="danger" title="You've been signed out">
          <Link href="/library" className="underline underline-offset-2">
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
            onDelete={openDelete}
          />
          <div className="grid gap-6 min-[1200px]:grid-cols-[minmax(0,1fr)_380px] min-[1200px]:items-start">
            <div className="flex min-w-0 flex-col gap-5">
              <TakeStage detail={detail} bridge={bridge} review={review} onRetried={onRetried} />
              <TakeResult detail={detail} />
            </div>
            <TakeInspector
              detail={detail}
              bridge={bridge}
              takeEmails={takeEmails}
              onEmailsSaved={setTakeEmails}
              review={review}
              onDelete={openDelete}
            />
          </div>
          <DeleteTakeDialog
            takeId={takeId}
            title={detail.take.title}
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            returnFocus={() => opener.current}
            onDeleted={() => {
              setGone(true);
              router.push(`/library?${DELETED_PARAM}=1`);
            }}
          />
        </>
      ) : stop === null ? (
        <TakeSkeleton title={initialTitle} />
      ) : null}
    </div>
  );
}
