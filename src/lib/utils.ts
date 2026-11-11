import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Joins class names and lets later Tailwind classes win over earlier ones (shadcn/ui helper). */
export function cn(...inputs: readonly ClassValue[]): string {
  return twMerge(clsx(inputs));
}
