import { ANALYTICS_EVENT_NAMES, ANALYTICS_RETENTION_MONTHS } from "./analytics-events";
import { GUEST_DROPS_PER_ADDRESS_PER_DAY, GUEST_TTL_HOURS } from "./guest-rules";
import { MEDIA_LIMITS, VIDEO_RETENTION_DAYS } from "./take-rules";
import type { UsageAccount } from "./usage-rules";

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
    kept: "A key is kept until you revoke it or delete the account. Request counts are kept for about 75 minutes (longer while a large flood is still being cleared).",
    deletedWith: "Revoking the key or deleting the account.",
  },
  {
    what: "Connected apps: when you connect an app such as an AI assistant with your sign in, its name, the web addresses it returns you to, the permission you gave, one way hashes of its access and refresh tokens, and when they were made and expire. The tokens themselves are never stored",
    why: "To let the app you chose act as you in Take Studio, and to let you disconnect it.",
    kept: "A connection is kept until you disconnect the app or delete the account. Expired tokens are removed within a day or so. An app that was registered but never connected, or that you disconnected, is removed once it is more than 30 days old and has no connection left, so a disconnected older app goes within about 15 minutes.",
    deletedWith: "Disconnecting the app or deleting the account.",
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
  {
    what: "A hash of the network address of a request that sends a wrong API key or access token",
    why: "To slow down guessing and floods against the API.",
    kept: "About 75 minutes. The cleanup runs every 15 minutes and removes counts once their minute is an hour old. A large flood can keep them longer until a later run removes them.",
    deletedWith: "It expires by itself.",
  },
  {
    what: `A video dropped before you sign in (spec 0023): the video, a guest record with no name, and the email address you give so we can send the sign in link, if you give one. The guest cookie ts_guest links the browser to it`,
    why: "To keep the video for you until you sign in and add it to your account.",
    kept: `${GUEST_TTL_HOURS} hours from each drop. If you do not sign in by then, that video is deleted. When no video is left, the guest record and any address are deleted. If you sign in from the browser that dropped the video, the video moves to your account and follows the account rules. If you sign in with only a matching email address, you confirm the claim first, and then the video moves.`,
    deletedWith:
      "Expiry after 24 hours, or signing in and confirming the claim where one is needed (it becomes part of your account).",
  },
  {
    what: `A hash of the network address of a visitor who drops a video before signing in, and a daily count of dropped minutes for the whole site`,
    why: `To allow at most ${GUEST_DROPS_PER_ADDRESS_PER_DAY} drops a day for one address and to cap the daily cost of free drops. The site wide count holds no personal data.`,
    kept: "2 days.",
    deletedWith: "It expires by itself.",
  },
];

export type CookieFact = {
  readonly name: string;
  readonly purpose: string;
  readonly kept: string;
};

/**
 * The session cookie, and the guest drop box cookie (spec 0023, set only when a visitor drops a
 * video before signing in). No analytics or advertising cookie exists.
 */
export const COOKIES: readonly CookieFact[] = [
  {
    name: "better-auth.session_token",
    purpose: "Keeps you signed in. Needed for the site to work.",
    kept: "Until you sign out or the session expires.",
  },
  {
    name: "ts_guest",
    purpose:
      "Only if you drop a video before signing in: remembers that video for a day so it can be added to your account when you sign in. Needed for that feature to work.",
    kept: "24 hours.",
  },
];

export type DeviceStorageFact = {
  readonly store: "localStorage" | "sessionStorage";
  readonly name: string;
  readonly holds: string;
  readonly cleared: string;
};

/**
 * Everything kept in this browser's own storage (not cookies, never sent to us by the page).
 * It is the creator's own settings and an unsent draft, so no consent banner is needed, but the
 * Privacy page lists it. A test scans `src` and fails when a storage key is used and not listed.
 */
export const DEVICE_STORAGE: readonly DeviceStorageFact[] = [
  {
    store: "localStorage",
    name: "ts.prompter.<your account id>",
    holds:
      "Your teleprompter settings: speed, text size, whether Follow my voice is on and whether you have seen its note.",
    cleared: "Stays on this device until you clear your browser data.",
  },
  {
    store: "localStorage",
    name: "ts.scriptDraft.<your account id>",
    holds: "A draft of your script, so it is not lost if you leave the page.",
    cleared:
      "Removed once the take is made, when you sign out, or when you clear your browser data.",
  },
  {
    store: "sessionStorage",
    name: "take-studio:fan-paused",
    holds: "Whether you paused the moving cards on the home page.",
    cleared: "Removed when you close the tab.",
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
