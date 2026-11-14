import { describe, expect, it } from "vitest";
import { failedMessage } from "./failed-message";
import { lowNotice, usedUpMessage } from "./usage-meter";

const summary = (usedMinutes: number) => ({
  usedSeconds: usedMinutes * 60,
  allowanceSeconds: 3600,
  remainingSeconds: Math.max(0, 3600 - usedMinutes * 60),
  resetsOn: "2026-12-01",
});

describe("lowNotice (AC-9)", () => {
  it("is empty below 80 %", () => expect(lowNotice(summary(47))).toBe(""));
  it("says the minutes left from 80 %", () =>
    expect(lowNotice(summary(48))).toBe("You have 12 minutes left this month."));
  it("says one minute, singular", () =>
    expect(lowNotice({ ...summary(59), usedSeconds: 3540 })).toBe(
      "You have 1 minute left this month.",
    ));
  it("is empty when it is used up (the drop zone says it)", () =>
    expect(lowNotice(summary(60))).toBe(""));
});

describe("usedUpMessage", () => {
  it("names the allowance and the reset date", () =>
    expect(usedUpMessage(summary(60))).toBe(
      "You've used this month's 60 minutes. They come back on 1 Dec.",
    ));
});

describe("failedMessage (AC-6)", () => {
  const now = new Date("2026-11-14T10:00:00Z");
  const base = { failureCode: "limit_exceeded", durationMs: 60_000 };
  it("dates a take kept past the reset", () =>
    expect(failedMessage({ ...base, videoExpiresAt: "2026-12-10T00:00:00Z" }, true, now)).toBe(
      "This month's allowance is used up. Your upload is kept until 10 Dec: try again from 1 Dec, or delete it.",
    ));
  it("asks for a new upload when the video goes first", () =>
    expect(failedMessage({ ...base, videoExpiresAt: "2026-11-20T00:00:00Z" }, false, now)).toBe(
      "Your upload is kept until 20 Nov, before your minutes come back on 1 Dec. Upload it again then.",
    ));
  it("copes with no expiry", () =>
    expect(failedMessage({ ...base, videoExpiresAt: null }, true, now)).toBe(
      "This month's allowance is used up. Try again from 1 Dec, or delete this take.",
    ));
  it("leaves other failures with the shared wording", () =>
    expect(
      failedMessage({ failureCode: "timeout", durationMs: null, videoExpiresAt: null }, true, now),
    ).toMatch(/took too long/));
});
