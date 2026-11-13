import { describe, expect, it } from "vitest";
import { initialsOf } from "./initials";
import { isActive } from "./nav-items";
import { recentMeta } from "./recent-takes";

describe("isActive", () => {
  it("matches the library on /library and not on a take page", () => {
    expect(isActive("/library", "/library")).toBe(true);
    expect(isActive("/library", "/takes/abc")).toBe(false);
    expect(isActive("/library", "/")).toBe(false);
  });
  it("matches a section and its sub pages, not look alike paths", () => {
    expect(isActive("/takes", "/takes")).toBe(true);
    expect(isActive("/takes", "/takes/abc")).toBe(true);
    expect(isActive("/takes", "/takes-archive")).toBe(false);
  });
});

describe("initialsOf", () => {
  it("uses first and last name", () => expect(initialsOf("Ada Mae Lovelace", "a@x.io")).toBe("AL"));
  it("uses one name", () => expect(initialsOf("Toyin", "t@x.io")).toBe("TO"));
  it("falls back to the email", () => expect(initialsOf("  ", "sam@x.io")).toBe("SA"));
  it("keeps emoji and other astral characters whole", () => {
    expect(initialsOf("🎬 Studio", "x@x.io")).toBe("🎬S");
    expect(initialsOf("𝒜da", "x@x.io")).toBe("𝒜D");
    expect(initialsOf("", "😀@x.io")).toBe("😀@");
  });
});

describe("recentMeta", () => {
  it("writes the status out, then the length", () => {
    expect(recentMeta({ status: "ready", durationMs: 12_000 })).toBe("Ready · 0:12");
    expect(recentMeta({ status: "processing", durationMs: 75_000 })).toBe("Processing · 1:15");
  });
  it("leaves the length off when it is not known yet", () => {
    expect(recentMeta({ status: "uploading", durationMs: null })).toBe("Uploading");
  });
});
