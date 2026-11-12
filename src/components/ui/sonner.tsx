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

/** Shows a toast. Use this instead of calling sonner directly so every toast follows design.md. */
export function notify(variant: ToastVariant, options: ToastOptions): string | number {
  // Our card owns the timer (it pauses on focus too), so sonner never closes it by itself.
  return sonnerToast.custom((id) => <ToastCard id={id} variant={variant} {...options} />, {
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
 * Toast region: bottom right on desktop, bottom centre on phones (design.md). Mount it once per
 * page tree; the app shell mounts it for the whole app.
 */
export function Toaster() {
  const isDesktop = useIsDesktop();
  return (
    <Sonner
      position={isDesktop ? "bottom-right" : "bottom-center"}
      gap={12}
      style={{ zIndex: "var(--z-toast)" } as React.CSSProperties}
    />
  );
}
