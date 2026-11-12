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
      className={cn(
        // Radius lg, padding clamp(12px, 1.6vw, 20px), grain at 4% (design.md §4b).
        "stage relative isolate overflow-hidden rounded-lg bg-stage-bg p-[clamp(12px,1.6vw,20px)] text-stage-text",
        "before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:opacity-[.04] before:content-[''] before:[background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")]",
        className,
      )}
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
        "flex aspect-video max-h-[62dvh] w-full items-center justify-center overflow-hidden rounded-md bg-stage-bg",
        className,
      )}
      {...props}
    />
  );
}
