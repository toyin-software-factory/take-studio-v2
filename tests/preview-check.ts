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
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { getPreview, requestPreview } from "../src/db/data/previews";
import * as schema from "../src/db/schema";
import { triggerPreview } from "../src/lib/trigger-runs";
import { startPreview } from "../src/server/backgrounds/preview";
import {
  client,
  db,
  r2,
  work,
  out,
  userId,
  keys,
  problems,
  expect,
  sleep,
  PLACEHOLDER,
  STUDIO,
  seedTake,
  previewOf,
  look,
  otherGreens,
} from "./lib/preview-helpers";

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
    p.width === 1280 && p.height === 2276 && p.greenShare < 0.0005,
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

  await otherGreens();

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
    thumbKey: `backgrounds/builtin/${PLACEHOLDER.slug}.webp`,
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
      thumbKey: `backgrounds/builtin/${PLACEHOLDER.slug}.webp`,
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
