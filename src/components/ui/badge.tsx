import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

// design.md: status is never colour alone, so every badge has an icon and a label.
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-full border border-transparent px-2.5 py-0.5 text-caption font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "border-border bg-transparent text-foreground",
        info: "bg-info-bg text-info",
        success: "bg-success-bg text-success",
        warning: "bg-warning-bg text-warning",
        danger: "bg-danger-bg text-danger",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    /** Required: the icon that, with the label, carries the status. */
    readonly icon: LucideIcon;
  };

/** Status badge: icon plus label. On the stage it uses the stage text colour on a tint. */
function Badge({ className, variant, icon, children, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), "in-[.stage]:text-foreground", className)}
      {...props}
    >
      <Icon icon={icon} size="badge" />
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
