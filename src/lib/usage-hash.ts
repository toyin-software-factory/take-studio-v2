/**
 * Usage account hash (spec 0002, AC-16). Usage is stored per account under an HMAC of the
 * canonical email, so it survives account deletion and rejoining without keeping the email.
 * Uses Web Crypto, which works the same in the Worker and in Trigger.dev tasks.
 */

/** Hash scheme version stored beside usage rows (`usage_month.hash_version`). */
export const USAGE_HASH_VERSION = 1;

const GMAIL_DOMAINS: ReadonlySet<string> = new Set(["gmail.com", "googlemail.com"]);

/**
 * Canonical form of an email for usage accounting:
 * lowercased and trimmed, `+tag` removed, and for Gmail the dots in the local part
 * removed and `googlemail.com` written as `gmail.com`.
 * Input without a usable `@` is returned lowercased and trimmed, unchanged otherwise.
 */
export function canonicalEmail(email: string): string {
  const lowered = email.trim().toLowerCase();
  const at = lowered.lastIndexOf("@");
  if (at <= 0 || at === lowered.length - 1) return lowered;

  const rawLocal = lowered.slice(0, at);
  const rawDomain = lowered.slice(at + 1);

  const plus = rawLocal.indexOf("+");
  const untagged = plus === -1 ? rawLocal : rawLocal.slice(0, plus);
  const isGmail = GMAIL_DOMAINS.has(rawDomain);
  const local = isGmail ? untagged.replaceAll(".", "") : untagged;
  const domain = isGmail ? "gmail.com" : rawDomain;

  // A local part that was only a tag ("+x@y") keeps its original form rather than becoming empty.
  return local === "" ? lowered : `${local}@${domain}`;
}

const encoder = new TextEncoder();

/** Lowercase hex of `HMAC_SHA256(message, secret)`. */
async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * The usage account hash for an email: `HMAC_SHA256(canonicalEmail(email), secret)` as hex.
 * `secret` is USAGE_HASH_SECRET from `parseUsageEnv()`; never log it or the email.
 */
export function usageAccountHash(email: string, secret: string): Promise<string> {
  return hmacSha256Hex(canonicalEmail(email), secret);
}
