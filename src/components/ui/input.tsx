import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full pointer-coarse:min-h-11 min-w-0 rounded-md border border-input bg-surface px-3 py-2 text-body shadow-xs transition-[color,box-shadow] outline-hidden selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:bg-disabled-bg disabled:text-disabled-fg read-only:border-border read-only:bg-transparent read-only:shadow-none",
        "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring",
        "aria-invalid:border-destructive in-[.stage]:aria-invalid:border-stage-text",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
