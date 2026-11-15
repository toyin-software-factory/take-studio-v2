/** The core API scenarios of the pipeline run: limits, media links, retry and ownership (AC-9 to AC-12). */
import { readFileSync } from "node:fs";
import * as schema from "../../src/db/schema";
import { check } from "./checks";
import { db, r2 } from "./harness";
import { type Creator } from "./creator";
import { jobsOf, media, probeLink, waitFinal } from "./api";

/** Needs the takes the fixture scenarios made, by their label. */
export async function coreScenarios(
  a: Creator,
  b: Creator,
  takes: Readonly<Record<string, string>>,
): Promise<void> {
  // AC-2 (server side) and AC-12: refused before upload.
  const tooBig = await a.api("POST", "/api/uploads", {
    fileName: "huge.mp4",
    sizeBytes: 3 * 1024 ** 3,
    container: "mp4",
  });
  check("limits", "over 2 GB → 422", tooBig.status === 422, tooBig.status);
  const badType = await a.api("POST", "/api/uploads", {
    fileName: "clip.webm",
    sizeBytes: 1_000,
    container: "webm",
  });
  check("limits", "bad type → 422", badType.status === 422, badType.status);

  // AC-9, AC-12: media links, lifetimes and slug file names (non ASCII title).
  const normal = takes["normal MP4 with a pause"];
  if (normal) {
    const renamed = await a.api("PATCH", `/api/takes/${normal}`, { title: "Café take ✨" });
    check("media", "rename", renamed.status === 200, renamed.status);
    const play = await probeLink(a, normal, "play");
    check(
      "media",
      "play: 1 h inline",
      play.objectStatus === 206 &&
        play.expiresInSeconds === 3600 &&
        String(play.disposition).startsWith("inline"),
      play,
    );
    const dl = await probeLink(a, normal, "download");
    check(
      "media",
      "download: 15 min, cafe-take-trimmed.mp4",
      dl.objectStatus === 206 &&
        dl.expiresInSeconds === 900 &&
        String(dl.disposition).includes('filename="cafe-take-trimmed.mp4"'),
      dl,
    );
    const orig = await probeLink(a, normal, "original");
    check(
      "media",
      "original: cafe-take-original.mp4",
      orig.objectStatus === 206 && String(orig.disposition).includes("cafe-take-original.mp4"),
      orig,
    );
  }
  const noPauses = takes["no pauses"];
  if (noPauses) {
    const dl = await probeLink(a, noPauses, "download");
    check(
      "media",
      "no render: Download gives the original (AC-7)",
      dl.objectStatus === 206 && String(dl.disposition).includes("-original.mov"),
      dl,
    );
  }

  // AC-10: "Try again" after a refundable failure, and not after a media failure.
  if (normal) {
    const original = readFileSync(media("normal.mp4"));
    const failedId = crypto.randomUUID();
    const key = `originals/${failedId}/source.mp4`;
    await r2.putObject(key, new Uint8Array(original), "video/mp4");
    await db.insert(schema.take).values({
      id: failedId,
      creatorId: a.id,
      title: "Crashed take",
      status: "failed",
      failureCode: "ffmpeg_error",
      originalKey: key,
      originalBytes: original.length,
      container: "mp4",
      durationMs: 6_000,
      width: 640,
      height: 360,
      videoExpiresAt: new Date(Date.now() + 30 * 864e5),
    });
    // The run that crashed: charged 6 s, refunded by jobs.finish (refundable code).
    await db.insert(schema.processingJob).values({
      id: crypto.randomUUID(),
      takeId: failedId,
      kind: "initial",
      status: "failed",
      failureCode: "ffmpeg_error",
      secondsCharged: 6,
      chargedMonth: "2026-11-01",
      chargedAccountHash: "h",
      refunded: true,
    });
    const retry = await a.api("POST", `/api/takes/${failedId}/retry`);
    check(
      "retry",
      "POST retry accepted",
      retry.status === 202 || retry.status === 201,
      retry.status,
    );
    const after = await waitFinal(a, failedId);
    check("retry", "ready after retry", after.take.status === "ready", after.take.status);
    // The transcript job that follows a Ready video charges nothing and is not part of this check.
    const jobs = (await jobsOf(failedId)).filter((j) => j.kind !== "transcribe");
    check(
      "retry",
      "one net charge (first refunded, new charged once)",
      jobs.length === 2 &&
        jobs[0]?.refunded === true &&
        jobs[1]?.secondsCharged === 6 &&
        jobs[1]?.refunded === false,
      jobs.map((j) => ({ status: j.status, charged: j.secondsCharged, refunded: j.refunded })),
    );
  }
  const tooLong = takes["too long (11 min)"];
  if (tooLong) {
    const r = await a.api("POST", `/api/takes/${tooLong}/retry`);
    check("retry", "media failure → 409 (Upload another video)", r.status === 409, r.status);
  }

  // AC-11: creator B gets the same 404 everywhere on A's take.
  if (normal) {
    const routes: Array<[string, string, unknown?]> = [
      ["GET", `/api/takes/${normal}`],
      ["PATCH", `/api/takes/${normal}`, { title: "mine" }],
      ["POST", `/api/takes/${normal}/retry`],
      ["DELETE", `/api/takes/${normal}`],
      ["GET", `/api/takes/${normal}/media?kind=play`],
      ["GET", `/api/takes/${normal}/media?kind=download`],
      ["GET", `/api/takes/${normal}/media?kind=original`],
      ["POST", `/api/uploads/${normal}/parts`, { partNumbers: [1] }],
      ["POST", `/api/uploads/${normal}/complete`, { parts: [{ partNumber: 1, etag: "x" }] }],
      ["DELETE", `/api/uploads/${normal}`],
      ["GET", "/api/takes/not-a-uuid"],
    ];
    const statuses = [];
    for (const [method, path, body] of routes)
      statuses.push(
        `${method} ${path.replace(normal, "<A's take>")} → ${(await b.api(method, path, body)).status}`,
      );
    check(
      "ownership",
      "creator B: 404 on every route",
      statuses.every((s) => s.endsWith("404")),
      statuses,
    );
    const list = await b.api("GET", "/api/takes");
    check(
      "ownership",
      "creator B's library is empty",
      Array.isArray(list.json.takes) && (list.json.takes as unknown[]).length === 0,
      list.json.takes,
    );
  }
}
