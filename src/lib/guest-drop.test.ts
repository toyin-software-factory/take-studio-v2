import { describe, expect, it } from "vitest";
import { DROP_COPY, checkGuestFile, percentLabel, refusalOf } from "./guest-drop";
import { GUEST_MAX_BYTES } from "./guest-rules";

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
