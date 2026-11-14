import { describe, expect, it } from "vitest";
import { oauthResumePath, redirectUriAllowed } from "./oauth-rules";

describe("oauthResumePath", () => {
  it("replays the authorize query without the signature fields", () => {
    const search = new URLSearchParams(
      "response_type=code&client_id=abc&state=s1&exp=1&sig=xyz&ba_iat=2&ba_pl=3",
    );
    expect(oauthResumePath(search)).toBe(
      "/api/auth/oauth2/authorize?response_type=code&client_id=abc&state=s1",
    );
  });

  it("is null for a plain sign in or an unsigned query", () => {
    expect(oauthResumePath(new URLSearchParams(""))).toBeNull();
    expect(oauthResumePath(new URLSearchParams("client_id=abc"))).toBeNull();
    expect(oauthResumePath(new URLSearchParams("reason=delete-account"))).toBeNull();
  });
});

describe("redirectUriAllowed", () => {
  it("allows https and loopback http only", () => {
    expect(redirectUriAllowed("https://app.example/cb")).toBe(true);
    expect(redirectUriAllowed("http://localhost:3000/cb")).toBe(true);
    expect(redirectUriAllowed("http://127.0.0.1:1/cb")).toBe(true);
    expect(redirectUriAllowed("http://[::1]:1/cb")).toBe(true);
  });

  it("refuses custom schemes, plain http, wildcards, credentials and junk", () => {
    for (const bad of [
      "com.example.app:/callback",
      "http://evil.example/cb",
      "https://*.evil.example/cb",
      "https://user:pw@app.example/cb",
      "https://app.example/cb#frag",
      "not a url",
    ]) {
      expect(redirectUriAllowed(bad)).toBe(false);
    }
  });
});
