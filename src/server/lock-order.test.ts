import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cancel } from "./jobs";
import { deleteTake } from "./takes";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { Db } from "@/db/types";
import { pgErrorCode } from "@/db/types";
import { reanalyse } from "@/db/data/cuts";
import { finish, markRunning, startJob, whileJobActive } from "@/db/data/jobs";

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

type Op = (ctx: Awaited<ReturnType<typeof runningVideoJob>>) => Promise<unknown>;
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
};

async function deadlocks(first: Op, second: Op): Promise<number> {
  let found = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const ctx = await runningVideoJob();
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
