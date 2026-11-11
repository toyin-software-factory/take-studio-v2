"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { Slot } from "radix-ui";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

// design.md: 10 px corners, 2 px focus ring with 2 px offset (Brick Red on light, cream on the
// stage via --ring), at least 44 px under a coarse pointer, disabled keeps its label.
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors outline-hidden select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring aria-disabled:cursor-not-allowed aria-disabled:bg-disabled-bg aria-disabled:text-disabled-fg aria-disabled:shadow-none pointer-coarse:min-h-11 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active",
        secondary:
          "border border-input bg-secondary text-secondary-foreground shadow-card hover:bg-accent active:bg-muted",
        ghost: "text-foreground hover:bg-accent active:bg-muted",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-danger-hover active:bg-danger-active",
        link: "h-auto px-0 text-primary underline underline-offset-2 hover:text-primary-hover aria-disabled:bg-transparent in-[.stage]:text-foreground in-[.stage]:hover:text-foreground",
      },
      size: {
        sm: "h-8 px-3 text-small",
        md: "h-10 px-4 text-small",
        lg: "h-12 px-6 text-body",
        icon: "size-10 rounded-full pointer-coarse:min-w-11",
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
