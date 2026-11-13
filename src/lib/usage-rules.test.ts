import { describe, expect, it } from "vitest";
import {
  FREE_MONTHLY_SECONDS_DEFAULT,
  fitsInAllowance,
  limitExceededMessage,
  monthlyAllowanceSeconds,
  parseUsageSettings,
  remainingSeconds,
  resetsOn,
  shortDate,
  usageDisplay,
  usageNotice,
  usageSummary,
} from "./usage-rules";

describe("parseUsageSettings (AC-2, AC-11)", () => {
  it("reads the two settings", () => {
    expect(parseUsageSettings({ free_monthly_seconds: 1800, usage_limit_enabled: true })).toEqual({
      freeMonthlySeconds: 1800,
      limitEnabled: true,
    });
  });
  it("defaults to 60 minutes and limit off when missing or bad", () => {
    const off = { freeMonthlySeconds: FREE_MONTHLY_SECONDS_DEFAULT, limitEnabled: false };
    expect(parseUsageSettings({})).toEqual(off);
    expect(parseUsageSettings({ free_monthly_seconds: "60", usage_limit_enabled: "true" })).toEqual(
      off,
    );
    expect(parseUsageSettings({ free_monthly_seconds: -5 })).toEqual(off);
    expect(parseUsageSettings({ free_monthly_seconds: 1.5 })).toEqual(off);
  });
  it("keeps an allowance of 0", () => {
    expect(parseUsageSettings({ free_monthly_seconds: 0 }).freeMonthlySeconds).toBe(0);
  });
});

describe("monthlyAllowanceSeconds (AC-2, AC-12)", () => {
  it("is the free number for every account today", () => {
    const settings = { freeMonthlySeconds: 3600, limitEnabled: true };
    expect(monthlyAllowanceSeconds(settings, { accountHash: "a" })).toBe(3600);
    expect(monthlyAllowanceSeconds(settings, { accountHash: "b" })).toBe(3600);
  });
});

describe("fitsInAllowance and remainingSeconds (AC-4)", () => {
  it("passes exactly at the line and fails one second over", () => {
    expect(fitsInAllowance(3600, 3000, 600)).toBe(true);
    expect(fitsInAllowance(3600, 3000, 601)).toBe(false);
  });
  it("never reports negative time left", () => {
    expect(remainingSeconds(3600, 4000)).toBe(0);
    expect(remainingSeconds(3600, 100)).toBe(3500);
  });
});

describe("resetsOn (AC-8)", () => {
  it("is the first of next month in UTC", () => {
    expect(resetsOn(new Date("2026-11-13T10:00:00Z"))).toBe("2026-12-01");
    expect(resetsOn(new Date("2026-12-31T23:59:59Z"))).toBe("2027-01-01");
    expect(resetsOn(new Date("2026-02-01T00:00:00Z"))).toBe("2026-03-01");
  });
  it("rolls over exactly at midnight UTC", () => {
    expect(resetsOn(new Date("2026-11-30T23:59:59.999Z"))).toBe("2026-12-01");
    expect(resetsOn(new Date("2026-12-01T00:00:00.000Z"))).toBe("2027-01-01");
  });
});

describe("usageSummary", () => {
  it("has the four numbers and nothing else", () => {
    expect(usageSummary(3600, 900, new Date("2026-11-13T00:00:00Z"))).toEqual({
      usedSeconds: 900,
      allowanceSeconds: 3600,
      remainingSeconds: 2700,
      resetsOn: "2026-12-01",
    });
  });
});

describe("usageDisplay (AC-9)", () => {
  it("rounds left down and used up so they add up", () => {
    expect(usageDisplay(3600, 0)).toEqual({
      usedMinutes: 0,
      leftMinutes: 60,
      allowanceMinutes: 60,
    });
    expect(usageDisplay(3600, 1)).toEqual({
      usedMinutes: 1,
      leftMinutes: 59,
      allowanceMinutes: 60,
    });
    expect(usageDisplay(3600, 61)).toEqual({
      usedMinutes: 2,
      leftMinutes: 58,
      allowanceMinutes: 60,
    });
    expect(usageDisplay(3600, 3599)).toEqual({
      usedMinutes: 60,
      leftMinutes: 0,
      allowanceMinutes: 60,
    });
    expect(usageDisplay(3600, 3600)).toEqual({
      usedMinutes: 60,
      leftMinutes: 0,
      allowanceMinutes: 60,
    });
  });
  it("caps at the allowance when usage is over it", () => {
    expect(usageDisplay(3600, 9999).usedMinutes).toBe(60);
  });
});

describe("usageNotice (AC-9)", () => {
  it("shows nothing below 80%, 'low' from 80% and 'used_up' at 0 left", () => {
    expect(usageNotice(3600, 2879)).toBe("none");
    expect(usageNotice(3600, 2880)).toBe("low");
    expect(usageNotice(3600, 3599)).toBe("low");
    expect(usageNotice(3600, 3600)).toBe("used_up");
    expect(usageNotice(3600, 4000)).toBe("used_up");
  });
  it("treats an allowance of 0 as used up", () => {
    expect(usageNotice(0, 0)).toBe("used_up");
  });
});

describe("shortDate", () => {
  it("writes a day and a month name", () => {
    expect(shortDate("2026-12-01")).toBe("1 Dec");
    expect(shortDate("2027-01-31")).toBe("31 Jan");
  });
});

describe("limitExceededMessage (AC-6)", () => {
  it("names the expiry and the reset date", () => {
    expect(
      limitExceededMessage({
        resetsOn: "2026-12-01",
        videoExpiresAt: new Date("2026-12-10T08:00:00Z"),
      }),
    ).toBe(
      "This month's allowance is used up. Your upload is kept until 10 Dec: try again from 1 Dec, or delete it.",
    );
  });
  it("says the video goes first when it expires before the reset", () => {
    expect(
      limitExceededMessage({
        resetsOn: "2026-12-01",
        videoExpiresAt: new Date("2026-11-30T23:00:00Z"),
      }),
    ).toBe(
      "Your upload is kept until 30 Nov, before your minutes come back on 1 Dec. Upload it again then.",
    );
  });
  it("still gives the reset date when the expiry is unknown", () => {
    expect(limitExceededMessage({ resetsOn: "2026-12-01", videoExpiresAt: null })).toContain(
      "1 Dec",
    );
  });
});
