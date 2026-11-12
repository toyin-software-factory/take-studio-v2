import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-12 w-full pointer-coarse:min-h-12 min-w-0 rounded-none border-0 border-b border-input bg-transparent px-0 py-2 text-body transition-[border-color,box-shadow,color] duration-300 ease-ui outline-hidden hover:border-foreground selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:border-border disabled:text-disabled-fg read-only:border-border",
        "focus-visible:border-foreground focus-visible:shadow-[0_1px_0_0_var(--foreground)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-3 focus-visible:outline-ring",
        "aria-invalid:border-destructive in-[.stage]:aria-invalid:border-stage-text",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
