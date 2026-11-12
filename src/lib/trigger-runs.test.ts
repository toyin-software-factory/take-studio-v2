import { describe, expect, it } from "vitest";
import { isWaitingRunStatus, jobTriggerOptions, probeKey } from "./trigger-runs";

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
