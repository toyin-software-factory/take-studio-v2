import { getCloudflareContext } from "@opennextjs/cloudflare";
import { setUser } from "@sentry/core";
import { createWebDb } from "@/db/client/web";
import { emailEnvSchema, parseWebEnv } from "@/lib/env";
import { createAuth } from "./auth";
import { resendSender } from "./email/send";

/** Per request database client over the Hyperdrive binding. */
export async function getDb() {
  const { env } = await getCloudflareContext({ async: true });
  return createWebDb(env.HYPERDRIVE);
}

/**
 * Per request Better Auth instance, sharing the request's database client. Sign in links go
 * out through Resend when the email variables are set; without them the instance has no sender
 * and a link request answers with the friendly "couldn't send" error (AC-8).
 */
export async function getAuth() {
  const email = emailEnvSchema.safeParse(process.env);
  return createAuth(await getDb(), parseWebEnv(), {
    ...(email.success ? { sendEmail: resendSender(email.data) } : {}),
  });
}

/**
 * The signed in session for this request, or null. Also tells Sentry who hit an error, by
 * user ID only, never email or name (spec 0005, AC-4). Scoped to this request.
 */
export async function getSession(requestHeaders: Headers) {
  const session = await (await getAuth()).api.getSession({ headers: requestHeaders });
  setUser(session ? { id: session.user.id } : null);
  return session;
}
