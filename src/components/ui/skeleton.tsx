import { cn } from "@/lib/utils";

/**
 * Loading placeholder shaped like the content. Light: --disabled-bg shimmer; inside the stage:
 * white at 10% on --stage-bg. Static under reduced motion (globals.css). Hidden from
 * assistive technology: announce loading on the region instead (for example `aria-busy`).
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-md bg-disabled-bg in-[.stage]:bg-stage-hover",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
