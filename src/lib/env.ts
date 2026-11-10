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

export type WebEnv = z.infer<typeof webEnvSchema>;
export type JobEnv = z.infer<typeof jobEnvSchema>;
export type R2Env = z.infer<typeof r2Schema>;

type Source = Record<string, string | undefined>;

function parseEnv<T extends z.ZodType>(schema: T, source: Source, label: string): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    // Names only, never values.
    const names = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid ${label} env: ${names}`);
  }
  return result.data;
}

export function parseWebEnv(source: Source = process.env): WebEnv {
  return parseEnv(webEnvSchema, source, "web");
}

export function parseJobEnv(source: Source = process.env): JobEnv {
  return parseEnv(jobEnvSchema, source, "job");
}
