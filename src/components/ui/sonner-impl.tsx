"use client";

import * as React from "react";
import { CircleAlert, CircleCheck, Info, Bell, X, type LucideIcon } from "lucide-react";
import { Toaster as Sonner, toast as sonnerToast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/** design.md: success and info dismiss after about 5 seconds; errors stay until dismissed. */
export const AUTO_DISMISS_MS = 5000;

export type ToastVariant = "default" | "success" | "info" | "error";

export type ToastOptions = {
  readonly title: string;
  readonly description?: string;
  /** One optional action, for example `{ label: "Undo", onClick }`. */
  readonly action?: { readonly label: string; readonly onClick: () => void };
};

const toastIcons: Readonly<Record<ToastVariant, LucideIcon>> = {
  default: Bell,
  success: CircleCheck,
  info: Info,
  error: CircleAlert,
};

const iconColours: Readonly<Record<ToastVariant, string>> = {
  default: "text-foreground",
  success: "text-success",
  info: "text-info",
  error: "text-danger",
};

/**
 * Counts down `ms`, pausing while `paused` is true, then calls `onDone`. `ms` of null never
 * finishes. The time left survives pauses, so hovering or focusing doesn't restart it.
 */
function useCountdown(ms: number | null, paused: boolean, onDone: () => void) {
  const remaining = React.useRef(ms);
  React.useEffect(() => {
    if (remaining.current === null || paused) return;
    const started = Date.now();
    const timer = window.setTimeout(onDone, remaining.current);
    return () => {
      window.clearTimeout(timer);
      if (remaining.current !== null) remaining.current -= Date.now() - started;
    };
  }, [paused, onDone]);
}

/** One toast. Errors use `role="alert"`, the rest `role="status"` (design.md, Toasts). */
function ToastCard({
  id,
  variant,
  title,
  description,
  action,
}: ToastOptions & { readonly id: string | number; readonly variant: ToastVariant }) {
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const dismiss = React.useCallback(() => sonnerToast.dismiss(id), [id]);
  useCountdown(variant === "error" ? null : AUTO_DISMISS_MS, hovered || focused, dismiss);

  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      data-variant={variant}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      className="flex w-full items-start gap-3 rounded-lg bg-card p-4 text-foreground shadow-overlay md:w-(--width)"
    >
      <Icon icon={toastIcons[variant]} className={cn("mt-0.5", iconColours[variant])} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-small font-medium">{title}</p>
        {description ? <p className="text-small text-muted-foreground">{description}</p> : null}
        {action ? (
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() => {
              action.onClick();
              dismiss();
            }}
          >
            {action.label}
          </Button>
        ) : null}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="-mt-2 -mr-2"
        aria-label="Dismiss"
        onClick={dismiss}
      >
        <Icon icon={X} />
      </Button>
    </div>
  );
}

/** Resolves once a toast region has mounted, so a toast sent early is never dropped. */
let markMounted: () => void = () => undefined;
const regionMounted = new Promise<void>((resolve) => {
  markMounted = resolve;
});

/** How long a toast waits for the region. A healthy region mounts within a second or two of hydration. */
const REGION_WAIT_MS = 8000;

function regionWithin(ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("toast region did not mount")), ms);
  });
  return Promise.race([regionMounted, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Shows a toast (waits for the toast region to exist first). Rejects if the region never mounts,
 * so `notify` can fall back to an alert instead of losing the message.
 */
export async function notifyNow(variant: ToastVariant, options: ToastOptions): Promise<void> {
  await regionWithin(REGION_WAIT_MS);
  // Our card owns the timer (it pauses on focus too), so sonner never closes it by itself.
  sonnerToast.custom((id) => <ToastCard id={id} variant={variant} {...options} />, {
    duration: Infinity,
  });
}

const desktopQuery = "(min-width: 48rem)";

/** True from the md breakpoint up. False during server rendering. */
function useIsDesktop(): boolean {
  return React.useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(desktopQuery);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(desktopQuery).matches,
    () => false,
  );
}

/**
 * Toast region: bottom right on desktop, bottom centre on phones (design.md). Loaded on demand
 * by `Toaster` in `sonner.tsx`, so sonner stays out of the first load of every page.
 */
export function ToasterRegion() {
  const isDesktop = useIsDesktop();
  React.useEffect(() => markMounted(), []);
  return (
    <Sonner
      position={isDesktop ? "bottom-right" : "bottom-center"}
      gap={12}
      style={{ zIndex: "var(--z-toast)" } as React.CSSProperties}
    />
  );
}
