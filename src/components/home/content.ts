import { MEDIA_LIMITS, VIDEO_RETENTION_DAYS } from "@/lib/take-rules";
import { CONTACT_EMAIL } from "@/lib/site";

/**
 * Everything the homepage says (spec 0010, AC-2). Copy describes only what works today: no line
 * claims the cut review timeline, undoing single cuts, AI agents choosing cuts or a monthly
 * limit before those ship; "coming soon" is only for the public API and MCP server. Limits come
 * from the upload and retention rules, never typed by hand.
 */

const GB = 1024 ** 3;

/** The four limits of "The limits" section, from `MEDIA_LIMITS` and `VIDEO_RETENTION_DAYS`. */
export function homeLimits(): readonly {
  readonly value: number;
  readonly unit: string;
  readonly label: string;
}[] {
  return [
    {
      value: Math.round(MEDIA_LIMITS.maxDurationMs / 60_000),
      unit: "min",
      label: "Longest take you can upload",
    },
    {
      value: Math.round(MEDIA_LIMITS.maxBytes / GB),
      unit: "GB",
      label: "Biggest file, MP4 or MOV",
    },
    { value: MEDIA_LIMITS.maxShortSide, unit: "p", label: "Highest resolution in and out" },
    {
      value: VIDEO_RETENTION_DAYS,
      unit: "days",
      label: "We keep your videos, then delete them",
    },
  ];
}

const minutes = Math.round(MEDIA_LIMITS.maxDurationMs / 60_000);
const gigabytes = Math.round(MEDIA_LIMITS.maxBytes / GB);
const resolution = `${MEDIA_LIMITS.maxShortSide}p`;

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

export const FAQ = {
  eyebrow: "Questions",
  muted: "Before you upload.",
  strong: "The short answers.",
  items: [
    {
      q: "What do I need to film?",
      a: "One take on your phone or camera. Film in front of a green screen if you want a studio background. Without one, you still get the pauses trimmed and a transcript.",
    },
    {
      q: "Which files can I upload?",
      a: `MP4 or MOV, up to ${minutes} minutes long, about ${gigabytes} GB, and up to ${resolution}. We check the file type and size before upload. We check the length and resolution after upload, and a file over either limit fails with a message that names it.`,
    },
    {
      q: "Can I get the untrimmed video?",
      a: `Yes. Download the original next to the trimmed video for as long as it is kept, ${VIDEO_RETENTION_DAYS} days.`,
    },
    {
      q: "Which languages do transcripts support?",
      a: "English for now. Captions download as SRT, timed to the trimmed video, and as plain text.",
    },
    {
      q: "How long do you keep my videos?",
      a: `The original and the finished video are kept for ${VIDEO_RETENTION_DAYS} days and then deleted automatically. Transcripts stay until you delete the take. Deleting a take removes everything.`,
    },
    {
      q: "What does it cost?",
      a: "Nothing while we're in beta. Paid plans may come later, and we'll tell you before anything changes.",
    },
    {
      q: "Can an AI agent use Take Studio?",
      a: "Soon. A public API and an MCP server will let agents do everything the web app does.",
    },
  ],
} as const;

export const CLOSING = {
  eyebrow: "Ready when you are",
  muted: "Your next take,",
  strong: "without the edit.",
  lead: "Take Studio is in beta and free for now. Sign in with Google or an email link and upload your first take.",
  emailLabel: "Email",
  emailPlaceholder: "you@example.com",
  cta: "Email me a sign in link",
  signInNote: "Already have an account?",
  signInLink: "Sign in with Google or an email link",
  invalid: "Enter an email address like you@example.com.",
  sending: "Sending…",
  sentTitle: "Check your inbox.",
  sent: (email: string) =>
    `If ${email} can sign in, a link is on its way. It works once and expires in 15 minutes.`,
  questions: "Questions?",
  email: CONTACT_EMAIL,
} as const;

export const FOOTER = {
  columns: [
    {
      label: "Product",
      links: [
        { href: "#reel", label: "How it works" },
        { href: "#studio", label: "Studios" },
        { href: "#capabilities", label: "Features" },
        { href: "#faq", label: "FAQ" },
      ],
    },
    {
      label: "Account",
      links: [
        { href: "/sign-in", label: "Sign in" },
        { href: "/sign-in", label: "Upload a take" },
      ],
    },
    {
      label: "For agents",
      links: [
        { href: "#studio", label: "Public API (soon)" },
        { href: "#studio", label: "MCP server (soon)" },
      ],
    },
    // Privacy and Terms join this column when scope feature 16 ships.
    { label: "Legal", links: [{ href: `mailto:${CONTACT_EMAIL}`, label: CONTACT_EMAIL }] },
  ],
  note: `Videos are deleted after ${VIDEO_RETENTION_DAYS} days. Transcripts stay until you delete the take.`,
  year: 2026,
} as const;
