/**
 * Signed links in emails (spec 0006, AC-6): the "Turn off these emails" link carries the user
 * ID and an HMAC of it under EMAIL_LINK_SECRET, so it works without signing in and can do
 * nothing but turn take emails off. Web Crypto, so it behaves the same in the Worker and in
 * Trigger.dev tasks. Never log the secret or the signature.
 */

const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(userId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(`take-emails-off:${userId}`)));
}

/** The hex HMAC-SHA-256 signature for a user's unsubscribe link. */
export function signUnsubscribe(userId: string, secret: string): Promise<string> {
  return hmac(userId, secret);
}

/** True only for the exact signature of `userId`, compared without an early exit. */
export async function verifyUnsubscribe(
  userId: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!userId || !signature || !secret) return false;
  const expected = await hmac(userId, secret);
  if (expected.length !== signature.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i += 1) {
    difference |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return difference === 0;
}

/** `{base}/emails/off?u=<userId>&s=<signature>`, absolute (base is BETTER_AUTH_URL). */
export async function unsubscribeUrl(
  baseUrl: string,
  userId: string,
  secret: string,
): Promise<string> {
  const url = new URL("/emails/off", baseUrl);
  url.searchParams.set("u", userId);
  url.searchParams.set("s", await signUnsubscribe(userId, secret));
  return url.toString();
}
