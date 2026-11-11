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
  })
  .parse(process.env);
if (new URL(env.PIPELINE_DATABASE_URL).hostname !== "localhost") {
  throw new Error("PIPELINE_DATABASE_URL must point at localhost.");
}

export const base = `http://localhost:${env.PIPELINE_PORT}`;
export const pg = postgres(env.PIPELINE_DATABASE_URL, { max: 4, onnotice: () => {} });
export const db = drizzle(pg, { schema });
export const r2 = createR2(env);
export const work = mkdtempSync(join(tmpdir(), "pipeline-"));
/** A dummy usage secret for local runs only (the real one is a Worker / Trigger.dev secret). */
const USAGE_HASH_SECRET = `pipeline-local-${randomBytes(16).toString("hex")}`;

const children: ChildProcess[] = [];

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

export function stopServices(): void {
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
  };
}
