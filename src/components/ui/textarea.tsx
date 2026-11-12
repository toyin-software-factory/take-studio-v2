import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-24 w-full rounded-none border-0 border-b border-input bg-transparent px-0 py-2 text-body transition-[border-color,box-shadow,color] duration-300 ease-ui outline-hidden hover:border-foreground placeholder:text-muted-foreground focus-visible:border-foreground focus-visible:shadow-[0_1px_0_0_var(--foreground)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-3 focus-visible:outline-ring disabled:cursor-not-allowed disabled:border-border disabled:text-disabled-fg read-only:border-border aria-invalid:border-destructive in-[.stage]:aria-invalid:border-stage-text",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
