import { type TranscriptEdit, type TranscriptWord, editedWords } from "./transcript-rules";
import type { TrimmedParagraph, TrimmedWord } from "./transcript-timeline-types";
import { alignToFrames, keepRanges, type Range } from "./trim";

export type TimelineOptions = {
  /** `render.removed_ranges` of the latest render; empty when the take was handed back uncut. */
  readonly removedRanges: readonly Range[];
  readonly durationMs: number;
  /** `transcript.source_fps`; null when unknown (the render then assumes 30). */
  readonly sourceFps: number | null;
  /** AI fixes (spec 0012): the shown word text is `editedWords(words, edits)`. */
  readonly edits?: readonly TranscriptEdit[];
};

/**
 * Maps stored words onto the trimmed video. A word is kept when its midpoint falls inside a keep
 * range; its times are its offset inside the concatenated keep ranges, clamped to its own keep
 * range, never going backwards, with `endMs > startMs`. A paragraph starts at its first kept word
 * and a paragraph with no kept words disappears.
 */
export function toTrimmedTranscript(
  storedWords: readonly TranscriptWord[],
  options: TimelineOptions,
): TrimmedParagraph[] {
  const { removedRanges, durationMs, sourceFps } = options;
  const words = editedWords(storedWords, options.edits ?? []);
  if (!(durationMs > 0)) return [];
  const keep = alignToFrames(keepRanges(removedRanges, durationMs), sourceFps);
  if (keep.length === 0) return [];

  // Where each keep range starts on the trimmed timeline. Summed once, so many cuts never drift.
  const offsets: number[] = [];
  let sum = 0;
  for (const range of keep) {
    offsets.push(sum);
    sum += range.endMs - range.startMs;
  }

  // Paragraph membership follows the input order (the flags say where a paragraph starts).
  const paragraphOf = words.map((word, index) => (word.para || index === 0 ? 1 : 0));
  let paragraph = -1;
  const groupOf = paragraphOf.map((starts) => {
    paragraph += starts;
    return paragraph;
  });

  // Times follow the original take: walk the words chronologically (a stable sort), so a word
  // out of order keeps its own time, while the trimmed times never go backwards.
  const chronological = words
    .map((word, index) => ({ word, index }))
    .sort((a, b) => a.word.startMs - b.word.startMs || a.word.endMs - b.word.endMs);
  const groups: TrimmedWord[][] = Array.from({ length: paragraph + 1 }, () => []);
  let lastStart = 0;
  for (const { word, index } of chronological) {
    const mid = (word.startMs + word.endMs) / 2;
    const at = keep.findIndex((range) => mid >= range.startMs && mid < range.endMs);
    const range = keep[at];
    const offset = offsets[at];
    if (range === undefined || offset === undefined) continue;
    const clamp = (ms: number) => Math.min(Math.max(ms, range.startMs), range.endMs);
    const startMs = Math.max(Math.round(offset + clamp(word.startMs) - range.startMs), lastStart);
    const endMs = Math.max(Math.round(offset + clamp(word.endMs) - range.startMs), startMs + 1);
    lastStart = startMs;
    groups[groupOf[index] ?? 0]?.push({ index, w: word.w, startMs, endMs, filler: word.filler });
  }

  return groups.flatMap((kept) => {
    const first = kept[0];
    return first ? [{ startMs: first.startMs, words: kept }] : [];
  });
}
