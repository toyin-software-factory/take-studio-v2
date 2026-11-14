/**
 * OAuth access token rules (spec 0019 AC-13, AC-14). Better Auth's OAuth provider stores every
 * token as the SHA-256 of the token in base64url (no padding); this is the same function, so a
 * lookup by hash finds the row. Nothing here logs or returns a token.
 */

/** SHA-256 base64url of a token (Web Crypto), the form `oauth_access_token.token` holds. */
export async function hashOauthToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** The token in `Bearer <token>`, or null when the header is not that shape. */
export function bearerToken(header: string): string | null {
  const match = /^Bearer +([^\s]+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
