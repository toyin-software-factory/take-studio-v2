import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processingJob, take } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { describeWithFfmpeg } from "@/test/ffmpeg";
import { storeWaveform, waveformArgs } from "./waveform";

/** Spec 0011, AC-11: the waveform pass stores values for a take and never fails the job. */
let testDb: TestDb;
let db: Db;
let dir: string;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
  dir = await mkdtemp(join(tmpdir(), "waveform-test-"));
});
afterAll(async () => {
  await testDb?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function runningJob() {
  const creator = await createCreator(db);
  const t = await seedTake(db, creator.id, { status: "ready", durationMs: 2_000 });
  const jobId = crypto.randomUUID();
  await db.insert(processingJob).values({
    id: jobId,
    takeId: t.id,
    kind: "initial",
    status: "running",
    secondsCharged: 2,
  });
  return { takeId: t.id, jobId };
}

const waveformOf = async (takeId: string) =>
  (await db.select({ w: take.waveform }).from(take).where(eq(take.id, takeId)))[0]?.w ?? null;

describe("waveformArgs", () => {
  it("asks for mono 8 kHz raw PCM on stdout", () => {
    const args = waveformArgs("in.mp4").join(" ");
    expect(args).toContain("-ac 1 -ar 8000 -f s16le -");
  });
});

describeWithFfmpeg("storeWaveform with the real ffmpeg", () => {
  it("stores a loud first second and a silent second", async () => {
    const file = join(dir, "tone.wav");
    execFileSync("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2",
      "-af",
      "volume='if(lt(t,1),0.5,0)':eval=frame",
      file,
    ]);
    const { takeId, jobId } = await runningJob();
    await storeWaveform(db, {
      jobId,
      takeId,
      source: file,
      durationMs: 2_000,
      signal: new AbortController().signal,
    });
    const wave = await waveformOf(takeId);
    expect(wave).toHaveLength(20);
    expect(wave?.slice(0, 8).every((v) => v > 40)).toBe(true);
    expect(wave?.slice(12).every((v) => v === 0)).toBe(true);
  });

  it("leaves the waveform null and does not throw when ffmpeg cannot read the file", async () => {
    const { takeId, jobId } = await runningJob();
    await storeWaveform(db, {
      jobId,
      takeId,
      source: join(dir, "missing.wav"),
      durationMs: 2_000,
      signal: new AbortController().signal,
    });
    expect(await waveformOf(takeId)).toBeNull();
  });

  it("writes nothing when the job is already final", async () => {
    const file = join(dir, "tone2.wav");
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=duration=1", file]);
    const { takeId, jobId } = await runningJob();
    await db.update(processingJob).set({ status: "failed" }).where(eq(processingJob.id, jobId));
    await storeWaveform(db, {
      jobId,
      takeId,
      source: file,
      durationMs: 1_000,
      signal: new AbortController().signal,
    });
    expect(await waveformOf(takeId)).toBeNull();
  });

  it("rethrows the job's deadline", async () => {
    const { takeId, jobId } = await runningJob();
    const ac = new AbortController();
    ac.abort(new Error("deadline"));
    await expect(
      storeWaveform(db, {
        jobId,
        takeId,
        source: join(dir, "x.wav"),
        durationMs: 1_000,
        signal: ac.signal,
      }),
    ).rejects.toThrow("deadline");
  });
});
