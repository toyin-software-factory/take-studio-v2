"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { TakeDetail } from "@/lib/take-api";

/** Whether the card shows: a suggestion, a green screen to put it on, and not already the current one. */
export function showSuggestion(detail: TakeDetail, currentId: string): boolean {
  return (
    detail.suggestion !== null &&
    !detail.noGreenScreen &&
    detail.suggestion.backgroundId !== currentId
  );
}

/**
 * "Suggested: <name>" with the AI's reason and a Use it button (spec 0012, AC-5, AC-12). Use it
 * only picks the background, so it joins the pending bar like any pick; Render there makes the
 * video. Nothing is applied by itself.
 */
export function SuggestedBackground({
  suggestion,
  chosen,
  disabled,
  onUse,
}: {
  readonly suggestion: NonNullable<TakeDetail["suggestion"]>;
  /** The suggestion is already the pending pick. */
  readonly chosen: boolean;
  readonly disabled: boolean;
  readonly onUse: (backgroundId: string) => void;
}) {
  return (
    <section
      aria-labelledby="suggested-heading"
      data-testid="suggested-background"
      className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-4"
    >
      <h3 id="suggested-heading" className="flex items-center gap-2 text-h4 font-medium">
        <Icon icon={Sparkles} size="badge" />
        Suggested: {suggestion.name}
      </h3>
      <p className="m-0 text-small text-muted-foreground">{suggestion.reason}</p>
      {chosen ? (
        <p role="status" className="m-0 text-small">
          Added to your changes. Press Render to make it.
        </p>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={disabled}
          aria-disabled={disabled || undefined}
          onClick={() => onUse(suggestion.backgroundId)}
          className="w-fit"
        >
          Use it
        </Button>
      )}
    </section>
  );
}
