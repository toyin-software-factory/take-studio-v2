/**
 * Dev run proof for background previews (spec 0008 AC-4). With `pnpm exec trigger dev` running
 * (see tests/process-check.ts for the env file note) and the built in studio seeded
 * (`pnpm db:seed`): takes with a green screen and without one (no render yet, so the job detects
 * on the frame) are asked for previews through the real `startPreview` and the `preview-background`
 * task. It measures the time from the request to a ready still, checks the picture (the studio
 * where the green was, the plain frame and the flag for no green screen), the cache hit, two
 * backgrounds on one take, and that nothing is written for a take deleted meanwhile. Exits 1 on
 * a miss. Cleans up.
 *
 *   DATABASE_URL_DIRECT=postgres://…@localhost:5432/take_studio \
 *     OUT_DIR=/some/dir pnpm tsx tests/preview-check.ts
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configure } from "@trigger.dev/sdk";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import { getPreview, requestPreview } from "../src/db/data/previews";
import * as schema from "../src/db/schema";
import { isGreen } from "../src/lib/keying";
import { parseFfprobe } from "../src/lib/probe";
import { createR2 } from "../src/lib/r2";
import { originalKey, thumbnailKey } from "../src/lib/take-rules";
import { triggerPreview } from "../src/lib/trigger-runs";
import { startPreview } from "../src/server/backgrounds/preview";
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
const work = mkdtempSync(join(tmpdir(), "preview-check-"));
const outDir = env.OUT_DIR ?? work;
mkdirSync(outDir, { recursive: true });
const media = (name: string) => new URL(`./fixtures/media/${name}`, import.meta.url).pathname;
const out = (o: unknown) => console.log(JSON.stringify(o));
const userId = `preview-check-${crypto.randomUUID()}`;
const keys: string[] = [];
const problems: string[] = [];
const expect = (ok: boolean, what: string) => {
  if (!ok) problems.push(what);
  out({ check: what, ok });
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STUDIO = BUILT_IN_BACKGROUNDS[0]!.id;

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
async function previewOf(takeId: string, backgroundId: string) {
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
async function look(objectKey: string, name: string) {
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
  return {
    width: probe.streams[0]!.width,
    height: probe.streams[0]!.height,
    greenShare: green / (raw.length / 3),
    corner: { r: raw[0] ?? 0, g: raw[1] ?? 0, b: raw[2] ?? 0 },
  };
}

await db
  .insert(schema.user)
  .values({ id: userId, name: "Preview check", email: `${userId}@example.com` });
try {
  // 1. A green screen take: keyed on the studio. The first request also starts the worker.
  const keyed = await seedTake("keyed-landscape.mp4");
  const first = await previewOf(keyed, STUDIO);
  out({ keyedPreviewSeconds: first.seconds });
  expect(
    first.preview.status === "ready" && !first.preview.noGreenScreen,
    "green screen take: the preview is ready and not flagged",
  );
  const k = await look(first.preview.objectKey!, "keyed-preview");
  expect(k.width === 1280 && k.height === 720, `the still is 1280x720 (${k.width}x${k.height})`);
  expect(
    k.greenShare === 0,
    `no green left in the keyed still (${(k.greenShare * 100).toFixed(2)} %)`,
  );
  expect(
    k.corner.b > k.corner.r,
    `the studio shows where the green was (rgb ${k.corner.r},${k.corner.g},${k.corner.b})`,
  );
  expect(
    first.seconds <= 20,
    `the preview came in ${first.seconds.toFixed(1)} s (about 20 s expected)`,
  );

  // 2. The cache: asking again is a hit, no new job.
  const again = await requestPreview(db, {
    creatorId: userId,
    takeId: keyed,
    backgroundId: STUDIO,
  });
  expect(
    again.ok && !again.data.dispatch && again.data.preview.id === first.preview.id,
    "asking again is a cache hit with no new job",
  );

  // 3. A second request after the worker is warm: the typical time.
  const portrait = await seedTake("keyed-portrait.mp4");
  const warm = await previewOf(portrait, STUDIO);
  out({ warmPreviewSeconds: warm.seconds });
  const p = await look(warm.preview.objectKey!, "portrait-preview");
  expect(
    p.width === 1280 && p.height === 2276 && p.greenShare === 0,
    `portrait take: ${p.width}x${p.height}, no green`,
  );

  // 4. A take with no green screen: the plain frame and the flag.
  const none = await seedTake("nogreen-none.mp4");
  const plain = await previewOf(none, STUDIO);
  expect(
    plain.preview.status === "ready" && plain.preview.noGreenScreen,
    "no green screen take: ready and flagged",
  );
  const n = await look(plain.preview.objectKey!, "nogreen-preview");
  expect(
    n.width === 1280 && Math.abs(n.corner.r - n.corner.b) < 20,
    `no green screen: the plain frame (corner rgb ${n.corner.r},${n.corner.g},${n.corner.b})`,
  );

  // 5. Two backgrounds on one take run one after the other and both finish.
  const second = crypto.randomUUID();
  const warmImage = join(work, "warm.jpg");
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
    warmImage,
  ]);
  const imageKey = `backgrounds/test-${second}/image.jpg`;
  keys.push(imageKey);
  await r2.putObject(imageKey, new Uint8Array(readFileSync(warmImage)), "image/jpeg");
  await db.insert(schema.background).values({
    id: second,
    creatorId: userId,
    name: "Studio warm",
    imageKey,
    thumbKey: `backgrounds/builtin/${BUILT_IN_BACKGROUNDS[0]!.slug}.webp`,
    width: 1920,
    height: 1080,
    status: "ready",
  });
  const [a, b] = await Promise.all([previewOf(portrait, second), previewOf(keyed, second)]);
  expect(
    a.preview.status === "ready" && b.preview.status === "ready",
    "previews on a second background finish",
  );
  const both = await Promise.all([
    startPreview(db, userId, keyed, STUDIO, triggerPreview),
    startPreview(db, userId, keyed, second, triggerPreview),
  ]);
  expect(
    both.every((r) => r.ok && r.data.status === "ready"),
    "both backgrounds of one take are cached",
  );

  // 5b. One at a time per take: two previews of one take, asked together, do not overlap.
  const extra: string[] = [];
  for (const name of ["Studio three", "Studio four"]) {
    const id = crypto.randomUUID();
    await db.insert(schema.background).values({
      id,
      creatorId: userId,
      name,
      imageKey,
      thumbKey: `backgrounds/builtin/${BUILT_IN_BACKGROUNDS[0]!.slug}.webp`,
      width: 1920,
      height: 1080,
      status: "ready",
    });
    extra.push(id);
  }
  const requested = await Promise.all(
    extra.map((backgroundId) =>
      requestPreview(db, { creatorId: userId, takeId: keyed, backgroundId }),
    ),
  );
  const handles = await Promise.all(
    requested.map(async (r) => (r.ok && r.data.dispatch ? triggerPreview(r.data.preview) : null)),
  );
  // Both previews must reach ready: a timeout fails the check instead of passing quietly.
  for (const backgroundId of extra) {
    let finished = false;
    for (let i = 0; i < 400 && !finished; i++) {
      const got = await getPreview(db, { creatorId: userId, takeId: keyed, backgroundId });
      finished = got.ok && got.data.status === "ready";
      if (!finished) await sleep(250);
    }
    expect(finished, `the preview on ${backgroundId.slice(0, 8)} reached ready`);
  }
  const { runs } = await import("@trigger.dev/sdk");
  const runInfo = await Promise.all(handles.flatMap((h) => (h ? [runs.retrieve(h.id)] : [])));
  // A run without a start or finish time is a failure, never a zero.
  const complete = runInfo.every((r) => r.startedAt && r.finishedAt);
  expect(complete && runInfo.length === 2, "both previews have a start and a finish time");
  const spans = runInfo
    .map((r) => ({
      start: r.startedAt?.getTime() ?? Number.NaN,
      end: r.finishedAt?.getTime() ?? Number.NaN,
    }))
    .sort((x, y) => x.start - y.start);
  out({ serialRuns: spans.map((s) => [s.start % 100000, s.end % 100000]) });
  expect(
    complete && spans.length === 2 && spans[1]!.start >= spans[0]!.end - 500,
    "two previews of one take ran one after the other (queue limit 1 per take)",
  );

  // 6. A take deleted while its preview is being made leaves nothing behind.
  const doomed = await seedTake("keyed-hdr.mp4");
  const gone = await startPreview(db, userId, doomed, STUDIO, triggerPreview);
  if (!gone.ok) throw new Error(gone.error);
  await db.delete(schema.take).where(eq(schema.take.id, doomed));
  await sleep(20_000);
  const left = await db
    .select()
    .from(schema.backgroundPreview)
    .where(eq(schema.backgroundPreview.id, gone.data.id));
  expect(left.length === 0, "the deleted take's preview row is gone");
  const stillThere = await r2.headObject(`previews/${doomed}/${gone.data.id}.jpg`);
  expect(stillThere === null, "no file is left for the deleted take's preview");
  // The HDR take also proves the tone mapped path when it finishes before the delete; not asserted.
  for (const row of await db
    .select()
    .from(schema.backgroundPreview)
    .where(eq(schema.backgroundPreview.takeId, keyed))) {
    if (row.objectKey) keys.push(row.objectKey);
  }
  for (const id of [portrait, none]) {
    for (const row of await db
      .select()
      .from(schema.backgroundPreview)
      .where(eq(schema.backgroundPreview.takeId, id))) {
      if (row.objectKey) keys.push(row.objectKey);
    }
  }
} finally {
  const failures = (await Promise.allSettled(keys.map((key) => r2.deleteObject(key)))).filter(
    (r) => r.status === "rejected",
  ).length;
  await db.delete(schema.user).where(eq(schema.user.id, userId));
  await client.end();
  rmSync(work, { recursive: true, force: true });
  out({ cleanup: { keys: keys.length, deleteFailures: failures }, problems });
  if (problems.length > 0 || failures > 0) process.exitCode = 1;
}
