import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { JobDb } from "@/db/client/job";
import { processingJob } from "@/db/schema";
import { type TestDb, createCreator, openTestDb, seedTake } from "@/db/testing/test-db";
import type { RunContext } from "./context";

const mocks = vi.hoisted(() => ({
  queueTakeEmail: vi.fn(async () => {}),
  dispatchJob: vi.fn(),
}));

vi.mock("@trigger.dev/sdk", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../email/queue", () => ({ queueTakeEmail: mocks.queueTakeEmail }));
vi.mock("@/lib/trigger-runs", () => ({ triggerForTranscribe: () => async () => ({ id: "run" }) }));
vi.mock("@/db/data/dispatch", () => ({ dispatchJob: mocks.dispatchJob }));

import { finishWithoutRender } from "./finish";
import { startTranscript } from "./transcript";

/** RF3-T07: the job finish Result is respected, and a failed transcript dispatch leaves no queued job. */
let testDb: TestDb;
let db: JobDb;
beforeAll(async () => {
  testDb = await openTestDb();
  db = testDb.db as unknown as JobDb;
});
afterAll(async () => {
  await testDb?.close();
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

/** Skips the retry pauses (1 s and up) and leaves the database driver's own timers alone. */
function skipRetryPauses() {
  const real = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) =>
    real(fn, (ms ?? 0) >= 1000 ? 0 : ms)) as unknown as typeof setTimeout);
}

async function seed(jobStatus: "running" | "cancelled") {
  const creator = await createCreator(testDb.db);
  const t = await seedTake(testDb.db, creator.id, {
    status: jobStatus === "running" ? "processing" : "ready",
  });
  const [job] = await testDb.db
    .insert(processingJob)
    .values({
      id: crypto.randomUUID(),
      takeId: t.id,
      kind: "initial",
      status: jobStatus,
      secondsCharged: 2,
    })
    .returning();
  if (!job) throw new Error("no job");
  return { take: t, job };
}

const transcribeJobs = (takeId: string) =>
  testDb.db
    .select()
    .from(processingJob)
    .where(and(eq(processingJob.takeId, takeId), eq(processingJob.kind, "transcribe")));

describe("finishWithoutRender", () => {
  it("sends no email and starts no transcript when the job was cancelled before the finish", async () => {
    const { take: t, job } = await seed("cancelled");
    const ctx = {
      client: db,
      signal: new AbortController().signal,
      job,
      take: t,
    } as unknown as RunContext;
    const result = await finishWithoutRender(ctx, "no_cuts");
    expect(result.outcome).toBe("not_finished");
    expect(mocks.queueTakeEmail).not.toHaveBeenCalled();
    expect(mocks.dispatchJob).not.toHaveBeenCalled();
    expect(await transcribeJobs(t.id)).toHaveLength(0);
  });

  it("emails and starts the transcript when the job finishes", async () => {
    const { take: t, job } = await seed("running");
    mocks.dispatchJob.mockResolvedValue({ ok: true, data: { runId: "r" } });
    const ctx = {
      client: db,
      signal: new AbortController().signal,
      job,
      take: t,
    } as unknown as RunContext;
    const result = await finishWithoutRender(ctx, "no_cuts");
    expect(result.outcome).toBe("no_cuts");
    expect(mocks.queueTakeEmail).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchJob).toHaveBeenCalledTimes(1);
  });
});

describe("startTranscript", () => {
  it("fails the transcribe job when the dispatch keeps throwing, so none stays queued", async () => {
    skipRetryPauses();
    const { take: t } = await seed("cancelled");
    mocks.dispatchJob.mockRejectedValue(new Error("db blinked"));
    const run = startTranscript(db, t.id);
    await run;
    expect(mocks.dispatchJob).toHaveBeenCalledTimes(3);
    const jobs = await transcribeJobs(t.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("failed");
    expect(jobs[0]?.failureCode).toBe("trigger_failed");
  });

  it("retries only the dispatch and keeps the one job when a retry goes through", async () => {
    skipRetryPauses();
    const { take: t } = await seed("cancelled");
    mocks.dispatchJob
      .mockRejectedValueOnce(new Error("db blinked"))
      .mockResolvedValue({ ok: true, data: { runId: "r" } });
    const run = startTranscript(db, t.id);
    await run;
    expect(mocks.dispatchJob).toHaveBeenCalledTimes(2);
    const jobs = await transcribeJobs(t.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("queued");
  });
});
