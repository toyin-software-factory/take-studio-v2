/**
 * Dev run proof for a background change (spec 0008 AC-5, AC-6). With `pnpm exec trigger dev`
 * running (see tests/process-check.ts for the env file note) and the built in studio seeded
 * (`pnpm db:seed`): a keyed take is processed on the built in studio, then changed through the
 * real `startBackgroundJob` and `process-take` to a second background, to a background whose
 * image is missing (the change must fail and change nothing), and back to the original. While
 * each change runs the take is polled: it must stay Ready the whole time and its video must not
 * change until the change succeeds. Exits 1 when anything misses. Cleans up.
 *
 *   DATABASE_URL_DIRECT=postgres://…@localhost:5432/take_studio \
 *     OUT_DIR=/some/dir pnpm tsx tests/background-change-check.ts
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configure } from "@trigger.dev/sdk";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import { dispatchJob } from "../src/db/data/dispatch";
import { startJob } from "../src/db/data/jobs";
import * as schema from "../src/db/schema";
import { parseFfprobe } from "../src/lib/probe";
import { createR2 } from "../src/lib/r2";
import { originalKey, thumbnailKey } from "../src/lib/take-rules";
import { triggerForJob } from "../src/lib/trigger-runs";
import { changeBackground } from "../src/server/backgrounds";
import { BUILT_IN_BACKGROUNDS } from "@/lib/built-in-backgrounds";

const env = z
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

const client = postgres(env.DATABASE_URL_DIRECT, { max: 3, onnotice: () => {} });
const db = drizzle(client, { schema });
const r2 = createR2(env);
const work = mkdtempSync(join(tmpdir(), "bgchange-check-"));
const outDir = env.OUT_DIR ?? work;
mkdirSync(outDir, { recursive: true });
const SECRET = "local-dev-usage-secret-0123456789abcdef";
const media = (name: string) => new URL(`./fixtures/media/${name}`, import.meta.url).pathname;
const out = (o: unknown) => console.log(JSON.stringify(o));
const userId = `bgchange-check-${crypto.randomUUID()}`;
const keys: string[] = [];
/** The blue, test only studio: the checks look for blue where the green was (the six real studios are not blue). */
const PLACEHOLDER = BUILT_IN_BACKGROUNDS.find((b) => b.testOnly)!;
const FIRST = PLACEHOLDER.id;
const problems: string[] = [];
const expect = (ok: boolean, what: string) => {
  if (!ok) problems.push(what);
  out({ check: what, ok });
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const latestRender = async (takeId: string) =>
  (await db.select().from(schema.render).where(eq(schema.render.takeId, takeId))).find(
    (r) => r.isLatest,
  );
const takeRow = async (id: string) =>
  (await db.select().from(schema.take).where(eq(schema.take.id, id)))[0]!;

async function frameOf(videoKey: string, name: string) {
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

async function waitJob(jobId: string, takeId: string) {
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
async function waitIdle(takeId: string) {
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

async function newBackground(name: string, imageBytes: Uint8Array<ArrayBuffer> | null) {
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

await db
  .insert(schema.user)
  .values({ id: userId, name: "Background change check", email: `${userId}@example.com` });
try {
  // A warm second studio image (no green in it).
  const warm = join(work, "warm.jpg");
  spawnSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "gradients=s=1920x1080:c0=0x6b2d1a:c1=0xd9a066:x0=0:y0=0:x1=1920:y1=1080:nb_colors=2:d=1",
    "-frames:v",
    "1",
    "-q:v",
    "3",
    warm,
  ]);
  const second = await newBackground("Studio warm", new Uint8Array(readFileSync(warm)));
  const missing = await newBackground("Studio gone", null);

  // 1. The initial run: keyed on the built in studio.
  const takeId = crypto.randomUUID();
  const key = originalKey(takeId, "mp4");
  keys.push(key, thumbnailKey(takeId));
  const data = new Uint8Array(readFileSync(media("keyed-landscape.mp4")));
  await r2.putObject(key, data, "video/mp4");
  const facts = parseFfprobe(
    JSON.parse(
      spawnSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-print_format",
          "json",
          "-show_format",
          "-show_streams",
          media("keyed-landscape.mp4"),
        ],
        { encoding: "utf8" },
      ).stdout,
    ),
  )!;
  await db.insert(schema.take).values({
    id: takeId,
    creatorId: userId,
    title: "bgchange",
    status: "uploaded",
    originalKey: key,
    originalBytes: data.byteLength,
    container: "mp4",
    durationMs: facts.durationMs,
    width: facts.width,
    height: facts.height,
    videoExpiresAt: new Date(Date.now() + 30 * 864e5),
    backgroundId: FIRST,
  });
  const started = await startJob(db, { creatorId: userId, takeId, usageSecret: SECRET });
  if (!started.ok) throw new Error(`start: ${started.error}`);
  await dispatchJob(db, { jobId: started.data.id, trigger: triggerForJob("process-take") });
  const initial = await waitJob(started.data.id, takeId);
  const first = await latestRender(takeId);
  expect(
    initial.job.status === "succeeded" && first?.keyed === true,
    "initial run keyed on the built in studio",
  );
  const blue = await frameOf(first!.videoKey!, "1-initial-blue-studio");
  expect(blue.b > blue.r, `initial frame is the blue studio (rgb ${blue.r},${blue.g},${blue.b})`);
  const charged = (
    await db.select().from(schema.processingJob).where(eq(schema.processingJob.takeId, takeId))
  ).reduce((n, j) => n + j.secondsCharged, 0);

  await waitIdle(takeId);

  // 2. Change to the warm studio: the take stays Ready, the video stays until it succeeds.
  const change = await changeBackground(db, userId, takeId, second, triggerForJob("process-take"));
  if (!change.ok) throw new Error(`change: ${change.error}`);
  const done = await waitJob(change.data.jobId, takeId);
  expect(
    done.job.status === "succeeded",
    `change to a second studio succeeded (${done.job.failureCode ?? "ok"})`,
  );
  expect(
    done.samples.every((s) => s.take === "ready"),
    "the take stayed Ready the whole time",
  );
  // Every poll taken while the job had not yet succeeded must still show the old video. A change
  // that finishes before the first poll leaves no such poll, which is fine: the renders are
  // checked below either way.
  const before = done.samples.filter((s) => s.job !== "succeeded");
  expect(
    before.every((s) => s.render === first!.id),
    `the old video stayed current in all ${before.length} polls before the change succeeded`,
  );
  const second1 = await latestRender(takeId);
  expect(
    second1?.id !== first!.id && second1?.keyed === true && second1.backgroundId === second,
    "the new render is current, keyed, on the second studio",
  );
  expect(
    (await takeRow(takeId)).backgroundId === second,
    "take.background_id is the second studio",
  );
  expect(done.job.secondsCharged === 0 && done.job.notifiedAt === null, "free and no email");
  const warmFrame = await frameOf(second1!.videoKey!, "2-warm-studio");
  expect(
    warmFrame.r > warmFrame.b,
    `frame is the warm studio (rgb ${warmFrame.r},${warmFrame.g},${warmFrame.b})`,
  );
  const queued = (await db.select().from(schema.storageDeletion)).map((r) => r.objectKey);
  expect(queued.includes(first!.videoKey!), "the old video file was queued for deletion");
  keys.push(second1!.videoKey!);

  await waitIdle(takeId);

  // 3. A change to a background whose image is gone fails and changes nothing.
  const bad = await changeBackground(db, userId, takeId, missing, triggerForJob("process-take"));
  if (!bad.ok) throw new Error(`bad change: ${bad.error}`);
  const failed = await waitJob(bad.data.jobId, takeId);
  expect(
    failed.job.status === "failed" && failed.job.failureCode === "background_missing",
    `a missing image fails as background_missing (${failed.job.failureCode})`,
  );
  const afterFail = await latestRender(takeId);
  const takeAfter = await takeRow(takeId);
  expect(
    afterFail?.id === second1!.id &&
      takeAfter.status === "ready" &&
      takeAfter.backgroundId === second,
    "the failed change left the take, its video and its background as they were",
  );
  expect(
    failed.samples.every((s) => s.take === "ready"),
    "the take stayed Ready during the failed change",
  );

  await waitIdle(takeId);

  // 4. Back to the original: the render is plain and the take has no background.
  const back = await changeBackground(db, userId, takeId, null, triggerForJob("process-take"));
  if (!back.ok) throw new Error(`back: ${back.error}`);
  const original = await waitJob(back.data.jobId, takeId);
  expect(original.job.status === "succeeded", "change back to the original succeeded");
  const plain = await latestRender(takeId);
  expect(
    plain?.keyed === false &&
      plain.backgroundId === null &&
      (await takeRow(takeId)).backgroundId === null,
    "the render is plain and take.background_id is null",
  );
  const green = await frameOf(plain!.videoKey!, "3-original-green");
  expect(
    green.g > green.r && green.g > green.b,
    `frame is the original green (rgb ${green.r},${green.g},${green.b})`,
  );
  keys.push(plain!.videoKey!);

  // Charges: the initial job's only.
  const total = (
    await db.select().from(schema.processingJob).where(eq(schema.processingJob.takeId, takeId))
  ).reduce((n, j) => n + j.secondsCharged, 0);
  expect(total === charged, `nothing was charged by the changes (${charged} s in all)`);
  const steps = await db
    .select()
    .from(schema.jobStep)
    .where(eq(schema.jobStep.jobId, change.data.jobId))
    .orderBy(asc(schema.jobStep.position));
  out({ changeSteps: steps.map((s) => `${s.name}:${s.status}`) });
} finally {
  const failures = (await Promise.allSettled(keys.map((k) => r2.deleteObject(k)))).filter(
    (r) => r.status === "rejected",
  ).length;
  await db.delete(schema.user).where(eq(schema.user.id, userId));
  await client.end();
  rmSync(work, { recursive: true, force: true });
  out({ cleanup: { keys: keys.length, deleteFailures: failures }, problems });
  if (problems.length > 0 || failures > 0) process.exitCode = 1;
}
