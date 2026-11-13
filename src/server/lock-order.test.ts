import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cancel } from "./jobs";
import { deleteTake } from "./takes";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { pgErrorCode } from "@/db/types";
import { reanalyse } from "@/db/data/cuts";
import {
  finish,
  markRunning,
  startChangeJob,
  startJob,
  startTranscribeJob,
  whileJobActive,
} from "@/db/data/jobs";
import { saveTranscriptAndFinish } from "@/db/data/transcripts";
import { deleteBackground } from "@/db/data/backgrounds";
import { background, user } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * The lock order rule (src/db/AGENTS.md): creator, then take, then job, then the rows under
 * them (renders, cuts, steps). Every path that locks both a take and a job takes the take
 * first. Each pair below runs at the same time on a fresh take many times; under a crosswise
 * order Postgres aborts one of them with a deadlock (40P01). Nothing may be aborted that way.
 */
let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db;
});
afterAll(() => testDb?.close());

const ROUNDS = 25;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const proposed = [
  { startMs: 1000, endMs: 2500, kind: "pause" as const, proposedBy: "rules" as const, reason: "x" },
];
const noAfter = { cancelRuns: async () => {}, requestStorageDrain: async () => {} };

/** A running video job on an uploaded take (the kind that moves the take when it finishes). */
async function runningVideoJob() {
  const creator = await createCreator(db);
  const t = await seedTake(db, creator.id, { status: "uploaded", durationMs: 10_000 });
  const started = await startJob(db, {
    creatorId: creator.id,
    takeId: t.id,
    usageSecret: "x".repeat(40),
  });
  if (!started.ok) throw new Error(`start refused: ${started.error}`);
  await markRunning(db, { jobId: started.data.id, triggerRunId: "run" });
  return { creatorId: creator.id, takeId: t.id, jobId: started.data.id };
}

/** A running transcribe job on a Ready take (it never moves the take). */
async function runningTranscribeJob() {
  const creator = await createCreator(db);
  const t = await seedTake(db, creator.id, { status: "ready", durationMs: 10_000 });
  const started = await startTranscribeJob(db, { takeId: t.id });
  if (!started.ok) throw new Error(`start refused: ${started.error}`);
  await markRunning(db, { jobId: started.data.id, triggerRunId: "run" });
  return { creatorId: creator.id, takeId: t.id, jobId: started.data.id };
}

type Ctx = Awaited<ReturnType<typeof runningVideoJob>>;
type Op = (ctx: Ctx) => Promise<unknown>;
const ops = {
  finish: ((c) => finish(db, { jobId: c.jobId, status: "failed", failureCode: "timeout" })) as Op,
  cancel: ((c) => cancel(db, { creatorId: c.creatorId, jobId: c.jobId })) as Op,
  guardedWrite: (async (c) =>
    whileJobActive(db, c.jobId, async (tx) => {
      const written = await reanalyse(tx, { takeId: c.takeId, proposed });
      await sleep(5); // hold the locks a moment, so the other side arrives while they are held
      return written;
    })) as Op,
  deleteTake: ((c) => deleteTake(db, c.creatorId, c.takeId, noAfter)) as Op,
  saveTranscript: (async (c) => {
    return saveTranscriptAndFinish(db, c.jobId, {
      takeId: c.takeId,
      language: "en",
      text: "hello",
      words: [{ w: "hello", startMs: 0, endMs: 100, conf: 1, filler: false, para: true }],
      sourceFps: 30,
      model: "nova-3",
    });
  }) as Op,
};

async function deadlocks(
  first: Op,
  second: Op,
  makeCtx: () => Promise<Ctx> = runningVideoJob,
): Promise<number> {
  let found = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const ctx = await makeCtx();
    const settled = await Promise.allSettled([first(ctx), second(ctx)]);
    for (const s of settled) {
      if (s.status === "rejected" && pgErrorCode(s.reason).code === "40P01") found += 1;
    }
  }
  return found;
}

describe("lock order: take before job (no deadlocks)", () => {
  const pairs: ReadonlyArray<readonly [keyof typeof ops, keyof typeof ops]> = [
    ["deleteTake", "finish"],
    ["deleteTake", "cancel"],
    ["deleteTake", "guardedWrite"],
    ["finish", "guardedWrite"],
    ["cancel", "guardedWrite"],
  ];
  it.each(pairs)(
    "%s and %s at the same time",
    async (a, b) => {
      expect(await deadlocks(ops[a], ops[b])).toBe(0);
    },
    60_000,
  );
});

describe("lock order with the transcript save", () => {
  const pairs: ReadonlyArray<readonly [keyof typeof ops, keyof typeof ops]> = [
    ["saveTranscript", "finish"],
    ["saveTranscript", "cancel"],
    ["saveTranscript", "deleteTake"],
    ["saveTranscript", "guardedWrite"],
  ];
  it.each(pairs)(
    "%s and %s at the same time (transcribe job)",
    async (a, b) => {
      expect(await deadlocks(ops[a], ops[b], runningTranscribeJob)).toBe(0);
    },
    60_000,
  );
});

describe("lock order: creator, then background (HRF-T01)", () => {
  /** A Ready take and an own ready background that is also the creator's default (the foreign key then updates the creator row when it is deleted). */
  async function changeAndDelete() {
    const creator = await createCreator(db);
    const t = await seedTake(db, creator.id, { status: "ready", durationMs: 10_000 });
    const id = crypto.randomUUID();
    await db.insert(background).values({
      id,
      creatorId: creator.id,
      name: "Mine",
      imageKey: `backgrounds/${creator.id}/${id}.jpg`,
      thumbKey: `backgrounds/${creator.id}/${id}.webp`,
      width: 1920,
      height: 1080,
      status: "ready",
    });
    await db.update(user).set({ defaultBackgroundId: id }).where(eq(user.id, creator.id));
    return { creator, take: t, backgroundId: id };
  }

  it("a background change and deleting that background (the creator's default) at the same time", async () => {
    let found = 0;
    const unexpected: string[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      const c = await changeAndDelete();
      const settled = await Promise.allSettled([
        startChangeJob(db, {
          creatorId: c.creator.id,
          takeId: c.take.id,
          background: { id: c.backgroundId },
          cuts: [],
        }),
        deleteBackground(db, c.creator.id, c.backgroundId),
      ]);
      for (const r of settled) {
        if (r.status === "fulfilled") continue;
        if (pgErrorCode(r.reason).code === "40P01") found += 1;
        else unexpected.push(String(r.reason));
      }
    }
    // Both functions return a Result for a refusal, so nothing may be rejected at all: a
    // different error would otherwise let this pass with both operations failing every round.
    expect(unexpected).toEqual([]);
    expect(found).toBe(0);
  }, 60_000);
});
