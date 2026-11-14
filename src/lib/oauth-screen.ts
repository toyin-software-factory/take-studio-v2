import { z } from "zod";
import { keyDate } from "./api-keys-screen";

/**
 * Words and shapes for the OAuth consent page and the connected apps list (spec 0019 AC-14,
 * AC-15). Pure: the components and the tests share these. Nothing here holds or logs a token or
 * a code; a client name is only ever shown as text.
 */

export const CONSENT_PATH = "/oauth/consent";

/** What an assistant can do once allowed (AC-15 step 8): fixed words, not read from the scope. */
export const CONSENT_CAN: readonly string[] = [
  "Read your takes: titles, transcripts, cut reasons and video links.",
  "Run edits on your takes, like trimming pauses or changing the background.",
  "Delete a take, but only when you confirm it each time.",
];

export const CONSENT_COPY = {
  title: "Allow this app to use your Take Studio?",
  appLabel: "App",
  returnLabel: "It sends you back to",
  canIntro: "If you allow it, this app can:",
  cannot: "It can't see your password or change your sign in. You can disconnect it at any time.",
  allow: "Allow",
  deny: "Deny",
  working: "One moment…",
  failed:
    "We couldn't finish that. Check your connection and try again. If it keeps failing, start again from the app.",
  unknownApp:
    "We don't know this app, so we can't ask you to allow it. Go back to the app and try again.",
  unknownAppTitle: "This request can't be shown",
  unnamed: "An app without a name",
} as const;

export const CONNECTED_COPY = {
  heading: "Connected apps",
  intro:
    "Assistants you allowed to use Take Studio as you. Disconnect one and it stops working right away.",
  empty: "No apps are connected. When you allow an assistant, it shows up here.",
  loading: "Loading your connected apps…",
  loadFailed: "We couldn't load your connected apps. Check your connection, then try again.",
  retry: "Try again",
  disconnectFailed: "We couldn't disconnect the app. Check your connection, then try again.",
  disconnected: "Disconnected.",
  neverUsed: "Never used",
} as const;

/** The web addresses an app returns you to, as bare hosts: no path, no query, no duplicates. */
export function redirectHosts(uris: readonly string[]): readonly string[] {
  const hosts: string[] = [];
  for (const uri of uris) {
    let host: string;
    try {
      const url = new URL(uri);
      // A custom scheme (an app on this computer) is shown whole up to the host, so it is clear
      // the link opens an app, not a website.
      host = /^https?:$/.test(url.protocol) ? url.host : `${url.protocol}//${url.host}`;
    } catch {
      continue;
    }
    if (!hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

/** The name to show: trimmed, and a fixed line when the app gave none. */
export function clientLabel(name: string | null | undefined): string {
  // Anyone can register a client (no sign in), so the name is untrusted text: control and
  // direction characters go, runs of space become one, and a long name is cut, so a page of
  // text or a line that flips the layout cannot stand in for the app's name.
  const cleaned = (name ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned === "") return CONSENT_COPY.unnamed;
  return cleaned.length > CLIENT_NAME_MAX ? `${cleaned.slice(0, CLIENT_NAME_MAX - 1)}…` : cleaned;
}

/** The longest app name the consent page and the connected apps list show. */
export const CLIENT_NAME_MAX = 60;

/** The answer of POST /api/auth/oauth2/consent: where to send the browser next. */
export const consentAnswerSchema = z.object({ url: z.string().min(1) });

const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "vbscript:", "file:", "blob:"]);

/**
 * The address to follow after Allow or Deny, or null when it is not one to follow. The server
 * only answers with a redirect URI the app registered; this also refuses a script scheme.
 */
export function followableUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return BLOCKED_SCHEMES.has(url.protocol) ? null : url.href;
  } catch {
    return null;
  }
}

/** A connected app as GET /api/connected-apps returns it (ids and times, never a token). */
export const connectedAppSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  connectedAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export const connectedAppsSchema = z.object({ apps: z.array(connectedAppSchema) });
export type ConnectedAppView = z.infer<typeof connectedAppSchema>;

export const connectedDate = (iso: string): string => keyDate(iso);
export const connectedLastUsed = (iso: string | null): string =>
  iso === null ? CONNECTED_COPY.neverUsed : keyDate(iso);

/** A disconnect is done on 204, or 404 (already gone: another tab or a retry). */
export const disconnectDone = (status: number | null): boolean => status === 204 || status === 404;
