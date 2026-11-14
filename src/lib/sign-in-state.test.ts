import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  SIGN_IN_MESSAGES,
  looksLikeEmail,
  EMAIL_PATTERN,
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

  it("parses an address, trimmed, or gives null", () => {
    expect(parseSignInEmail(" me@example.com ")).toBe("me@example.com");
    for (const bad of ["", "a", "a@b", "a b@c.de", "@b.co"]) {
      expect(parseSignInEmail(bad)).toBeNull();
    }
  });

  it("accepts and refuses exactly what zod's email check does", () => {
    const samples = [
      "me@example.com",
      "a.b+c@sub.example.co",
      "o'brien@example.org",
      "a@b.c",
      "a@b.co",
      "a..b@example.com",
      ".a@example.com",
      "a.@example.com",
      "a@-b.com",
      "a@b-.com",
      "a@b..com",
      "a b@c.de",
      "a@b",
      "",
      "@b.co",
      "a@@b.co",
      "a@b.c1",
      "über@example.com",
      "a@exämple.com",
      "x@1.2.3.4",
      "a_b-c@d-e.fg",
      "a@b.museum",
      "a@b.c_d",
    ];
    for (const sample of samples) {
      const zodSays = z.email().safeParse(sample).success;
      expect(EMAIL_PATTERN.test(sample), sample).toBe(zodSays);
    }
  });
});
