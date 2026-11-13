import { afterEach, describe, expect, it, vi } from "vitest";
import { CLEANUP } from "./cleanup-rules";
import {
  isAliveRunStatus,
  isRunAlive,
  isRunWaiting,
  isWaitingRunStatus,
  jobTriggerOptions,
  probeKey,
} from "./trigger-runs";

const retrieve = vi.fn();
vi.mock("@trigger.dev/sdk", () => ({
  runs: { retrieve: (id: string) => retrieve(id), cancel: vi.fn() },
  tasks: { trigger: vi.fn() },
  idempotencyKeys: { create: vi.fn() },
}));

describe("probeKey (S1C-T09)", () => {
  it("keeps the upload completion key and gives every re-dispatch its own", () => {
    const id = "6f0f6b0e-0000-4000-8000-000000000001";
    expect(probeKey(id)).toBe(`probe-${id}`);
    expect(probeKey(id, 0)).toBe(`probe-${id}`);
    expect(probeKey(id, 1)).toBe(`probe-${id}-1`);
    expect(new Set([probeKey(id), probeKey(id, 1), probeKey(id, 2), probeKey(id, 3)]).size).toBe(4);
  });
});

describe("jobTriggerOptions (HRF-T01)", () => {
  it("gives each creator their own concurrency key, so one cannot block another", () => {
    const a = jobTriggerOptions("k1", "creator-a");
    const b = jobTriggerOptions("k2", "creator-b");
    expect(a).toEqual({ idempotencyKey: "k1", concurrencyKey: "creator-creator-a" });
    expect(b.concurrencyKey).not.toBe(a.concurrencyKey);
    // The same creator always lands in the same queue (so their jobs wait behind each other).
    expect(jobTriggerOptions("k3", "creator-a").concurrencyKey).toBe(a.concurrencyKey);
  });

  it("sets no key without a creator, and carries the idempotency key untouched", () => {
    expect(jobTriggerOptions("k", undefined)).toEqual({ idempotencyKey: "k" });
  });
});

describe("isWaitingRunStatus (HRF-T01)", () => {
  it("is true for a run still waiting its turn or just starting, false once it ended", () => {
    for (const status of ["PENDING_VERSION", "QUEUED", "DELAYED", "DEQUEUED", "EXECUTING"]) {
      expect(isWaitingRunStatus(status), status).toBe(true);
    }
    for (const status of [
      "COMPLETED",
      "FAILED",
      "CRASHED",
      "CANCELED",
      "SYSTEM_FAILURE",
      "TIMED_OUT",
      "EXPIRED",
    ]) {
      expect(isWaitingRunStatus(status), status).toBe(false);
    }
  });
});

describe("isRunWaiting (HRF-T01)", () => {
  afterEach(() => {
    retrieve.mockReset();
    vi.useRealTimers();
  });

  it("reads the run's status: waiting while queued, not once it ended", async () => {
    retrieve.mockResolvedValueOnce({ status: "QUEUED" });
    expect(await isRunWaiting("run_1")).toBe(true);
    retrieve.mockResolvedValueOnce({ status: "COMPLETED" });
    expect(await isRunWaiting("run_2")).toBe(false);
  });

  it("answers 'waiting' when Trigger.dev fails, never a guess that fails a live job", async () => {
    retrieve.mockRejectedValueOnce(new Error("503"));
    expect(await isRunWaiting("run_3")).toBe(true);
  });

  it("gives up on a slow lookup after the timeout and answers 'waiting'", async () => {
    vi.useFakeTimers();
    retrieve.mockReturnValueOnce(new Promise(() => undefined));
    const answer = isRunWaiting("run_4");
    await vi.advanceTimersByTimeAsync(CLEANUP.runCheckTimeoutMs + 1);
    expect(await answer).toBe(true);
  });
});

describe("isRunAlive (RF3-T01)", () => {
  afterEach(() => retrieve.mockReset());

  it("is true for every run that has not ended, false once it ended", async () => {
    for (const status of [
      "QUEUED",
      "DELAYED",
      "DEQUEUED",
      "PENDING_VERSION",
      "EXECUTING",
      "WAITING",
    ]) {
      expect(isAliveRunStatus(status), status).toBe(true);
    }
    for (const status of [
      "COMPLETED",
      "FAILED",
      "CRASHED",
      "CANCELED",
      "SYSTEM_FAILURE",
      "TIMED_OUT",
      "EXPIRED",
    ]) {
      retrieve.mockResolvedValueOnce({ status });
      expect(await isRunAlive("run_x"), status).toBe(false);
    }
  });

  it("counts an API error as alive, never a guess that fails a live job", async () => {
    retrieve.mockRejectedValueOnce(new Error("boom"));
    expect(await isRunAlive("run_y")).toBe(true);
  });
});
