/**
 * Waveform and cut change checks for the pipeline run (spec 0011 build step 2): the video job
 * stores a waveform (AC-11), a change render that keeps one cut renders exactly that plan and
 * updates the flags (AC-7), and a take with no stored waveform gets one on its first change
 * render (AC-11). Real R2 and Trigger.dev dev. Called from run.ts with its helpers.
 */
import { asc, eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { type Creator, db } from "./harness";
import { renderFacts } from "./inspect";
import { sleep, waitIdle } from "./wait";

export type ChangesCtx = {
  readonly a: Creator;
  /** The take of the `pauses + A/V sync` fixture (five cuts), ready and owned by `a`. */
  readonly takeId: string;
  /** A ready take with no audio (the `silent` fixture), owned by `a`. */
  readonly silentTakeId: string | undefined;
  /** Downloads the take's current video and returns the local path. */
  readonly downloadRender: (creator: Creator, takeId: string) => Promise<string>;
  readonly check: (scenario: string, name: string, ok: boolean, detail?: unknown) => void;
};

type TakeJson = {
  cuts: { id: string; startMs: number; endMs: number; applied: boolean }[];
  latestRender: { id: string; removedRanges: { startMs: number; endMs: number }[] } | null;
};

async function waveformRow(takeId: string) {
  const [row] = await db
    .select({ w: schema.take.waveform, durationMs: schema.take.durationMs })
    .from(schema.take)
    .where(eq(schema.take.id, takeId));
  return row;
}

const validWaveform = (w: readonly number[] | null | undefined, durationMs: number | null) =>
  !!w &&
  w.length === Math.min(1000, Math.ceil((durationMs ?? 0) / 100)) &&
  w.every((v) => Number.isInteger(v) && v >= 0 && v <= 100) &&
  w.some((v) => v > 0);

/** POSTs a change that keeps only `keepId` applied and waits for its job to end. */
async function changeKeeping(
  a: Creator,
  takeId: string,
  keepId: string,
  label: string,
): Promise<string> {
  // A transcribe job may still be running after Ready; POST /changes answers 409 job_active then.
  await waitIdle(takeId);
  const got = (await a.api("GET", `/api/takes/${takeId}`)).json as unknown as TakeJson;
  const res = await a.api("POST", `/api/takes/${takeId}/changes`, {
    baseRenderId: got.latestRender?.id ?? null,
    cuts: got.cuts.map((c) => ({ id: c.id, applied: c.id === keepId })),
  });
  if (res.status !== 202) throw new Error(`${label}: POST /changes answered ${res.status}`);
  const jobId = String(res.json.jobId);
  for (let i = 0; i < 300; i++) {
    const job = await a.api("GET", `/api/takes/${takeId}/jobs/${jobId}`);
    const status = String(job.json.status);
    if (status === "succeeded") return jobId;
    if (status === "failed" || status === "cancelled") throw new Error(`${label}: job ${status}`);
    await sleep(2_000);
  }
  throw new Error(`${label}: change job did not finish in 10 minutes`);
}

export async function changeScenarios(ctx: ChangesCtx) {
  const { a, takeId, silentTakeId, check, downloadRender } = ctx;

  // AC-11: the initial job stored a waveform of the original.
  const first = await waveformRow(takeId);
  check(
    "waveform",
    "initial job stored a waveform (length, 0 to 100, not flat)",
    validWaveform(first?.w, first?.durationMs ?? null),
    { length: first?.w?.length, durationMs: first?.durationMs },
  );
  const read = await a.api("GET", `/api/takes/${takeId}/waveform`);
  check(
    "waveform",
    "GET /waveform returns it",
    read.status === 200 && Array.isArray(read.json.waveform),
    read.status,
  );
  if (silentTakeId) {
    check(
      "waveform",
      "a take with no audio keeps a null waveform",
      (await waveformRow(silentTakeId))?.w === null,
      "",
    );
  }

  // AC-7: a change that keeps one cut renders exactly that plan and updates the flags.
  const cuts = await db
    .select()
    .from(schema.cut)
    .where(eq(schema.cut.takeId, takeId))
    .orderBy(asc(schema.cut.startMs));
  const keep = cuts[2];
  if (!keep || cuts.length < 2) {
    check("changes", "fixture has cuts", false, cuts.length);
    return;
  }
  // An older take: no stored waveform until its first change render (AC-11).
  await db.update(schema.take).set({ waveform: null }).where(eq(schema.take.id, takeId));
  const changeJobId = await changeKeeping(a, takeId, keep.id, "keep one cut");
  const after = (await a.api("GET", `/api/takes/${takeId}`)).json as unknown as TakeJson;
  const wantRanges = [{ startMs: keep.startMs, endMs: keep.endMs }];
  const gotRanges = after.latestRender?.removedRanges.map((r) => ({
    startMs: r.startMs,
    endMs: r.endMs,
  }));
  check(
    "changes",
    "removed ranges match the plan (only the kept cut)",
    JSON.stringify(gotRanges) === JSON.stringify(wantRanges),
    { gotRanges, wantRanges },
  );
  check(
    "changes",
    "cut flags updated (only that cut applied)",
    after.cuts.every((c) => c.applied === (c.id === keep.id)),
    after.cuts.map((c) => c.applied),
  );
  const [changeJob] = await db
    .select()
    .from(schema.processingJob)
    .where(eq(schema.processingJob.id, changeJobId));
  check(
    "changes",
    "the change render is a free background job",
    changeJob?.kind === "background" && changeJob.secondsCharged === 0,
    [changeJob?.kind, changeJob?.secondsCharged],
  );
  // The file the renderer produced, not only its metadata: original length minus the removed cut.
  const facts = renderFacts(await downloadRender(a, takeId));
  const originalMs = (await waveformRow(takeId))?.durationMs ?? 0;
  const expectedMs = originalMs - (keep.endMs - keep.startMs);
  check(
    "changes",
    "change render length = original − removed cut (±1 frame)",
    Math.abs(facts.durationMs - expectedMs) <= 40,
    { render: facts.durationMs, expectedMs },
  );
  const old = await waveformRow(takeId);
  check(
    "waveform",
    "an old take got its waveform on the first change render",
    validWaveform(old?.w, old?.durationMs ?? null),
    { length: old?.w?.length },
  );
}
