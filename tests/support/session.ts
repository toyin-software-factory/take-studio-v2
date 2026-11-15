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

/**
 * A value from the `.env` the Worker was built with, else from the environment. The file wins:
 * an agent sandbox sets its own BETTER_AUTH_SECRET in the shell, which the built Worker never
 * sees, so reading the shell first forged cookies the Worker rejected (B2-T137). CI has no such
 * variable and writes the file.
 */
export function setting(name: string): string | undefined {
  const fromFile = existsSync(".env") ? parse(readFileSync(".env"))[name] : undefined;
  return fromFile ?? process.env[name];
}

/** Better Auth (better-call) cookie format: `token.base64(HMAC-SHA256(secret, token))`, URI encoded. */
export function signedSessionCookie(token: string, secret: string): string {
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  return encodeURIComponent(`${token}.${signature}`);
}

/** The test database URL; throws unless it is on this machine (local Docker or CI service). */
export function localDatabaseUrl(): string {
  const url = setting("DATABASE_URL") ?? localDatabase;
  const { hostname } = new URL(url);
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname)) {
    throw new Error(`Refusing to seed test data into a non-local database host: ${hostname}`);
  }
  return url;
}

/**
 * A made up user id the CI `.env` names as INSIGHTS_VIEWER_USER_ID, so a test can sign in as the
 * insights viewer. Never the real viewer's id (C-35): that exists only as a production secret.
 */
export const INSIGHTS_TEST_VIEWER_ID = "00000000-0000-4000-8000-00000000e2e1";

/**
 * The made up usage hash secret of every e2e build: the CI placeholder `.env` and
 * `tests/support/build-worker.sh` write this same value, so a test never depends on a secret that
 * happens to be in the shell.
 */
export const USAGE_TEST_HASH_SECRET = "ci-only-placeholder-usage-secret-0123456789";

export type TestUser = { readonly id: string; readonly name: string; readonly email: string };

/** Signs a fresh test user in for `context`. Call the returned cleanup after the test. */
export async function signIn(
  context: BrowserContext,
  baseURL: string,
  name = "Ada Lovelace",
  id: string = randomUUID(),
): Promise<{ readonly user: TestUser; readonly cleanup: () => Promise<void> }> {
  const secret = setting("BETTER_AUTH_SECRET");
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set (CI writes it to .env).");
  const sql = postgres(localDatabaseUrl(), { max: 1 });
  const user = { id, name, email: `e2e-${randomUUID()}@example.test` };
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
