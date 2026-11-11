"use client";

import { useCallback, useState } from "react";
import { type TranscriptViewData, transcriptViewSchema } from "@/lib/take-api";
import { POLL } from "@/lib/take-display";
import { callApi } from "./browser-io";
import { usePoll, type PollResult } from "./use-poll";

const SKIPPED: Readonly<Record<string, string>> = {
  not_english: "Transcripts are English only for now",
  no_speech: "No speech found in this take",
  original_gone: "This take's video has expired, so a transcript can't be made",
};

/** `m:ss` of a time in milliseconds (floored). */
function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The transcript under a ready take (spec 0007, slice 2 thread): plain paragraphs, each with its
 * timestamp on the trimmed video. Reads GET /api/takes/{id}/transcript and polls every 2 s
 * while it is being made. The full panel (trimmed times, seek, downloads) comes later.
 */
export function TranscriptPanel({ takeId }: { readonly takeId: string }) {
  const [view, setView] = useState<TranscriptViewData | null>(null);
  const [stopped, setStopped] = useState(false);

  const load = useCallback(async (): Promise<PollResult> => {
    const reply = await callApi(`/api/takes/${takeId}/transcript`, "GET").catch(() => null);
    const parsed = transcriptViewSchema.safeParse(reply?.data);
    if (reply?.status === 401 || reply?.status === 404) {
      setStopped(true);
      return "stop";
    }
    if (reply?.status !== 200 || !parsed.success) return "error";
    setView(parsed.data);
    return parsed.data.state === "making" ? "continue" : "stop";
  }, [takeId]);

  usePoll(load, POLL.takeMs, !stopped && (view === null || view.state === "making"), {
    immediate: true,
  });

  if (!view) return null;
  return (
    <section aria-labelledby="transcript-heading" className="flex flex-col gap-3">
      <h2 id="transcript-heading" className="text-h3 font-semibold">
        Transcript
      </h2>
      {view.state === "making" ? <p role="status">Making your transcript</p> : null}
      {view.state === "none" ? <p>No transcript for this take</p> : null}
      {view.state === "failed" ? <p>The transcript didn&rsquo;t finish</p> : null}
      {view.state === "skipped" ? <p>{SKIPPED[view.reason ?? ""] ?? "No transcript"}</p> : null}
      {view.state === "ready" && view.paragraphs?.length === 0 ? (
        <p>No words in this transcript</p>
      ) : null}
      {view.state === "ready"
        ? (view.paragraphs ?? []).map((p) => (
            <div key={p.startMs} className="flex max-w-[72ch] gap-3 leading-[1.7]">
              <span className="font-mono text-small text-muted-foreground">{clock(p.startMs)}</span>
              <p>{p.words.map((w) => w.w).join(" ")}</p>
            </div>
          ))
        : null}
    </section>
  );
}
