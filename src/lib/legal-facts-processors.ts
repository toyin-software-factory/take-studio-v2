/* ------------------------------------------------------------------ */
/* Processors (AC-4).                                                   */
/* ------------------------------------------------------------------ */

export type Processor = {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly receives: string;
  readonly doesNotReceive: string;
  readonly location: string;
  /** A link to the service's own privacy addendum, when it asks us to point to it. */
  readonly addendumUrl?: string;
  /** Always false: we never let a service train on creator content. The test pins it. */
  readonly trainsOnContent: false;
  /** Env variable names this service's secrets use (checked against the env schemas). */
  readonly envNames: readonly string[];
  /** Runtime dependencies in package.json that talk to this service. */
  readonly packages: readonly string[];
};

/** Cloudflare's Turnstile Privacy Addendum; Cloudflare asks us to reference it (B2-T185). */
export const TURNSTILE_ADDENDUM_URL = "https://www.cloudflare.com/turnstile-privacy-policy/";

export const PROCESSORS: readonly Processor[] = [
  {
    id: "cloudflare",
    name: "Cloudflare",
    role: "Hosts the website and stores your video files (Workers and R2).",
    receives: "Your original and finished videos, preview images, and every web request.",
    doesNotReceive: "Nothing is kept from you that the service needs to run.",
    location: "Global network; files are stored in the R2 region we chose.",
    trainsOnContent: false,
    envNames: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"],
    packages: ["@opennextjs/cloudflare", "aws4fetch"],
  },
  {
    id: "neon",
    name: "Neon",
    role: "Holds our database (Postgres).",
    receives: "Your account details, take titles, transcripts, cuts, job records and usage counts.",
    doesNotReceive: "Video or audio files.",
    location: "Hosted by Neon in the region we chose.",
    trainsOnContent: false,
    envNames: ["DATABASE_URL"],
    packages: ["postgres"],
  },
  {
    id: "trigger",
    name: "Trigger.dev",
    role: "Runs the video jobs that trim, key and render your take.",
    receives:
      "File keys and IDs, and your video while a job runs (it passes through their machines).",
    doesNotReceive:
      "Your email address. Transcript words pass through its jobs while they run (the AI edit reads them); we do not send transcripts to it for storage.",
    location: "Trigger.dev cloud.",
    trainsOnContent: false,
    envNames: ["TRIGGER_SECRET_KEY"],
    packages: ["@trigger.dev/sdk"],
  },
  {
    id: "deepgram",
    name: "Deepgram",
    role: "Turns your audio into a transcript.",
    receives:
      "The audio of your take. If you turn on Follow my voice while you record with a script, your microphone audio is also sent live to Deepgram, only while you record. We do not store that live audio.",
    doesNotReceive:
      "Your video, your name or your email. We ask Deepgram not to use your audio to train its models. The short lived access token we ask Deepgram for, so your browser can connect while you record, carries no personal data.",
    location: "Deepgram cloud.",
    trainsOnContent: false,
    envNames: ["DEEPGRAM_API_KEY", "DEEPGRAM_REALTIME_API_KEY"],
    packages: [],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    role: "Suggests which words to fix and which pauses to cut (the AI edit).",
    receives:
      "Transcript words, which words the transcriber was unsure of, where the pauses are, and the script you typed or pasted when the take has one.",
    doesNotReceive:
      "Video or audio files, or your account name or email. Words you say or type into a script still reach it, including any name or email among them.",
    location: "Anthropic cloud.",
    trainsOnContent: false,
    envNames: ["ANTHROPIC_API_KEY"],
    packages: ["@anthropic-ai/sdk"],
  },
  {
    id: "resend",
    name: "Resend",
    role: "Sends sign in links, take ready or failed emails, and a notice when our Terms or Privacy Policy change.",
    receives: "Your email address and the message we send.",
    doesNotReceive: "Your videos or transcripts.",
    location: "Resend cloud.",
    trainsOnContent: false,
    envNames: ["RESEND_API_KEY"],
    packages: ["resend"],
  },
  {
    id: "sentry",
    name: "Sentry",
    role: "Collects error reports so we can fix problems.",
    receives: "Error details cleaned down to IDs, with no video, transcript, email or cookies.",
    doesNotReceive: "Personal data: user info, cookies, headers and request bodies are turned off.",
    location: "Sentry cloud.",
    trainsOnContent: false,
    envNames: ["SENTRY_DSN"],
    packages: ["@sentry/core", "@sentry/nextjs", "@sentry/node"],
  },
  {
    id: "turnstile",
    name: "Cloudflare Turnstile",
    role: "Checks that a visitor who drops a video before signing in is not a bot.",
    receives: "A one time check token and the visitor's network address, when you drop a video.",
    doesNotReceive: "Your videos, transcripts or email address.",
    location: "Cloudflare global network.",
    addendumUrl: TURNSTILE_ADDENDUM_URL,
    trainsOnContent: false,
    envNames: ["TURNSTILE_SECRET_KEY", "TURNSTILE_SITE_KEY"],
    packages: [],
  },
  {
    id: "google",
    name: "Google sign in",
    role: "Lets you sign in with your Google account.",
    receives: "Your sign in request.",
    doesNotReceive: "Your videos or transcripts. We receive your email, name and picture from it.",
    location: "Google.",
    trainsOnContent: false,
    envNames: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    packages: [],
  },
];

/** Env names that belong to no data processor (our own secrets and addresses). */
export const NON_PROCESSOR_ENV: readonly string[] = [
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "USAGE_HASH_SECRET",
  "EMAIL_FROM",
  "EMAIL_LINK_SECRET",
];

/**
 * Runtime dependencies known not to send data to a third party. A new dependency must go here or
 * in a processor's `packages`, so an analytics or payments SDK cannot slip in unseen.
 */
export const NON_DATA_PACKAGES: readonly string[] = [
  "@better-auth/oauth-provider",
  "@modelcontextprotocol/sdk",
  "better-auth",
  "class-variance-authority",
  "clsx",
  "drizzle-orm",
  "gsap",
  "lenis",
  "lucide-react",
  "next",
  "radix-ui",
  "react",
  "react-dom",
  "sonner",
  "tailwind-merge",
  "three",
  "zod",
];
