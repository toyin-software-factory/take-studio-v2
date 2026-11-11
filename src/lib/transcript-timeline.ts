import { alignToFrames, keepRanges, type Range } from "./trim";

/**
 * Read time rules for a transcript (spec 0007, Pipeline step 3). Pure: the stored words are on
 * the original take; everything shown or exported is mapped onto the trimmed video here, with
 * the same frame aligned keep ranges the render uses, so nothing is stored twice and the
 * captions line up with the video.
 */

/** A stored word: times on the original take (spec 0007, `transcript.words`). */
export type StoredWord = {
  readonly w: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly filler: boolean;
  /** True on the first word of a paragraph. */
  readonly para: boolean;
};

/** A kept word on the trimmed timeline. */
export type TrimmedWord = {
  readonly w: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly filler: boolean;
};

export type TrimmedParagraph = {
  readonly startMs: number;
  readonly words: readonly TrimmedWord[];
};

export type Cue = {
  readonly startMs: number;
  readonly endMs: number;
  /** One or two lines joined by a line feed. */
  readonly text: string;
};

export const CAPTION_RULES = {
  maxCueMs: 7000,
  minCueMs: 1000,
  maxLines: 2,
  maxLineChars: 42,
} as const;

export type TimelineOptions = {
  /** `render.removed_ranges` of the latest render; empty when the take was handed back uncut. */
  readonly removedRanges: readonly Range[];
  readonly durationMs: number;
  /** `transcript.source_fps`; null when unknown (the render then assumes 30). */
  readonly sourceFps: number | null;
};

/**
 * Maps stored words onto the trimmed video. A word is kept when its midpoint falls inside a keep
 * range; its times are its offset inside the concatenated keep ranges, clamped to its own keep
 * range, never going backwards, with `endMs > startMs`. A paragraph starts at its first kept word
 * and a paragraph with no kept words disappears.
 */
export function toTrimmedTranscript(
  words: readonly StoredWord[],
  options: TimelineOptions,
): TrimmedParagraph[] {
  const { removedRanges, durationMs, sourceFps } = options;
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

  const groups: TrimmedWord[][] = [];
  let group = -1;
  let lastStart = 0;
  words.forEach((word, index) => {
    if (word.para || index === 0) {
      group += 1;
      groups.push([]);
    }
    const mid = (word.startMs + word.endMs) / 2;
    const at = keep.findIndex((range) => mid >= range.startMs && mid < range.endMs);
    const range = keep[at];
    const offset = offsets[at];
    if (range === undefined || offset === undefined) return;
    const clamp = (ms: number) => Math.min(Math.max(ms, range.startMs), range.endMs);
    const startMs = Math.max(Math.round(offset + clamp(word.startMs) - range.startMs), lastStart);
    const endMs = Math.max(Math.round(offset + clamp(word.endMs) - range.startMs), startMs + 1);
    lastStart = startMs;
    groups[group]?.push({ w: word.w, startMs, endMs, filler: word.filler });
  });

  return groups.flatMap((kept) => {
    const first = kept[0];
    return first ? [{ startMs: first.startMs, words: kept }] : [];
  });
}

const cleanWord = (w: string) => w.replace(/\s+/g, " ").trim().replaceAll("-->", "->");

/** Splits cue text over at most two lines of at most 42 characters, near the middle. */
function wrapLines(words: readonly string[]): string[] | null {
  const max = CAPTION_RULES.maxLineChars;
  const whole = words.join(" ");
  if (whole.length <= max) return [whole];
  let best: string[] | null = null;
  let bestGap = Infinity;
  for (let i = 1; i < words.length; i += 1) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    if (a.length > max || b.length > max) continue;
    const gap = Math.abs(a.length - b.length);
    if (gap < bestGap) {
      best = [a, b];
      bestGap = gap;
    }
  }
  return best;
}

/** Break the line at the word boundary nearest the middle even when a giant word will not fit. */
function wrapAnyway(words: readonly string[]): string[] {
  const wrapped = wrapLines(words);
  if (wrapped) return wrapped;
  if (words.length < 2) return [words.join(" ")];
  const half = words.join(" ").length / 2;
  let used = 0;
  let cut = 1;
  for (let i = 0; i < words.length; i += 1) {
    used += (words[i]?.length ?? 0) + 1;
    if (used >= half) {
      cut = Math.min(Math.max(i + 1, 1), words.length - 1);
      break;
    }
  }
  return [words.slice(0, cut).join(" "), words.slice(cut).join(" ")];
}

type Draft = { startMs: number; endMs: number; words: string[] };

/**
 * Builds caption cues from kept words. Fillers are dropped. A cue ends at a paragraph start, after
 * a word ending in `.`, `?` or `!`, or when one more word would pass 7 seconds or no longer fit on
 * two lines of 42 characters. Each cue lasts at least 1 second when the next cue starts late
 * enough, and cues never overlap. A single word longer than a line stays on one line.
 */
export function buildCues(paragraphs: readonly TrimmedParagraph[]): Cue[] {
  const drafts: Draft[] = [];
  let current: Draft | null = null;
  let breakBefore = true;

  for (const paragraph of paragraphs) {
    breakBefore = true;
    for (const word of paragraph.words) {
      if (word.filler) continue;
      const w = cleanWord(word.w);
      if (w === "") continue;
      if (current) {
        const tooLong = word.endMs - current.startMs > CAPTION_RULES.maxCueMs;
        const noFit = wrapLines([...current.words, w]) === null;
        if (breakBefore || tooLong || noFit) {
          drafts.push(current);
          current = null;
        }
      }
      if (current) {
        current.words.push(w);
        current.endMs = Math.max(current.endMs, word.endMs);
      } else {
        current = { startMs: word.startMs, endMs: word.endMs, words: [w] };
      }
      breakBefore = /[.?!]["')\]]*$/.test(w);
    }
  }
  if (current) drafts.push(current);

  // Times: no overlap (a later cue starts no earlier than the one before ends), a cue never runs
  // past 7 seconds, and a short cue is stretched to 1 second up to the next cue's start.
  const timed = drafts.map((d) => ({
    ...d,
    endMs: Math.min(d.endMs, d.startMs + CAPTION_RULES.maxCueMs),
  }));
  timed.forEach((cue, i) => {
    const before = timed[i - 1];
    if (before) cue.startMs = Math.max(cue.startMs, before.endMs);
    cue.endMs = Math.max(cue.endMs, cue.startMs + 1);
  });
  return timed.map((cue, i) => {
    const next = timed[i + 1];
    const stretched = Math.max(cue.endMs, cue.startMs + CAPTION_RULES.minCueMs);
    const endMs = next ? Math.min(stretched, Math.max(next.startMs, cue.endMs)) : stretched;
    return { startMs: cue.startMs, endMs, text: wrapAnyway(cue.words).join("\n") };
  });
}

function clock(ms: number, separator: "," | "."): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(total % 1000, 3)}`;
}

/** SubRip: numbered from 1, `hh:mm:ss,mmm --> hh:mm:ss,mmm`, a blank line after each cue. */
export function toSrt(cues: readonly Cue[]): string {
  return cues
    .map(
      (cue, i) =>
        `${i + 1}\n${clock(cue.startMs, ",")} --> ${clock(cue.endMs, ",")}\n${cue.text}\n\n`,
    )
    .join("");
}

const escapeVtt = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** WebVTT: a `WEBVTT` header, `hh:mm:ss.mmm` times, text escaped. Same cues as the SRT. */
export function toVtt(cues: readonly Cue[]): string {
  const body = cues
    .map(
      (cue) =>
        `${clock(cue.startMs, ".")} --> ${clock(cue.endMs, ".")}\n${escapeVtt(cue.text)}\n\n`,
    )
    .join("");
  return `WEBVTT\n\n${body}`;
}

/** Paragraphs separated by a blank line; no fillers, no timestamps. */
export function toPlainText(paragraphs: readonly TrimmedParagraph[]): string {
  const blocks = paragraphs
    .map((p) =>
      p.words
        .filter((word) => !word.filler)
        .map((word) => cleanWord(word.w))
        .filter((w) => w !== "")
        .join(" "),
    )
    .filter((text) => text !== "");
  return blocks.length === 0 ? "" : `${blocks.join("\n\n")}\n`;
}
