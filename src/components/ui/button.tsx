"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { Slot } from "radix-ui";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

// design.md §5: pill shape, 2 px focus ring with 3 px offset (ink on light, lime on the stage
// via --ring), pressed scale(.98), at least 44 px under a coarse pointer, disabled keeps its
// label. Primary turns into the white pill on dark by itself: `.stage` rebinds the tokens.
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition-[background-color,border-color,box-shadow,color,transform] duration-300 ease-ui outline-hidden select-none active:scale-[.98] active:duration-150 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-3 focus-visible:outline-ring aria-disabled:cursor-not-allowed aria-disabled:bg-disabled-bg aria-disabled:text-disabled-fg aria-disabled:shadow-none pointer-coarse:min-h-11 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active",
        secondary:
          "border border-input bg-transparent text-foreground hover:bg-hover-surface in-[.stage]:border-line-dark in-[.stage]:bg-glass in-[.stage]:[backdrop-filter:var(--blur-glass)] in-[.stage]:hover:border-on-dark-20",
        ghost: "text-foreground hover:bg-hover-surface",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-danger-hover active:bg-danger-active",
        link: "h-auto rounded-xs px-0 text-foreground underline underline-offset-[6px] hover:underline-offset-[3px] aria-disabled:bg-transparent",
      },
      size: {
        sm: "h-8 px-4 text-small",
        md: "h-10 px-6 text-body",
        lg: "h-12 px-6 text-body",
        icon: "size-10 px-0 pointer-coarse:min-w-11",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element (for example a link) with button styles. */
    readonly asChild?: boolean;
    /** Shows a spinner, keeps the label, announces busy and blocks clicks. */
    readonly loading?: boolean;
  };

/**
 * Button with design.md variants and sizes. `disabled` and `loading` use `aria-disabled`, so
 * the button stays focusable and keeps its label for screen readers, and clicks are ignored.
 * An icon only button (`size="icon"`) needs an `aria-label`.
 */
function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled = false,
  onClick,
  children,
  ...props
}: ButtonProps) {
  const inactive = disabled || loading;
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      data-variant={variant ?? "primary"}
      aria-disabled={inactive || undefined}
      aria-busy={loading || undefined}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        if (inactive) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      // Link buttons size to their text, so no size classes (they would override h-auto px-0).
      className={cn(buttonVariants({ variant, size: variant === "link" ? null : size, className }))}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Icon icon={Loader2} size="badge" className="animate-spin" /> : null}
          {children}
        </>
      )}
    </Comp>
  );
}

export { Button, buttonVariants };
