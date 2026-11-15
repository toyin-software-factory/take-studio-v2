import { createHash, randomBytes } from "node:crypto";
import { TEST_ORIGIN } from "../mcp/test-wiring";

/**
 * Spec 0019 AC-13 and the data and endpoint parts of AC-14, through the real Better Auth handler
 * over a test database: register, authorize, consent, token, refresh rotation, hashed storage,
 * S256 only, `resolveCreator` on tokens, `/mcp` isolation, disconnect, cleanup and the account
 * deletion cascade. Synthetic accounts only (`*.example.test`); tokens are never printed.
 */

export const ORIGIN = TEST_ORIGIN;
export const RESOURCE = `${ORIGIN}/mcp`;
export const REDIRECT = "http://127.0.0.1:9/cb";
export const ENV = {
  BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789",
  BETTER_AUTH_URL: ORIGIN,
  GOOGLE_CLIENT_ID: "x",
  GOOGLE_CLIENT_SECRET: "x",
};
export const sent: { text?: string }[] = [];
export type Registered = { client_id: string };
export const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};
export const bearer = (token: string) =>
  new Request(`${ORIGIN}/api/takes`, { headers: { authorization: `Bearer ${token}` } });
