/**
 * API level end to end pipeline test (spec 0004 build plan step 5, backend half).
 *
 *   pnpm test:pipeline
 *
 * Drives the real routes and tasks: POST /api/uploads → PUT parts to R2 → complete → probe →
 * process-take → GET /api/takes/{id} → media links, for every fixture, plus retry, ownership
 * and limits. Local Postgres (Docker), real R2 and Trigger.dev dev, local ffmpeg. Cleans up
 * through the real deletion path. Exits non zero when any check fails.
 * Pre release check, not PR CI: it needs R2 and Trigger.dev credentials (see README).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { asc, eq, inArray } from "drizzle-orm";
import { drainDeletions, takeFileKeys } from "../../src/db/data/deletion";
import * as schema from "../../src/db/schema";
import { deleteCreatorData } from "../../src/server/account";
import { uploadFailureMessage } from "../../src/lib/take-messages";
import {
  type Creator,
  createCreator,
  db,
  pg,
  r2,
  startServices,
  stopServices,
  work,
} from "./harness";
import { avSync, renderFacts } from "./inspect";

type Check = { scenario: string; check: string; ok: boolean; detail: string };
const checks: Check[] = [];
function check(scenario: string, name: string, ok: boolean, detail: unknown = "") {
  checks.push({
    scenario,
    check: name,
    ok,
    detail: typeof detail === "string" ? detail : JSON.stringify(detail),
  });
}

const media = (file: string) => new URL(`../fixtures/media/${file}`, import.meta.url).pathname;

/** Upload a fixture the way the browser will: create, part PUTs straight to R2, complete. */
async function upload(creator: Creator, file: string, container: "mp4" | "mov"): Promise<string> {
  const bytes = readFileSync(media(file));
  const created = await creator.api("POST", "/api/uploads", {
    fileName: file,
    sizeBytes: bytes.length,
    container,
  });
  if (created.status !== 201)
    throw new Error(`create ${file}: ${created.status} ${JSON.stringify(created.json)}`);
  const { takeId, partSize, partCount } = created.json as {
    takeId: string;
    partSize: number;
    partCount: number;
  };
  const numbers = Array.from({ length: partCount }, (_, i) => i + 1);
  const links = await creator.api("POST", `/api/uploads/${takeId}/parts`, { partNumbers: numbers });
  const parts = await Promise.all(
    (links.json.parts as { partNumber: number; url: string }[]).map(async (p) => {
      const start = (p.partNumber - 1) * partSize;
      const res = await fetch(p.url, {
        method: "PUT",
        body: bytes.subarray(start, start + partSize),
      });
      return {
        partNumber: p.partNumber,
        etag: (res.headers.get("etag") ?? "").replaceAll('"', ""),
      };
    }),
  );
  const done = await creator.api("POST", `/api/uploads/${takeId}/complete`, { parts });
  if (done.status !== 200)
    throw new Error(`complete ${file}: ${done.status} ${JSON.stringify(done.json)}`);
  return takeId;
}

type TakeJson = {
  take: {
    status: string;
    failureCode: string | null;
    retryable: boolean;
    durationMs: number | null;
    title: string;
  };
  latestJob: { status: string; steps: { name: string; status: string }[] } | null;
  latestRender: { id: string; durationMs: number | null } | null;
  removedMs: number;
  note: string | null;
};

/** Poll GET /api/takes/{id} (every 2 s, like the page) until the take is ready or failed. */
async function waitFinal(creator: Creator, takeId: string): Promise<TakeJson> {
  for (let i = 0; i < 300; i++) {
    const res = await creator.api("GET", `/api/takes/${takeId}`);
    const t = res.json as unknown as TakeJson;
    if (res.status === 200 && (t.take.status === "ready" || t.take.status === "failed")) return t;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`take ${takeId} did not finish in 10 minutes`);
}

/** Fetch the first byte through a media link; returns status and Content-Disposition. */
async function probeLink(creator: Creator, takeId: string, kind: string) {
  const res = await creator.api("GET", `/api/takes/${takeId}/media?kind=${kind}`);
  if (res.status !== 200) return { routeStatus: res.status, objectStatus: null, disposition: null };
  const object = await fetch(String(res.json.url), { headers: { range: "bytes=0-0" } });
  return {
    routeStatus: res.status,
    objectStatus: object.status,
    disposition: object.headers.get("content-disposition"),
    expiresInSeconds: res.json.expiresInSeconds,
  };
}

async function downloadRender(creator: Creator, takeId: string): Promise<string> {
  const res = await creator.api("GET", `/api/takes/${takeId}/media?kind=download`);
  const file = join(work, `${takeId}.mp4`);
  writeFileSync(file, Buffer.from(await (await fetch(String(res.json.url))).arrayBuffer()));
  return file;
}

async function jobsOf(takeId: string) {
  return db
    .select()
    .from(schema.processingJob)
    .where(eq(schema.processingJob.takeId, takeId))
    .orderBy(asc(schema.processingJob.createdAt));
}

async function cutsOf(takeId: string) {
  const rows = await db
    .select()
    .from(schema.cut)
    .where(eq(schema.cut.takeId, takeId))
    .orderBy(asc(schema.cut.startMs));
  return rows.map((c) => [c.startMs, c.endMs] as const);
}

type Expect = {
  readonly status: "ready" | "failed";
  readonly failureCode?: string;
  readonly cuts?: ReadonlyArray<readonly [number, number]>;
  readonly note?: string | null;
  readonly render?: { width: number; height: number; colorTransfer?: string };
  readonly sync?: boolean;
  readonly messageIncludes?: string;
};

const FIXTURES: ReadonlyArray<readonly [string, string, "mp4" | "mov", Expect]> = [
  [
    "normal MP4 with a pause",
    "normal.mp4",
    "mp4",
    { status: "ready", cuts: [[2_250, 3_751]], note: null, render: { width: 640, height: 360 } },
  ],
  [
    "portrait MOV, moov at the end",
    "portrait-pauses.mov",
    "mov",
    { status: "ready", cuts: [[2_249, 3_251]], render: { width: 720, height: 1280 } },
  ],
  [
    "HDR (PQ)",
    "hdr-pauses.mp4",
    "mp4",
    {
      status: "ready",
      cuts: [[2_249, 3_251]],
      render: { width: 1280, height: 720, colorTransfer: "bt709" },
    },
  ],
  [
    "pauses + A/V sync",
    "pauses-sync.mp4",
    "mp4",
    {
      status: "ready",
      cuts: [
        [0, 1_401],
        [3_250, 4_251],
        [8_250, 10_751],
        [13_250, 13_751],
        [17_600, 20_000],
      ],
      render: { width: 640, height: 360 },
      sync: true,
    },
  ],
  ["no pauses", "portrait-moov-end.mov", "mov", { status: "ready", cuts: [], note: "no_cuts" }],
  ["silent", "silent.mp4", "mp4", { status: "ready", cuts: [], note: "no_audio" }],
  [
    "too long (11 min)",
    "too-long-11min.mp4",
    "mp4",
    { status: "failed", failureCode: "too_long", messageIncludes: "11 minutes long" },
  ],
  [
    "4K",
    "4k.mp4",
    "mp4",
    { status: "failed", failureCode: "resolution_exceeded", messageIncludes: "3840×2160" },
  ],
];

async function fixtureScenario(
  a: Creator,
  label: string,
  file: string,
  container: "mp4" | "mov",
  want: Expect,
) {
  const takeId = await upload(a, file, container);
  const t = await waitFinal(a, takeId);
  check(label, "final status", t.take.status === want.status, t.take.status);
  if (want.failureCode) {
    check(label, "failure code", t.take.failureCode === want.failureCode, t.take.failureCode);
    check(label, "not retryable (media failure)", t.take.retryable === false, t.take.retryable);
    const [row] = await db.select().from(schema.take).where(eq(schema.take.id, takeId));
    const message = row ? uploadFailureMessage(row) : "";
    check(
      label,
      "message names the problem",
      message.includes(want.messageIncludes ?? ""),
      message,
    );
    check(label, "no job, no charge", (await jobsOf(takeId)).length === 0, "");
    return takeId;
  }

  const cuts = await cutsOf(takeId);
  check(label, "cuts and margins", JSON.stringify(cuts) === JSON.stringify(want.cuts), cuts);
  const removed = cuts.reduce((s, [x, y]) => s + (y - x), 0);
  check(label, "removedMs", Math.abs(t.removedMs - removed) <= 1, {
    api: t.removedMs,
    cuts: removed,
  });
  if (want.note !== undefined) check(label, "AC-7 note", t.note === want.note, t.note);

  const [job] = await jobsOf(takeId);
  const expectedCharge = Math.ceil((t.take.durationMs ?? 0) / 1000);
  check(
    label,
    "charge recorded",
    job?.secondsCharged === expectedCharge && job.refunded === false,
    {
      secondsCharged: job?.secondsCharged,
      expectedCharge,
      refunded: job?.refunded,
    },
  );

  if (want.render) {
    const file = await downloadRender(a, takeId);
    const f = renderFacts(file);
    check(
      label,
      "render size and orientation",
      f.width === want.render.width && f.height === want.render.height && f.rotation === 0,
      `${f.width}x${f.height} rot ${f.rotation}`,
    );
    check(
      label,
      "H.264 yuv420p + AAC",
      f.codec === "h264" && f.pixFmt === "yuv420p" && f.hasAudio,
      `${f.codec} ${f.pixFmt} audio=${f.hasAudio}`,
    );
    check(
      label,
      "CFR + faststart",
      f.cfr && f.faststart,
      `fps ${f.fps} cfr=${f.cfr} faststart=${f.faststart}`,
    );
    if (want.render.colorTransfer)
      check(
        label,
        "HDR tone mapped",
        f.colorTransfer === want.render.colorTransfer,
        f.colorTransfer,
      );
    const expectedMs = (t.take.durationMs ?? 0) - removed;
    check(
      label,
      "render length = original − removed (±1 frame)",
      Math.abs(f.durationMs - expectedMs) <= 40,
      { render: f.durationMs, expectedMs },
    );
    if (want.sync) {
      const s = avSync(file);
      check(
        label,
        "A/V sync at every cut (≤ 1 frame)",
        s.maxAbsOffsetMs <= 34 && s.offsetsMs.length === 5,
        s.offsetsMs,
      );
    }
  } else {
    check(label, "no render made", t.latestRender === null, t.latestRender);
  }
  return takeId;
}

async function main() {
  console.log("Starting the app and trigger dev…");
  await startServices();
  const a = await createCreator("a");
  const b = await createCreator("b");
  const takes: Record<string, string> = {};

  // AC-4, AC-6, AC-7: every fixture end to end.
  for (const [label, file, container, want] of FIXTURES) {
    try {
      takes[label] = await fixtureScenario(a, label, file, container, want);
    } catch (error) {
      check(label, "ran", false, String(error));
    }
  }

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
    const jobs = await jobsOf(failedId);
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

let exitCode = 0;
try {
  await main();
} catch (error) {
  check("harness", "run", false, String(error));
} finally {
  // Clean up through the real deletion path: account data deleted, files drained from R2.
  const creators = (await db.select({ id: schema.user.id }).from(schema.user)).filter((u) =>
    u.id.startsWith("pipeline-"),
  );
  const owned = creators.length
    ? await db
        .select({ id: schema.take.id })
        .from(schema.take)
        .where(
          inArray(
            schema.take.creatorId,
            creators.map((c) => c.id),
          ),
        )
    : [];
  const keys = await takeFileKeys(
    db,
    owned.map((t) => t.id),
  );
  for (const c of creators) {
    await deleteCreatorData(db, c.id, {
      cancelRuns: async () => {},
      requestStorageDrain: async () => {},
    });
    await db.delete(schema.user).where(eq(schema.user.id, c.id));
  }
  const drained = await drainDeletions(db, (k) => r2.deleteObject(k));
  const left = (await Promise.all(keys.map((k) => r2.headObject(k)))).filter(Boolean).length;
  check("cleanup", "all test files deleted from R2", left === 0, {
    keys: keys.length,
    drained: drained.deleted,
    left,
  });
  stopServices();
  await pg.end();

  const width = Math.max(...checks.map((c) => c.scenario.length));
  for (const c of checks) {
    console.log(
      `${c.ok ? "✓" : "✗"} ${c.scenario.padEnd(width)}  ${c.check}${c.ok ? "" : `  →  ${c.detail}`}`,
    );
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(
    `\n${checks.length - failed} passed, ${failed} failed (${checks.length} checks). Logs: ${work}`,
  );
  writeFileSync(join(work, "checks.json"), JSON.stringify(checks, null, 1));
  exitCode = failed > 0 ? 1 : 0;
}
process.exit(exitCode);
