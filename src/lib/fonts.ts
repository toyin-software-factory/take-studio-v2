import { Inter_Tight } from "next/font/google";

// Downloaded at build time and served from our own origin, so no request to Google at runtime
// (works under OpenNext). Latin subset, swap, three weights only (design.md §3).

/**
 * Inter Tight: the one family for everything. 300 for body at 16 px and up, 400 for headings
 * and small text, 500 for buttons and labels. Exposed as the CSS variable `--font-inter-tight`.
 * Times, durations and sizes use `tabular-nums` (the `mono` utility), not a second family.
 */
export const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  display: "swap",
  variable: "--font-inter-tight",
});
