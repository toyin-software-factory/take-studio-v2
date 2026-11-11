"use client";

import { useCallback, useState } from "react";
import { useNow } from "./use-now";
import { Film } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  type TakeCard as TakeCardData,
  type TakeList,
  cardFromDetail,
  takeDetailSchema,
  takeListSchema,
} from "@/lib/take-api";
import { POLL, isInFlight } from "@/lib/take-display";
import { callApi } from "./browser-io";
import { TakeCard } from "./take-card";
import { UPLOAD_INPUT_ID } from "./upload-area";
import { usePoll, type PollResult } from "./use-poll";

/**
 * The creator's takes, newest first, 24 per page (AC-1), with "Show more takes" for the next
 * page. Cards of takes still uploading or processing refresh every 5 s while the tab is
 * visible (AC-8). Empty state: one sentence and one action (design.md Screen states).
 */
export function TakeLibrary({
  initial,
  nowIso,
}: {
  readonly initial: TakeList;
  readonly nowIso: string;
}) {
  const [takes, setTakes] = useState<readonly TakeCardData[]>(initial.takes);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const now = useNow(nowIso);

  const inFlight = takes.filter((t) => isInFlight(t.status)).map((t) => t.id);
  const pollKey = inFlight.join(",");

  const refresh = useCallback(async (): Promise<PollResult> => {
    const ids = pollKey.split(",").filter(Boolean);
    const replies = await Promise.all(ids.map((id) => callApi(`/api/takes/${id}`, "GET")));
    if (replies.some((r) => r.status === 401)) return "stop";
    const gone = new Set(ids.filter((_, i) => replies[i]!.status === 404));
    const fresh = new Map(
      replies.flatMap((r) => {
        const parsed = takeDetailSchema.safeParse(r.data);
        return r.status === 200 && parsed.success
          ? [[parsed.data.take.id, cardFromDetail(parsed.data)] as const]
          : [];
      }),
    );
    setTakes((list) => list.filter((t) => !gone.has(t.id)).map((t) => fresh.get(t.id) ?? t));
    return replies.every((r) => r.status === 200 || r.status === 404) ? "continue" : "error";
  }, [pollKey]);
  usePoll(refresh, POLL.cardMs, pollKey !== "");

  const onRetried = useCallback((id: string) => {
    setTakes((list) =>
      list.map((t) =>
        t.id === id ? { ...t, status: "processing", failureCode: null, retryable: false } : t,
      ),
    );
  }, []);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const reply = await callApi(`/api/takes?cursor=${encodeURIComponent(cursor)}`, "GET");
      const page = takeListSchema.safeParse(reply.data);
      if (reply.status !== 200 || !page.success) throw new Error("list failed");
      setTakes((list) => [
        ...list,
        ...page.data.takes.filter((t) => !list.some((s) => s.id === t.id)),
      ]);
      setCursor(page.data.nextCursor);
    } catch {
      setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  };

  if (takes.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md bg-surface px-6 py-12 text-center shadow-card">
        <Icon icon={Film} size="empty" className="text-text-muted" />
        <p>No takes yet. Upload your first video.</p>
        <Button onClick={() => document.getElementById(UPLOAD_INPUT_ID)?.click()}>
          Choose a video
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {takes.map((take) => (
          <TakeCard key={take.id} take={take} now={now} onRetried={onRetried} />
        ))}
      </ul>
      {moreError ? (
        <Alert variant="danger" title="More takes didn't load">
          Check your connection, then choose Show more takes again.
        </Alert>
      ) : null}
      {cursor ? (
        <Button
          variant="secondary"
          className="self-center"
          loading={loadingMore}
          onClick={() => void loadMore()}
        >
          Show more takes
        </Button>
      ) : null}
    </div>
  );
}
