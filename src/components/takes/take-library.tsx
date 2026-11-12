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
  const [sessionEnded, setSessionEnded] = useState(false);
  const now = useNow(nowIso);

  const inFlight = takes.filter((t) => isInFlight(t.status)).map((t) => t.id);
  const pollKey = inFlight.join(",");

  const refresh = useCallback(async (): Promise<PollResult> => {
    const ids = pollKey.split(",").filter(Boolean);
    // Each request settles on its own: one that fails or times out counts as an error for the
    // backoff, and the others still update their cards.
    const replies = await Promise.all(
      ids.map((id) =>
        callApi(`/api/takes/${id}`, "GET").catch(() => ({ status: 0, data: null as unknown })),
      ),
    );
    if (replies.some((r) => r.status === 401)) {
      setSessionEnded(true);
      return "stop";
    }
    const gone = new Set(ids.filter((_, i) => replies[i]!.status === 404));
    // A 200 whose body is not a take is an error too, so polling backs off instead of asking
    // for the same bad answer every 5 s.
    const parsed = replies.map((r) =>
      r.status === 200 ? takeDetailSchema.safeParse(r.data) : null,
    );
    const fresh = new Map(
      parsed.flatMap((p) =>
        p?.success ? [[p.data.take.id, cardFromDetail(p.data)] as const] : [],
      ),
    );
    setTakes((list) => list.filter((t) => !gone.has(t.id)).map((t) => fresh.get(t.id) ?? t));
    const allGood = replies.every((r, i) => r.status === 404 || parsed[i]?.success === true);
    return allGood ? "continue" : "error";
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
      if (reply.status === 401) {
        setSessionEnded(true);
        return;
      }
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
      <div className="flex flex-col items-center gap-3 rounded-md bg-card px-6 py-12 text-center shadow-card">
        <Icon icon={Film} size="empty" className="text-muted-foreground" />
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
      {sessionEnded ? (
        <Alert variant="warning" title="Your session ended">
          Sign in again to see the latest on your takes.
          <div className="pt-2">
            {/* A full reload, not router.refresh(): it drops this page's state, so another creator
                who signed in meanwhile never sees these cards. */}
            <Button size="sm" onClick={() => window.location.reload()}>
              Sign in
            </Button>
          </div>
        </Alert>
      ) : null}
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
