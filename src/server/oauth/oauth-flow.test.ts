import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  account,
  oauthAccessToken,
  oauthClient,
  oauthClientResource,
  oauthConsent,
  oauthRefreshToken,
  rateLimit,
  session,
  signInEmailAttempt,
  user,
  verification,
} from "@/db/schema";
import { type TestDb, openTestDb } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { OAUTH_REGISTER_PER_HOUR, createAuth } from "../auth";
import { protectedResourceMetadata } from "./metadata";
import { ENV, ORIGIN, REDIRECT, RESOURCE, sent, type Registered } from "./oauth-flow-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_oauth" });
  db = testDb.db;
  auth = createAuth(db, ENV, {
    sendEmail: async (email) => {
      sent.push(email);
      return { ok: true, data: { id: "em_1" } };
    },
  });
  for (const table of [
    oauthAccessToken,
    oauthRefreshToken,
    oauthConsent,
    oauthClientResource,
    oauthClient,
    session,
    account,
    verification,
    rateLimit,
    signInEmailAttempt,
  ])
    await db.delete(table);
  await db.delete(user);
});
afterAll(() => testDb?.close());
let auth: ReturnType<typeof createAuth>;
let ip = 0;
const jsonPost = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  auth.handler(
    new Request(`${ORIGIN}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "x-forwarded-for": `203.0.113.${(ip += 1)}`,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
async function register(redirect = REDIRECT): Promise<Response> {
  return jsonPost("/api/auth/oauth2/register", {
    client_name: "Test assistant",
    redirect_uris: [redirect],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    application_type: "native",
  });
}
describe("discovery and registration (AC-13)", () => {
  it("the protected resource names /mcp, the issuer and header only", () => {
    expect(protectedResourceMetadata(`${ORIGIN}/`)).toEqual({
      resource: RESOURCE,
      authorization_servers: [`${ORIGIN}/api/auth`],
      bearer_methods_supported: ["header"],
    });
  });

  it("the authorization server document lists S256 only and the code and refresh grants", async () => {
    const res = await auth.handler(
      new Request(`${ORIGIN}/api/auth/.well-known/oauth-authorization-server`),
    );
    const doc = (await res.json()) as Record<string, unknown>;
    expect(doc.code_challenge_methods_supported).toEqual(["S256"]);
    expect(doc.grant_types_supported).toEqual(
      expect.arrayContaining(["authorization_code", "refresh_token"]),
    );
    expect(doc.registration_endpoint).toBe(`${ORIGIN}/api/auth/oauth2/register`);
    expect(doc.token_endpoint).toBe(`${ORIGIN}/api/auth/oauth2/token`);
  });

  it("registers a client and links it to the /mcp resource; a bad redirect is refused", async () => {
    const ok = await register();
    expect(ok.status).toBe(201);
    const { client_id } = (await ok.json()) as Registered;
    const links = await db
      .select()
      .from(oauthClientResource)
      .where(eq(oauthClientResource.clientId, client_id));
    expect(links.map((l) => l.resourceId)).toEqual([RESOURCE]);
    const bad = await register("http://evil.example/cb");
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const wild = await register("https://*.evil.example/cb");
    expect(wild.status).toBeGreaterThanOrEqual(400);
    const custom = await register("com.example.app:/callback");
    expect(custom.status).toBeGreaterThanOrEqual(400);
    const loopback = await register("http://127.0.0.1:8123/cb");
    expect(loopback.status).toBe(201);
    // No application_type sent: a loopback redirect still registers (inferred as native).
    const bare = await jsonPost("/api/auth/oauth2/register", {
      client_name: "Bare assistant",
      redirect_uris: ["http://127.0.0.1:8124/cb"],
    });
    expect(bare.status).toBe(201);
  });
});
describe("registration rate limit (AC-13)", () => {
  it("allows 20 registrations an hour from one address and answers 429 to the 21st", async () => {
    // Same wiring as the Worker: the caller's address comes from cf-connecting-ip.
    const withIp = createAuth(db, ENV, {
      clientIpHeader: "cf-connecting-ip",
      sendEmail: async () => ({ ok: true, data: { id: "em_1" } }),
    });
    const registerFrom = (address: string) =>
      withIp.handler(
        new Request(`${ORIGIN}/api/auth/oauth2/register`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: ORIGIN,
            "cf-connecting-ip": address,
          },
          body: JSON.stringify({
            client_name: "Rate test assistant",
            redirect_uris: [REDIRECT],
            token_endpoint_auth_method: "none",
            application_type: "native",
          }),
        }),
      );
    for (let n = 0; n < OAUTH_REGISTER_PER_HOUR; n += 1) {
      expect((await registerFrom("198.18.0.77")).status).toBe(201);
    }
    expect((await registerFrom("198.18.0.77")).status).toBe(429);
    // Another address is not held back by it.
    expect((await registerFrom("198.18.0.78")).status).toBe(201);
  });
});
