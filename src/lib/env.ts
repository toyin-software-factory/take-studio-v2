import { z } from "zod";

/**
 * One zod validated env module, split into web env (the Worker) and job env
 * (Trigger.dev tasks). Parsing is lazy, so `next build` passes without real values.
 * See spec 0001, "Where each key lives".
 */

const r2Schema = z.object({
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
});

export const webEnvSchema = r2Schema.extend({
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  TRIGGER_SECRET_KEY: z.string().min(1),
});

export const jobEnvSchema = r2Schema.extend({
  DATABASE_URL: z.url(),
});

/**
 * Usage hashing (spec 0002, AC-16): needed by the Worker and by jobs, but parsed only where
 * the hash is computed, so the app keeps running before the secret is set everywhere.
 */
export const usageEnvSchema = z.object({
  USAGE_HASH_SECRET: z.string().min(32, "USAGE_HASH_SECRET must be at least 32 characters"),
});

/**
 * Email (spec 0006): Resend key, sender and the secret that signs unsubscribe links. Parsed
 * only where email is sent or a link is signed, so the app keeps running before they are set.
 */
export const emailEnvSchema = z.object({
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().min(3),
  EMAIL_LINK_SECRET: z.string().min(32, "EMAIL_LINK_SECRET must be at least 32 characters"),
});

export type EmailEnv = z.infer<typeof emailEnvSchema>;
export type WebEnv = z.infer<typeof webEnvSchema>;
export type JobEnv = z.infer<typeof jobEnvSchema>;
export type R2Env = z.infer<typeof r2Schema>;
export type UsageEnv = z.infer<typeof usageEnvSchema>;

type Source = Record<string, string | undefined>;

/** Validates `source` against `schema`; on failure throws naming the bad variables, never their values. */
function parseEnv<T extends z.ZodType>(schema: T, source: Source, label: string): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    // Names only, never values.
    const names = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid ${label} env: ${names}`);
  }
  return result.data;
}

/** Web (Worker) env: auth, Google, R2 and Trigger.dev variables. */
export function parseWebEnv(source: Source = process.env): WebEnv {
  return parseEnv(webEnvSchema, source, "web");
}

/** Job (Trigger.dev task) env: database URL and R2 variables. */
export function parseJobEnv(source: Source = process.env): JobEnv {
  return parseEnv(jobEnvSchema, source, "job");
}

/** Usage env: the HMAC secret for usage account hashes (web and jobs). */
export function parseUsageEnv(source: Source = process.env): UsageEnv {
  return parseEnv(usageEnvSchema, source, "usage");
}

/** Email env: Resend key, sender address and the unsubscribe link secret (web and jobs). */
export function parseEmailEnv(source: Source = process.env): EmailEnv {
  return parseEnv(emailEnvSchema, source, "email");
}
