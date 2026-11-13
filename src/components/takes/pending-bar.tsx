"use client";

import { Button } from "@/components/ui/button";
import type { CutReview } from "./use-cut-review";

/** The one line the status region says, from the render phase and the last refusal. */
function statusText(review: CutReview): string {
  if (review.rendering) return "Rendering…";
  if (review.message) return review.message;
  if (review.phase.kind === "done") return "Rendered. Your downloads are up to date.";
  if (review.phase.kind === "failed")
    return "The new video didn't finish. Your changes are still here.";
  if (review.readOnly) return "The original has expired, so cuts can't be changed.";
  return "";
}

/**
 * The pending changes bar (spec 0011, AC-4, AC-6): what will change, in order, with Discard and
 * Render. The status region is in the page from the first load and empty until it has
 * something to say, so a screen reader announces it when it fills.
 */
export function PendingBar({ review }: { readonly review: CutReview }) {
  const n = review.items.length;
  const failed = review.phase.kind === "failed";
  const text = statusText(review);
  return (
    <div className="flex flex-col gap-2">
      <p role="status" className="min-h-[1lh] text-small">
        {text}
      </p>
      {review.hasEdits && !review.readOnly ? (
        <section
          aria-label="Unsaved changes"
          className="flex flex-col gap-3 rounded-lg border border-stage-border bg-stage-raised px-4 py-3 text-stage-text sm:flex-row sm:items-center"
        >
          <div className="min-w-0 flex-1">
            <p className="text-small font-medium">
              {n === 1 ? "1 change" : `${n} changes`}: {review.items.map((i) => i.text).join(", ")}
            </p>
            <p className="text-small text-stage-text-muted">
              Renders again in about a minute. Your transcript stays the same.
            </p>
          </div>
          {/* On a phone the text has the full width and the buttons share the row below it. */}
          <div className="flex gap-3 *:flex-1 sm:*:flex-none">
            <Button variant="ghost" onClick={review.discard} disabled={review.locked}>
              Discard
            </Button>
            {review.canRender ? (
              <Button
                onClick={review.start}
                loading={review.phase.kind === "starting"}
                disabled={review.locked}
              >
                {failed ? "Try again" : "Render"}
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
