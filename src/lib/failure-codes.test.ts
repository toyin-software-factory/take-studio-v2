import { describe, expect, it } from "vitest";
import { FAILURE_CODE_VALUES, isFailureCode, isRefundable } from "./failure-codes";

// The registry from spec 0002, "Failure code registry" (AC-13).
const REFUNDABLE = [
  "internal_error",
  "ffmpeg_error",
  "trigger_failed",
  "timeout",
  "stale_run",
  "provider_error",
  "cancelled_before_start",
];
const NOT_REFUNDABLE = [
  "invalid_media",
  "too_long",
  "too_large",
  "resolution_exceeded",
  "corrupt_upload",
  "cancelled_while_running",
];

describe("failure code registry (AC-13)", () => {
  it("holds exactly the codes in the spec", () => {
    expect([...FAILURE_CODE_VALUES].sort()).toEqual([...REFUNDABLE, ...NOT_REFUNDABLE].sort());
  });

  it.each(REFUNDABLE)("%s is refundable", (code) => {
    expect(isRefundable(code)).toBe(true);
  });

  it.each(NOT_REFUNDABLE)("%s is not refundable", (code) => {
    expect(isRefundable(code)).toBe(false);
  });

  it("refunds only before a job runs when the creator cancels", () => {
    expect(isRefundable("cancelled_before_start")).toBe(true);
    expect(isRefundable("cancelled_while_running")).toBe(false);
  });

  it("treats an unknown code (from a newer deploy) as unknown and not refundable", () => {
    expect(isFailureCode("some_future_code")).toBe(false);
    expect(isRefundable("some_future_code")).toBe(false);
    expect(isRefundable("toString")).toBe(false);
  });
});
