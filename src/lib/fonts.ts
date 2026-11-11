import { Inter, JetBrains_Mono } from "next/font/google";

// Downloaded at build time and served from our own origin, so no request to Google at runtime
// (works under OpenNext). Variable axis only, latin subset, swap (design.md, Type).

/** Inter: UI, headings and transcript. Exposed as the CSS variable `--font-inter`. */
export const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

/** JetBrains Mono: timestamps, durations and file sizes (`.mono`). Not preloaded: few pages use it. */
export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
  preload: false,
});
