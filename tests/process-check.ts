/**
 * Dev run proof for process-take (spec 0004 AC-5, AC-6, AC-7, AC-10). With `pnpm exec trigger
 * dev` running (see tests/probe-check.ts for the env file note), for each fixture: an uploaded
 * take in local Postgres with its file in R2 → startJob + dispatchJob(process-take) → wait →
 * inspect the job, cuts and the rendered file with local ffprobe/ffmpeg (size, colour, CFR,
 * faststart, duration, A/V sync at the cuts). Then a forced failure and a retry. Cleans up.
 *
 *   DATABASE_URL_DIRECT=postgres://…@localhost:5432/take_studio pnpm tsx tests/process-check.ts
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configure } from "@trigger.dev/sdk";
import { asc, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import { dispatchJob } from "../src/db/data/dispatch";
import { startJob } from "../src/db/data/jobs";
import * as schema from "../src/db/schema";
import { renderKey } from "../src/lib/cut-rules";
import { parseFfprobe } from "../src/lib/probe";
import { createR2 } from "../src/lib/r2";
import { originalKey, thumbnailKey } from "../src/lib/take-rules";
import { triggerForJob } from "../src/lib/trigger-runs";

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
if (new URL(env.DATABASE_URL_DIRECT).hostname !== "localhost") throw new Error("localhost only");
configure({ secretKey: env.TRIGGER_DEV_SECRET_KEY });

const client = postgres(env.DATABASE_URL_DIRECT, { max: 3, onnotice: () => {} });
const db = drizzle(client, { schema });
const r2 = createR2(env);
const work = mkdtempSync(join(tmpdir(), "process-check-"));
const SECRET = "local-dev-usage-secret-0123456789abcdef";
const media = (name: string) => new URL(`./fixtures/media/${name}`, import.meta.url).pathname;
const out = (o: unknown) => console.log(JSON.stringify(o));
const sh = (cmd: string, args: string[]) =>
  execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 << 20,
  });
/** ffmpeg stderr even on success (ffmpeg logs to stderr). */
function ffmpegLog(args: string[]): string {
  return spawnSync("ffmpeg", ["-hide_banner", "-nostats", ...args], {
    encoding: "utf8",
    maxBuffer: 64 << 20,
  }).stderr;
}

/** A fixture as a plain ArrayBuffer backed view. */
function fileBytes(file: string): Uint8Array<ArrayBuffer> {
  const buf = readFileSync(media(file));
  return new Uint8Array(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  );
}

const userId = `process-check-${crypto.randomUUID()}`;
const keys: string[] = [];

async function seedTake(file: string, container: "mp4" | "mov", bytes?: Uint8Array<ArrayBuffer>) {
  const data = bytes ?? fileBytes(file);
  const takeId = crypto.randomUUID();
  const key = originalKey(takeId, container);
  keys.push(key, thumbnailKey(takeId));
  await r2.putObject(key, data, container === "mov" ? "video/quicktime" : "video/mp4");
  const facts = parseFfprobe(
    JSON.parse(
      sh("ffprobe", [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        media(file),
      ]),
    ),
  );
  if (!facts) throw new Error(`fixture ${file} unreadable`);
  await db.insert(schema.take).values({
    id: takeId,
    creatorId: userId,
    title: file,
    status: "uploaded",
    originalKey: key,
    originalBytes: data.byteLength,
    container,
    durationMs: facts.durationMs,
    width: facts.width,
    height: facts.height,
    videoExpiresAt: new Date(Date.now() + 30 * 864e5),
  });
  return takeId;
}

async function runJob(takeId: string) {
  const started = await startJob(db, { creatorId: userId, takeId, usageSecret: SECRET });
  if (!started.ok) throw new Error(`start: ${started.error}`);
  const dispatched = await dispatchJob(db, {
    jobId: started.data.id,
    trigger: triggerForJob("process-take"),
  });
  if (!dispatched.ok) throw new Error(`dispatch: ${dispatched.error}`);
  for (let i = 0; i < 600; i++) {
    const [job] = await db
      .select()
      .from(schema.processingJob)
      .where(eq(schema.processingJob.id, started.data.id));
    if (job && ["succeeded", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("job did not finish in 10 minutes");
}

/** Inspect a rendered file: facts, CFR, faststart, and (optionally) flash vs tone timing. */
function inspect(path: string, syncCheck: boolean) {
  const raw = JSON.parse(
    sh("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path]),
  );
  const v = raw.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  const bytes = readFileSync(path);
  const result: Record<string, unknown> = {
    codec: v.codec_name,
    pixFmt: v.pix_fmt,
    size: `${v.width}x${v.height}`,
    rotation:
      (v.side_data_list ?? []).find((d: { rotation?: number }) => d.rotation !== undefined)
        ?.rotation ?? 0,
    colorTransfer: v.color_transfer ?? null,
    fps: `${v.r_frame_rate} avg ${v.avg_frame_rate}`,
    cfr: v.r_frame_rate === v.avg_frame_rate,
    audio: raw.streams.some((s: { codec_type: string }) => s.codec_type === "audio"),
    durationS: Number(Number(raw.format.duration).toFixed(3)),
    faststart: bytes.indexOf("moov") < bytes.indexOf("mdat"),
  };
  if (syncCheck) {
    const yavg = ffmpegLog([
      "-i",
      path,
      "-vf",
      "signalstats,metadata=print:key=lavfi.signalstats.YAVG",
      "-an",
      "-f",
      "null",
      "-",
    ]);
    const frames = [...yavg.matchAll(/pts_time:([\d.]+)[\s\S]*?YAVG=([\d.]+)/g)].map(
      (m) => [Number(m[1]), Number(m[2])] as const,
    );
    const flashes: number[] = [];
    let inFlash = false;
    for (const [t, y] of frames) {
      if (y > 100 && !inFlash) flashes.push(t);
      inFlash = y > 100;
    }
    const sil = ffmpegLog([
      "-i",
      path,
      "-vn",
      "-af",
      "silencedetect=noise=-35dB:d=0.05",
      "-f",
      "null",
      "-",
    ]);
    const onsets = [...sil.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
    const offsets = flashes.map((f) => {
      const nearest = onsets.reduce(
        (a, b) => (Math.abs(b - f) < Math.abs(a - f) ? b : a),
        Infinity,
      );
      return Math.round((nearest - f) * 1000);
    });
    Object.assign(result, {
      flashTimesS: flashes.map((f) => Number(f.toFixed(3))),
      toneOnsetsS: onsets.map((o) => Number(o.toFixed(3))),
      avOffsetsMs: offsets,
      maxAbsOffsetMs: Math.max(...offsets.map(Math.abs)),
    });
  }
  return result;
}

async function report(
  label: string,
  takeId: string,
  job: typeof schema.processingJob.$inferSelect,
  syncCheck = false,
) {
  const [t] = await db.select().from(schema.take).where(eq(schema.take.id, takeId));
  const steps = await db
    .select({
      name: schema.jobStep.name,
      status: schema.jobStep.status,
      progress: schema.jobStep.progress,
      failureCode: schema.jobStep.failureCode,
    })
    .from(schema.jobStep)
    .where(eq(schema.jobStep.jobId, job.id))
    .orderBy(asc(schema.jobStep.position));
  const cuts = await db
    .select()
    .from(schema.cut)
    .where(eq(schema.cut.takeId, takeId))
    .orderBy(asc(schema.cut.startMs));
  const [latest] = await db.select().from(schema.render).where(eq(schema.render.takeId, takeId));
  let rendered: Record<string, unknown> | null = null;
  if (latest?.videoKey && latest.isLatest) {
    keys.push(renderKey(takeId, latest.id));
    const file = join(work, `${takeId}.mp4`);
    const res = await fetch(await r2.presignGet(latest.videoKey, { expiresSeconds: 600 }));
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    rendered = {
      bytes: statSync(file).size,
      removedRanges: latest.removedRanges,
      ...inspect(file, syncCheck),
    };
  }
  out({
    scenario: label,
    job: {
      status: job.status,
      failureCode: job.failureCode,
      secondsCharged: job.secondsCharged,
      refunded: job.refunded,
    },
    take: { status: t?.status, failureCode: t?.failureCode },
    steps,
    cuts: cuts.map((c) => `${c.startMs}-${c.endMs} ${c.reason}`),
    render: rendered,
  });
}

try {
  await db
    .insert(schema.user)
    .values({ id: userId, name: "Process check", email: `${userId}@example.com` });

  for (const [label, file, container, sync] of [
    ["pauses + A/V sync", "pauses-sync.mp4", "mp4", true],
    ["normal landscape", "normal.mp4", "mp4", false],
    ["portrait phone MOV", "portrait-pauses.mov", "mov", false],
    ["HDR PQ", "hdr-pauses.mp4", "mp4", false],
    ["no pauses (AC-7)", "portrait-moov-end.mov", "mov", false],
    ["no audio (AC-7)", "silent.mp4", "mp4", false],
  ] as const) {
    const takeId = await seedTake(file, container);
    await report(label, takeId, await runJob(takeId), sync);
  }

  // Forced failure: the original is corrupted after the probe (truncated), so ffmpeg fails.
  const full = fileBytes("normal.mp4");
  const takeId = await seedTake("normal.mp4", "mp4", full.slice(0, 4_000));
  await report("forced ffmpeg failure", takeId, await runJob(takeId));
  // Retry ("Try again"): the file is fine again; the failed take restarts.
  await r2.putObject(originalKey(takeId, "mp4"), full, "video/mp4");
  await report("retry after failure", takeId, await runJob(takeId));
} finally {
  await Promise.all(keys.map((k) => r2.deleteObject(k)));
  const left = (await Promise.all(keys.map((k) => r2.headObject(k)))).filter(Boolean).length;
  await db.delete(schema.user).where(like(schema.user.id, "process-check-%"));
  rmSync(work, { recursive: true, force: true });
  out({ cleanup: { r2KeysDeleted: keys.length, stillThere: left } });
  await client.end();
}
