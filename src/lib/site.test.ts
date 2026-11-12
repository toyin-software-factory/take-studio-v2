import { describe, expect, it } from "vitest";
import { CONTACT_EMAIL, siteOrigin } from "./site";

describe("siteOrigin (spec 0010, AC-3)", () => {
  it("is the origin of a valid URL, without a path or trailing slash", () => {
    expect(siteOrigin("https://take.example.com/")).toBe("https://take.example.com");
    expect(siteOrigin("http://127.0.0.1:8787/some/path")).toBe("http://127.0.0.1:8787");
  });
  it("is null when missing or not a URL, so no absolute URL is guessed", () => {
    expect(siteOrigin(undefined)).toBeNull();
    expect(siteOrigin("")).toBeNull();
    expect(siteOrigin("not a url")).toBeNull();
  });
  it("has the one contact address", () => {
    expect(CONTACT_EMAIL).toBe("hello@takestudio.app");
  });
});
