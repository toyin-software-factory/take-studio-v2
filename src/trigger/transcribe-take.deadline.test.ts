import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { finish } from "@/db/data/jobs";
import { take, transcript } from "@/db/schema";
import { DeadlineExceeded, runWithDeadline } from "@/lib/deadline";
import { parseTranscriptEnv } from "@/lib/env";
import {
  DeepgramError,
  DeepgramRejected,
  failTranscribeJob,
  transcribeFailureCode,
  postToDeepgram,
  transcribeJob,
} from "./transcribe-take";
import { dgBody, job, io, outcome, db, registerDb } from "./transcribe-take.support";

registerDb();

describe("a stalled attempt stops at the deadline (S2T-T07)", () => {
  it("ends the job failed with timeout, take Ready, 0 charged, nothing left open or on disk", async () => {
    const { take: t, jobId } = await job();
    let extractStopped = false;
    // A barrier: the deadline fires only once the extraction is waiting for the abort.
    let markReady: () => void = () => undefined;
    const extractionReady = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const stalled = io({
      extractAudio: async (_link, out, signal) => {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(out, "partial"); // a temp file the attempt must clean up
        await new Promise<void>((resolve) => {
          if (signal?.aborted) return resolve();
          signal?.addEventListener(
            "abort",
            () => {
              extractStopped = true; // ffmpeg killed
              resolve();
            },
            { once: true },
          );
          markReady();
        });
        throw signal?.reason;
      },
    }).value;

    const controller = new AbortController();
    const running = transcribeJob(db, jobId, "r", stalled, controller.signal).catch(
      (e: unknown) => e,
    );
    await extractionReady;
    controller.abort(new DeadlineExceeded());
    const error = await running;

    expect(error).toBeInstanceOf(DeadlineExceeded);
    expect(extractStopped).toBe(true);
    expect(await failTranscribeJob(db, jobId, error)).toBe("timeout");
    const { job: j, step } = await outcome(jobId);
    expect(j).toMatchObject({ status: "failed", failureCode: "timeout", secondsCharged: 0 });
    expect(step).toMatchObject({ status: "failed", failureCode: "timeout" });
    const [after] = await db.select().from(take).where(eq(take.id, t.id));
    expect(after?.status).toBe("ready");
    // The work directory is gone.
    const { readdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    expect((await readdir(tmpdir())).filter((n) => n.startsWith(`transcribe-${t.id}-`))).toEqual(
      [],
    );
  });

  it("aborts the Deepgram fetch itself and reports the deadline, not a Deepgram failure", async () => {
    const hang = ((_url: string, init?: RequestInit) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      })) as unknown as typeof fetch;
    const error = await runWithDeadline(30, (signal) =>
      postToDeepgram(new Uint8Array(), "k", hang, signal),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DeadlineExceeded);
    expect(transcribeFailureCode(error)).toBe("timeout");
  });
});

describe("no write after the deadline (S2T-T07)", () => {
  it("does not skip the job when the original is found missing after the deadline", async () => {
    const { jobId } = await job();
    const controller = new AbortController();
    const gone = io({
      r2: {
        headObject: async () => {
          controller.abort(new DeadlineExceeded());
          return null;
        },
        presignGet: async () => "x",
      },
    }).value;
    const error = await transcribeJob(db, jobId, "r", gone, controller.signal).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DeadlineExceeded);
    const { job: j, step } = await outcome(jobId);
    expect(j?.status).toBe("running");
    expect(step?.status).toBe("running");
  });
});

describe("a job that is already final (spec 0007, atomic save)", () => {
  it("publishes no transcript when cleanup failed the job while the run worked", async () => {
    const { take: t, jobId } = await job();
    // Cleanup fails the stale job while the run is still talking to Deepgram.
    const post = async () => {
      await finish(db, { jobId, status: "failed", failureCode: "stale_run" });
      return dgBody();
    };
    const result = await transcribeJob(db, jobId, "r", io({ post }).value);
    expect(result).toMatchObject({ outcome: "job_final" });
    expect(await db.select().from(transcript).where(eq(transcript.takeId, t.id))).toHaveLength(0);
    expect((await outcome(jobId)).job).toMatchObject({
      status: "failed",
      failureCode: "stale_run",
    });
  });
});

describe("postToDeepgram", () => {
  const reply = (status: number, json: unknown = {}) =>
    (async () => new Response(JSON.stringify(json), { status })) as unknown as typeof fetch;

  it("sends the audio with the key and returns the body", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ a: 1 })));
    expect(await postToDeepgram(new Uint8Array([1]), "KEY", fetchImpl as never)).toEqual({ a: 1 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("mip_opt_out=true");
    expect(init.headers).toMatchObject({ authorization: "Token KEY", "content-type": "audio/ogg" });
  });

  it.each([429, 500, 503])("retries (DeepgramError) on %i", async (status) => {
    await expect(postToDeepgram(new Uint8Array(), "k", reply(status))).rejects.toBeInstanceOf(
      DeepgramError,
    );
  });

  it("retries on a network failure", async () => {
    const down = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    await expect(postToDeepgram(new Uint8Array(), "k", down)).rejects.toBeInstanceOf(DeepgramError);
  });

  it.each([400, 402, 413])("does not retry %i (DeepgramRejected, status only)", async (status) => {
    const error = (await postToDeepgram(new Uint8Array(), "k", reply(status)).catch(
      (e: unknown) => e,
    )) as Error;
    expect(error).toBeInstanceOf(DeepgramRejected);
    expect(error.message).toBe(`Deepgram rejected the request (${status})`);
  });
});

describe("transcriptEnvSchema", () => {
  it("names the variable, never a value", () => {
    expect(() => parseTranscriptEnv({})).toThrow("Invalid transcript env: DEEPGRAM_API_KEY");
    expect(parseTranscriptEnv({ DEEPGRAM_API_KEY: "k" })).toEqual({ DEEPGRAM_API_KEY: "k" });
  });
});
