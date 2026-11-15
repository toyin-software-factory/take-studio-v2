import { gigabytes, minutes, resolution } from "./content-limits";

/**
 * Everything the homepage says (spec 0010, AC-2). Copy describes only what works today: no line
 * claims the cut review timeline, undoing single cuts, AI agents choosing cuts or a monthly
 * limit before those ship; "coming soon" is only for the public API and MCP server. Limits come
 * from the upload and retention rules, never typed by hand.
 */

export { homeLimits } from "./content-limits";
export { CLOSING, FAQ, FOOTER } from "./content-end";

export const NAV_LINKS = [
  { href: "#reel", label: "how it works" },
  { href: "#studio", label: "studios" },
  { href: "#capabilities", label: "features" },
  { href: "#faq", label: "faq" },
] as const;

export const HERO = {
  muted: "Film one take.",
  strong: "Get it back ready to post.",
  lead: "Upload a video and Take Studio trims the pauses, swaps your green screen for a studio and writes captions that match the cut.",
} as const;

/** The fan of product cards: only screens that show features that exist today. */
export const FAN_CARDS = [
  { image: "fan-charcoal", label: "Charcoal studio", href: "#studio" },
  { image: "fan-key", label: "Green screen out", href: "#studio" },
  { image: "fan-captions", label: "Captions", href: "#capabilities" },
  { image: "fan-studios", label: "Six built in studios", href: "#studio" },
  { image: "fan-ready", label: "One take, done", href: "#reel" },
  { image: "fan-upload", label: `Upload up to ${minutes} minutes`, href: "#limits" },
  { image: "fan-library", label: "All your takes", href: "#capabilities" },
  { image: "fan-brick", label: "Brick studio", href: "#studio" },
] as const;

export const REEL = {
  muted: "One take in.",
  strong: "A finished video out.",
  label:
    "A green screen take: pauses are removed, the background changes through four studios, and captions appear",
} as const;

export const PROOF = {
  eyebrow: "Made for solo creators",
  muted: "You film alone.",
  strong: "Post wherever your people are.",
  platforms: [
    "YouTube",
    "TikTok",
    "Instagram Reels",
    "LinkedIn",
    "Shorts",
    "Course videos",
    "Podcasts",
  ],
  formats: ["MP4", "MOV", resolution, `${minutes} min`, `${gigabytes} GB`, "SRT", "TXT"],
} as const;

export const STUDIO = {
  eyebrow: "The studio floor",
  muted: "Three jobs you used to do by hand.",
  strong: "Done while you make a coffee.",
  words: ["Trim.", "Key.", "Caption."],
  srOnly: "Trim, key, caption.",
  trim: {
    chip: "01 · Trim",
    title: "Every pause, found and cut",
    text: "Take Studio finds the silent gaps and cuts them out. You get the trimmed video back, with how much was removed, and the original stays yours to download.",
    metaLeft: "12 pauses removed",
    metaRight: "38.4 s saved",
  },
  key: {
    chip: "02 · Key",
    title: "Six studios, or your own",
    text: "The green screen goes. Pick a built in studio or upload any image.",
    swatches: [
      { image: "studio-blue", alt: "Studio blue studio" },
      { image: "studio-charcoal", alt: "Charcoal studio" },
      { image: "studio-orange", alt: "Orange set studio" },
      { image: "studio-paper", alt: "Paper sweep studio" },
      { image: "studio-sage", alt: "Sage studio" },
      { image: "studio-brick", alt: "Brick studio" },
    ],
  },
  caption: {
    chip: "03 · Caption",
    title: "Captions that match the cut",
    text: "An English transcript with timestamps, timed to the trimmed video.",
    srt: [
      "1",
      "00:00:00,000 --> 00:00:02,400",
      "Hey, welcome back. This is a quick look",
      "at how I record now.",
    ],
  },
  agents: {
    chip: "Coming soon",
    title: "Your AI agent can drive it too",
    text: "A public API and an MCP server, so an agent can upload a take, pick a studio and fetch the captions without you opening the app.",
  },
  fill: ["No editing timeline.", "No retakes for a long pause.", "No typing captions by hand."],
  cta: "Upload your first take",
} as const;

export const CAPABILITIES = {
  eyebrow: "What it does",
  muted: "Four jobs, one upload.",
  strong: "Nothing to learn.",
  tiles: [
    {
      key: "pauses",
      title: "Pauses out",
      text: "Silent gaps go. The original is always kept for download.",
      media: "tile-pauses",
      width: 720,
      height: 720,
    },
    {
      key: "studio",
      title: "Studio in",
      text: "Six built in studios, or any image you upload.",
      media: "tile-studio",
      width: 720,
      height: 960,
    },
    {
      key: "transcript",
      title: "Transcript",
      text: "Timestamps on every paragraph. Download SRT or TXT.",
      media: "tile-transcript",
      width: 720,
      height: 720,
    },
    {
      key: "agents",
      title: "Built for agents",
      text: "An API and MCP server so agents can do it for you. Coming soon.",
      media: null,
      width: 840,
      height: 672,
    },
  ],
} as const;

export const LIMITS = {
  eyebrow: "The limits",
  muted: "Simple limits.",
  strong: "Free while we're in beta.",
} as const;
