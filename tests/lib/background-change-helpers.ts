/** Shared setup and helpers for tests/background-change-check.ts (moved out to keep each file at 250 lines or fewer). */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configure } from "@trigger.dev/sdk";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import * as schema from "../../src/db/schema";
import { createR2 } from "../../src/lib/r2";
import { BUILT_IN_BACKGROUNDS } from "@/lib/built-in-backgrounds";

export const env = z
  .object({
    DATABASE_URL_DIRECT: z.url(),
    TRIGGER_DEV_SECRET_KEY: z.string().startsWith("tr_dev_"),
    R2_ACCOUNT_ID: z.string().min(1),
    R2_ACCESS_KEY_ID: z.string().min(1),
    R2_SECRET_ACCESS_KEY: z.string().min(1),
    R2_BUCKET: z.string().min(1),
    OUT_DIR: z.string().optional(),
  })
  .parse(process.env);
if (new URL(env.DATABASE_URL_DIRECT).hostname !== "localhost") throw new Error("localhost only");
configure({ secretKey: env.TRIGGER_DEV_SECRET_KEY });

export const client = postgres(env.DATABASE_URL_DIRECT, { max: 3, onnotice: () => {} });
export const db = drizzle(client, { schema });
export const r2 = createR2(env);
export const work = mkdtempSync(join(tmpdir(), "bgchange-check-"));
export const outDir = env.OUT_DIR ?? work;
mkdirSync(outDir, { recursive: true });
export const SECRET = "local-dev-usage-secret-0123456789abcdef";
export const media = (name: string) =>
  new URL(`../fixtures/media/${name}`, import.meta.url).pathname;
export const out = (o: unknown) => console.log(JSON.stringify(o));
export const userId = `bgchange-check-${crypto.randomUUID()}`;
export const keys: string[] = [];
/** The blue, test only studio: the checks look for blue where the green was (the six real studios are not blue). */
export const PLACEHOLDER = BUILT_IN_BACKGROUNDS.find((b) => b.testOnly)!;
export const FIRST = PLACEHOLDER.id;
export const problems: string[] = [];
export const expect = (ok: boolean, what: string) => {
  if (!ok) problems.push(what);
  out({ check: what, ok });
};
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const latestRender = async (takeId: string) =>
  (await db.select().from(schema.render).where(eq(schema.render.takeId, takeId))).find(
    (r) => r.isLatest,
  );
export const takeRow = async (id: string) =>
  (await db.select().from(schema.take).where(eq(schema.take.id, id)))[0]!;

export async function frameOf(videoKey: string, name: string) {
  const res = await fetch(await r2.presignGet(videoKey, { expiresSeconds: 600 }));
  const path = join(work, `${name}.mp4`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  const png = join(outDir, `${name}.png`);
  spawnSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-ss",
    "1",
    "-i",
    path,
    "-frames:v",
    "1",
    "-vf",
    "scale=640:-2",
    png,
  ]);
  // Mean colour of the top left corner, where the studio shows (or the green, for the original).
  const raw = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      png,
      "-vf",
      "crop=40:40:0:0,scale=1:1,format=rgb24",
      "-f",
      "rawvideo",
      "-",
    ],
    { maxBuffer: 1 << 20 },
  ).stdout;
  return { r: raw[0] ?? 0, g: raw[1] ?? 0, b: raw[2] ?? 0 };
}

export async function waitJob(jobId: string, takeId: string) {
  const samples: { take: string; render: string | undefined; job: string }[] = [];
  for (let i = 0; i < 900; i++) {
    // The job, the take and the latest render come from one snapshot (repeatable read), so a
    // finish that commits between the reads cannot pair `running` with the new render.
    const { job, takeStatus, renderId } = await db.transaction(
      async (tx) => {
        const [j] = await tx
          .select()
          .from(schema.processingJob)
          .where(eq(schema.processingJob.id, jobId));
        const [t] = await tx.select().from(schema.take).where(eq(schema.take.id, takeId));
        const renders = await tx
          .select()
          .from(schema.render)
          .where(eq(schema.render.takeId, takeId));
        return { job: j, takeStatus: t!.status, renderId: renders.find((r) => r.isLatest)?.id };
      },
      { isolationLevel: "repeatable read" },
    );
    samples.push({ take: takeStatus, render: renderId, job: job?.status ?? "missing" });
    if (job && ["succeeded", "failed", "cancelled"].includes(job.status)) return { job, samples };
    await sleep(300);
  }
  throw new Error("job did not finish in 5 minutes");
}

/** Waits until the take has no queued or running job (the transcript job follows a video). */
export async function waitIdle(takeId: string) {
  for (let i = 0; i < 300; i++) {
    const jobs = await db
      .select()
      .from(schema.processingJob)
      .where(eq(schema.processingJob.takeId, takeId));
    if (jobs.every((j) => !["queued", "running"].includes(j.status))) return;
    await sleep(500);
  }
  throw new Error("the take still has a running job after 2.5 minutes");
}

export async function newBackground(name: string, imageBytes: Uint8Array<ArrayBuffer> | null) {
  const id = crypto.randomUUID();
  const imageKey = `backgrounds/test-${id}/image.jpg`;
  if (imageBytes) {
    await r2.putObject(imageKey, imageBytes, "image/jpeg");
    keys.push(imageKey);
  }
  await db.insert(schema.background).values({
    id,
    creatorId: userId,
    name,
    imageKey,
    thumbKey: PLACEHOLDER ? `backgrounds/builtin/${PLACEHOLDER.slug}.webp` : "x",
    width: 1920,
    height: 1080,
    status: "ready",
  });
  return id;
}
