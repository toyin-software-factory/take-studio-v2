import type { AiEditAnswer } from "./ai-edit-answer";
import {
  AI_EDIT,
  type AiCandidate,
  type AiWord,
  type CatalogEntry,
  wordCutMaxShareFor,
} from "./ai-edit-config";
import {
  type Counter,
  type Span,
  type ValidAiEdit,
  keptPauses,
  mergeCuts,
  validFixes,
  validWordCuts,
} from "./ai-edit-pieces";
import { type ProposedCut, cleanReason } from "./cut-rules";
import { type Result, err, ok } from "./result";
import { SMOOTH } from "./trim";

export function smoothWordCutEdges(
  cuts: readonly ProposedCut[],
  words: readonly AiWord[],
): ProposedCut[] {
  const applied = cuts.filter((c) => c.applied !== false);
  const hits = (a: Span, b: Span) => a.startMs < b.endMs && b.startMs < a.endMs;
  const kept = words.filter((w) => !applied.some((c) => hits(c, w)));
  return cuts.map((c) => {
    if (c.applied === false || (c.kind !== "false_start" && c.kind !== "filler")) return c;
    const others = cuts.filter((o) => o !== c);
    const before = kept.filter((w) => w.endMs <= c.startMs).at(-1);
    const after = kept.find((w) => w.startMs >= c.endMs);
    let { startMs, endMs } = c;
    if (before && !others.some((o) => o.endMs > before.endMs && o.startMs < c.startMs)) {
      const gap = c.startMs - before.endMs;
      startMs = c.startMs - Math.min(SMOOTH.wordEdgeMaxMs, Math.floor(gap / 2));
    }
    if (after && !others.some((o) => o.startMs < after.startMs && o.endMs > c.endMs)) {
      const gap = after.startMs - c.endMs;
      endMs = c.endMs + Math.min(SMOOTH.wordEdgeMaxMs, Math.floor(gap / 2));
    }
    return { ...c, startMs, endMs };
  });
}

/**
 * Checks the answer against the transcript and the candidates (spec 0012, Validation). Items that
 * break a rule are dropped and counted; the whole answer is refused (`invalid`, so the caller falls
 * back to the rules cuts) when word cuts total over 40% of the take (60% for a take under 30 s), or more than half of all
 * items were dropped. The schema parse and the `max_tokens` stop are the caller's checks, before
 * this. Pure: no reason or word is logged.
 */
export function validateAiEdit(
  answer: AiEditAnswer,
  words: readonly AiWord[],
  candidates: readonly AiCandidate[],
  durationMs: number,
  catalog: readonly CatalogEntry[] = [],
  hasScript = false,
): Result<ValidAiEdit, "invalid"> {
  const count: Counter = { dropped: 0 };
  const kept = keptPauses(answer, candidates, count);
  const keptSpans = [...kept.keys()].flatMap((i) => {
    const c = candidates[i];
    return c ? [{ startMs: c.startMs, endMs: c.endMs }] : [];
  });

  const wordCuts = validWordCuts(answer, words, durationMs, keptSpans, count);
  const wordCutMs = wordCuts.reduce((sum, c) => sum + (c.endMs - c.startMs), 0);
  if (wordCutMs > durationMs * wordCutMaxShareFor(durationMs, hasScript)) return err("invalid");

  const fixes = validFixes(answer, words, count);

  let background: ValidAiEdit["background"] = null;
  if (answer.background) {
    const reason = cleanReason(answer.background.reason);
    if (reason && catalog.some((b) => b.id === answer.background?.id)) {
      background = { id: answer.background.id, reason };
    } else {
      count.dropped += 1;
    }
  }

  const total =
    answer.keepPauses.length +
    answer.wordCuts.length +
    answer.fixes.length +
    (answer.background ? 1 : 0);

  const pauseCuts = candidates.flatMap((c, i): ProposedCut[] => {
    const keptReason = kept.get(i);
    const keep = keptReason !== undefined;
    return [
      {
        startMs: c.startMs,
        endMs: c.endMs,
        kind: "pause",
        proposedBy: "ai",
        reason: keep ? keptReason : cleanReason(c.reason),
        applied: !keep,
      },
    ];
  });
  const unapplied = pauseCuts.filter((c) => c.applied === false);
  const applied = pauseCuts.filter((c) => c.applied !== false);
  const merged = [...unapplied, ...mergeCuts(applied, wordCuts, count)];
  const smoothed = smoothWordCutEdges(merged, words);
  // Smoothing grows word cuts by up to 160 ms each; when that would take the word cuts over the
  // share limit, the answer keeps the unsmoothed edges (the check above stays true).
  const grown = smoothed.reduce((sum, c, i) => {
    const before = merged[i];
    return sum + (before ? c.endMs - c.startMs - (before.endMs - before.startMs) : 0);
  }, 0);
  // A cut that smoothing grew past the per cut limit also keeps its unsmoothed edges.
  const pastCutLimit = smoothed.some((c, i) => {
    const before = merged[i];
    const len = c.endMs - c.startMs;
    return (
      before !== undefined && len > before.endMs - before.startMs && len > AI_EDIT.wordCutMaxMs
    );
  });
  const withinLimit =
    !pastCutLimit && wordCutMs + grown <= durationMs * wordCutMaxShareFor(durationMs);
  const cuts = (withinLimit ? smoothed : merged).sort((a, b) => a.startMs - b.startMs);
  // Last, so the merge's drops count too.
  if (count.dropped * 2 > total) return err("invalid");
  return ok({ cuts, fixes, background, dropped: count.dropped });
}
