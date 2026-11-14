import { describe, expect, it } from "vitest";
import {
  clientLabel,
  connectedAppsSchema,
  consentAnswerSchema,
  disconnectDone,
  followableUrl,
  redirectHosts,
} from "./oauth-screen";

describe("redirectHosts", () => {
  it("keeps only the host, once each, in order", () => {
    expect(
      redirectHosts([
        "https://claude.example/cb?x=1",
        "https://claude.example/other",
        "http://127.0.0.1:8123/callback",
      ]),
    ).toEqual(["claude.example", "127.0.0.1:8123"]);
  });
  it("shows the scheme for a custom scheme and skips what is not a URL", () => {
    expect(redirectHosts(["myapp://done", "not a url"])).toEqual(["myapp://done"]);
  });
});

describe("clientLabel", () => {
  it("trims, and falls back for no name", () => {
    expect(clientLabel("  Synthetic Assistant ")).toBe("Synthetic Assistant");
    expect(clientLabel(null)).toBe("An app without a name");
    expect(clientLabel("   ")).toBe("An app without a name");
  });
  it("keeps markup as plain text", () => {
    expect(clientLabel("<b>x</b>")).toBe("<b>x</b>");
  });
});

describe("followableUrl", () => {
  it("follows https, loopback http and custom schemes", () => {
    expect(followableUrl("https://app.example/cb?code=c&state=s")).toBe(
      "https://app.example/cb?code=c&state=s",
    );
    expect(followableUrl("http://127.0.0.1:9/cb")).toBe("http://127.0.0.1:9/cb");
    expect(followableUrl("myapp://done?code=c")).toBe("myapp://done?code=c");
  });
  it("refuses script like schemes and junk", () => {
    expect(followableUrl("javascript:alert(1)")).toBeNull();
    expect(followableUrl("data:text/html,x")).toBeNull();
    expect(followableUrl("nope")).toBeNull();
  });
});

describe("schemas and statuses", () => {
  it("reads the consent answer and the list", () => {
    expect(consentAnswerSchema.safeParse({ url: "https://a.example/cb" }).success).toBe(true);
    expect(consentAnswerSchema.safeParse({}).success).toBe(false);
    expect(
      connectedAppsSchema.safeParse({
        apps: [{ id: "c1", name: null, connectedAt: "2026-11-14T10:00:00Z", lastUsedAt: null }],
      }).success,
    ).toBe(true);
  });
  it("counts 204 and 404 as disconnected", () => {
    expect(disconnectDone(204)).toBe(true);
    expect(disconnectDone(404)).toBe(true);
    expect(disconnectDone(500)).toBe(false);
    expect(disconnectDone(null)).toBe(false);
  });
});
