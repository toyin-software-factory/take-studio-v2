/**
 * Harness for the API level pipeline test (spec 0004 build plan step 5): environment checks,
 * the local app and `trigger dev` as child processes, signed in creators, and an HTTP client.
 * Local Postgres only; R2 and Trigger.dev (dev environment) are real.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, openSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import * as schema from "../../src/db/schema";
import { createR2 } from "../../src/lib/r2";

export const env = z
  .object({
    PIPELINE_DATABASE_URL: z
      .string()
      .url()
      .default("postgres://postgres:postgres@localhost:5432/take_studio"),
    PIPELINE_PORT: z.coerce.number().int().default(3100),
    BETTER_AUTH_SECRET: z.string().min(32),
    TRIGGER_DEV_SECRET_KEY: z.string().startsWith("tr_dev_"),
    TRIGGER_ACCESS_TOKEN: z.string().min(1),
    R2_ACCOUNT_ID: z.string().min(1),
    R2_ACCESS_KEY_ID: z.string().min(1),
    R2_SECRET_ACCESS_KEY: z.string().min(1),
    R2_BUCKET: z.string().min(1),
    /** Transcripts (spec 0007): real Deepgram, tiny synthetic fixtures. Reaches `trigger dev` through the shell env. */
    DEEPGRAM_API_KEY: z.string().min(1),
  })
  .parse(process.env);
if (new URL(env.PIPELINE_DATABASE_URL).hostname !== "localhost") {
  throw new Error("PIPELINE_DATABASE_URL must point at localhost.");
}

export const base = `http://localhost:${env.PIPELINE_PORT}`;
export const pg = postgres(env.PIPELINE_DATABASE_URL, {
  max: 4,
  onnotice: () => {},
  connection: { application_name: "pipeline-harness" },
});
export const db = drizzle(pg, { schema });
export const r2 = createR2(env);
export const work = mkdtempSync(join(tmpdir(), "pipeline-"));
/** A dummy usage secret for local runs only (the real one is a Worker / Trigger.dev secret). */
const USAGE_HASH_SECRET = `pipeline-local-${randomBytes(16).toString("hex")}`;

const children: ChildProcess[] = [];

/**
 * `next dev` opens a new database client for every request and never closes it (on the Worker
 * the client dies with the request), so a long run piles up idle connections until Postgres
 * answers "too many clients". Every few seconds this closes the ones that have been idle for
 * 30 s (local database only; the harness's own connections are named and left alone, and the
 * job clients of `trigger dev` reconnect by themselves).
 */
let reaper: ReturnType<typeof setInterval> | undefined;
function startConnectionReaper(): void {
  reaper = setInterval(() => {
    pg`select pg_terminate_backend(pid) from pg_stat_activity
       where datname = current_database() and pid <> pg_backend_pid()
         and application_name <> 'pipeline-harness'
         and state = 'idle' and state_change < now() - interval '30 seconds'`.catch(() => {});
  }, 10_000);
}

/** Variables both child processes get: local DB, dev Trigger.dev key, proxy settings. */
function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: env.PIPELINE_DATABASE_URL,
    DATABASE_URL_DIRECT: env.PIPELINE_DATABASE_URL,
    CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: env.PIPELINE_DATABASE_URL,
    TRIGGER_SECRET_KEY: env.TRIGGER_DEV_SECRET_KEY,
    USAGE_HASH_SECRET,
    ...extra,
  };
}

function start(name: string, args: string[], extra: Record<string, string>): void {
  const log = openSync(join(work, `${name}.log`), "a");
  const child = spawn("pnpm", args, {
    env: childEnv(extra),
    stdio: ["ignore", log, log],
    detached: true,
  });
  children.push(child);
}

/**
 * Starts `next dev` on the pipeline port and `trigger dev`. The Trigger.dev worker doesn't
 * inherit proxy settings in some sandboxes, so they're also passed through an env file.
 */
export async function startServices(): Promise<void> {
  const proxyEnv = join(work, "proxy.env");
  const names = [
    "http_proxy",
    "https_proxy",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "no_proxy",
    "NO_PROXY",
    "NODE_USE_ENV_PROXY",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
  ];
  writeFileSync(
    proxyEnv,
    names
      .filter((n) => process.env[n])
      .map((n) => `${n}=${process.env[n]}`)
      .join("\n"),
    { mode: 0o600 },
  );

  startConnectionReaper();
  start("next", ["exec", "next", "dev", "--port", String(env.PIPELINE_PORT)], {
    BETTER_AUTH_URL: base,
    PORT: String(env.PIPELINE_PORT),
  });
  start("trigger", ["exec", "trigger", "dev", "--skip-update-check", "--env-file", proxyEnv], {});

  for (let i = 0; i < 90; i++) {
    const ok = await fetch(`${base}/api/health`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) break;
    if (i === 89) throw new Error(`The app didn't start: see ${join(work, "next.log")}`);
    await new Promise((r) => setTimeout(r, 2_000));
  }
  // Give the Trigger.dev dev worker time to register its tasks.
  await new Promise((r) => setTimeout(r, 30_000));
}

// A Ctrl+C or a kill must not leave `next dev` and `trigger dev` behind (they keep database
// connections open and the next run then fails with "too many clients").
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopServices();
    process.exit(130);
  });
}

export function stopServices(): void {
  clearInterval(reaper);
  for (const child of children) {
    try {
      if (child.pid) process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
}

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
