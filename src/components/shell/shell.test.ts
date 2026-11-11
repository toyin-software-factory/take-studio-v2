import { describe, expect, it } from "vitest";
import { initialsOf } from "./initials";
import { isActive } from "./nav-items";

describe("isActive", () => {
  it("matches home only on /", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/", "/takes")).toBe(false);
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
});
