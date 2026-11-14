"use client";

import { Button } from "@/components/ui/button";
import { secondsText, type NumberedCut } from "@/lib/cut-review";
import { formatClock } from "@/lib/take-display";
import type { CutReview } from "./use-cut-review";

const KIND_TEXT: Readonly<Record<string, string>> = {
  pause: "Pause",
  false_start: "False start",
  filler: "Filler word",
  manual: "Added by you",
};

/** The plain words for a cut's kind. */
export function kindText(kind: string): string {
  return KIND_TEXT[kind] ?? "Cut";
}

/** The line that says whether the AI took part, or null when it did and left reasons. */
export function fallbackNote(
  aiEdit: "done" | "unavailable" | null,
  hasCuts: boolean,
  hasReasons: boolean,
): { readonly testId: string; readonly text: string } | null {
  if (aiEdit === "unavailable")
    return {
      testId: "ai-unavailable",
      text: "The AI edit didn’t run for this take, so only pauses were cut.",
    };
  if (!hasCuts || hasReasons) return null;
  return {
    testId: "no-ai-reasons",
    text:
      aiEdit === "done"
        ? "The AI didn’t cut any words in this take, so only pauses were cut."
        : "The AI didn’t run on this take, so only pauses were cut.",
  };
}

function CutRow({
  cut,
  applied,
  disabled,
  onSeek,
  onToggle,
}: {
  readonly cut: NumberedCut;
  readonly applied: boolean;
  readonly disabled: boolean;
  readonly onSeek: () => void;
  readonly onToggle: () => void;
}) {
  const reason = cut.reason?.trim();
  const verb = applied ? "Undo" : "Redo";
  return (
    <li className="flex items-stretch gap-2 border-t border-stage-border pt-2 first:border-t-0 first:pt-0">
      <button
        type="button"
        onClick={onSeek}
        className="min-h-11 flex-1 cursor-pointer rounded-sm py-1 text-left outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-stage-focus"
      >
        <span className="flex flex-wrap items-baseline gap-x-2 text-small">
          <span className="font-medium">{cut.label}</span>
          <span className="text-stage-text-muted">
            {formatClock(cut.startMs)} to {formatClock(cut.endMs)},{" "}
            {secondsText(cut.endMs - cut.startMs)} s, {kindText(cut.kind).toLowerCase()}
            {applied ? "" : ", kept"}
          </span>
        </span>
        <span className="block text-small text-stage-text-muted">
          {reason ?? "No reason given."}
        </span>
      </button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        aria-label={`${verb} ${cut.label}`}
        onClick={onToggle}
        className="self-center"
      >
        {verb}
      </Button>
    </li>
  );
}

/**
 * Every cut as a visible row (B2-T25, spec 0012 AC-3): time range, length, kind, the reason, and
 * its own Undo or Redo that shares the timeline's state. Pressing the row only seeks the player;
 * only the button changes a cut.
 */
export function CutList({
  review,
  aiEdit,
  onSeek,
}: {
  readonly review: CutReview;
  readonly aiEdit: "done" | "unavailable" | null;
  readonly onSeek: (cut: NumberedCut) => void;
}) {
  const note = fallbackNote(
    aiEdit,
    review.numbered.length > 0,
    review.numbered.some((c) => c.reason?.trim()),
  );
  const disabled = review.locked || review.readOnly;
  return (
    <>
      {note ? (
        <p data-testid={note.testId} className="text-small text-stage-text-muted">
          {note.text}
        </p>
      ) : null}
      {review.numbered.length > 0 ? (
        <ul aria-label="Cuts and reasons" data-testid="cut-list" className="flex flex-col gap-2">
          {review.numbered.map((cut) => (
            <CutRow
              key={cut.id}
              cut={cut}
              applied={review.applied(cut.id)}
              disabled={disabled}
              onSeek={() => onSeek(cut)}
              onToggle={() => review.toggle(cut.id)}
            />
          ))}
        </ul>
      ) : null}
    </>
  );
}
