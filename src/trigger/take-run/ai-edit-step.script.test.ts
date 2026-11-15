import { describe, expect, it, vi } from "vitest";
import { AiCallError } from "./ai-call";
import { registerDb, seedRun, io, run, stepOf, expectRulesCuts } from "./ai-edit-step.support";

const info = vi.hoisted(() => vi.fn());
vi.mock("@trigger.dev/sdk", () => ({
  logger: { info, warn: info, error: info },
}));

registerDb("take_studio_test_ai_edit_script");

const SCRIPT = "Quince synthetic script words about harbours.";

describe("aiEditStep with a script (spec 0021 AC-13, AC-8)", () => {
  it("logs and reports no script text on success, and the report carries no script when Claude fails", async () => {
    const ok = await seedRun();
    const a = io();
    await run({ ...ok.ctx, take: { ...ok.take, script: SCRIPT } }, a.value);

    const bad = await seedRun();
    const failing = io({
      call: vi.fn(async () => {
        throw new AiCallError("provider_rejected", false);
      }),
    });
    const result = await run({ ...bad.ctx, take: { ...bad.take, script: SCRIPT } }, failing.value);

    expect(result.status).toBe("skipped");
    expect(await stepOf(bad.job.id)).toEqual({ status: "skipped", code: "ai_unavailable" });
    await expectRulesCuts(bad.take.id);
    const seen = JSON.stringify([info.mock.calls, failing.report.mock.calls, a.report.mock.calls]);
    expect(seen).not.toContain("Quince");
    expect(seen).not.toContain("harbours");
  });
});
