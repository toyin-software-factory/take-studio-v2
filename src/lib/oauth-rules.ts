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

const SIGNED_QUERY_PARAMS = ["sig", "exp", "ba_iat", "ba_pl"] as const;

/** True when the client asked for a fresh login (`prompt` holds `login`). */
export function oauthWantsFreshLogin(search: URLSearchParams): boolean {
  return (search.get("prompt") ?? "").split(/\s+/).includes("login");
}

/**
 * Where sign in returns to when an OAuth client sent the creator here. Better Auth's login
 * redirect carries the original authorize query plus signature fields; dropping those and
 * replaying the rest on the authorize endpoint lets the flow carry on to the consent page.
 * Sign in itself is the fresh login a `prompt=login` asks for, so `login` is dropped from the
 * replayed `prompt` (kept, the provider would send the creator back here again); the page also
 * shows the form, not an instant redirect, for a signed in creator when a fresh login was asked.
 * The path is fixed (never taken from the query), so this cannot be an open redirect. A query
 * without a `client_id` and `sig` is not an OAuth hand off, so it returns null.
 */
export function oauthResumePath(search: URLSearchParams): string | null {
  if (!search.has("client_id") || !search.has("sig")) return null;
  const params = new URLSearchParams(search);
  for (const name of SIGNED_QUERY_PARAMS) params.delete(name);
  const prompt = (params.get("prompt") ?? "").split(/\s+/).filter((p) => p !== "" && p !== "login");
  if (prompt.length > 0) params.set("prompt", prompt.join(" "));
  else params.delete("prompt");
  return `/api/auth/oauth2/authorize?${params.toString()}`;
}

/**
 * AC-13 redirect policy: `https`, or `http` on a loopback host (localhost, 127.0.0.1, [::1]),
 * and no wildcard or credentials. The plugin also accepts native private use schemes such as
 * `com.example.app:/callback`; we do not.
 */
export function redirectUriAllowed(uri: string): boolean {
  if (uri.includes("*")) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "" || url.hash !== "") return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}
