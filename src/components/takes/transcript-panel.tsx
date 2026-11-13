"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { visibleEdits } from "@/lib/transcript-fixes";
import { type PlayerBridge, useCurrentParagraph } from "./player-bridge";
import { TranscriptFixes } from "./transcript-fixes";
import { TranscriptDownloads } from "./transcript-downloads";
import { TranscriptParagraphs } from "./transcript-paragraphs";
import type { useTranscript } from "./use-transcript";

const PANEL = "flex flex-col gap-3";

const SKIPPED: Readonly<Record<string, string>> = {
  not_english: "Transcripts are English only for now",
  no_speech: "No speech found in this take",
  original_gone: "This take's video has expired, so a transcript can't be made",
};

/**
 * The transcript beside the stage (spec 0007, AC-2 to AC-5, AC-8 to AC-10, AC-12): making (with
 * polling), ready, ready with no words in the trimmed video, skipped with its reason, failed
 * with Try again, and none with Make transcript (or a plain note when it cannot be made).
 * The words, seek, downloads and the caption track version all come from one read.
 */
export function TranscriptPanel({
  takeId,
  bridge,
  transcript,
}: {
  readonly takeId: string;
  readonly bridge: PlayerBridge;
  /** The one read of the transcript, shared with the Export tab (see `TakeInspector`). */
  readonly transcript: ReturnType<typeof useTranscript>;
}) {
  const { view, loadError, stopped, starting, startError, make } = transcript;
  const edits = view?.state === "ready" ? visibleEdits(view) : [];
  const fixed = new Set(edits.filter((e) => !e.undone).map((e) => e.index));
  const paragraphs = view?.state === "ready" ? (view.paragraphs ?? []) : [];
  const current = useCurrentParagraph(
    bridge,
    paragraphs.map((p) => p.startMs),
  );

  // The player shows a caption track only for a ready transcript that has words.
  const captionsVersion =
    view?.state === "ready" && paragraphs.length > 0 ? (view.version ?? "1") : null;
  useEffect(() => {
    bridge.setCaptions(captionsVersion);
    return () => bridge.setCaptions(null);
  }, [bridge, captionsVersion]);

  const problem = loadError ? (
    <p role="alert" className="text-danger">
      We couldn&rsquo;t load the transcript. We&rsquo;ll keep trying.
    </p>
  ) : null;
  if (stopped) {
    // A 401 or 404 ends the checking for good, so say so and offer no retry.
    return (
      <section aria-labelledby="transcript-heading" className={PANEL}>
        <h2 id="transcript-heading" className="text-h3 font-medium">
          Transcript
        </h2>
        <p role="alert">
          We can&rsquo;t check on the transcript any more. Reload the page or sign in again.
        </p>
      </section>
    );
  }
  if (!view) return problem;

  const retryable = (view.state === "none" || view.state === "failed") && view.canMake;
  return (
    <section aria-labelledby="transcript-heading" className={PANEL}>
      <h2 id="transcript-heading" className="text-h3 font-medium">
        Transcript
      </h2>
      {problem}
      {view.state === "making" ? (
        <p role="status" className="flex items-center gap-2 text-muted-foreground">
          <Icon icon={Loader2} size="badge" className="animate-spin motion-reduce:animate-none" />
          Making your transcript
        </p>
      ) : null}
      {view.state === "none" && !view.canMake ? <p>No transcript for this take</p> : null}
      {view.state === "failed" ? <p>The transcript didn&rsquo;t finish</p> : null}
      {retryable ? (
        <Button type="button" onClick={() => void make()} loading={starting} className="w-fit">
          {view.state === "failed" ? "Try again" : "Make transcript"}
        </Button>
      ) : null}
      {startError ? (
        <p role="alert" className="text-danger">
          {startError}
        </p>
      ) : null}
      {view.state === "skipped" ? <p>{SKIPPED[view.reason ?? ""] ?? "No transcript"}</p> : null}
      {view.state === "ready" && paragraphs.length === 0 ? (
        <p>No words in the trimmed video</p>
      ) : null}
      {view.state === "ready" && paragraphs.length > 0 ? (
        <>
          <TranscriptDownloads takeId={takeId} version={view.version} />
          <TranscriptFixes
            edits={edits}
            busy={transcript.fixing}
            error={transcript.fixError}
            onSet={transcript.setEditUndone}
          />
          <div className="max-h-[32rem] overflow-y-auto">
            <TranscriptParagraphs
              paragraphs={paragraphs}
              current={current}
              onSeek={bridge.seek}
              fixed={fixed}
            />
          </div>
        </>
      ) : null}
    </section>
  );
}
