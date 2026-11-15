/** Shared setup and helpers for tests/preview-check.ts (moved out to keep each file at 250 lines or fewer). */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configure } from "@trigger.dev/sdk";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import { getPreview } from "../../src/db/data/previews";
import * as schema from "../../src/db/schema";
import { isGreen } from "../../src/lib/keying";
import { parseFfprobe } from "../../src/lib/probe";
import { createR2 } from "../../src/lib/r2";
import { originalKey, thumbnailKey } from "../../src/lib/take-rules";
import { triggerPreview } from "../../src/lib/trigger-runs";
import { startPreview } from "../../src/server/backgrounds/preview";
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
export const work = mkdtempSync(join(tmpdir(), "preview-check-"));
export const outDir = env.OUT_DIR ?? work;
mkdirSync(outDir, { recursive: true });
export const media = (name: string) =>
  new URL(`../fixtures/media/${name}`, import.meta.url).pathname;
export const out = (o: unknown) => console.log(JSON.stringify(o));
export const userId = `preview-check-${crypto.randomUUID()}`;
export const keys: string[] = [];
export const problems: string[] = [];
export const expect = (ok: boolean, what: string) => {
  if (!ok) problems.push(what);
  out({ check: what, ok });
};
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The blue, test only studio: the checks look for blue where the green was (the six real studios are not blue). */
export const PLACEHOLDER = BUILT_IN_BACKGROUNDS.find((b) => b.testOnly)!;
export const STUDIO = PLACEHOLDER.id;

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
  )!;
  await db.insert(schema.take).values({
    id: takeId,
    creatorId: userId,
    title: file,
    status: "ready",
    originalKey: key,
    originalBytes: data.byteLength,
    container: "mp4",
    durationMs: facts.durationMs,
    width: facts.width,
    height: facts.height,
    videoExpiresAt: new Date(Date.now() + 30 * 864e5),
  });
  return takeId;
}

/** Asks for a preview and waits until it is ready; returns the seconds it took. */
export async function previewOf(takeId: string, backgroundId: string) {
  const started = Date.now();
  const asked = await startPreview(db, userId, takeId, backgroundId, triggerPreview);
  if (!asked.ok) throw new Error(`startPreview: ${asked.error}`);
  for (let i = 0; i < 400; i++) {
    const got = await getPreview(db, { creatorId: userId, takeId, backgroundId });
    if (got.ok && got.data.status !== "making") {
      return { preview: got.data, seconds: (Date.now() - started) / 1000 };
    }
    await sleep(250);
  }
  throw new Error("the preview did not finish in 100 seconds");
}

/** The picture's size and the share of green pixels (hue 80 to 160) and its top left colour. */
export async function look(objectKey: string, name: string) {
  const res = await fetch(await r2.presignGet(objectKey, { expiresSeconds: 600 }));
  const path = join(outDir, `${name}.jpg`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  const probe = JSON.parse(
    spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", path], {
      encoding: "utf8",
    }).stdout,
  ) as { streams: { width: number; height: number }[] };
  const raw = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-vf", "scale=320:-2,format=rgb24", "-f", "rawvideo", "-"],
    { maxBuffer: 64 << 20 },
  ).stdout;
  let green = 0;
  for (let i = 0; i + 2 < raw.length; i += 3) {
    if (isGreen({ r: raw[i]!, g: raw[i + 1]!, b: raw[i + 2]! })) green += 1;
  }
  // A pixel in the middle of the shoulders (the person's shirt), to see the person was kept.
  const rows = raw.length / 3 / 320;
  const t = (Math.round(rows * 0.8) * 320 + 160) * 3;
  return {
    width: probe.streams[0]!.width,
    height: probe.streams[0]!.height,
    greenShare: green / (raw.length / 3),
    corner: { r: raw[0] ?? 0, g: raw[1] ?? 0, b: raw[2] ?? 0 },
    torso: { r: raw[t] ?? 0, g: raw[t + 1] ?? 0, b: raw[t + 2] ?? 0 },
  };
}

/** Check 4b: other greens keep the person and clear the screen. */
export async function otherGreens() {
  // 4b. Other greens (S3S-T10): a lime virtual screen and a pale mint one, each with a grey
  // sweater (146,148,140). The person must stay: the shoulders are still grey, not the studio.
  for (const file of ["keyed-lime.mp4", "keyed-mint.mp4", "keyed-shadow.mp4"]) {
    const take = await seedTake(file);
    const made = await previewOf(take, STUDIO);
    expect(
      made.preview.status === "ready" && !made.preview.noGreenScreen,
      `${file}: the preview is ready and not flagged`,
    );
    keys.push(made.preview.objectKey!);
    const g = await look(made.preview.objectKey!, file.replace(".mp4", "-preview"));
    expect(g.greenShare === 0, `${file}: no green left (${(g.greenShare * 100).toFixed(2)} %)`);
    expect(
      Math.abs(g.torso.r - 146) < 40 &&
        Math.abs(g.torso.g - 148) < 40 &&
        Math.abs(g.torso.b - 140) < 40,
      `${file}: the person is kept, the sweater is still grey (rgb ${g.torso.r},${g.torso.g},${g.torso.b})`,
    );
  }
}
