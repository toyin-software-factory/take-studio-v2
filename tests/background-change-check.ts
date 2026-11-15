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
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { asc, eq } from "drizzle-orm";
import { dispatchJob } from "../src/db/data/dispatch";
import { startJob } from "../src/db/data/jobs";
import * as schema from "../src/db/schema";
import { parseFfprobe } from "../src/lib/probe";
import { originalKey, thumbnailKey } from "../src/lib/take-rules";
import { triggerForJob } from "../src/lib/trigger-runs";
import { changeBackground } from "../src/server/backgrounds";
import {
  client,
  db,
  r2,
  work,
  SECRET,
  media,
  out,
  userId,
  keys,
  FIRST,
  problems,
  expect,
  latestRender,
  takeRow,
  frameOf,
  waitJob,
  waitIdle,
  newBackground,
} from "./lib/background-change-helpers";

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
