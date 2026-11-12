"use client";

import type { TranscriptViewData } from "@/lib/take-api";
import { formatClock } from "@/lib/take-display";

type Paragraph = NonNullable<TranscriptViewData["paragraphs"]>[number];

/**
 * The words of a ready transcript (spec 0007, AC-2, AC-3, AC-12; design.md Transcript panel).
 * Each paragraph has a mono `m:ss` button (the one tab stop per paragraph, so a long transcript
 * stays usable by keyboard); clicking a word seeks too, for pointer users. Filler words are
 * underlined dotted; the paragraph being played has `aria-current`. Times are already on the
 * trimmed video.
 */
export function TranscriptParagraphs({
  paragraphs,
  current,
  onSeek,
}: {
  readonly paragraphs: readonly Paragraph[];
  readonly current: number | null;
  readonly onSeek: (ms: number) => void;
}) {
  return (
    <ol className="m-0 flex list-none flex-col gap-2 p-0">
      {paragraphs.map((p) => {
        const playing = p.startMs === current;
        return (
          <li
            key={p.startMs}
            aria-current={playing ? "true" : undefined}
            className={`flex max-w-[72ch] gap-3 rounded-md px-2 py-1 leading-[1.7] ${
              playing ? "bg-selected-surface" : ""
            }`}
          >
            <button
              type="button"
              onClick={() => onSeek(p.startMs)}
              aria-label={`Play from ${formatClock(p.startMs)}`}
              className="mono h-fit min-h-6 shrink-0 pointer-coarse:min-h-11 pointer-coarse:min-w-11 rounded-sm px-1 text-small text-muted-foreground underline-offset-2 outline-hidden hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
            >
              {formatClock(p.startMs)}
            </button>
            {/* Words seek on a pointer click; keyboard users have the timestamp button. */}
            <p
              className="m-0"
              onClick={(event) => {
                const start = (event.target as HTMLElement).closest<HTMLElement>("[data-start]")
                  ?.dataset.start;
                if (start !== undefined) onSeek(Number(start));
              }}
            >
              {p.words.map((word, i) => (
                <span key={`${word.startMs}-${i}`}>
                  {i > 0 ? " " : null}
                  <span
                    data-start={word.startMs}
                    className={`cursor-pointer rounded-sm hover:bg-hover-surface ${
                      word.filler ? "underline decoration-dotted underline-offset-4" : ""
                    }`}
                  >
                    {word.w}
                  </span>
                </span>
              ))}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
