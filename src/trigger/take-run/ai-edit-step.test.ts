import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { transcript } from "@/db/schema";
import { AiCallError } from "./ai-call";
import {
  TITLE,
  WORDS,
  seedRun,
  good,
  reply,
  io,
  stepOf,
  editsOf,
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

registerDb("take_studio_test_ai_edit");

describe("aiEditStep", () => {
  it("sends the take's script to Claude, and sends none for a take without one (spec 0021 AC-13)", async () => {
    const withScript = await seedRun();
    const a = io();
    await run(
      { ...withScript.ctx, take: { ...withScript.take, script: "Hello my name is Jon." } },
      a.value,
    );
    const sent = a.call.mock.calls[0]?.[0] as { user: string; system: string };
    expect(sent.user).toContain("SCRIPT\nHello my name is Jon.\nEND_SCRIPT");

    const without = await seedRun();
    const b = io();
    await run(without.ctx, b.value);
    const plain = b.call.mock.calls[0]?.[0] as { user: string; system: string };
    expect(plain.user).not.toContain("SCRIPT");
    expect(plain.system).not.toContain("SCRIPT");
  });

  it("happy path: AI cuts with reasons, a kept pause unapplied, one call (AC-2, AC-9)", async () => {
    const { ctx, take, job } = await seedRun();
    const { value, call, report } = io();
    expect(await run(ctx, value)).toEqual({ status: "succeeded", hasCuts: true });
    expect(call).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
    expect(await stepOf(job.id)).toEqual({ status: "succeeded", code: null });
    const rows = (await cutsOf(take.id)).sort((a, b) => a.startMs - b.startMs);
    expect(rows.every((r) => r.proposedBy === "ai" && r.reason)).toBe(true);
    expect(rows.map((r) => [r.kind, r.startMs, r.endMs, r.applied])).toEqual([
      ["filler", 450, 800, true],
      ["pause", 3000, 5000, true],
      ["pause", 8000, 10_000, false],
    ]);
    // Spec 0012 task 4: the fixes are stored with the cuts, none undone, and the words are untouched.
    expect(await editsOf(take.id)).toEqual([
      { index: 3, old: "Jon", new: "John", reason: "Name said earlier", undone: false },
    ]);
    const [row] = await db.select().from(transcript).where(eq(transcript.takeId, take.id));
    expect(row?.words[3]?.w).toBe("Jon");
  });

  it("sends only words, candidates, length: no title, name, email, take ID or URL (AC-8)", async () => {
    const { ctx, take, job } = await seedRun();
    const { value, call } = io();
    await run(ctx, value);
    const request = call.mock.calls[0]?.[0];
    const text = `${request?.system}\n${request?.user}`;
    for (const secret of [TITLE, take.id, job.id, take.creatorId, "http", "@", take.originalKey]) {
      expect(text).not.toContain(secret);
    }
    expect(request?.user).toContain("3|Jon|1100|1400|");
  });

  it("falls back on a timeout: rules cuts stay, skipped ai_unavailable, one report with IDs (AC-7)", async () => {
    const { ctx, take, job } = await seedRun();
    const { value, report } = io({
      call: async () => {
        throw new AiCallError("timeout", false);
      },
    });
    expect(await run(ctx, value)).toEqual({ status: "skipped", hasCuts: null });
    expect(await stepOf(job.id)).toEqual({ status: "skipped", code: "ai_unavailable" });
    await expectRulesCuts(take.id);
    expect(await editsOf(take.id)).toEqual([]);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith({ takeId: take.id, jobId: job.id, cause: "timeout" });
  });

  it.each([
    ["invalid JSON", reply("not json {"), "invalid"],
    ["schema failure", reply({ keepPauses: [] }), "invalid"],
    ["max_tokens", reply(good, { stopReason: "max_tokens" }), "cutoff"],
    ["a refusal", reply(good, { stopReason: "refusal" }), "provider_rejected"],
    ["no text", reply(good, { text: null }), "invalid"],
    [
      "a bad fix",
      reply({
        keepPauses: [],
        wordCuts: [],
        fixes: [{ index: 3, old: "Jan", new: "John", reason: "r" }],
        background: null,
      }),
      "invalid",
    ],
  ])("falls back on %s", async (_name, answer, cause) => {
    const { ctx, take, job } = await seedRun();
    const { value, report } = io({ call: async () => answer });
    const out = await run(ctx, value);
    expect(out).toEqual({ status: "skipped", hasCuts: null });
    expect(await stepOf(job.id)).toEqual({ status: "skipped", code: "ai_unavailable" });
    await expectRulesCuts(take.id);
    expect(report).toHaveBeenCalledWith({ takeId: take.id, jobId: job.id, cause });
  });

  it("falls back when word cuts take over 60 % of a take under 30 s", async () => {
    const { ctx, take, job } = await seedRun();
    const words = [
      { ...WORDS[0]!, endMs: 400 },
      { ...WORDS[1]!, startMs: 500 },
      { ...WORDS[2]!, startMs: 14_000, endMs: 14_200 },
    ];
    await testDb.db.update(transcript).set({ words }).where(eq(transcript.takeId, take.id));
    const answer = {
      keepPauses: [],
      wordCuts: [{ fromWord: 1, toWord: 1, kind: "false_start", reason: "x" }], // 500..14 000, 67.5 % of 20 000 (a take under 30 s may lose 60 %)
      fixes: [],
      background: null,
    };
    const { value, report } = io({ call: async () => reply(answer) });
    expect((await run(ctx, value)).status).toBe("skipped");
    expect(await stepOf(job.id)).toEqual({ status: "skipped", code: "ai_unavailable" });
    expect(report).toHaveBeenCalledWith({ takeId: take.id, jobId: job.id, cause: "invalid" });
    await expectRulesCuts(take.id);
  });
});
