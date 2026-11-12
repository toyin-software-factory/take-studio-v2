import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The dark stage (design.md): for the video player, cut timeline and processing preview.
 * Everything inside resolves the shared token names to the stage set, so components keep
 * working and get the lime focus ring and stage hover. The lime accent is a ring or a fill here, never text on white.
 */
export function Stage({
  className,
  label,
  ...props
}: React.ComponentProps<"section"> & {
  /** Accessible name of the stage region, for example "Player". */
  readonly label?: string;
}) {
  return (
    <section
      data-slot="stage"
      aria-label={label}
      className={cn("stage rounded-md bg-stage-bg p-4 text-stage-text sm:p-6", className)}
      {...props}
    />
  );
}

/** A raised panel on the stage (toolbar, side panel): 1.4:1 against the stage, so it gets a border. */
export function StagePanel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="stage-panel"
      className={cn("rounded-md border border-stage-border bg-stage-raised p-3", className)}
      {...props}
    />
  );
}

/** Holds media of any shape in a 16:9 box; the bars around it are the stage colour. */
export function StageLetterbox({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="stage-letterbox"
      className={cn(
        "flex aspect-video w-full items-center justify-center overflow-hidden rounded-sm bg-stage-bg",
        className,
      )}
      {...props}
    />
  );
}
