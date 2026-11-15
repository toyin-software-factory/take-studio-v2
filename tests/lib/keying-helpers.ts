/** Shared setup and helpers for tests/keying-check.ts (moved out to keep each file at 250 lines or fewer). */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configure } from "@trigger.dev/sdk";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import { dispatchJob } from "../../src/db/data/dispatch";
import { startJob } from "../../src/db/data/jobs";
import * as schema from "../../src/db/schema";
import { isGreen } from "../../src/lib/keying";
import { parseFfprobe } from "../../src/lib/probe";
import { createR2 } from "../../src/lib/r2";
import { originalKey, thumbnailKey } from "../../src/lib/take-rules";
import { triggerForJob } from "../../src/lib/trigger-runs";
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
export const work = mkdtempSync(join(tmpdir(), "keying-check-"));
export const outDir = env.OUT_DIR ?? work;
mkdirSync(outDir, { recursive: true });
export const SECRET = "local-dev-usage-secret-0123456789abcdef";
export const media = (name: string) =>
  new URL(`../fixtures/media/${name}`, import.meta.url).pathname;
export const out = (o: unknown) => console.log(JSON.stringify(o));
export const userId = `keying-check-${crypto.randomUUID()}`;
export const keys: string[] = [];
/** The blue, test only studio: the checks look for blue where the green was (the six real studios are not blue). */
export const PLACEHOLDER = BUILT_IN_BACKGROUNDS.find((b) => b.testOnly)!;
export const BACKGROUND_ID = PLACEHOLDER.id;

export const FIXTURES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "keyed-landscape.mp4",
      "keyed-portrait.mp4",
      "keyed-hdr.mp4",
      "keyed-no-pauses.mp4",
      "keyed-no-audio.mp4",
      "keyed-lime.mp4",
      "keyed-mint.mp4",
      "keyed-shadow.mp4",
      "nogreen-none.mp4",
      "nogreen-no-pauses.mp4",
      "nogreen-no-audio.mp4",
      "nogreen-dark-patchy.mp4",
      "nogreen-green-shirt.mp4",
      "nogreen-narrow.mp4",
    ];

/** Decodes one frame as raw rgb24 at `width` wide (even height), after a tone map for HDR. */
export function rawFrame(path: string, atSeconds: number, width: number, hdr: boolean) {
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
export function morph(mask: Uint8Array, w: number, h: number, r: number, grow: boolean) {
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
export function outlineGreen(sourcePath: string, outputPath: string, hdr: boolean) {
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
  // The person must survive the key (S3S-T10): inside the subject (shrunk by the band), the
  // output must still look like the source, not like the studio.
  let inside = 0;
  let kept = 0;
  for (let i = 0; i < fg.length; i++) {
    if (shrunk[i] !== 1) continue;
    inside += 1;
    const delta =
      Math.abs(render.data[i * 3]! - src.data[i * 3]!) +
      Math.abs(render.data[i * 3 + 1]! - src.data[i * 3 + 1]!) +
      Math.abs(render.data[i * 3 + 2]! - src.data[i * 3 + 2]!);
    if (delta < 90) kept += 1;
  }
  return {
    bandPixels: band,
    greenInBand: green,
    subjectPixels: inside,
    subjectKept: inside === 0 ? 0 : kept / inside,
  };
}

export async function seedTake(file: string) {
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

export async function runJob(takeId: string) {
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
export function expected(file: string): { keyed: boolean; trimSkipped: boolean; audio: boolean } {
  return {
    keyed: file.startsWith("keyed-"),
    trimSkipped: file.endsWith("-no-audio.mp4"),
    audio: !file.endsWith("-no-audio.mp4"),
  };
}
