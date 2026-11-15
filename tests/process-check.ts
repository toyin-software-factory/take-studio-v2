/**
 * Dev run proof for process-take (spec 0004 AC-5, AC-6, AC-7, AC-10). With `pnpm exec trigger
 * dev` running (see tests/probe-check.ts for the env file note), for each fixture: an uploaded
 * take in local Postgres with its file in R2 → startJob + dispatchJob(process-take) → wait →
 * inspect the job, cuts and the rendered file with local ffprobe/ffmpeg (size, colour, CFR,
 * faststart, duration, A/V sync at the cuts). Then a forced failure and a retry. Cleans up.
 *
 *   DATABASE_URL_DIRECT=postgres://…@localhost:5432/take_studio pnpm tsx tests/process-check.ts
 */

import { rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { originalKey } from "../src/lib/take-rules";
import {
  client,
  db,
  r2,
  work,
  out,
  fileBytes,
  userId,
  keys,
  seedTake,
  runJob,
  report,
} from "./lib/process-helpers";

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
  // Best effort per key: one failed delete must not stop the rest of the cleanup.
  const deleteFailures = (await Promise.allSettled(keys.map((k) => r2.deleteObject(k)))).filter(
    (result) => result.status === "rejected",
  ).length;
  const left = (await Promise.all(keys.map((k) => r2.headObject(k).catch(() => null)))).filter(
    Boolean,
  ).length;
  // Only this run's user (equality, never a prefix match that could hit another run's rows).
  await db.delete(schema.user).where(eq(schema.user.id, userId));
  rmSync(work, { recursive: true, force: true });
  out({
    cleanup: { r2KeysDeleted: keys.length - deleteFailures, deleteFailures, stillThere: left },
  });
  await client.end();
}
