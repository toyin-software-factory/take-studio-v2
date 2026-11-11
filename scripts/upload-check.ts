/**
 * End to end check of the browser upload routes (spec 0004, AC-3 and AC-4) against a running
 * local app and real R2: makes a test file, signs in as a throwaway local creator, then does
 * what the browser will do: POST /api/uploads, part links in batches, PUT each part straight to
 * R2 (3 at a time), POST /complete. Prints each step. With --cleanup it deletes the R2 object
 * and the local rows afterwards.
 *
 * Usage (app running on localhost with local Postgres):
 *   DATABASE_URL_DIRECT=postgres://…@localhost:5432/take_studio \
 *   pnpm tsx scripts/upload-check.ts --base http://localhost:3000 --mib 100 --cleanup
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import { session, take, user } from "../src/db/schema";
import { createR2 } from "../src/lib/r2";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const base = arg("base", "http://localhost:3000");
const mib = Number(arg("mib", "100"));
const cleanup = args.includes("--cleanup");

const env = z
  .object({
    DATABASE_URL_DIRECT: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    R2_ACCOUNT_ID: z.string().min(1),
    R2_ACCESS_KEY_ID: z.string().min(1),
    R2_SECRET_ACCESS_KEY: z.string().min(1),
    R2_BUCKET: z.string().min(1),
  })
  .parse(process.env);
for (const [label, value] of [
  ["DATABASE_URL_DIRECT", env.DATABASE_URL_DIRECT],
  ["--base", base],
] as const) {
  if (!["localhost", "127.0.0.1"].includes(new URL(value).hostname)) {
    throw new Error(`${label} must point at localhost for this check.`);
  }
}

const client = postgres(env.DATABASE_URL_DIRECT, { max: 2, onnotice: () => {} });
const db = drizzle(client);
const r2 = createR2(env);
const log = (step: string, detail: unknown = "") =>
  console.log(
    `${new Date().toISOString().slice(11, 19)} ${step} ${typeof detail === "string" ? detail : JSON.stringify(detail)}`,
  );

/** better-call's signed cookie value: encodeURIComponent(`${value}.${base64 HMAC}`). */
async function signCookie(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return encodeURIComponent(`${value}.${Buffer.from(mac).toString("base64")}`);
}

const userId = `upload-check-${crypto.randomUUID()}`;
const token = randomBytes(24).toString("base64url");
let takeId: string | null = null;

try {
  await db
    .insert(user)
    .values({ id: userId, name: "Upload check", email: `${userId}@example.com` });
  await db.insert(session).values({
    id: crypto.randomUUID(),
    userId,
    token,
    expiresAt: new Date(Date.now() + 3_600_000),
    updatedAt: new Date(),
  });
  const headers = {
    cookie: `better-auth.session_token=${await signCookie(token, env.BETTER_AUTH_SECRET)}`,
    origin: new URL(base).origin,
    "content-type": "application/json",
  };
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
    return json;
  };

  const sizeBytes = mib * 1024 * 1024;
  const data = randomBytes(sizeBytes);
  log("file", { sizeBytes, mib });

  const t0 = Date.now();
  const created = z
    .object({ takeId: z.string(), partSize: z.number(), partCount: z.number() })
    .parse(
      await api("POST", "/api/uploads", {
        fileName: "upload-check.mp4",
        sizeBytes,
        container: "mp4",
      }),
    );
  takeId = created.takeId;
  log("POST /api/uploads", created);

  const etags: { partNumber: number; etag: string }[] = [];
  const numbers = Array.from({ length: created.partCount }, (_, i) => i + 1);
  for (let i = 0; i < numbers.length; i += 50) {
    const batch = numbers.slice(i, i + 50);
    const links = z
      .object({ parts: z.array(z.object({ partNumber: z.number(), url: z.string() })) })
      .parse(await api("POST", `/api/uploads/${takeId}/parts`, { partNumbers: batch }));
    log("POST /parts", {
      parts: batch.length,
      linkHost: new URL(links.parts[0]?.url ?? base).host,
    });
    let next = 0;
    const worker = async () => {
      while (next < links.parts.length) {
        const part = links.parts[next++];
        if (!part) break;
        const start = (part.partNumber - 1) * created.partSize;
        const res = await fetch(part.url, {
          method: "PUT",
          body: data.subarray(start, Math.min(start + created.partSize, sizeBytes)),
        });
        if (!res.ok) throw new Error(`PUT part ${part.partNumber} → ${res.status}`);
        etags.push({
          partNumber: part.partNumber,
          etag: (res.headers.get("etag") ?? "").replaceAll('"', ""),
        });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }
  etags.sort((a, b) => a.partNumber - b.partNumber);
  log("PUT parts to R2", { parts: etags.length, seconds: (Date.now() - t0) / 1000 });

  const completed = await api("POST", `/api/uploads/${takeId}/complete`, { parts: etags });
  log("POST /complete", completed);
  const again = await api("POST", `/api/uploads/${takeId}/complete`, { parts: etags });
  log("POST /complete (repeat, idempotent)", again);

  const head = await r2.headObject(`originals/${takeId}/source.mp4`);
  log("R2 HEAD", { size: head?.size, matchesDeclared: head?.size === sizeBytes });
  const [row] = await db
    .select({ status: take.status, uploadId: take.uploadId })
    .from(take)
    .where(eq(take.id, takeId));
  log("take row", row);
} finally {
  if (cleanup) {
    if (takeId) {
      await r2.deleteObject(`originals/${takeId}/source.mp4`);
      log("cleanup: R2 object deleted", {
        stillThere: (await r2.headObject(`originals/${takeId}/source.mp4`)) !== null,
      });
    }
    await db.delete(user).where(eq(user.id, userId));
    log("cleanup: local user, session and take removed");
  }
  await client.end();
}
