import { join } from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { processingJob } from "@/db/schema";
import { DeepgramError, DeepgramRejected, DeepgramTimeout } from "../transcript-provider";
import { type TranscriptStepIo } from "./transcript-step";
import {
  body,
  seedRun,
  io,
  stepOf,
  transcripts,
  run,
  db,
  registerDb,
} from "./transcript-step.support";

vi.mock("@trigger.dev/sdk", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  AbortTaskRunError: class extends Error {},
}));

registerDb();

describe("transcriptStep", () => {
  it("makes the transcript from the local original and saves it (AC-1)", async () => {
    const { ctx, take, job } = await seedRun();
    const { value, post, extractAudio } = io();
    expect(await run(ctx, value)).toBe("succeeded");
    expect(extractAudio).toHaveBeenCalledWith(ctx.source, join(ctx.work, "audio.ogg"), ctx.signal);
    expect(post).toHaveBeenCalledTimes(1);
    expect(await stepOf(job.id)).toEqual({ status: "succeeded", code: null });
    const rows = await transcripts(take.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceFps).toBe(29.97);
  });

  it("skips a take with no sound as no_speech without calling Deepgram", async () => {
    const { ctx, job, take } = await seedRun({ hasAudio: false });
    const { value, post, extractAudio } = io();
    expect(await run(ctx, value)).toBe("skipped");
    expect(post).not.toHaveBeenCalled();
    expect(extractAudio).not.toHaveBeenCalled();
    expect(await stepOf(job.id)).toEqual({ status: "skipped", code: "no_speech" });
    expect(await transcripts(take.id)).toHaveLength(0);
  });

  it.each([
    ["not_english", () => body("fr")],
    ["no_speech", () => body("en", false)],
  ])("skips %s without saving", async (reason, answer) => {
    const { ctx, job, take } = await seedRun();
    const { value } = io({ post: async () => answer() });
    expect(await run(ctx, value)).toBe("skipped");
    expect(await stepOf(job.id)).toEqual({ status: "skipped", code: reason });
    expect(await transcripts(take.id)).toHaveLength(0);
  });

  it("a missing Deepgram key fails only the step (provider_error)", async () => {
    const { ctx, job } = await seedRun();
    const { value, post } = io({ apiKey: () => null });
    expect(await run(ctx, value)).toBe("failed");
    expect(post).not.toHaveBeenCalled();
    expect(await stepOf(job.id)).toEqual({ status: "failed", code: "provider_error" });
    const [j] = await db.select().from(processingJob).where(eq(processingJob.id, job.id));
    expect(j?.status).toBe("running");
  });

  it("retries once on a 5xx and then succeeds (AC-7)", async () => {
    const { ctx, job } = await seedRun();
    const post = vi
      .fn<TranscriptStepIo["post"]>()
      .mockRejectedValueOnce(new DeepgramError(503))
      .mockResolvedValue(body());
    expect(await run(ctx, io({ post }).value)).toBe("succeeded");
    expect(post).toHaveBeenCalledTimes(2);
    expect((await stepOf(job.id)).status).toBe("succeeded");
  });

  it("fails the step after the one retry, and the caller starts the separate job (AC-7)", async () => {
    const { ctx, job, take } = await seedRun();
    const post = vi.fn(async () => {
      throw new DeepgramError(500);
    });
    expect(await run(ctx, io({ post }).value)).toBe("failed");
    expect(post).toHaveBeenCalledTimes(2);
    expect(await stepOf(job.id)).toEqual({ status: "failed", code: "provider_error" });
    expect(await transcripts(take.id)).toHaveLength(0);
  });

  it("does not retry a rejected request or a timeout", async () => {
    const rejected = await seedRun();
    const postRejected = vi.fn(async () => {
      throw new DeepgramRejected(402);
    });
    expect(await run(rejected.ctx, io({ post: postRejected }).value)).toBe("failed");
    expect(postRejected).toHaveBeenCalledTimes(1);
    expect(await stepOf(rejected.job.id)).toEqual({ status: "failed", code: "provider_rejected" });

    const slow = await seedRun();
    const postSlow = vi.fn(async () => {
      throw new DeepgramTimeout();
    });
    expect(await run(slow.ctx, io({ post: postSlow }).value)).toBe("failed");
    expect(postSlow).toHaveBeenCalledTimes(1);
    expect(await stepOf(slow.job.id)).toEqual({ status: "failed", code: "timeout" });
  });
});
