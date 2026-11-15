import { CAPTION_RULES, type Cue, type TrimmedParagraph } from "./transcript-timeline-types";

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

  // Words in mapped time order, each remembering whether it opens a paragraph (even a filler
  // does, so the next spoken word still starts a new cue).
  const timeline = paragraphs
    .flatMap((paragraph) => paragraph.words.map((word, i) => ({ word, opensParagraph: i === 0 })))
    .sort((a, b) => a.word.startMs - b.word.startMs || a.word.endMs - b.word.endMs);

  for (const { word, opensParagraph } of timeline) {
    if (opensParagraph) breakBefore = true;
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
