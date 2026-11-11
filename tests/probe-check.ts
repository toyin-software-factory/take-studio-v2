/**
 * Dev run proof for the probe task (spec 0004 AC-4): for each fixture, a local `uploading` take
 * with its file in R2, then the real `probe` task on Trigger.dev dev (`pnpm exec trigger dev`
 * running), then the take's final state, message, thumbnail and started job. Cleans up after
 * itself (R2 objects and local rows). Local Postgres only.
 *
 *   DATABASE_URL_DIRECT=postgres://…@localhost:5432/take_studio pnpm tsx tests/probe-check.ts
 */
import { readFileSync, statSync } from "node:fs";
import { configure, runs, tasks } from "@trigger.dev/sdk";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import { jobStep, processingJob, take, user } from "../src/db/schema";
import { createR2 } from "../src/lib/r2";
import { uploadFailureMessage } from "../src/lib/take-messages";
import { originalKey, thumbnailKey } from "../src/lib/take-rules";

const env = z
  .object({
    DATABASE_URL_DIRECT: z.string().url(),
    TRIGGER_DEV_SECRET_KEY: z.string().startsWith("tr_dev_"),
    R2_ACCOUNT_ID: z.string().min(1),
    R2_ACCESS_KEY_ID: z.string().min(1),
    R2_SECRET_ACCESS_KEY: z.string().min(1),
    R2_BUCKET: z.string().min(1),
  })
  .parse(process.env);
if (new URL(env.DATABASE_URL_DIRECT).hostname !== "localhost") {
  throw new Error("DATABASE_URL_DIRECT must point at localhost for this check.");
}
configure({ secretKey: env.TRIGGER_DEV_SECRET_KEY });

const client = postgres(env.DATABASE_URL_DIRECT, { max: 2, onnotice: () => {} });
const db = drizzle(client);
const r2 = createR2(env);

const FIXTURES = [
  ["normal.mp4", "mp4"],
  ["portrait-moov-end.mov", "mov"],
  ["hdr-pq.mp4", "mp4"],
  ["silent.mp4", "mp4"],
  ["too-long-11min.mp4", "mp4"],
  ["4k.mp4", "mp4"],
] as const;

const userId = `probe-check-${crypto.randomUUID()}`;
const keys: string[] = [];
const final = [
  "COMPLETED",
  "FAILED",
  "CRASHED",
  "SYSTEM_FAILURE",
  "CANCELED",
  "EXPIRED",
  "TIMED_OUT",
];

try {
  await db.insert(user).values({ id: userId, name: "Probe check", email: `${userId}@example.com` });

  for (const [file, container] of FIXTURES) {
    const path = new URL(`./fixtures/media/${file}`, import.meta.url);
    const bytes = readFileSync(path);
    const takeId = crypto.randomUUID();
    const key = originalKey(takeId, container);
    keys.push(key, thumbnailKey(takeId));
    await r2.putObject(
      key,
      new Uint8Array(bytes),
      container === "mov" ? "video/quicktime" : "video/mp4",
    );
    await db.insert(take).values({
      id: takeId,
      creatorId: userId,
      title: file,
      status: "uploading",
      originalKey: key,
      originalBytes: statSync(path).size,
      container,
    });

    const handle = await tasks.trigger("probe", { takeId });
    let run = await runs.retrieve(handle.id);
    for (let i = 0; i < 120 && !final.includes(run.status); i++) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      run = await runs.retrieve(handle.id);
    }

    const [row] = await db.select().from(take).where(eq(take.id, takeId));
    const [job] = await db.select().from(processingJob).where(eq(processingJob.takeId, takeId));
    const steps = job
      ? (await db.select().from(jobStep).where(eq(jobStep.jobId, job.id))).map((s) => s.name)
      : [];
    const thumb = await r2.headObject(thumbnailKey(takeId));
    console.log(
      JSON.stringify({
        fixture: file,
        probeRun: `${run.id} ${run.status}`,
        output: run.output,
        take: row && {
          status: row.status,
          failureCode: row.failureCode,
          durationMs: row.durationMs,
          size: row.width && row.height ? `${row.width}x${row.height}` : null,
          container: row.container,
        },
        message: row?.status === "failed" ? uploadFailureMessage(row) : null,
        thumbnailBytes: thumb?.size ?? null,
        job: job
          ? {
              kind: job.kind,
              status: job.status,
              secondsCharged: job.secondsCharged,
              steps,
              processTakeRun: job.triggerRunId,
            }
          : null,
      }),
    );
  }
} finally {
  await Promise.all(keys.map((key) => r2.deleteObject(key)));
  const left = await Promise.all(keys.map((key) => r2.headObject(key)));
  await db.delete(user).where(eq(user.id, userId));
  console.log(
    JSON.stringify({
      cleanup: { r2ObjectsDeleted: keys.length, stillThere: left.filter(Boolean).length },
    }),
  );
  await client.end();
}
