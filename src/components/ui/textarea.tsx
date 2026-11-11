import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-surface px-3 py-2 text-body shadow-xs transition-[color,box-shadow] outline-hidden placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-disabled-bg disabled:text-disabled-fg read-only:border-border read-only:bg-transparent read-only:shadow-none aria-invalid:border-destructive in-[.stage]:aria-invalid:border-stage-text",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
