"use client";

import dynamic from "next/dynamic";
import type { ToastOptions, ToastVariant } from "./sonner-impl";

/**
 * Toasts. sonner and the toast card live in `sonner-impl.tsx` and load after the page has
 * hydrated (launch speed review, B2-T109): `Toaster` loads the region on demand and `notify`
 * imports the same module, which waits for the region before it shows the toast, so an early
 * toast is never lost. Use `notify` instead of calling sonner directly so every toast follows
 * design.md.
 */
export type { ToastOptions, ToastVariant };

/** Toast region. Mount it once per page tree; the app shell mounts it for the whole app. */
export const Toaster = dynamic(() => import("./sonner-impl").then((m) => m.ToasterRegion), {
  ssr: false,
});

/** Shows a toast. */
export function notify(variant: ToastVariant, options: ToastOptions): void {
  void import("./sonner-impl").then((m) => m.notifyNow(variant, options));
}
