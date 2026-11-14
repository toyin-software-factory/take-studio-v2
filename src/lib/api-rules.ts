/**
 * Pure rules for API keys (spec 0018). Limits, the key format and the hash live here so the
 * routes, the guard and the tests read one source. Uses Web Crypto, which works the same in the
 * Worker and in Trigger.dev tasks. Never log or store a raw key.
 */

export const API_KEYS = {
  /** Keys a creator may hold at once (AC-1). */
  maxPerCreator: 5,
  nameMaxLength: 60,
  /** `last_used_at` is written at most this often per key (AC-10). */
  lastUsedEveryMs: 60 * 60 * 1000,
} as const;

export const API_RATE = {
  /** Requests a key may make in one UTC minute (AC-9). */
  perMinute: 120,
  /** Rate window rows older than this are deleted by the cleanup sweep. */
  keepMs: 60 * 60 * 1000,
} as const;

export const API_KEY_PREFIX = "tsk_";
const SECRET_BYTES = 32;
/** 32 bytes in base64url without padding is 43 characters. */
const SECRET_CHARS = 43;
const PREFIX_CHARS = 8;
const KEY_PATTERN = /^tsk_[A-Za-z0-9_-]{43}$/;

/** Total length of a key: `tsk_` plus 43 characters. */
export const API_KEY_LENGTH = API_KEY_PREFIX.length + SECRET_CHARS;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** A new key: `tsk_` plus 32 random bytes in base64url. `bytes` is for tests only. */
export function generateApiKey(
  bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(SECRET_BYTES)),
): string {
  if (bytes.length !== SECRET_BYTES) throw new Error("api key needs 32 bytes");
  return `${API_KEY_PREFIX}${base64url(bytes)}`;
}

/** The key if it has the exact format, else null. A format check only; the hash lookup decides. */
export function parseApiKey(value: string): string | null {
  return KEY_PATTERN.test(value) ? value : null;
}

/** The first 8 characters after `tsk_`, kept to tell keys apart. Empty for a malformed key. */
export function apiKeyPrefix(key: string): string {
  return parseApiKey(key) === null
    ? ""
    : key.slice(API_KEY_PREFIX.length, API_KEY_PREFIX.length + PREFIX_CHARS);
}

/** SHA-256 hex of the full key (Web Crypto). The key is 256 bits of randomness, so no salt. */
export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The key in an `Authorization` header, or null when the header is not `Bearer <well formed
 * key>`. A caller treats any present header as the key path, so null here means 401, never a
 * fall back to the session (AC-5).
 */
export function bearerKey(header: string): string | null {
  const match = /^Bearer +([^\s]+)$/i.exec(header.trim());
  return match?.[1] ? parseApiKey(match[1]) : null;
}

/** A key name trimmed, or null when it is empty or longer than 60 characters (AC-1). */
export function normalizeKeyName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= API_KEYS.nameMaxLength ? trimmed : null;
}

/** Start of the UTC minute of `at` (the rate window key). */
export function rateWindowStart(at: Date): Date {
  return new Date(Math.floor(at.getTime() / 60_000) * 60_000);
}

/** Seconds until the next UTC minute: `60 - secondsIntoMinute`, at least 1 (AC-9). */
export function retryAfterSeconds(at: Date): number {
  return Math.max(1, 60 - at.getUTCSeconds());
}

/** True when `count` (after counting this request) is over the per minute limit. */
export function isOverRateLimit(count: number): boolean {
  return count > API_RATE.perMinute;
}
