import { getTranscriptByTake } from "@/db/data/transcripts";
import type { Executor } from "@/db/types";
import { type Result, err, ok } from "@/lib/result";
import { type TrimmedParagraph, toTrimmedTranscript } from "@/lib/transcript-timeline";
import { getForCreator } from "../takes";

/**
 * The transcript of one of the creator's takes on the trimmed timeline (spec 0007, AC-2, AC-4,
 * AC-10). Ownership is in the query, so another creator's take is `not_found`, the same as a
 * take with no transcript. Works on an expired take: the transcript outlives the video. The
 * words are personal data: callers return them to the owner and never log them.
 */

export type TrimmedTranscriptView = {
  readonly title: string;
  readonly paragraphs: readonly TrimmedParagraph[];
  /** Changes when the transcript or the latest render does (the track URL's `?v=`). */
  readonly version: string;
};

export async function getTrimmedForCreator(
  db: Executor,
  creatorId: string,
  takeId: string,
): Promise<Result<TrimmedTranscriptView, "not_found">> {
  const found = await getForCreator(db, creatorId, takeId);
  if (!found.ok) return err("not_found");
  const { take, latestRender } = found.data;
  const stored = await getTranscriptByTake(db, take.id);
  if (!stored) return err("not_found");

  const paragraphs = toTrimmedTranscript(stored.words, {
    // No latest render (a take handed back uncut) means nothing was removed.
    removedRanges: latestRender?.removedRanges ?? [],
    durationMs: take.durationMs ?? 0,
    sourceFps: stored.sourceFps,
  });
  return ok({
    title: take.title,
    paragraphs,
    version: `${stored.updatedAt.getTime()}.${latestRender?.id ?? "none"}`,
  });
}
