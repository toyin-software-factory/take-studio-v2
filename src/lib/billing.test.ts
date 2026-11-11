import { describe, expect, it } from "vitest";
import { chargeSeconds, chargedMonth, refundSeconds } from "./billing";

describe("charging (AC-6)", () => {
  it("charges ceil(duration_ms / 1000) seconds", () => {
    expect(chargeSeconds(61_500)).toBe(62);
    expect(chargeSeconds(61_000)).toBe(61);
    expect(chargeSeconds(1)).toBe(1);
    expect(chargeSeconds(0)).toBe(0);
  });

  it("records the first of the UTC month", () => {
    expect(chargedMonth(new Date("2026-11-30T23:59:59Z"))).toBe("2026-11-01");
    // 00:30 on 1 December in UTC+1 is still November in UTC.
    expect(chargedMonth(new Date("2026-12-01T00:30:00+01:00"))).toBe("2026-11-01");
    expect(chargedMonth(new Date("2027-01-01T00:00:00Z"))).toBe("2027-01-01");
  });
});

describe("refunds (AC-13)", () => {
  const job = { secondsCharged: 62, refunded: false };

  it("refunds the full charge for a refundable code, once", () => {
    expect(refundSeconds({ ...job, failureCode: "ffmpeg_error" })).toBe(62);
    expect(refundSeconds({ ...job, failureCode: "cancelled_before_start" })).toBe(62);
    expect(refundSeconds({ ...job, refunded: true, failureCode: "ffmpeg_error" })).toBe(0);
  });

  it("refunds nothing for non refundable, unknown or missing codes", () => {
    expect(refundSeconds({ ...job, failureCode: "too_long" })).toBe(0);
    expect(refundSeconds({ ...job, failureCode: "cancelled_while_running" })).toBe(0);
    expect(refundSeconds({ ...job, failureCode: "some_future_code" })).toBe(0);
    expect(refundSeconds({ ...job, failureCode: null })).toBe(0);
  });

  it("never returns a negative amount", () => {
    expect(refundSeconds({ secondsCharged: 0, refunded: false, failureCode: "timeout" })).toBe(0);
    expect(refundSeconds({ secondsCharged: -5, refunded: false, failureCode: "timeout" })).toBe(0);
  });
});
