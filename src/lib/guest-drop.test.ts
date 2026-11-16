import { describe, expect, it } from "vitest";
import {
  DROP_COPY,
  REFUSAL_HEADING,
  checkGuestDuration,
  checkGuestFile,
  dropStep,
  fileMeta,
  formatBytes,
  percentLabel,
  refusalOf,
  stepLabel,
} from "./guest-drop";
import { GUEST_MAX_BYTES, GUEST_MAX_SECONDS } from "./guest-rules";

const file = (name: string, size: number, type = "video/mp4") => ({ name, size, type });

describe("checkGuestFile", () => {
  it("accepts an mp4 and a mov", () => {
    expect(checkGuestFile(file("a.mp4", 10))).toEqual({ ok: true, container: "mp4" });
    expect(checkGuestFile(file("a.mov", 10, "video/quicktime"))).toEqual({
      ok: true,
      container: "mov",
    });
  });
  it("refuses a file over the guest cap with the size message, not the 2 GB one", () => {
    expect(checkGuestFile(file("a.mp4", GUEST_MAX_BYTES + 1))).toEqual({
      ok: false,
      message: DROP_COPY.tooBig,
    });
    expect(checkGuestFile(file("a.mp4", GUEST_MAX_BYTES)).ok).toBe(true);
  });
  it("refuses other types, webm and empty files", () => {
    expect(checkGuestFile(file("a.avi", 10, "video/x-msvideo"))).toEqual({
      ok: false,
      message: DROP_COPY.notVideo,
    });
    expect(checkGuestFile(file("a.webm", 10, "video/webm"))).toEqual({
      ok: false,
      message: DROP_COPY.notVideo,
    });
    expect(checkGuestFile(file("a.mp4", 0))).toEqual({ ok: false, message: DROP_COPY.empty });
  });
});

describe("refusalOf", () => {
  it("maps the guest route codes to a screen", () => {
    expect(refusalOf("guest_address_limit")).toBe("limit");
    expect(refusalOf("guest_budget_spent")).toBe("limit");
    expect(refusalOf("guest_paused")).toBe("paused");
    expect(refusalOf("guest_unavailable")).toBe("unavailable");
    expect(refusalOf("guest_busy")).toBe("failed");
    expect(refusalOf(null)).toBe("failed");
  });
});

describe("copy", () => {
  it("states the real limits and has no dash punctuation", () => {
    expect(DROP_COPY.rules).toContain("500 MB");
    expect(DROP_COPY.rules).toContain("3 minutes");
    expect(DROP_COPY.expiry).toContain("24 hours");
    for (const text of Object.values(DROP_COPY)) expect(text).not.toMatch(/[—–]| - /);
  });
  it("clamps the percent", () => {
    expect(percentLabel(-5)).toBe("0%");
    expect(percentLabel(49.6)).toBe("50%");
    expect(percentLabel(140)).toBe("100%");
  });
});

describe("checkGuestDuration", () => {
  it("refuses a video over the guest length", () => {
    const check = checkGuestDuration(GUEST_MAX_SECONDS + 1);
    expect(check).toEqual({ ok: false, message: DROP_COPY.tooLong });
  });
  it("lets a video at or under the length through", () => {
    expect(checkGuestDuration(GUEST_MAX_SECONDS)).toBeNull();
    expect(checkGuestDuration(12)).toBeNull();
  });
  it("lets an unreadable length through, the server still checks", () => {
    expect(checkGuestDuration(null)).toBeNull();
    expect(checkGuestDuration(Number.NaN)).toBeNull();
    expect(checkGuestDuration(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("refusal copy from the guest rules", () => {
  it("puts the size and the length in the numbers, never typed", () => {
    expect(DROP_COPY.tooBig).toContain("(500 MB)");
    expect(DROP_COPY.tooLong).toBe(
      "That video is longer than we can take for a free try (3 minutes). Trim it or sign in to upload a longer one.",
    );
  });
  it("has the stop headings and the kept line", () => {
    expect(REFUSAL_HEADING.limit).toBe("That's all the free tries for now");
    expect(REFUSAL_HEADING.paused).toBe("Free tries are paused");
    expect(DROP_COPY.paused).toContain("Nothing is lost by signing in: it takes one email.");
    expect(DROP_COPY.kept).toBe("We kept your file.");
    expect(DROP_COPY.invalidEmail).toBe("Enter a real email address, like name@example.com.");
  });
});

describe("file row and steps", () => {
  it("formats size and length", () => {
    expect(formatBytes(48.2 * 1024 * 1024)).toBe("48.2 MB");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(fileMeta(48.2 * 1024 * 1024, 72)).toBe("48.2 MB · 1:12");
    expect(fileMeta(1024 * 1024, 2.501)).toBe("1.0 MB · 0:02");
    expect(fileMeta(48.2 * 1024 * 1024, null)).toBe("48.2 MB");
  });
  it("names the step for screen readers", () => {
    expect(stepLabel(2)).toBe("Step 2 of 3");
    expect(dropStep("idle", false)).toBe(1);
    expect(dropStep("uploading", false)).toBe(2);
    expect(dropStep("done", false)).toBe(2);
    expect(dropStep("done", true)).toBe(3);
    // A sent email does not keep step 3 after a cancel or a failure.
    expect(dropStep("idle", true)).toBe(1);
    expect(dropStep("failed", true)).toBe(1);
    expect(dropStep("refused", true)).toBe(1);
  });
});
