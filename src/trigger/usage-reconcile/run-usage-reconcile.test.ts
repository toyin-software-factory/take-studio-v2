import { describe, expect, it, vi } from "vitest";
import type { ReconcileSummary } from "@/db/data/usage-reconcile";
import { type UsageSwitchDb, runUsageReconcile } from "./run-usage-reconcile";

const TOKEN = "switch-token-0123456789";
const clean: ReconcileSummary = { added: 90, subtracted: 30, jobs: 3, failed: 0 };

function harness(reconcile: () => Promise<ReconcileSummary>) {
  const steps: string[] = [];
  const db: UsageSwitchDb = {
    reconcile: async () => {
      steps.push("reconcile");
      return reconcile();
    },
    enableLimit: async () => {
      steps.push("enable");
    },
  };
  const opened = vi.fn();
  const open = <T>(fn: (d: UsageSwitchDb) => Promise<T>): Promise<T> => {
    opened();
    return fn(db);
  };
  const log = vi.fn();
  return { steps, open, opened, log };
}

describe("runUsageReconcile (spec 0014 AC-11 switch on)", () => {
  it("does nothing, and opens no database, for a wrong, empty or missing token", async () => {
    const { steps, open, opened, log } = harness(async () => clean);
    for (const payload of [{ token: "nope" }, { token: "" }, {}, null, "x"]) {
      expect(await runUsageReconcile(payload, TOKEN, open, log)).toEqual({ outcome: "skipped" });
    }
    expect(await runUsageReconcile({ token: TOKEN }, undefined, open, log)).toEqual({
      outcome: "skipped",
    });
    expect(opened).not.toHaveBeenCalled();
    expect(steps).toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  it("runs the reconcile before it enables the limit, and logs counts only", async () => {
    const { steps, open, log } = harness(async () => clean);
    const out = await runUsageReconcile({ token: TOKEN }, TOKEN, open, log);
    expect(steps).toEqual(["reconcile", "enable"]);
    expect(out).toEqual({ outcome: "enabled", summary: clean });
    expect(log).toHaveBeenCalledWith("usage-reconcile: reconciled", {
      jobs: 3,
      secondsAdded: 90,
      secondsSubtracted: 30,
      failed: 0,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
  });

  it("leaves the flag alone when the reconcile throws", async () => {
    const { steps, open, log } = harness(async () => {
      throw new Error("connection lost with account hash abc");
    });
    const out = await runUsageReconcile({ token: TOKEN }, TOKEN, open, log);
    expect(out).toEqual({ outcome: "reconcile_failed", summary: null });
    expect(steps).toEqual(["reconcile"]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("abc");
  });

  it("leaves the flag alone when a job could not be reconciled", async () => {
    const owed = { ...clean, failed: 1 };
    const { steps, open } = harness(async () => owed);
    const out = await runUsageReconcile({ token: TOKEN }, TOKEN, open, vi.fn());
    expect(out).toEqual({ outcome: "reconcile_failed", summary: owed });
    expect(steps).toEqual(["reconcile"]);
  });

  it("a second run is a no op: nothing added, and the flag is set to what it already is", async () => {
    const results = [clean, { added: 0, subtracted: 0, jobs: 0, failed: 0 }];
    const { steps, open } = harness(async () => results.shift() ?? clean);
    await runUsageReconcile({ token: TOKEN }, TOKEN, open, vi.fn());
    const second = await runUsageReconcile({ token: TOKEN }, TOKEN, open, vi.fn());
    expect(second).toEqual({
      outcome: "enabled",
      summary: { added: 0, subtracted: 0, jobs: 0, failed: 0 },
    });
    expect(steps).toEqual(["reconcile", "enable", "reconcile", "enable"]);
  });
});
