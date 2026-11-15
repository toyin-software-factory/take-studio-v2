/** Throwaway signed in creators for the pipeline test: a user row, a session row and a signed cookie. */
import { randomBytes } from "node:crypto";
import * as schema from "../../src/db/schema";
import { base, db, env } from "./harness";

/** better-call's signed cookie value: encodeURIComponent(`${token}.${base64 HMAC}`). */
async function signCookie(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.BETTER_AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return encodeURIComponent(`${value}.${Buffer.from(mac).toString("base64")}`);
}

export type Creator = {
  readonly id: string;
  readonly api: (
    method: string,
    path: string,
    body?: unknown,
  ) => Promise<{ status: number; json: Record<string, unknown> }>;
  /** A request whose body is read as text (downloads), with the response headers. */
  readonly raw: (
    method: string,
    path: string,
  ) => Promise<{ status: number; headers: Headers; text: string }>;
};

/** IDs of the creators this run made, recorded before the row exists, so cleanup removes only these. */
export const createdCreatorIds = new Set<string>();

/** A throwaway creator with a real Better Auth session cookie. */
export async function createCreator(label: string): Promise<Creator> {
  const id = `pipeline-${label}-${crypto.randomUUID()}`;
  createdCreatorIds.add(id);
  const token = randomBytes(24).toString("base64url");
  await db
    .insert(schema.user)
    .values({ id, name: `Pipeline ${label}`, email: `${id}@example.com` });
  await db.insert(schema.session).values({
    id: crypto.randomUUID(),
    userId: id,
    token,
    expiresAt: new Date(Date.now() + 2 * 3_600_000),
    updatedAt: new Date(),
  });
  const cookie = `better-auth.session_token=${await signCookie(token)}`;
  return {
    id,
    api: async (method, path, body) => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { cookie, origin: base, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { status: res.status, json };
    },
    raw: async (method, path) => {
      const res = await fetch(`${base}${path}`, { method, headers: { cookie, origin: base } });
      return { status: res.status, headers: res.headers, text: await res.text() };
    },
  };
}
