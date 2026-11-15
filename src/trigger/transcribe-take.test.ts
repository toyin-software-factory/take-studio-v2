import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { logger } from "@trigger.dev/sdk";
import { take, transcript } from "@/db/schema";
import {
  DeepgramError,
  DeepgramRejected,
  DeepgramTimeout,
  failTranscribeJob,
  transcribeFailureCode,
  postToDeepgram,
  transcribeJob,
} from "./transcribe-take";
import { SECRET_TEXT, dgBody, job, io, outcome, db, registerDb } from "./transcribe-take.support";

registerDb();

describe("transcribeJob (spec 0007, AC-6, AC-7)", () => {
  it("saves the transcript for English (en-GB), leaves the take ready and charges nothing", async () => {
    const { take: t, jobId } = await job();
    const { value } = io();
    const result = await transcribeJob(db, jobId, "run_1", value);
    expect(result).toMatchObject({ outcome: "saved", words: 2 });
    const [row] = await db.select().from(transcript).where(eq(transcript.takeId, t.id));
    expect(row).toMatchObject({ language: "en", model: "nova-3", sourceFps: 29.97 });
    const { job: j, step } = await outcome(jobId);
    expect(j).toMatchObject({ status: "succeeded", secondsCharged: 0 });
    expect(step?.status).toBe("succeeded");
    const [after] = await db.select().from(take).where(eq(take.id, t.id));
    expect(after?.status).toBe("ready");
  });

  it("skips not_english without storing a transcript", async () => {
    const { take: t, jobId } = await job();
    await transcribeJob(db, jobId, "r", io({ post: async () => dgBody("es") }).value);
    const { job: j, step } = await outcome(jobId);
    expect(j?.status).toBe("succeeded");
    expect(step).toMatchObject({ status: "skipped", failureCode: "not_english" });
    expect(await db.select().from(transcript).where(eq(transcript.takeId, t.id))).toHaveLength(0);
  });

  it("skips no_speech when Deepgram finds no words", async () => {
    const { jobId } = await job();
    await transcribeJob(db, jobId, "r", io({ post: async () => dgBody("en", false) }).value);
    expect((await outcome(jobId)).step).toMatchObject({
      status: "skipped",
      failureCode: "no_speech",
    });
  });

  it("never calls Deepgram for a take with no audio stream", async () => {
    const { jobId } = await job();
    const { value, post } = io({ probe: async () => ({ hasAudio: false, fps: 30 }) as never });
    await transcribeJob(db, jobId, "r", value);
    expect(post).not.toHaveBeenCalled();
    expect((await outcome(jobId)).step).toMatchObject({
      status: "skipped",
      failureCode: "no_speech",
    });
  });

  it("skips original_gone quietly when the original is missing, without calling Deepgram", async () => {
    const { jobId } = await job();
    const { value, post } = io({
      r2: { headObject: async () => null, presignGet: async () => "x" },
    });
    await transcribeJob(db, jobId, "r", value);
    expect(post).not.toHaveBeenCalled();
    expect((await outcome(jobId)).step).toMatchObject({
      status: "skipped",
      failureCode: "original_gone",
    });
  });

  it("does nothing for a job that is already final", async () => {
    const { jobId } = await job();
    await transcribeJob(db, jobId, "r", io().value);
    const { value, post } = io();
    expect(await transcribeJob(db, jobId, "r2", value)).toMatchObject({ outcome: "skipped" });
    expect(post).not.toHaveBeenCalled();
  });

  it("lets a bad response retry (DeepgramError) instead of saving", async () => {
    const { jobId } = await job();
    await expect(
      transcribeJob(db, jobId, "r", io({ post: async () => ({ nope: 1 }) }).value),
    ).rejects.toBeInstanceOf(DeepgramError);
  });

  it("logs and returns no transcript text, keys or links", async () => {
    const spies = [vi.spyOn(logger, "info"), vi.spyOn(logger, "warn"), vi.spyOn(logger, "error")];
    const { jobId } = await job();
    const result = await transcribeJob(db, jobId, "r", io().value);
    const seen = JSON.stringify([...spies.flatMap((s) => s.mock.calls), result]);
    expect(seen).not.toContain("Secret");
    expect(seen).not.toContain(SECRET_TEXT);
    expect(seen).not.toContain("r2.test");
    expect(seen).not.toContain("originals/");
    spies.forEach((s) => s.mockRestore());
  });
});

describe("the Deepgram error matrix (spec 0007, AC-8)", () => {
  const attempt = (jobId: string, post: () => Promise<unknown>) =>
    transcribeJob(db, jobId, "r", io({ post }).value);

  it("retries a 500 and then succeeds on the same job, charging nothing", async () => {
    const { take: t, jobId } = await job();
    const down = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    // Attempt 1: Deepgram answers 500, the task throws so Trigger.dev retries.
    await expect(attempt(jobId, () => postToDeepgram(new Uint8Array(), "k", down))).rejects.toThrow(
      DeepgramError,
    );
    expect((await outcome(jobId)).job?.status).toBe("running");
    // Attempt 2: success.
    expect(await attempt(jobId, async () => dgBody())).toMatchObject({ outcome: "saved" });
    expect((await outcome(jobId)).job).toMatchObject({ status: "succeeded", secondsCharged: 0 });
    expect(await db.select().from(transcript).where(eq(transcript.takeId, t.id))).toHaveLength(1);
  });

  it("three 500s end failed provider_error, leave the take Ready and charge 0", async () => {
    const { take: t, jobId } = await job();
    const error = new DeepgramError(500);
    for (let n = 0; n < 3; n++) {
      await expect(attempt(jobId, async () => Promise.reject(error))).rejects.toBe(error);
    }
    expect(await failTranscribeJob(db, jobId, error)).toBe("provider_error");
    const { job: j, step } = await outcome(jobId);
    expect(j).toMatchObject({ status: "failed", failureCode: "provider_error", secondsCharged: 0 });
    expect(step).toMatchObject({ status: "failed", failureCode: "provider_error" });
    const [after] = await db.select().from(take).where(eq(take.id, t.id));
    expect(after?.status).toBe("ready");
    expect(await db.select().from(transcript).where(eq(transcript.takeId, t.id))).toHaveLength(0);
  });

  it("a 402 is not retried and fails at once as provider_rejected", async () => {
    const { jobId } = await job();
    const out = (async () => new Response("{}", { status: 402 })) as unknown as typeof fetch;
    const error = await attempt(jobId, () => postToDeepgram(new Uint8Array(), "k", out)).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DeepgramRejected);
    expect((error as DeepgramRejected).status).toBe(402);
    expect(await failTranscribeJob(db, jobId, error)).toBe("provider_rejected");
    expect((await outcome(jobId)).job).toMatchObject({
      status: "failed",
      failureCode: "provider_rejected",
    });
  });

  it("maps a Deepgram timeout to timeout and a plain 429 or network failure to provider_error", async () => {
    const timeout = (async () => {
      throw new DOMException("took too long", "TimeoutError");
    }) as unknown as typeof fetch;
    const error = await postToDeepgram(new Uint8Array(), "k", timeout).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DeepgramTimeout);
    expect(transcribeFailureCode(error)).toBe("timeout");
    // Headers arrive, then the body stalls past the deadline.
    const stalled = (async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new DOMException("took too long", "TimeoutError");
      },
    })) as unknown as typeof fetch;
    const bodyError = await postToDeepgram(new Uint8Array(), "k", stalled).catch((e: unknown) => e);
    expect(bodyError).toBeInstanceOf(DeepgramTimeout);
    expect(transcribeFailureCode(bodyError)).toBe("timeout");
    expect(transcribeFailureCode(new DeepgramError(429))).toBe("provider_error");
    expect(transcribeFailureCode(new DeepgramError(null))).toBe("provider_error");
    expect(transcribeFailureCode(new Error("MAX_DURATION_EXCEEDED"))).toBe("timeout");
    expect(transcribeFailureCode(new Error("boom"))).toBe("internal_error");
  });
});
