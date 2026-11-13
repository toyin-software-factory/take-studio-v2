import { describe, expect, it } from "vitest";
import {
  SIGN_IN_MESSAGES,
  looksLikeEmail,
  parseSignInEmail,
  signInFailureFrom,
} from "./sign-in-state";

describe("sign in form states (AC-4, AC-8)", () => {
  it("maps Better Auth errors to the three failure states", () => {
    expect(signInFailureFrom({ status: 429 })).toBe("rate_limited");
    expect(signInFailureFrom({ code: "EMAIL_RATE_LIMITED" })).toBe("rate_limited");
    expect(signInFailureFrom({ status: 503 })).toBe("send_failed");
    expect(signInFailureFrom({ code: "EMAIL_SEND_FAILED" })).toBe("send_failed");
    expect(signInFailureFrom({ status: 500 })).toBe("error");
    expect(signInFailureFrom(null)).toBe("error");
  });

  it("the send failure says what the spec says", () => {
    const { title, text } = SIGN_IN_MESSAGES.send_failed;
    expect(`${title}. ${text}`).toBe("We couldn't send the email. Please try again or use Google.");
  });

  it("checks an address before sending", () => {
    for (const ok of ["a@b.co", " me@example.com ", "x+tag@mail.example.org"]) {
      expect(looksLikeEmail(ok)).toBe(true);
    }
    for (const bad of ["", "a", "a@b", "a b@c.de", "@b.co", "a@@b.co"]) {
      expect(looksLikeEmail(bad)).toBe(false);
    }
  });

  it("parses an address with zod, trimmed, or gives null", () => {
    expect(parseSignInEmail(" me@example.com ")).toBe("me@example.com");
    for (const bad of ["", "a", "a@b", "a b@c.de", "@b.co"]) {
      expect(parseSignInEmail(bad)).toBeNull();
    }
  });
});
