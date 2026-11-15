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
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { asc, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { renderKey } from "../src/lib/cut-rules";
import { renderFacts } from "./pipeline/inspect";
import {
  client,
  db,
  r2,
  work,
  outDir,
  media,
  out,
  userId,
  keys,
  FIXTURES,
  outlineGreen,
  seedTake,
  runJob,
  expected,
} from "./lib/keying-helpers";

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
      const outline = row.outline as
        { greenInBand: number; bandPixels: number; subjectKept: number } | undefined;
      if (!outline || outline.bandPixels === 0) problems.push("no outline measured");
      else {
        if (outline.greenInBand !== 0) problems.push(`${outline.greenInBand} green outline pixels`);
        if (outline.subjectKept < 0.98) {
          problems.push(`only ${(outline.subjectKept * 100).toFixed(1)} % of the person kept`);
        }
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
