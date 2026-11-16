/**
 * The one off Terms change notice (spec 0015 decision 7, B2-T186): run only
 * by the manual workflow `terms-notice.yml`. Sends one plain email per real account through the
 * existing Resend sender, with the key `terms-<notice id>-<user id>` so a rerun never sends twice.
 * A dry run (the default) prints only a count and sends nothing, but it still fails when a send secret is missing, so a green dry run proves the real send can start. Logs hold counts and
 * user ids, never an email address. It uses the database guard of `pnpm db:seed`.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import { resendSender, type EmailSender } from "../src/lib/email/send";
import {
  NOTICES,
  NOTICE_ID,
  noticeKey,
  selectRecipients,
  termsNoticeEmail,
  type Recipient,
} from "../src/lib/email/terms-notice";
import * as schema from "../src/db/schema";

const PAUSE_MS = 600; // Resend allows 2 requests a second by default.
const RETRIES = 3;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const SEND_ENV = ["RESEND_API_KEY", "EMAIL_FROM", "BETTER_AUTH_URL"] as const;

/** Names (never values) of the send secrets that are missing or empty. */
export function missingSendEnv(
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  return SEND_ENV.filter((name) => (env[name] ?? "").trim() === "");
}

export type Summary = {
  readonly recipients: number;
  readonly sent: number;
  readonly failed: readonly string[];
};

/** Sends to each recipient in turn; a rate limit waits and tries again, any other failure is kept by id. */
export async function sendAll(
  recipients: readonly Recipient[],
  noticeId: string,
  email: ReturnType<typeof termsNoticeEmail>,
  send: EmailSender,
  pause: (ms: number) => Promise<void> = sleep,
  log: (line: string) => void = console.log,
): Promise<Summary> {
  let sent = 0;
  const failed: string[] = [];
  for (const r of recipients) {
    let done = false;
    for (let attempt = 0; attempt < RETRIES && !done; attempt++) {
      const res = await send({
        to: r.email,
        ...email,
        idempotencyKey: noticeKey(noticeId, r.id),
      });
      if (res.ok) {
        sent += 1;
        done = true;
      } else if (res.error === "rate_limited") {
        await pause(2000 * (attempt + 1));
      } else break;
    }
    if (!done) {
      failed.push(r.id);
      log(`terms-notice: failed for user ${r.id}`);
    }
    await pause(PAUSE_MS);
  }
  return { recipients: recipients.length, sent, failed };
}

async function main() {
  const env = z
    .object({
      DATABASE_URL_DIRECT: z.url(),
      NOTICE_ID: z.string().regex(NOTICE_ID),
      DRY_RUN: z.enum(["true", "false"]).default("true"),
      CI: z.string().optional(),
      MIGRATE_TARGET: z.enum(["prod"]).optional(),
      // Only a real send needs these.
      RESEND_API_KEY: z.string().optional(),
      EMAIL_FROM: z.string().optional(),
      BETTER_AUTH_URL: z.string().optional(),
    })
    .parse(process.env);
  const notice = NOTICES[env.NOTICE_ID];
  if (!notice) throw new Error(`Unknown notice id. Known: ${Object.keys(NOTICES).join(", ")}`);

  // Dry run too: a green dry run must mean the real send would not throw on a missing secret.
  const missing = missingSendEnv(env);
  if (missing.length > 0) {
    throw new Error(
      `Missing secrets: ${missing.join(", ")}. Add them as GitHub repository secrets (see the runbook, step 0).`,
    );
  }
  const host = new URL(env.DATABASE_URL_DIRECT).hostname;
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  if (!local && env.CI !== "true" && env.MIGRATE_TARGET !== "prod") {
    throw new Error(
      `Refusing the non local database host ${host}. Set MIGRATE_TARGET=prod on purpose.`,
    );
  }
  const client = postgres(env.DATABASE_URL_DIRECT, { max: 1, onnotice: () => {} });
  try {
    const rows = await drizzle(client, { schema })
      .select({
        id: schema.user.id,
        email: schema.user.email,
        guest: schema.user.guest,
        takeEmails: schema.user.takeEmails,
      })
      .from(schema.user);
    const recipients = selectRecipients(rows);
    console.log(
      `terms-notice ${env.NOTICE_ID}: ${recipients.length} recipients of ${rows.length} accounts (${rows.length - recipients.length} skipped)`,
    );
    if (env.DRY_RUN === "true") return console.log("terms-notice: dry run, nothing sent");

    if (!env.RESEND_API_KEY || !env.EMAIL_FROM || !env.BETTER_AUTH_URL) return;
    const email = termsNoticeEmail(notice, env.BETTER_AUTH_URL);
    const send = resendSender({ RESEND_API_KEY: env.RESEND_API_KEY, EMAIL_FROM: env.EMAIL_FROM });
    const summary = await sendAll(recipients, env.NOTICE_ID, email, send);
    console.log(`terms-notice: sent ${summary.sent}, failed ${summary.failed.length}`);
    if (summary.failed.length > 0) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

// Importing this file (the tests) must not connect to anything.
if (process.argv[1]?.endsWith("send-terms-notice.ts")) await main();
