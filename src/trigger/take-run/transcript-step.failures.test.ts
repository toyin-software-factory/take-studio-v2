import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { JobDb } from "@/db/client/job";
import { processingJob } from "@/db/schema";
import type { RunContext } from "./context";
import { DeepgramError, DeepgramRejected } from "../transcript-provider";
import { seedRun, io, stepOf, transcripts, run, db, registerDb } from "./transcript-step.support";

vi.mock("@trigger.dev/sdk", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  AbortTaskRunError: class extends Error {},
}));

registerDb();

describe("transcriptStep", () => {
  it("the edit deadline stops the step: failed timeout, the job goes on (AC-6)", async () => {
    const { ctx, job } = await seedRun();
    const edit = new AbortController();
    const post = vi.fn(
      (_audio: Uint8Array, _key: string, signal: AbortSignal) =>
        new Promise<unknown>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const running = run(ctx, io({ post }).value, edit.signal);
    await vi.waitFor(() => expect(post).toHaveBeenCalled());
    edit.abort(new Error("edit deadline"));
    expect(await running).toBe("failed");
    expect(await stepOf(job.id)).toEqual({ status: "failed", code: "timeout" });
    const [j] = await db.select().from(processingJob).where(eq(processingJob.id, job.id));
    expect(j?.status).toBe("running");
  });

  it("a database error before Deepgram ends only the step, even if the status write fails too", async () => {
    const { ctx } = await seedRun();
    const broken = new Proxy(db, {
      get: () => () => {
        throw new Error("db down");
      },
    }) as unknown as JobDb;
    const { value, post } = io();
    expect(await run({ ...ctx, client: broken } as RunContext, value)).toBe("failed");
    expect(post).not.toHaveBeenCalled();
  });

  it("rethrows when the run itself was stopped", async () => {
    const { ctx } = await seedRun();
    const stop = new AbortController();
    const stopped = { ...ctx, signal: stop.signal } as RunContext;
    const post = vi.fn(async () => {
      stop.abort(new Error("run stopped"));
      throw new DeepgramError(null);
    });
    await expect(run(stopped, io({ post }).value, stop.signal)).rejects.toThrow("run stopped");
  });

  it("reuses a finished step on a retry of the job: Deepgram is not called again", async () => {
    const { ctx, job, take } = await seedRun();
    expect(await run(ctx, io().value)).toBe("succeeded");
    const again = io();
    expect(await run(ctx, again.value)).toBe("succeeded");
    expect(again.post).not.toHaveBeenCalled();
    expect(again.extractAudio).not.toHaveBeenCalled();
    expect(await transcripts(take.id)).toHaveLength(1);
    expect((await stepOf(job.id)).status).toBe("succeeded");

    const failed = await seedRun();
    const post = vi.fn(async () => {
      throw new DeepgramRejected(400);
    });
    expect(await run(failed.ctx, io({ post }).value)).toBe("failed");
    const retry = io();
    expect(await run(failed.ctx, retry.value)).toBe("failed");
    expect(retry.post).not.toHaveBeenCalled();
  });

  it("writes nothing and stops when the job was cancelled meanwhile", async () => {
    const { ctx, take } = await seedRun({ jobStatus: "cancelled" });
    await expect(run(ctx, io().value)).rejects.toThrow();
    expect(await transcripts(take.id)).toHaveLength(0);
  });
});
