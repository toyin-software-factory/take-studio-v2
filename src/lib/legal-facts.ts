import { ANALYTICS_EVENT_NAMES, ANALYTICS_RETENTION_MONTHS } from "./analytics-events";
import { DEEPGRAM_OPTIONS } from "./deepgram";
import { CONTACT_EMAIL } from "./site";
import { MEDIA_LIMITS, VIDEO_RETENTION_DAYS } from "./take-rules";
import type { UsageAccount } from "./usage-rules";

/**
 * The facts the Privacy and Terms pages state (spec 0015). Pure: no I/O, no clock. Numbers come
 * from the rule constants and are never retyped; the services and the stored data are listed here
 * once, and `legal-facts.test.ts` fails when the code and this file drift apart.
 *
 * Changing anything the pages promise (a service, a cookie, a stored field, a retention period, a
 * new event, a payment step) means changing this file, the page copy and the `LEGAL_VERSION`
 * date together.
 */

/* ------------------------------------------------------------------ */
/* Facts only Toyin can supply (AC-8). `null` until supplied: the pages */
/* show no invented value and keep the Draft banner.                    */
/* ------------------------------------------------------------------ */

export type LegalEntity = {
  readonly name: string | null;
  readonly postalAddress: string | null;
  /** The address for privacy requests; the page uses `CONTACT_EMAIL` until this is set. */
  readonly privacyEmail: string | null;
  readonly governingLaw: string | null;
  readonly disputeVenue: string | null;
  /** ISO date the terms take effect. */
  readonly effectiveDate: string | null;
};

/** PLACEHOLDER: every value below is Toyin's to supply (spec 0015 Follow up, questions 1 and 2). */
export const LEGAL_ENTITY: LegalEntity = {
  name: null,
  postalAddress: null,
  privacyEmail: null,
  governingLaw: null,
  disputeVenue: null,
  effectiveDate: null,
};

/** The address shown for privacy requests: Toyin's, else the site contact. */
export function privacyContactEmail(entity: LegalEntity = LEGAL_ENTITY): string {
  return entity.privacyEmail ?? CONTACT_EMAIL;
}

/* ------------------------------------------------------------------ */
/* Toyin's answers to spec 0015 questions 3 to 7 (C-30, recommended).  */
/* Each answer from Toyin is a one line change here.                    */
/* ------------------------------------------------------------------ */

/** Toyin's answer to question 5 (C-30): 16. */
export const MINIMUM_AGE = 16;
/** Toyin's answer to question 6 (C-30): worldwide. */
export const SERVICE_REGION: "worldwide" | "limited" = "worldwide";
/** Toyin's answer to question 3 (C-30): `notice` is a line under the sign in form, no checkbox, nothing stored. */
export const AGREEMENT: "notice" | "checkbox" | "notice_and_stored" = "notice";
/** Toyin's answer to question 7 (C-30): `date_and_email` is the date plus an email for material changes. */
export const CHANGE_NOTICE: "date_and_email" | "date_only" = "date_and_email";
/** Toyin's answer to question 4 (C-30): "email us" until the button ships. False says "email us, done within 30 days"; true names the control. Shipped with B2-T33 (the account menu's Delete account). */
export const ACCOUNT_DELETE_SELF_SERVE = true;
/** Days we take to delete an account asked for by email. */
export const ACCOUNT_DELETE_EMAIL_DAYS = 30;

/* ------------------------------------------------------------------ */
/* Version and review (AC-7, AC-11).                                    */
/* ------------------------------------------------------------------ */

/** ISO dates, bumped by hand whenever the page text changes (the text hash test forces it). */
export const LEGAL_VERSION = {
  privacy: "2026-11-14",
  terms: "2026-11-14",
} as const;

export type Review = {
  readonly reviewedBy: string | null;
  readonly reviewedOn: string | null;
  readonly privacyVersion: string | null;
  readonly privacyTextHash: string | null;
  readonly termsVersion: string | null;
  readonly termsTextHash: string | null;
  readonly allowanceMinutes: number | null;
  readonly limitEnabled: boolean | null;
};

/** All `null` until a lawyer signs off; a small PR sets them (spec 0015 build plan step 8). */
export const REVIEW: Review = {
  reviewedBy: null,
  reviewedOn: null,
  privacyVersion: null,
  privacyTextHash: null,
  termsVersion: null,
  termsTextHash: null,
  allowanceMinutes: null,
  limitEnabled: null,
};

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
  /** Always false: we never let a service train on creator content. The test pins it. */
  readonly trainsOnContent: false;
  /** Env variable names this service's secrets use (checked against the env schemas). */
  readonly envNames: readonly string[];
  /** Runtime dependencies in package.json that talk to this service. */
  readonly packages: readonly string[];
};

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
    receives: "The audio of your take.",
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
    role: "Sends sign in links and take ready or failed emails.",
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

/* ------------------------------------------------------------------ */
/* What we collect (AC-5).                                              */
/* ------------------------------------------------------------------ */

export type Collected = {
  readonly what: string;
  readonly why: string;
  readonly kept: string;
  readonly deletedWith: string;
};

const DAYS = `${VIDEO_RETENTION_DAYS} days`;

export const COLLECTED: readonly Collected[] = [
  {
    what: `Product events: a count of what you do (${ANALYTICS_EVENT_NAMES.join(", ")}). They hold no video, words, titles or email, only small codes and numbers`,
    why: "To learn how Take Studio is used and where it fails. We use our own database, no cookie and no third party for this.",
    kept: `While the account exists. Download, change, failure and limit events are removed after ${ANALYTICS_RETENTION_MONTHS} months.`,
    deletedWith: "Deleting the account.",
  },
  {
    what: "Cut counts: when you download a video, how many cuts of each kind were kept, undone or added (numbers only), and a mark with a time when you tell us a cut was missed (cuts_reviewed, cut_missed)",
    why: "To measure how well automatic cuts work. They hold no words, video or reason for a cut.",
    kept: `While the account exists. Removed after ${ANALYTICS_RETENTION_MONTHS} months.`,
    deletedWith: "Deleting the account.",
  },
  {
    what: "API keys: the name you give a key, a one way hash of the key, its first few characters, when it was made and last used, and a count of requests per key per minute. The key itself is shown once and never stored",
    why: "To let your own tools and agents use Take Studio as you, and to slow down misuse.",
    kept: "A key is kept until you revoke it or delete the account. Request counts are kept about an hour.",
    deletedWith: "Revoking the key or deleting the account.",
  },
  {
    what: "Email, name and picture from Google, or just your email for a sign in link",
    why: "To make and recognise your account.",
    kept: "While the account exists.",
    deletedWith: "Deleting the account.",
  },
  {
    what: "Take titles",
    why: "To show your library.",
    kept: "Until you delete the take.",
    deletedWith: "Deleting the take or the account.",
  },
  {
    what: "Videos (the original and the finished one)",
    why: "To make your finished video.",
    kept: `${DAYS} from the end of the upload, then deleted. You can delete them sooner.`,
    deletedWith: "Deleting the take or the account.",
  },
  {
    what: "Your script, if you add one when you record or upload (up to 20,000 characters), and whether the video was recorded in Take Studio or uploaded as a file",
    why: "To show it while you record and to help make the cuts.",
    kept: "Until you delete the take. It stays when the video expires after the retention period.",
    deletedWith: "Deleting the take or the account.",
  },
  {
    what: "A draft of your script and your teleprompter settings, saved in this browser only (local storage keys ts.scriptDraft and ts.prompter, not cookies)",
    why: "So a draft is not lost and the teleprompter looks the way you left it.",
    kept: "On your device until the take is made or you sign out (the draft goes then; the teleprompter settings stay). It is never sent to us until you start the upload.",
    deletedWith: "Signing out (the draft), or clearing your browser data.",
  },
  {
    what: "Backgrounds you upload (images)",
    why: "To put you in front of your own backdrop.",
    kept: "Until you delete them. They do not expire after the video retention period.",
    deletedWith: "Deleting the background or the account.",
  },
  {
    what: "Transcripts, cuts and edits",
    why: "To make captions and the cut.",
    kept: "Until you delete the take.",
    deletedWith: "Deleting the take or the account.",
  },
  {
    what: "Usage seconds, stored under a keyed hash of your email (no readable email or ID)",
    why: "To count the monthly allowance and stop abuse.",
    kept: "Stays after the account is deleted, with no way to read an email from it.",
    deletedWith: "Not deleted with the account.",
  },
  {
    what: "Session records with IP address and user agent",
    why: "To keep you signed in and spot misuse.",
    kept: "Until the session ends or the account is deleted.",
    deletedWith: "Deleting the account.",
  },
  {
    what: "A hash of your email for sign in limits",
    why: "To slow down repeated sign in requests.",
    kept: "15 minutes.",
    deletedWith: "It expires by itself.",
  },
];

export type CookieFact = {
  readonly name: string;
  readonly purpose: string;
  readonly kept: string;
};

/** The only cookie (Better Auth session). No analytics or advertising cookie exists. */
export const COOKIES: readonly CookieFact[] = [
  {
    name: "better-auth.session_token",
    purpose: "Keeps you signed in. Needed for the site to work.",
    kept: "Until you sign out or the session expires.",
  },
];

/** What the pages say about the creator's choices. */
export const CHOICES = [
  "Delete a take at any time (every file and record goes).",
  "Delete your account.",
  "Turn off take emails with the link in any email.",
  "Contact us about your data.",
] as const;

/** The numbers the pages quote, read from the rule constants. */
export const LEGAL_NUMBERS = {
  retentionDays: VIDEO_RETENTION_DAYS,
  maxMinutes: MEDIA_LIMITS.maxDurationMs / 60_000,
  maxGigabytes: MEDIA_LIMITS.maxBytes / 1024 ** 3,
  maxLongSide: MEDIA_LIMITS.maxLongSide,
  maxShortSide: MEDIA_LIMITS.maxShortSide,
} as const;

/**
 * The standard free account the public pages use for the allowance, never the reader's own
 * (spec 0015 value sourcing): the pages cannot vary by who reads them.
 */
export const PUBLIC_VIEWER: UsageAccount = { accountHash: "public-viewer" };

/** Does Deepgram stay opted out of training? The test pins this to the request options. */
export const DEEPGRAM_OPTS_OUT = DEEPGRAM_OPTIONS.mip_opt_out === "true";

/* ------------------------------------------------------------------ */
/* Text hash, draft state and launch check (AC-7, AC-8, AC-11).        */
/* ------------------------------------------------------------------ */

/** Collapses whitespace and trims, so layout changes never change the hash. */
export function normalizeLegalText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** SHA-256 (hex) of the normalized text. Web Crypto, so it runs in Node and in the Worker. */
export async function legalTextHash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeLegalText(text));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The entity fields still `null`, by name. */
export function missingEntityFields(entity: LegalEntity): readonly string[] {
  return Object.entries(entity)
    .filter(([, value]) => value === null)
    .map(([key]) => key);
}

/** What the live pages show now, to compare with what was reviewed. */
export type LegalNow = {
  /** `null` until the pages exist to hash (spec 0015 step 2); the gate then fails. */
  readonly privacyTextHash: string | null;
  readonly termsTextHash: string | null;
  /** `null` when the allowance setting could not be read. */
  readonly allowance: { readonly minutes: number; readonly limitEnabled: boolean } | null;
};

/**
 * Why the Draft banner must show, empty when it can go. Unreadable allowance counts as a
 * reason (it never passes on a guess).
 */
export function draftReasons(input: {
  readonly entity: LegalEntity;
  readonly review: Review;
  readonly version: typeof LEGAL_VERSION;
  readonly now: LegalNow;
}): readonly string[] {
  const { entity, review, version, now } = input;
  const reasons: string[] = missingEntityFields(entity).map((f) => `entity.${f} is not set`);
  for (const [key, value] of Object.entries(review)) {
    if (value === null) reasons.push(`review.${key} is not set`);
  }
  if (review.privacyVersion !== version.privacy) reasons.push("privacy version was not reviewed");
  if (review.termsVersion !== version.terms) reasons.push("terms version was not reviewed");
  if (now.privacyTextHash === null) reasons.push("privacy text hash is not available");
  else if (review.privacyTextHash !== now.privacyTextHash) reasons.push("privacy text changed");
  if (now.termsTextHash === null) reasons.push("terms text hash is not available");
  else if (review.termsTextHash !== now.termsTextHash) reasons.push("terms text changed");
  if (now.allowance === null) {
    reasons.push("allowance could not be read");
  } else if (
    review.allowanceMinutes !== now.allowance.minutes ||
    review.limitEnabled !== now.allowance.limitEnabled
  ) {
    reasons.push("allowance differs from the reviewed one");
  }
  return reasons;
}

/* ------------------------------------------------------------------ */
/* Drift flag for /sync and review (AC-10).                             */
/* ------------------------------------------------------------------ */

/**
 * Files whose change can alter what the pages promise: dependencies, env names, the rules and
 * options the copy quotes, the stored fields, sign in and cookies, what the AI and email send.
 * A diff touching any of them without `legal-facts.ts` is flagged by `pnpm legal:drift`.
 */
export const LEGAL_WATCHED_PATHS: readonly string[] = [
  "package.json",
  "src/lib/env.ts",
  "src/lib/take-rules.ts",
  "src/lib/usage-rules.ts",
  "src/lib/deepgram.ts",
  "src/lib/ai-edit.ts",
  "src/lib/sentry-options.ts",
  "src/lib/storage-lifecycle.ts",
  "src/server/auth.ts",
  "src/db/schema/",
  "src/lib/email/",
];

export const LEGAL_FACTS_PATH = "src/lib/legal-facts.ts";

/** The watched files this diff touches, or none when `legal-facts.ts` changed too. */
export function legalDriftFlag(changedPaths: readonly string[]): readonly string[] {
  if (changedPaths.includes(LEGAL_FACTS_PATH)) return [];
  return changedPaths.filter((path) =>
    LEGAL_WATCHED_PATHS.some((w) => (w.endsWith("/") ? path.startsWith(w) : path === w)),
  );
}
