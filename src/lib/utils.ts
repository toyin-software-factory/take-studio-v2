import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Our type scale (globals.css) uses names tailwind-merge doesn't know. Without this it reads
// `text-small` as a text colour and drops the real colour class next to it.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ["display", "h1", "h2", "h3", "body", "small", "caption"] } },
});

/** Joins class names and lets later Tailwind classes win over earlier ones (shadcn/ui helper). */
export function cn(...inputs: readonly ClassValue[]): string {
  return twMerge(clsx(inputs));
}
