import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { cut, processingJob, transcript } from "@/db/schema";
import { AiCallError } from "./ai-call";
import { type AiEditIo, aiEditStep } from "./ai-edit-step";
import {
  TITLE,
  WORDS,
  CANDS,
  seedRun,
  good,
  reply,
  io,
  stepOf,
  cutsOf,
  run,
  expectRulesCuts,
  testDb,
  db,
  registerDb,
} from "./ai-edit-step.support";

vi.mock("@trigger.dev/sdk", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

registerDb("take_studio_test_ai_edit_fallbacks");

describe("aiEditStep", () => {
  it("a missing key is ai_unavailable (no_key), never an abort, and Claude is not called", async () => {
    const { ctx, job, take } = await seedRun();
    const { value, call, report } = io({ apiKey: () => null });
    expect((await run(ctx, value)).status).toBe("skipped");
    expect(call).not.toHaveBeenCalled();
    expect(await stepOf(job.id)).toEqual({ status: "skipped", code: "ai_unavailable" });
    expect(report).toHaveBeenCalledWith({ takeId: take.id, jobId: job.id, cause: "no_key" });
    const [j] = await db.select().from(processingJob).where(eq(processingJob.id, job.id));
    expect(j?.status).toBe("running");
  });

  it("a request over the input guard is not sent (too_large)", async () => {
    const { ctx, take } = await seedRun();
    const many = Array.from({ length: 25_000 }, (_, i) => ({
      ...WORDS[0]!,
      startMs: i,
      endMs: i + 1,
    }));
    await testDb.db.update(transcript).set({ words: many }).where(eq(transcript.takeId, take.id));
    const { value, call, report } = io();
    expect((await run(ctx, value)).status).toBe("skipped");
    expect(call).not.toHaveBeenCalled();
    expect(report.mock.calls[0]?.[0].cause).toBe("too_large");
  });

  it("retries once on a 429 or 5xx, then succeeds", async () => {
    const { ctx } = await seedRun();
    const call = vi
      .fn<AiEditIo["call"]>()
      .mockRejectedValueOnce(new AiCallError("provider_error", true))
      .mockResolvedValue(reply(good));
    const out = await run(ctx, io({ call }).value);
    expect(out.status).toBe("succeeded");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("retries only once, and never for a rejection", async () => {
    const { ctx, job } = await seedRun();
    const twice = vi
      .fn<AiEditIo["call"]>()
      .mockRejectedValue(new AiCallError("provider_error", true));
    const a = io({ call: twice });
    expect((await run(ctx, a.value)).status).toBe("skipped");
    expect(twice).toHaveBeenCalledTimes(2);
    expect(a.report.mock.calls[0]?.[0].cause).toBe("provider_error");
    expect((await stepOf(job.id)).code).toBe("ai_unavailable");

    const other = await seedRun();
    const rejected = vi
      .fn<AiEditIo["call"]>()
      .mockRejectedValue(new AiCallError("provider_rejected", false));
    const b = io({ call: rejected });
    await run(other.ctx, b.value);
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(b.report.mock.calls[0]?.[0].cause).toBe("provider_rejected");
  });

  it("does not retry once the deadline fired", async () => {
    const { ctx } = await seedRun();
    const edit = new AbortController();
    const call = vi.fn<AiEditIo["call"]>(async () => {
      edit.abort();
      throw new AiCallError("provider_error", true);
    });
    const { value, report } = io({ call });
    await aiEditStep(ctx, edit.signal, { transcript: "succeeded", candidates: CANDS }, value);
    expect(call).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]?.[0].cause).toBe("timeout");
  });

  it("a failed in run transcript falls back as transcript_failed without calling Claude", async () => {
    const { ctx, job, take } = await seedRun({ withTranscript: false });
    const { value, call, report } = io();
    expect((await run(ctx, value, "failed" as never)).status).toBe("skipped");
    expect(call).not.toHaveBeenCalled();
    expect(await stepOf(job.id)).toEqual({ status: "skipped", code: "ai_unavailable" });
    expect(report).toHaveBeenCalledWith({
      takeId: take.id,
      jobId: job.id,
      cause: "transcript_failed",
    });
  });

  it.each(["not_english", "no_speech"])(
    "a %s take skips with the same reason and sends no message",
    async (reason) => {
      const { ctx, job, take } = await seedRun({ withTranscript: false, transcriptStep: reason });
      const { value, call, report } = io();
      expect((await run(ctx, value, "skipped" as never)).status).toBe("skipped");
      expect(call).not.toHaveBeenCalled();
      expect(report).not.toHaveBeenCalled();
      expect(await stepOf(job.id)).toEqual({ status: "skipped", code: reason });
      await expectRulesCuts(take.id);
    },
  );

  it("reuses a final step on attempt 2: no second Claude call, no change", async () => {
    const { ctx, job } = await seedRun();
    const first = io();
    await run(ctx, first.value);
    const second = io();
    expect((await run(ctx, second.value)).hasCuts).toBeNull();
    expect(second.call).not.toHaveBeenCalled();
    expect((await stepOf(job.id)).status).toBe("succeeded");
  });

  it("keeps a cut the creator changed (AC-2)", async () => {
    const { ctx, take } = await seedRun();
    await testDb.db
      .update(cut)
      .set({ creatorChangedAt: new Date(), applied: false })
      .where(and(eq(cut.takeId, take.id), eq(cut.startMs, 3000)));
    const { value } = io({
      call: async () => reply({ keepPauses: [], wordCuts: [], fixes: [], background: null }),
    });
    await run(ctx, value);
    const rows = await cutsOf(take.id);
    const mine = rows.filter((r) => r.startMs === 3000);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ proposedBy: "rules", applied: false });
  });

  it("writes nothing once the job is final, and the run stops", async () => {
    const { ctx, job, take } = await seedRun();
    await db.update(processingJob).set({ status: "cancelled" }).where(eq(processingJob.id, job.id));
    await expect(run(ctx, io().value)).rejects.toThrow();
    await expectRulesCuts(take.id);
  });

  it("logs and reports no text from the take, the prompt or the answer", async () => {
    const { logger } = await import("@trigger.dev/sdk");
    const { ctx } = await seedRun();
    await run(ctx, io().value);
    const logged = JSON.stringify([
      ...vi.mocked(logger.info).mock.calls,
      ...vi.mocked(logger.warn).mock.calls,
    ]);
    for (const secret of ["Jon", "Hello", "Deliberate beat", "Filler word", TITLE]) {
      expect(logged).not.toContain(secret);
    }
    expect(logged).toContain("inputTokens");
  });
});
