/** Helpers the pipeline scenarios share: upload a fixture, wait for a take, read links, jobs and cuts. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { asc, eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { db, work } from "./harness";
import { type Creator } from "./creator";

export const media = (file: string) =>
  file.startsWith("/")
    ? file
    : fileURLToPath(new URL(`../fixtures/media/${file}`, import.meta.url));

/** Upload a fixture the way the browser will: create, part PUTs straight to R2, complete. */
export async function upload(
  creator: Creator,
  file: string,
  container: "mp4" | "mov" | "webm",
  backgroundId?: string,
  source?: "recording",
): Promise<string> {
  const bytes = readFileSync(media(file));
  const created = await creator.api("POST", "/api/uploads", {
    fileName: file,
    sizeBytes: bytes.length,
    container,
    ...(backgroundId ? { backgroundId } : {}),
    ...(source ? { source } : {}),
  });
  if (created.status !== 201)
    throw new Error(`create ${file}: ${created.status} ${JSON.stringify(created.json)}`);
  const { takeId, partSize, partCount } = created.json as {
    takeId: string;
    partSize: number;
    partCount: number;
  };
  const numbers = Array.from({ length: partCount }, (_, i) => i + 1);
  const links = await creator.api("POST", `/api/uploads/${takeId}/parts`, { partNumbers: numbers });
  const parts = await Promise.all(
    (links.json.parts as { partNumber: number; url: string }[]).map(async (p) => {
      const start = (p.partNumber - 1) * partSize;
      const res = await fetch(p.url, {
        method: "PUT",
        body: bytes.subarray(start, start + partSize),
      });
      return {
        partNumber: p.partNumber,
        etag: (res.headers.get("etag") ?? "").replaceAll('"', ""),
      };
    }),
  );
  const done = await creator.api("POST", `/api/uploads/${takeId}/complete`, { parts });
  if (done.status !== 200)
    throw new Error(`complete ${file}: ${done.status} ${JSON.stringify(done.json)}`);
  return takeId;
}

export type TakeJson = {
  take: {
    status: string;
    failureCode: string | null;
    retryable: boolean;
    durationMs: number | null;
    title: string;
  };
  latestJob: { status: string; steps: { name: string; status: string }[] } | null;
  latestRender: { id: string; durationMs: number | null } | null;
  removedMs: number;
  note: string | null;
};

/** Poll GET /api/takes/{id} (every 2 s, like the page) until the take is ready or failed. */
export async function waitFinal(creator: Creator, takeId: string): Promise<TakeJson> {
  for (let i = 0; i < 300; i++) {
    const res = await creator.api("GET", `/api/takes/${takeId}`);
    const t = res.json as unknown as TakeJson;
    if (res.status === 200 && (t.take.status === "ready" || t.take.status === "failed")) return t;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`take ${takeId} did not finish in 10 minutes`);
}

/** Fetch the first byte through a media link; returns status and Content-Disposition. */
export async function probeLink(creator: Creator, takeId: string, kind: string) {
  const res = await creator.api("GET", `/api/takes/${takeId}/media?kind=${kind}`);
  if (res.status !== 200) return { routeStatus: res.status, objectStatus: null, disposition: null };
  const object = await fetch(String(res.json.url), { headers: { range: "bytes=0-0" } });
  return {
    routeStatus: res.status,
    objectStatus: object.status,
    disposition: object.headers.get("content-disposition"),
    expiresInSeconds: res.json.expiresInSeconds,
  };
}

export async function downloadRender(creator: Creator, takeId: string): Promise<string> {
  const res = await creator.api("GET", `/api/takes/${takeId}/media?kind=download`);
  const file = join(work, `${takeId}.mp4`);
  writeFileSync(file, Buffer.from(await (await fetch(String(res.json.url))).arrayBuffer()));
  return file;
}

export async function jobsOf(takeId: string) {
  return db
    .select()
    .from(schema.processingJob)
    .where(eq(schema.processingJob.takeId, takeId))
    .orderBy(asc(schema.processingJob.createdAt));
}

export async function cutsOf(takeId: string) {
  const rows = await db
    .select()
    .from(schema.cut)
    .where(eq(schema.cut.takeId, takeId))
    .orderBy(asc(schema.cut.startMs));
  return rows.map((c) => [c.startMs, c.endMs] as const);
}
