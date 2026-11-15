import type { AiEditAnswer } from "./ai-edit-answer";
import { AI_EDIT, type AiCandidate, type AiWord } from "./ai-edit-config";
import { type ProposedCut, cleanReason, overlaps } from "./cut-rules";
import { isFillerWord } from "./transcript-rules";

// ----- Validation -----

export type AiFix = {
  readonly index: number;
  readonly old: string;
  readonly new: string;
  readonly reason: string;
};

export type ValidAiEdit = {
  /** Every cut to store: cut pauses and word cuts applied, kept pauses unapplied. */
  readonly cuts: readonly ProposedCut[];
  readonly fixes: readonly AiFix[];
  readonly background: { readonly id: string; readonly reason: string } | null;
  /** Items dropped one by one (counts only, for the log). */
  readonly dropped: number;
};

export type Span = { readonly startMs: number; readonly endMs: number };
export type WordCut = Span & { readonly kind: "false_start" | "filler"; readonly reason: string };

const isFiller = (w: AiWord): boolean => w.filler || isFillerWord(w.w);

/** Clips `span` so it does not touch any kept pause; null when nothing is left. */
function clipAround(span: Span, kept: readonly Span[]): Span | null {
  let { startMs, endMs } = span;
  for (const k of [...kept].sort((a, b) => a.startMs - b.startMs)) {
    if (!overlaps({ startMs, endMs }, k)) continue;
    if (k.startMs > startMs) endMs = k.startMs;
    else startMs = k.endMs;
  }
  return startMs < endMs ? { startMs, endMs } : null;
}

export type Counter = { dropped: number };

export function keptPauses(
  answer: AiEditAnswer,
  candidates: readonly AiCandidate[],
  count: Counter,
): Map<number, string> {
  const kept = new Map<number, string>();
  for (const k of answer.keepPauses) {
    const inRange = k.candidate >= 0 && k.candidate < candidates.length;
    if (!inRange || kept.has(k.candidate)) {
      count.dropped += 1;
      continue;
    }
    kept.set(k.candidate, cleanReason(k.reason) ?? AI_EDIT.keptPauseReason);
  }
  return kept;
}

export function validWordCuts(
  answer: AiEditAnswer,
  words: readonly AiWord[],
  durationMs: number,
  keptSpans: readonly Span[],
  count: Counter,
): WordCut[] {
  const found: WordCut[] = [];
  for (const c of answer.wordCuts) {
    const reason = cleanReason(c.reason);
    const first = words[c.fromWord];
    const inRange = c.fromWord >= 0 && c.fromWord <= c.toWord && c.toWord < words.length;
    if (!reason || !inRange || !first) {
      count.dropped += 1;
      continue;
    }
    const end = words[c.toWord + 1]?.startMs ?? durationMs;
    const span = clipAround({ startMs: first.startMs, endMs: end }, keptSpans);
    if (!span || span.endMs - span.startMs > AI_EDIT.wordCutMaxMs) {
      count.dropped += 1;
      continue;
    }
    found.push({ ...span, kind: c.kind, reason });
  }
  // Word cuts never overlap each other: the later one (by start) is dropped.
  const sorted = found.sort((a, b) => a.startMs - b.startMs);
  const kept: WordCut[] = [];
  for (const cut of sorted) {
    if (kept.some((k) => overlaps(k, cut))) count.dropped += 1;
    else kept.push(cut);
  }
  return kept;
}

export function validFixes(
  answer: AiEditAnswer,
  words: readonly AiWord[],
  count: Counter,
): AiFix[] {
  const seen = new Set<number>();
  const fixes: AiFix[] = [];
  for (const f of answer.fixes) {
    const word = words[f.index];
    const next = f.new.trim();
    const reason = cleanReason(f.reason);
    const ok =
      word !== undefined &&
      f.old === word.w &&
      !isFiller(word) &&
      next !== "" &&
      next !== f.old &&
      [...next].length <= AI_EDIT.fixMaxChars &&
      !seen.has(f.index) &&
      reason !== null &&
      fixes.length < AI_EDIT.maxFixes;
    if (!ok) {
      count.dropped += 1;
      continue;
    }
    seen.add(f.index);
    fixes.push({ index: f.index, old: f.old, new: next, reason: reason });
  }
  return fixes;
}

/** Merges each word cut with the cut pauses it overlaps (the word cut's kind and reason win). */
export function mergeCuts(
  pauses: readonly ProposedCut[],
  wordCuts: readonly WordCut[],
  count: Counter,
): ProposedCut[] {
  let rest = [...pauses];
  const merged: ProposedCut[] = [];
  for (const w of wordCuts) {
    const hit = rest.filter((p) => overlaps(p, w));
    const startMs = Math.min(w.startMs, ...hit.map((p) => p.startMs));
    const endMs = Math.max(w.endMs, ...hit.map((p) => p.endMs));
    const span = { startMs, endMs };
    // Expanding into pauses can make two word cuts touch: the later one is dropped.
    if (endMs - startMs > AI_EDIT.wordCutMaxMs || merged.some((m) => overlaps(m, span))) {
      count.dropped += 1; // the pauses stay alone
      continue;
    }
    rest = rest.filter((p) => !hit.includes(p));
    merged.push({
      startMs,
      endMs,
      kind: w.kind,
      proposedBy: "ai",
      reason: w.reason,
      applied: true,
    });
  }
  return [...rest, ...merged];
}

/**
 * Smooth cuts (spec 0020): a word cut edge that borders a kept word moves to the middle of the
 * gap between them, at most `SMOOTH.wordEdgeMaxMs`, so a cut never lands on the word's attack or
 * tail. Edges next to a pause cut or the take's start or end stay, and so do edges of words with
 * no gap. Only word cuts move; the kept word's own time is never entered. Pure.
 */
