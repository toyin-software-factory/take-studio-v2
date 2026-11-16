import { hmacSha256Hex } from "./usage-hash";

/**
 * Hash of the visitor's address for the drop box's daily count (spec 0023). HMAC with
 * USAGE_HASH_SECRET and its own label so it never matches another hash. An IPv6 address keeps its
 * first 64 bits (the network part), so one device cannot dodge the count by changing the rest.
 */
export function guestIpKey(ip: string): string {
  const trimmed = ip.trim().toLowerCase();
  if (!trimmed.includes(":")) return trimmed;
  const [head = "", tail] = trimmed.split("::");
  const front = head === "" ? [] : head.split(":");
  const back = tail === undefined || tail === "" ? [] : tail.split(":");
  const fill =
    tail === undefined ? [] : Array<string>(Math.max(0, 8 - front.length - back.length)).fill("0");
  return [...front, ...fill, ...back]
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":");
}

export function hashGuestIp(ip: string, secret: string): Promise<string> {
  return hmacSha256Hex(`guest-ip:${guestIpKey(ip)}`, secret);
}

/** 32 random bytes as base64url, and the SHA-256 hex of it stored in `guest_claim.token_hash`. */
export function newGuestToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export async function hashGuestToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
