"use client";

import * as React from "react";
import { Progress as ProgressPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * Progress bar (design.md): --info fill on a decorative --border track on light; lime on
 * raised inside the stage. Leave `value` undefined for the indeterminate state. Always give it
 * an accessible name (`aria-label` or `aria-labelledby`).
 */
function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const indeterminate = value === undefined || value === null;
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={indeterminate ? null : value}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-border in-[.stage]:bg-on-dark-20",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "h-full bg-info in-[.stage]:bg-stage-accent",
          indeterminate ? "w-1/3 animate-indeterminate" : "w-full transition-transform",
        )}
        style={indeterminate ? undefined : { transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
