import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  countOauthRequest,
  deleteExpiredOauthRows,
  disconnectApp,
  getConsentClient,
  listConnectedApps,
} from "@/db/data/oauth";
import { handleDisconnect, handleList } from "./http";
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
import { type TestDb, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { hashOauthToken } from "@/lib/oauth-rules";
import { guard } from "../api-auth";
import { createAuth } from "../auth";
import { handleMcp } from "../mcp/http";
import { TEST_NOW, TEST_ORIGIN, testMcpDeps } from "../mcp/test-wiring";
import { protectedResourceMetadata } from "./metadata";

/**
 * Spec 0019 AC-13 and the data and endpoint parts of AC-14, through the real Better Auth handler
 * over a test database: register, authorize, consent, token, refresh rotation, hashed storage,
 * S256 only, `resolveCreator` on tokens, `/mcp` isolation, disconnect, cleanup and the account
 * deletion cascade. Synthetic accounts only (`*.example.test`); tokens are never printed.
 */

const ORIGIN = TEST_ORIGIN;
const RESOURCE = `${ORIGIN}/mcp`;
const REDIRECT = "http://127.0.0.1:9/cb";
const ENV = {
  BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789",
  BETTER_AUTH_URL: ORIGIN,
  GOOGLE_CLIENT_ID: "x",
  GOOGLE_CLIENT_SECRET: "x",
};

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

const sent: { text?: string }[] = [];
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

type Registered = { client_id: string };
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

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

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
}

/** Authorize, allow, and return the code the redirect carries. */
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

const tokenRequest = async (body: Record<string, string>) => {
  const res = await auth.handler(
    new Request(`${ORIGIN}/api/auth/oauth2/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-for": `198.51.100.${(ip += 1)}`,
      },
      body: new URLSearchParams(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, string> };
};

/** A full grant: a new client, consent, code, token. */
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

const bearer = (token: string) =>
  new Request(`${ORIGIN}/api/takes`, { headers: { authorization: `Bearer ${token}` } });
const identity = () => testMcpDeps(db).keyAuth;

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

describe("authorize and token (AC-13)", () => {
  it("a minimal registration is a public client: PKCE exchange with no secret", async () => {
    const who = await signIn("minimal@example.test");
    const res = await jsonPost("/api/auth/oauth2/register", {
      client_name: "Minimal assistant",
      redirect_uris: [REDIRECT],
    });
    expect(res.status).toBe(201);
    const client = (await res.json()) as Registered & { client_secret?: string };
    expect(client.client_secret).toBeUndefined();
    const { verifier, challenge } = pkce();
    const code = await grantCode(who.cookie, client.client_id, challenge);
    const token = await tokenRequest({
      grant_type: "authorization_code",
      code,
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    });
    expect(token.status).toBe(200);
    expect(token.body.access_token).toBeTruthy();
  });

  it("issues a one time code and a hashed token pair; the code needs the right verifier", async () => {
    const who = await signIn("flow@example.test");
    const registered = (await (await register()).json()) as Registered;
    const { verifier, challenge } = pkce();
    const code = await grantCode(who.cookie, registered.client_id, challenge);
    const wrong = await tokenRequest({
      grant_type: "authorization_code",
      code,
      client_id: registered.client_id,
      redirect_uri: REDIRECT,
      code_verifier: `x${verifier}`,
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe("invalid_grant");
  });

  it("stores only hashes, expires the access token in an hour and the refresh in 30 days", async () => {
    const who = await signIn("hash@example.test");
    const grant = await connect(who);
    const [access] = await db
      .select()
      .from(oauthAccessToken)
      .where(eq(oauthAccessToken.clientId, grant.clientId));
    const [refresh] = await db
      .select()
      .from(oauthRefreshToken)
      .where(eq(oauthRefreshToken.clientId, grant.clientId));
    expect(access?.token).toBe(await hashOauthToken(grant.access));
    expect(access?.token).not.toBe(grant.access);
    expect(refresh?.token).not.toBe(grant.refresh);
    expect(access?.resources).toEqual([RESOURCE]);
    const hours =
      ((access?.expiresAt.getTime() ?? 0) - (access?.createdAt.getTime() ?? 0)) / 3_600_000;
    expect(hours).toBeCloseTo(1, 1);
    const days =
      ((refresh?.expiresAt.getTime() ?? 0) - (refresh?.createdAt.getTime() ?? 0)) / 86_400_000;
    expect(days).toBeCloseTo(30, 0);
  });

  it("refuses plain, a missing challenge, a redirect that is not an exact match, and a replayed code", async () => {
    const who = await signIn("s256@example.test");
    const registered = (await (await register()).json()) as Registered;
    const { challenge } = pkce();
    const plain = await authorize(who.cookie, registered.client_id, challenge, {
      code_challenge_method: "plain",
    });
    expect(plain.url).toContain("error");
    const none = await authorize(who.cookie, registered.client_id, "", { code_challenge: "" });
    expect(none.url).toContain("error");
    const other = await authorize(who.cookie, registered.client_id, challenge, {
      redirect_uri: "http://127.0.0.1:9/cb2",
    });
    expect(other.url).not.toContain("code=");
    const grant = await connect(who);
    const replay = await tokenRequest({
      grant_type: "authorization_code",
      code: grant.code,
      client_id: grant.clientId,
      redirect_uri: REDIRECT,
      code_verifier: grant.verifier,
    });
    expect(replay.status).toBe(400);
  });

  it("an authorization code lasts 60 seconds and is refused after that", async () => {
    const who = await signIn("code-ttl@example.test");
    const registered = (await (await register()).json()) as Registered;
    const { verifier, challenge } = pkce();
    const code = await grantCode(who.cookie, registered.client_id, challenge);
    // The code row is the verification row whose value names this client (never "the newest").
    const rows = (await db.select().from(verification)).filter((r) =>
      r.value.includes(registered.client_id),
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    const seconds = ((row?.expiresAt.getTime() ?? 0) - (row?.createdAt.getTime() ?? 0)) / 1000;
    expect(seconds).toBeGreaterThanOrEqual(59);
    expect(seconds).toBeLessThanOrEqual(61);
    await db
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verification.id, row!.id));
    const late = await tokenRequest({
      grant_type: "authorization_code",
      code,
      client_id: registered.client_id,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    });
    expect(late.status).toBe(400);
  });

  it("rotates the refresh token, and reuse of an old one revokes the whole grant", async () => {
    const who = await signIn("rotate@example.test");
    const grant = await connect(who);
    const first = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: grant.refresh,
      client_id: grant.clientId,
    });
    expect(first.status).toBe(200);
    expect(first.body.refresh_token).not.toBe(grant.refresh);
    const reuse = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: grant.refresh,
      client_id: grant.clientId,
    });
    expect(reuse.body.error).toBe("invalid_grant");
    const newer = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: first.body.refresh_token ?? "",
      client_id: grant.clientId,
    });
    expect(newer.body.error).toBe("invalid_grant");
  });
});

describe("tokens as identity (AC-14)", () => {
  it("reaches only its own creator's takes through /mcp and the API", async () => {
    const a = await signIn("mine@example.test");
    const b = await signIn("theirs@example.test");
    const mine = await seedTake(db, a.id, { title: "Mine" });
    const theirs = await seedTake(db, b.id, { title: "Theirs" });
    const grant = await connect(a);
    const deps = testMcpDeps(db);
    const res = await handleMcp(
      new Request(`${ORIGIN}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${grant.access}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "list_takes", arguments: {} },
        }),
      }),
      deps,
    );
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).toContain(mine.id);
    expect(text).not.toContain(theirs.id);
    const viaGuard = await guard(
      bearer(grant.access),
      { getCreator: async () => null, keyAuth: identity() },
      { checkOrigin: false },
    );
    expect(viaGuard).toMatchObject({ creatorId: a.id });
  });

  it("answers 401 session_required on a session only route", async () => {
    const who = await signIn("session-only@example.test");
    const grant = await connect(who);
    const request = new Request(`${ORIGIN}/api/api-keys`, {
      method: "POST",
      headers: { authorization: `Bearer ${grant.access}`, origin: ORIGIN },
    });
    const res = await guard(
      request,
      { getCreator: async () => null, keyAuth: identity(), allowedOrigin: ORIGIN },
      { checkOrigin: true, sessionOnly: true },
    );
    if (!(res instanceof Response)) throw new Error("expected a refusal");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "session_required" });
  });

  it("counts a token's requests against 120 a minute per app and creator, with Retry-After", async () => {
    const who = await signIn("limited@example.test");
    const grant = await connect(who);
    const deps = { getCreator: async () => null, keyAuth: identity() };
    for (let i = 0; i < 119; i++) await countOauthRequest(db, grant.clientId, who.id, TEST_NOW);
    const last = await guard(bearer(grant.access), deps, { checkOrigin: false });
    expect(last instanceof Response).toBe(false);
    const over = await guard(bearer(grant.access), deps, { checkOrigin: false });
    expect(over instanceof Response && over.status).toBe(429);
    expect(over instanceof Response && over.headers.get("retry-after")).not.toBeNull();
  });

  it("refuses an unknown, expired, revoked or wrong resource token with 401", async () => {
    const who = await signIn("refused@example.test");
    const grant = await connect(who);
    const check = async (token: string) => {
      const res = await guard(
        bearer(token),
        { getCreator: async () => null, keyAuth: identity() },
        { checkOrigin: false },
      );
      return res instanceof Response ? res.status : 200;
    };
    expect(await check(grant.access)).toBe(200);
    expect(await check("not-a-token")).toBe(401);
    const hash = await hashOauthToken(grant.access);
    await db
      .update(oauthAccessToken)
      .set({ resources: ["https://elsewhere.example/mcp"] })
      .where(eq(oauthAccessToken.token, hash));
    expect(await check(grant.access)).toBe(401);
    await db
      .update(oauthAccessToken)
      .set({ resources: [RESOURCE], expiresAt: new Date("2026-11-09T12:00:00Z") })
      .where(eq(oauthAccessToken.token, hash));
    expect(await check(grant.access)).toBe(401);
    await db
      .update(oauthAccessToken)
      .set({ expiresAt: new Date(Date.now() + 3_600_000), revoked: new Date() })
      .where(eq(oauthAccessToken.token, hash));
    expect(await check(grant.access)).toBe(401);
  });

  it("lists connected apps and disconnect ends the token on the next request", async () => {
    const who = await signIn("disconnect@example.test");
    const other = await signIn("bystander@example.test");
    const mine = await connect(who);
    const theirs = await connect(other);
    const apps = await listConnectedApps(db, who.id);
    expect(apps.map((app) => app.clientId)).toEqual([mine.clientId]);
    expect(apps[0]?.name).toBe("Test assistant");
    expect(await disconnectApp(db, who.id, mine.clientId)).toBe(true);
    const status = async (token: string) => {
      const res = await guard(
        bearer(token),
        { getCreator: async () => null, keyAuth: identity() },
        { checkOrigin: false },
      );
      return res instanceof Response ? res.status : 200;
    };
    expect(await status(mine.access)).toBe(401);
    expect(await status(theirs.access)).toBe(200);
    expect(await listConnectedApps(db, who.id)).toEqual([]);
    const refresh = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: mine.refresh,
      client_id: mine.clientId,
    });
    expect(refresh.status).toBe(400);
  });

  it("connected apps routes: session only, own rows only, disconnect by consent ID", async () => {
    const who = await signIn("routes@example.test");
    const other = await signIn("routes-other@example.test");
    const mine = await connect(who);
    const theirs = await connect(other);
    const origin = new URL(RESOURCE).origin;
    const deps = (id: string | null) => ({
      allowedOrigin: origin,
      getCreator: async () => (id ? { db, creatorId: id } : null),
    });
    const list = (id: string | null, headers: Record<string, string> = {}) =>
      handleList(new Request(`${origin}/api/connected-apps`, { headers }), deps(id));
    const remove = (id: string | null, consent: string, headers: Record<string, string>) =>
      handleDisconnect(
        new Request(`${origin}/api/connected-apps/${consent}`, { method: "DELETE", headers }),
        consent,
        deps(id),
      );

    expect((await list(null)).status).toBe(401);
    const viaToken = await list(who.id, { authorization: `Bearer ${mine.access}` });
    expect(viaToken.status).toBe(401);
    expect(((await viaToken.json()) as { error: string }).error).toBe("session_required");

    const body = (await (await list(who.id)).json()) as {
      apps: { id: string; name: string; connectedAt: string; lastUsedAt: string | null }[];
    };
    expect(body.apps).toHaveLength(1);
    const app = body.apps[0]!;
    expect(app.name).toBe("Test assistant");
    expect(app.lastUsedAt).not.toBeNull();
    expect(JSON.stringify(body)).not.toContain(mine.access);
    expect(JSON.stringify(body)).not.toContain(mine.clientId);

    const theirConsent = (await listConnectedApps(db, other.id))[0]!.id;
    expect((await remove(who.id, theirConsent, { origin })).status).toBe(404);
    expect((await remove(who.id, app.id, {})).status).toBe(403);
    expect((await remove(who.id, app.id, { origin })).status).toBe(204);
    expect((await remove(who.id, app.id, { origin })).status).toBe(404);
    expect(await listConnectedApps(db, other.id)).toHaveLength(1);
    expect(theirs.access).toBeTruthy();
  });

  it("the consent page reads a client's name and redirects, and nothing for an unknown one", async () => {
    const who = await signIn("consent-client@example.test");
    const app = await connect(who);
    const client = await getConsentClient(db, app.clientId);
    expect(client?.name).toBe("Test assistant");
    expect(client?.redirectUris.length).toBeGreaterThan(0);
    expect(await getConsentClient(db, "no-such-client")).toBeNull();
  });

  it("deleting the account deletes its grants and tokens, and only its own", async () => {
    const gone = await signIn("deleted@example.test");
    const stays = await signIn("stays@example.test");
    const doomed = await connect(gone);
    const kept = await connect(stays);
    await db.delete(user).where(eq(user.id, gone.id));
    for (const table of [oauthAccessToken, oauthRefreshToken, oauthConsent] as const) {
      const rows = await db.select().from(table).where(eq(table.userId, gone.id));
      expect(rows).toEqual([]);
    }
    const [still] = await db
      .select()
      .from(oauthAccessToken)
      .where(eq(oauthAccessToken.userId, stays.id));
    expect(still?.token).toBe(await hashOauthToken(kept.access));
    expect(doomed.clientId).not.toBe(kept.clientId);
  });

  it("cleanup deletes tokens a day past expiry or revocation and keeps the rest", async () => {
    const who = await signIn("cleanup@example.test");
    const old = await connect(who);
    const fresh = await connect(who);
    const now = new Date();
    await db
      .update(oauthAccessToken)
      .set({ expiresAt: new Date(now.getTime() - 3 * 86_400_000) })
      .where(eq(oauthAccessToken.token, await hashOauthToken(old.access)));
    const counts = await deleteExpiredOauthRows(db, now);
    expect(counts.accessTokens).toBeGreaterThanOrEqual(1);
    const left = await db
      .select()
      .from(oauthAccessToken)
      .where(eq(oauthAccessToken.userId, who.id));
    expect(left.map((row) => row.token)).toEqual([await hashOauthToken(fresh.access)]);
  });
});
