import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteUnusedOauthClients, disconnectConsent } from "@/db/data/oauth";
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
import { createAuth } from "../auth";
import {
  ENV,
  ORIGIN,
  REDIRECT,
  RESOURCE,
  pkce,
  sent,
  type Registered,
} from "./oauth-flow-test-helpers";

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb({ database: "take_studio_test_oauth_13" });
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
async function signIn(email: string): Promise<{ cookie: string; id: string }> {
  const ask = await jsonPost("/api/auth/sign-in/magic-link", { email, callbackURL: "/library" });
  expect(ask.status).toBe(200);
  const token = new URL(
    /https?:\/\/[^\s"<]+/.exec(sent.at(-1)?.text ?? "")?.[0] ?? "",
  ).searchParams.get("token");
  const verify = await auth.handler(
    new Request(`${ORIGIN}/api/auth/magic-link/verify?token=${token}&callbackURL=/library`, {
      headers: { "x-forwarded-for": `203.0.113.${(ip += 1)}` },
    }),
  );
  const cookie = /(?:__Secure-)?better-auth\.session_token=[^;]+/.exec(
    verify.headers.get("set-cookie") ?? "",
  )?.[0];
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (!cookie || !row) {
    throw new Error(`sign in failed: ${verify.status} ${verify.headers.get("location") ?? ""}`);
  }
  return { cookie, id: row.id };
}
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
async function authorize(
  cookie: string,
  clientId: string,
  challenge: string,
  extra: Record<string, string> = {},
): Promise<{ status: number; url: string }> {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    resource: RESOURCE,
    scope: "openid offline_access",
    state: "st1",
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...extra,
  });
  const res = await auth.handler(
    new Request(`${ORIGIN}/api/auth/oauth2/authorize?${query}`, {
      headers: { cookie, "x-forwarded-for": `192.0.2.${(ip += 1)}` },
    }),
  );
  const body = (await res.json().catch(() => ({}))) as { url?: string };
  return { status: res.status, url: body.url ?? res.headers.get("location") ?? "" };
} /** Authorize, allow, and return the code the redirect carries. */
async function grantCode(cookie: string, clientId: string, challenge: string): Promise<string> {
  let { url } = await authorize(cookie, clientId, challenge);
  if (url.includes("/consent")) {
    const res = await jsonPost(
      "/api/auth/oauth2/consent",
      { accept: true, oauth_query: new URL(url, ORIGIN).search.slice(1) },
      { cookie },
    );
    url = ((await res.json()) as { url: string }).url;
  }
  expect(new URL(url).searchParams.get("state")).toBe("st1");
  const code = new URL(url).searchParams.get("code");
  if (!code) throw new Error("no code");
  return code;
}
const tokenRequest = async (
  body: Record<string, string>,
  extraHeaders: Record<string, string> = {},
) => {
  const res = await auth.handler(
    new Request(`${ORIGIN}/api/auth/oauth2/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-for": `198.51.100.${(ip += 1)}`,
        ...extraHeaders,
      },
      body: new URLSearchParams(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, string> };
}; /** A full grant: a new client, consent, code, token. */
async function connect(who: { cookie: string }) {
  const registered = (await (await register()).json()) as Registered;
  const { verifier, challenge } = pkce();
  const code = await grantCode(who.cookie, registered.client_id, challenge);
  const token = await tokenRequest({
    grant_type: "authorization_code",
    code,
    client_id: registered.client_id,
    redirect_uri: REDIRECT,
    code_verifier: verifier,
  });
  expect(token.status).toBe(200);
  return {
    clientId: registered.client_id,
    code,
    verifier,
    access: token.body.access_token ?? "",
    refresh: token.body.refresh_token ?? "",
  };
}
describe("tokens as identity (AC-14)", () => {
  it("cleanup deletes unused clients over 30 days old and keeps used or newer ones (B2-T104)", async () => {
    const who = await signIn("cleanup-clients@example.test");
    const used = await connect(who);
    const unusedOld = ((await (await register()).json()) as Registered).client_id;
    const unusedNew = ((await (await register()).json()) as Registered).client_id;
    const now = new Date();
    const aged = (days: number) => new Date(now.getTime() - days * 86_400_000);
    await db
      .update(oauthClient)
      .set({ createdAt: aged(31) })
      .where(eq(oauthClient.clientId, unusedOld));
    await db
      .update(oauthClient)
      .set({ createdAt: aged(29) })
      .where(eq(oauthClient.clientId, unusedNew));
    // A grant that is old keeps its client: it has a consent row and tokens.
    await db
      .update(oauthClient)
      .set({ createdAt: aged(90) })
      .where(eq(oauthClient.clientId, used.clientId));
    expect(await deleteUnusedOauthClients(db, now)).toBeGreaterThanOrEqual(1);
    const ids = async () =>
      (await db.select({ id: oauthClient.clientId }).from(oauthClient)).map((r) => r.id);
    const left = await ids();
    expect(left).not.toContain(unusedOld);
    expect(left).toContain(unusedNew);
    expect(left).toContain(used.clientId);
    // Once the consent and tokens are gone too, the old client is unused and is removed.
    await disconnectConsent(
      db,
      who.id,
      (await db.select().from(oauthConsent).where(eq(oauthConsent.clientId, used.clientId)))[0]!.id,
    );
    expect(await deleteUnusedOauthClients(db, now)).toBeGreaterThanOrEqual(1);
    expect(await ids()).not.toContain(used.clientId);
  });
});
