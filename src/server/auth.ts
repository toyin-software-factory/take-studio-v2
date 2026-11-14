import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { magicLink } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import type { WebEnv } from "@/lib/env";
import { beforeDeleteUser } from "./account";
import { ACCOUNT_DELETE_FRESH_SECONDS } from "./account/policy";
import type { EmailSender } from "@/lib/email/send";
import { signInEmail } from "@/lib/email/templates";
import { takeSignInEmailSlot } from "./email/sign-in-limits";
import { refreshGrantDisconnected, revokeGrantOnRefreshReuse } from "@/db/data/oauth";
import { basicClientId, hashOauthToken, redirectUriAllowed } from "@/lib/oauth-rules";
import { recordEvent } from "./analytics/record";

type AuthEnv = Pick<
  WebEnv,
  "BETTER_AUTH_SECRET" | "BETTER_AUTH_URL" | "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET"
>;

/** Sign in link lifetime (spec 0006, AC-2): 15 minutes, single use. */
export const MAGIC_LINK_EXPIRES_SECONDS = 15 * 60;

/** AC-13: client registrations allowed per IP per hour. */
export const OAUTH_REGISTER_PER_HOUR = 20;

/** The protected resource the OAuth tokens are issued for (spec 0019 AC-13). */
export const mcpResource = (env: Pick<WebEnv, "BETTER_AUTH_URL">): string =>
  `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/mcp`;

/** What auth needs to send mail: the sender, or none (the CLI and tests without email). */
export type AuthDeps = {
  readonly sendEmail?: EmailSender;
  /**
   * Header that carries the real client IP for the per IP limit. The Worker passes
   * `cf-connecting-ip` (set by Cloudflare, not by the client); without it Better Auth uses
   * `x-forwarded-for`, whose multi address values can share one counter. Unset in tests and
   * the CLI, where there is no Cloudflare in front.
   */
  readonly clientIpHeader?: string;
};

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
    // Spec 0015 step 7: deleting an account needs a sign in within the last 10 minutes.
    session: { freshAge: ACCOUNT_DELETE_FRESH_SECONDS },
    account: {
      // AC-3: the same email via Google and via a link is one account, never two.
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    ...(deps.clientIpHeader
      ? { advanced: { ipAddress: { ipAddressHeaders: [deps.clientIpHeader] } } }
      : {}),
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
        if (ctx.path === "/oauth2/token") {
          // AC-13: reuse of a rotated refresh token revokes the whole grant, consent included.
          const body = ctx.body as Record<string, unknown> | undefined;
          const clientId =
            typeof body?.client_id === "string"
              ? body.client_id
              : basicClientId(ctx.headers?.get("authorization") ?? null);
          if (
            body?.grant_type === "refresh_token" &&
            typeof body.refresh_token === "string" &&
            clientId !== null
          ) {
            const hash = await hashOauthToken(body.refresh_token);
            await revokeGrantOnRefreshReuse(db, hash, clientId);
            // A disconnect ended this grant: a refresh must not mint a new pair for it.
            if (await refreshGrantDisconnected(db, hash, clientId)) {
              throw new APIError("BAD_REQUEST", {
                error: "invalid_grant",
                error_description: "This connection was removed. Connect again.",
              });
            }
          }
          return;
        }
        if (ctx.path === "/oauth2/register") {
          // AC-13: https or loopback only, no wildcards (the plugin also allows custom schemes).
          const uris = (ctx.body as { redirect_uris?: unknown } | undefined)?.redirect_uris;
          if (
            Array.isArray(uris) &&
            uris.some((u) => typeof u !== "string" || !redirectUriAllowed(u))
          ) {
            throw new APIError("BAD_REQUEST", {
              error: "invalid_redirect_uri",
              error_description:
                "Redirect URIs must be https, or http on localhost, with no wildcard.",
            });
          }
          // MCP clients are public clients (PKCE, no secret): a registration that says nothing
          // about its auth method would otherwise become confidential and get a secret it
          // never uses, and its secretless code exchange would fail with invalid_client.
          const body = ctx.body as Record<string, unknown> | undefined;
          if (body && body.token_endpoint_auth_method === undefined) {
            return { context: { ...ctx, body: { ...body, token_endpoint_auth_method: "none" } } };
          }
          return;
        }
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
      oauthProvider({
        // Opaque access tokens kept as SHA-256 hashes: with the jwt plugin a token for a resource
        // is a signed JWT that is never stored, so it could not be looked up or revoked (a
        // disconnect must work on the next request, AC-14). Spike note in spec 0019 Follow-up.
        disableJwtPlugin: true,
        // AC-13: an authorization code lives 60 seconds (the plugin's default is 600).
        codeExpiresIn: 60,
        loginPage: "/sign-in",
        consentPage: "/oauth/consent",
        allowDynamicClientRegistration: true,
        // A registration without application_type and with a loopback redirect is a native app.
        clientRegistrationDefaultApplicationType: "infer",
        allowUnauthenticatedClientRegistration: true,
        resources: [mcpResource(env)],
        // Every dynamically registered client may ask for the /mcp resource, or the token
        // request is refused with invalid_target (spike, spec 0019 step 6).
        clientRegistrationDefaultResources: [mcpResource(env)],
        // AC-13: 20 client registrations per IP per hour (the plugin default is 5 a minute).
        rateLimit: { register: { window: 60 * 60, max: OAUTH_REGISTER_PER_HOUR } },
      }),
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
    databaseHooks: {
      user: {
        // Spec 0016 AC-4: one `signup` event per creator, after the user row is written. Best
        // effort: `recordEvent` never throws, so a failed insert cannot break sign up.
        create: {
          after: async (created) => {
            await recordEvent(db, { name: "signup", creatorId: created.id });
          },
        },
      },
    },
    user: {
      // Declared so a later schema regeneration keeps the column; `input: false` means a
      // sign up or update body can never set it (only the signed link and the switch do).
      additionalFields: {
        takeEmails: { type: "boolean", required: true, defaultValue: true, input: false },
      },
      // Spec 0002, AC-17: the creator's takes, rows and files go before the user row.
      deleteUser: { enabled: true, beforeDelete: beforeDeleteUser(db) },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
