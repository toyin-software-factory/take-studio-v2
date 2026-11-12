/**
 * Dev run proof for background keying (spec 0008 AC-2, AC-3). With `pnpm exec trigger dev`
 * running (see tests/process-check.ts for the env file note) and the built in studio seeded
 * (`pnpm db:seed`), for each synthetic fixture: a take in local Postgres with its file in R2
 * and the built in background chosen → startJob + dispatchJob(process-take) → wait → inspect
 * the job steps, the render row and the rendered file with local ffmpeg. For a keyed output it
 * counts green pixels in a band around the subject's outline (there must be none), and saves
 * a frame of every output. Cleans up.
 *
 *   DATABASE_URL_DIRECT=postgres://…@localhost:5432/take_studio \
 *     OUT_DIR=/some/dir pnpm tsx tests/keying-check.ts [keyed-landscape.mp4 …]
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
import { isGreen } from "../src/lib/keying";
import { parseFfprobe } from "../src/lib/probe";
import { createR2 } from "../src/lib/r2";
import { renderKey } from "../src/lib/cut-rules";
import { originalKey, thumbnailKey } from "../src/lib/take-rules";
import { triggerForJob } from "../src/lib/trigger-runs";
import { BUILT_IN_BACKGROUNDS } from "../scripts/built-in-backgrounds";
import { renderFacts } from "./pipeline/inspect";

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
const work = mkdtempSync(join(tmpdir(), "keying-check-"));
const outDir = env.OUT_DIR ?? work;
mkdirSync(outDir, { recursive: true });
const SECRET = "local-dev-usage-secret-0123456789abcdef";
const media = (name: string) => new URL(`./fixtures/media/${name}`, import.meta.url).pathname;
const out = (o: unknown) => console.log(JSON.stringify(o));
const userId = `keying-check-${crypto.randomUUID()}`;
const keys: string[] = [];
const BACKGROUND_ID = BUILT_IN_BACKGROUNDS[0]!.id;

const FIXTURES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "keyed-landscape.mp4",
      "keyed-portrait.mp4",
      "keyed-hdr.mp4",
      "keyed-no-pauses.mp4",
      "keyed-no-audio.mp4",
      "nogreen-none.mp4",
      "nogreen-no-pauses.mp4",
      "nogreen-no-audio.mp4",
      "nogreen-dark-patchy.mp4",
      "nogreen-green-shirt.mp4",
      "nogreen-narrow.mp4",
    ];

/** Decodes one frame as raw rgb24 at `width` wide (even height), after a tone map for HDR. */
function rawFrame(path: string, atSeconds: number, width: number, hdr: boolean) {
  const probe = parseFfprobe(
    JSON.parse(
      spawnSync(
        "ffprobe",
        ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
        { encoding: "utf8" },
      ).stdout,
    ),
  )!;
  const height = Math.max(2, Math.round((probe.height * width) / probe.width / 2) * 2);
  const tone = hdr
    ? "zscale=tin=smpte2084:min=bt2020nc:pin=bt2020:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,"
    : "";
  const res = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-ss",
      String(atSeconds),
      "-i",
      path,
      "-frames:v",
      "1",
      "-vf",
      `${tone}scale=${width}:${height},format=rgb24`,
      "-f",
      "rawvideo",
      "-",
    ],
    { maxBuffer: 256 << 20 },
  );
  return { width, height, data: new Uint8Array(res.stdout) };
}

/** Max filter (grow) or min filter (shrink) of a boolean mask by `r` pixels, separable. */
function morph(mask: Uint8Array, w: number, h: number, r: number, grow: boolean) {
  const pass = (src: Uint8Array, horizontal: boolean) => {
    const dst = new Uint8Array(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = grow ? 0 : 1;
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? Math.min(w - 1, Math.max(0, x + k)) : x;
          const yy = horizontal ? y : Math.min(h - 1, Math.max(0, y + k));
          const s = src[yy * w + xx]!;
          v = grow ? Math.max(v, s) : Math.min(v, s);
        }
        dst[y * w + x] = v;
      }
    }
    return dst;
  };
  return pass(pass(mask, true), false);
}

/** Green pixels in a 7 px band around the subject's outline of a keyed output. */
function outlineGreen(sourcePath: string, outputPath: string, hdr: boolean) {
  const W = 640;
  const src = rawFrame(sourcePath, 1, W, hdr);
  const render = rawFrame(outputPath, 1, W, false);
  // The subject is whatever is not the screen colour in the source frame.
  const fg = new Uint8Array(W * src.height);
  for (let i = 0; i < fg.length; i++) {
    const c = { r: src.data[i * 3]!, g: src.data[i * 3 + 1]!, b: src.data[i * 3 + 2]! };
    fg[i] = isGreen(c) ? 0 : 1;
  }
  const r = 7;
  const grown = morph(fg, W, src.height, r, true);
  const shrunk = morph(fg, W, src.height, r, false);
  let band = 0;
  let green = 0;
  for (let i = 0; i < fg.length; i++) {
    if (grown[i] === 1 && shrunk[i] === 0) {
      band += 1;
      const c = { r: render.data[i * 3]!, g: render.data[i * 3 + 1]!, b: render.data[i * 3 + 2]! };
      if (isGreen(c)) green += 1;
    }
  }
  return { bandPixels: band, greenInBand: green };
}

async function seedTake(file: string) {
  const takeId = crypto.randomUUID();
  const key = originalKey(takeId, "mp4");
  keys.push(key, thumbnailKey(takeId));
  const data = new Uint8Array(readFileSync(media(file)));
  await r2.putObject(key, data, "video/mp4");
  const facts = parseFfprobe(
    JSON.parse(
      spawnSync(
        "ffprobe",
        ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", media(file)],
        { encoding: "utf8" },
      ).stdout,
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
    container: "mp4",
    durationMs: facts.durationMs,
    width: facts.width,
    height: facts.height,
    videoExpiresAt: new Date(Date.now() + 30 * 864e5),
    backgroundId: BACKGROUND_ID,
  });
  return { takeId, facts };
}

async function runJob(takeId: string) {
  const started = await startJob(db, { creatorId: userId, takeId, usageSecret: SECRET });
  if (!started.ok) throw new Error(`start: ${started.error}`);
  const dispatched = await dispatchJob(db, {
    jobId: started.data.id,
    trigger: triggerForJob("process-take"),
  });
  if (!dispatched.ok) throw new Error(`dispatch: ${dispatched.error}`);
  for (let i = 0; i < 900; i++) {
    const [job] = await db
      .select()
      .from(schema.processingJob)
      .where(eq(schema.processingJob.id, started.data.id));
    if (job && ["succeeded", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("job did not finish in 15 minutes");
}

/** What each fixture must give (spec 0008 AC-2, AC-3); any mismatch makes the script exit 1. */
function expected(file: string): { keyed: boolean; trimSkipped: boolean; audio: boolean } {
  return {
    keyed: file.startsWith("keyed-"),
    trimSkipped: file.endsWith("-no-audio.mp4"),
    audio: !file.endsWith("-no-audio.mp4"),
  };
}

let failed = 0;

await db
  .insert(schema.user)
  .values({ id: userId, name: "Keying check", email: `${userId}@example.com` });
try {
  for (const file of FIXTURES) {
    const started = Date.now();
    const { takeId, facts } = await seedTake(file);
    const job = await runJob(takeId);
    const renderSeconds = Math.round((Date.now() - started) / 1000);
    const steps = await db
      .select()
      .from(schema.jobStep)
      .where(eq(schema.jobStep.jobId, job.id))
      .orderBy(asc(schema.jobStep.position));
    const renders = await db.select().from(schema.render).where(eq(schema.render.takeId, takeId));
    const latest = renders.find((r) => r.isLatest);
    const [t] = await db.select().from(schema.take).where(eq(schema.take.id, takeId));
    const row: Record<string, unknown> = {
      file,
      job: job.status,
      failureCode: job.failureCode,
      take: t?.status,
      steps: steps.map((s) => `${s.name}:${s.status}${s.failureCode ? `(${s.failureCode})` : ""}`),
      render: latest
        ? { keyed: latest.keyed, keyColor: latest.keyColor, background: latest.backgroundName }
        : null,
      charged: job.secondsCharged,
      wallSeconds: renderSeconds,
    };
    const hdr = file.includes("hdr");
    const sourcePath = media(file);
    if (latest?.videoKey) {
      keys.push(renderKey(takeId, latest.id));
      const res = await fetch(await r2.presignGet(latest.videoKey, { expiresSeconds: 600 }));
      const path = join(work, `${takeId}.mp4`);
      writeFileSync(path, Buffer.from(await res.arrayBuffer()));
      const f = renderFacts(path);
      row.output = {
        size: `${f.width}x${f.height}`,
        shape: `${facts.width}x${facts.height}`,
        codec: `${f.codec} ${f.pixFmt}`,
        cfr: f.cfr,
        audio: f.hasAudio,
        durationMs: f.durationMs,
        sourceMs: facts.durationMs,
      };
      if (latest.keyed) row.outline = outlineGreen(sourcePath, path, hdr);
      // A frame of every output, for the proof.
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
        join(outDir, `${file.replace(".mp4", "")}-output.png`),
      ]);
    }
    // Compare with the expected outcome.
    const want = expected(file);
    const problems: string[] = [];
    const stepText = (row.steps as string[]).join(" ");
    if (job.status !== "succeeded") problems.push(`job ${job.status} ${job.failureCode ?? ""}`);
    if (t?.status !== "ready") problems.push(`take ${t?.status}`);
    if (want.keyed && !stepText.includes("background:succeeded")) {
      problems.push("background step not succeeded");
    }
    if (!want.keyed && !stepText.includes("background:skipped(no_green_screen)")) {
      problems.push("background step not skipped with no_green_screen");
    }
    if (want.trimSkipped !== stepText.includes("trim:skipped")) problems.push("trim step wrong");
    // A take with a background is always rendered, keyed or not (AC-2).
    if (!latest?.videoKey) problems.push("no render");
    if (latest && latest.keyed !== want.keyed) problems.push(`render keyed=${latest.keyed}`);
    if (latest && latest.backgroundName === null) {
      problems.push("render does not name its background");
    }
    const o = row.output as { audio?: boolean } | undefined;
    if (o && o.audio !== want.audio) problems.push(`output audio=${o.audio}`);
    if (want.keyed) {
      const outline = row.outline as { greenInBand: number; bandPixels: number } | undefined;
      if (!outline || outline.bandPixels === 0) problems.push("no outline measured");
      else if (outline.greenInBand !== 0) {
        problems.push(`${outline.greenInBand} green outline pixels`);
      }
    }
    row.ok = problems.length === 0;
    if (problems.length > 0) {
      row.problems = problems;
      failed += 1;
    }
    out(row);
  }
} finally {
  const failures = (await Promise.allSettled(keys.map((k) => r2.deleteObject(k)))).filter(
    (r) => r.status === "rejected",
  ).length;
  await db.delete(schema.user).where(eq(schema.user.id, userId));
  await client.end();
  rmSync(work, { recursive: true, force: true });
  out({ cleanup: { keys: keys.length, deleteFailures: failures }, fixturesFailed: failed });
  if (failed > 0 || failures > 0) process.exitCode = 1;
}
