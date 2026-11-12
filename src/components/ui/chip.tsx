"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type ChipProps = Omit<React.ComponentProps<"button">, "aria-pressed"> & {
  /** On or off. Written as `aria-pressed`, so the state is announced, not only coloured. */
  readonly pressed: boolean;
};

/**
 * Toggle chip (design.md §5, Form): a pill with a 1 px line border; pressed fills with ink
 * and white text (the white pill on the stage), 200 ms. `disabled` keeps the label.
 */
function Chip({ className, pressed, type = "button", ...props }: ChipProps) {
  return (
    <button
      type={type}
      data-slot="chip"
      aria-pressed={pressed}
      className={cn(
        "inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1 text-small font-medium whitespace-nowrap text-foreground transition-[background-color,border-color,color,transform] duration-200 ease-ui outline-hidden select-none hover:border-border-strong active:scale-[.98] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-3 focus-visible:outline-ring disabled:cursor-not-allowed disabled:text-disabled-fg pointer-coarse:min-h-11 aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Chip };
