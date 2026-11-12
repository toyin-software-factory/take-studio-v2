import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

// design.md: inline, tinted background, icon plus title and text in --text. Status colours are
// for the icon only; on the stage they fail contrast, so the icon takes the text colour there.
const alertVariants = cva(
  "grid w-full grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 rounded-md px-4 py-3 text-small text-foreground",
  {
    variants: {
      variant: {
        info: "bg-info-bg [&>svg]:text-info",
        success: "bg-success-bg [&>svg]:text-success",
        warning: "bg-warning-bg [&>svg]:text-warning",
        danger: "bg-danger-bg [&>svg]:text-danger",
      },
    },
    defaultVariants: { variant: "info" },
  },
);

const icons: Readonly<
  Record<NonNullable<VariantProps<typeof alertVariants>["variant"]>, LucideIcon>
> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};

/** Inline alert. Errors (`danger`) are announced with `role="alert"`, the rest politely. */
function Alert({
  className,
  variant,
  title,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> &
  VariantProps<typeof alertVariants> & { readonly title: string }) {
  const kind = variant ?? "info";
  return (
    <div
      data-slot="alert"
      role={kind === "danger" ? "alert" : "status"}
      className={cn(
        alertVariants({ variant: kind }),
        "in-[.stage]:[&>svg]:text-current",
        className,
      )}
      {...props}
    >
      <Icon icon={icons[kind]} size="ui" className="row-span-2" />
      <p className="font-medium">{title}</p>
      {children ? <div className="col-start-2">{children}</div> : null}
    </div>
  );
}

export { Alert, alertVariants };
