import { z } from "zod";

/**
 * Voice following token (spec 0021 step 2, AC-12): the numbers and the Deepgram grant shapes,
 * pure. The route mints a short lived Deepgram token for the creator's browser. The token is a
 * secret: never log it, never send it to Sentry or analytics, never put it in a URL.
 */
export const REALTIME_TOKEN = {
  /** Mints one creator may make in a rolling hour (spec 0021 API table). */
  perHour: 10,
  /** Mints one creator may make in a rolling day: bounds the spend a script of retries could cause. */
  perDay: 40,
  /** How long the token may be used to open a socket. An open socket outlives it. */
  ttlSeconds: 60,
  hourMs: 60 * 60 * 1000,
  dayMs: 24 * 60 * 60 * 1000,
  /** Mint rows older than this are deleted by the cleanup sweep (the day window plus a margin). */
  keepMs: 2 * 24 * 60 * 60 * 1000,
} as const;

export const DEEPGRAM_GRANT_URL = "https://api.deepgram.com/v1/auth/grant";

/** The body of `POST /v1/auth/grant`. */
export const grantRequestBody = (ttlSeconds: number = REALTIME_TOKEN.ttlSeconds) => ({
  ttl_seconds: ttlSeconds,
});

/** Deepgram's grant answer (an external response, so parsed). */
export const grantResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

/** What the route answers: the token and how long it can open a socket. */
export type RealtimeToken = {
  readonly token: string;
  readonly expiresInSeconds: number;
};

/** Which window refused a mint, or null when it may go ahead. Pure over the counts. */
export function mintRefusal(counts: {
  readonly lastHour: number;
  readonly lastDay: number;
}): "hourly" | "daily" | null {
  if (counts.lastHour >= REALTIME_TOKEN.perHour) return "hourly";
  if (counts.lastDay >= REALTIME_TOKEN.perDay) return "daily";
  return null;
}
