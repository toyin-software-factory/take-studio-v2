import { describe, expect, it } from "vitest";
import { creditFor, creditPlanOf, parseCreditSettings } from "./credit-rules";

const STARTS = new Date("2026-12-01T00:00:00Z");
const NOW = new Date("2026-12-10T00:00:00Z");
const AFTER = new Date("2026-12-05T00:00:00Z");
const BEFORE = new Date("2026-11-20T00:00:00Z");
const base = {
  plan: "free" as const,
  choice: null,
  takeCreatedAt: AFTER,
  enabled: true,
  startsAt: STARTS,
  now: NOW,
};

describe("creditFor (AC-4)", () => {
  it("credits a free take created after the start", () => {
    expect(creditFor(base)).toBe(true);
  });
  it("leaves a free take created before the start alone", () => {
    expect(creditFor({ ...base, takeCreatedAt: BEFORE })).toBe(false);
  });
  it("is off while the switch is off, the start is empty or in the future", () => {
    expect(creditFor({ ...base, enabled: false })).toBe(false);
    expect(creditFor({ ...base, startsAt: null })).toBe(false);
    expect(creditFor({ ...base, startsAt: new Date("2027-01-01T00:00:00Z") })).toBe(false);
  });
  it("gives a paid plan the credit only when it chose on", () => {
    expect(creditFor({ ...base, plan: "paid", choice: "on" })).toBe(true);
    expect(creditFor({ ...base, plan: "paid", choice: "off" })).toBe(false);
    expect(creditFor({ ...base, plan: "paid", choice: null })).toBe(false);
  });
  it("maps creator to paid", () => {
    expect(creditPlanOf("creator")).toBe("paid");
    expect(creditPlanOf("free")).toBe("free");
  });
});

describe("parseCreditSettings", () => {
  it("enables only on boolean true and reads a valid date", () => {
    expect(
      parseCreditSettings({ credit_enabled: true, credit_starts_at: "2026-12-01T00:00:00Z" }),
    ).toEqual({
      enabled: true,
      startsAt: STARTS,
    });
    expect(parseCreditSettings({ credit_enabled: "true" }).enabled).toBe(false);
  });
  it("reads a bad or missing date as not set", () => {
    expect(parseCreditSettings({ credit_starts_at: "nope" }).startsAt).toBeNull();
    expect(parseCreditSettings({}).startsAt).toBeNull();
  });
});
