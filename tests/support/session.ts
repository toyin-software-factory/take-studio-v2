import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import postgres from "postgres";
import type { BrowserContext } from "@playwright/test";

/**
 * Test only sign in: seeds a user and a session in the local or CI Postgres and sets Better
 * Auth's signed session cookie, so e2e tests can see signed in pages without Google.
 * The Worker under test must be built with the same BETTER_AUTH_SECRET (the CI placeholder
 * `.env`); never point this at a real database.
 */

const localDatabase = "postgres://postgres:postgres@localhost:5432/take_studio";

/** A value from the environment, else from the `.env` the Worker was built with. */
function setting(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  return existsSync(".env") ? parse(readFileSync(".env"))[name] : undefined;
}

/** Better Auth (better-call) cookie format: `token.base64(HMAC-SHA256(secret, token))`, URI encoded. */
export function signedSessionCookie(token: string, secret: string): string {
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  return encodeURIComponent(`${token}.${signature}`);
}

export type TestUser = { readonly id: string; readonly name: string; readonly email: string };

/** Signs a fresh test user in for `context`. Call the returned cleanup after the test. */
export async function signIn(
  context: BrowserContext,
  baseURL: string,
  name = "Ada Lovelace",
): Promise<{ readonly user: TestUser; readonly cleanup: () => Promise<void> }> {
  const secret = setting("BETTER_AUTH_SECRET");
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set (CI writes it to .env).");
  const url = setting("DATABASE_URL") ?? localDatabase;
  // Only ever seed a database on this machine (local Docker or the CI service container).
  const { hostname } = new URL(url);
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname)) {
    throw new Error(`Refusing to seed test sessions into a non-local database host: ${hostname}`);
  }
  const sql = postgres(url, { max: 1 });
  const user = { id: randomUUID(), name, email: `e2e-${randomUUID()}@example.test` };
  const token = randomBytes(32).toString("base64url");
  const now = new Date();

  await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at)
            values (${user.id}, ${user.name}, ${user.email}, true, ${now}, ${now})`;
  await sql`insert into session (id, token, user_id, expires_at, created_at, updated_at)
            values (${randomUUID()}, ${token}, ${user.id},
                    ${new Date(now.getTime() + 60 * 60 * 1000)}, ${now}, ${now})`;

  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: signedSessionCookie(token, secret),
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  return {
    user,
    cleanup: async () => {
      await sql`delete from session where user_id = ${user.id}`;
      await sql`delete from "user" where id = ${user.id}`;
      await sql.end();
    },
  };
}
