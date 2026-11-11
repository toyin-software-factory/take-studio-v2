import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { magicLink } from "better-auth/plugins";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import type { WebEnv } from "@/lib/env";
import { beforeDeleteUser } from "./account";
import type { EmailSender } from "@/lib/email/send";
import { signInEmail } from "@/lib/email/templates";
import { takeSignInEmailSlot } from "./email/sign-in-limits";

type AuthEnv = Pick<
  WebEnv,
  "BETTER_AUTH_SECRET" | "BETTER_AUTH_URL" | "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET"
>;

/** Sign in link lifetime (spec 0006, AC-2): 15 minutes, single use. */
export const MAGIC_LINK_EXPIRES_SECONDS = 15 * 60;

/** What auth needs to send mail: the sender, or none (the CLI and tests without email). */
export type AuthDeps = { readonly sendEmail?: EmailSender };

/**
 * Better Auth: Google plus email sign in links (spec 0006). One account per email (account
 * linking, Google trusted); database rate limits (10 link requests per IP per hour here, 3 per
 * email per 15 minutes in the hook below); a failed send is a friendly 503, never silence.
 * Built per request around the per request Hyperdrive client: see `getAuth` in ./request.ts.
 */
export function createAuth(
  db: PostgresJsDatabase<typeof schema>,
  env: AuthEnv,
  deps: AuthDeps = {},
) {
  return betterAuth({
    appName: "Take Studio",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    account: {
      // AC-3: the same email via Google and via a link is one account, never two.
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      // AC-4: 10 sign in link requests per IP per hour.
      customRules: { "/sign-in/magic-link": { window: 60 * 60, max: 10 } },
    },
    hooks: {
      // AC-4: 3 sign in link requests per email per 15 minutes (the IP limit is above).
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/magic-link") return;
        const email = (ctx.body as { email?: unknown } | undefined)?.email;
        if (typeof email !== "string" || email.length === 0) return;
        if (!(await takeSignInEmailSlot(db, email))) {
          throw new APIError("TOO_MANY_REQUESTS", {
            code: "EMAIL_RATE_LIMITED",
            message: "Too many sign in links requested. Try again in a few minutes.",
          });
        }
      }),
    },
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_EXPIRES_SECONDS,
        // Always the same answer for any address (AC-1): unknown emails get a link too.
        sendMagicLink: async ({ email, url }) => {
          const sent = await deps.sendEmail?.({ to: email, ...signInEmail({ url }) });
          if (!sent?.ok) {
            // AC-8: the form shows "We couldn't send the email, please try again or use Google".
            throw new APIError("SERVICE_UNAVAILABLE", {
              code: "EMAIL_SEND_FAILED",
              message: "We couldn't send the email.",
            });
          }
        },
      }),
    ],
    user: {
      // Spec 0002, AC-17: the creator's takes, rows and files go before the user row.
      deleteUser: { enabled: true, beforeDelete: beforeDeleteUser(db) },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
