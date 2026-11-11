import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalEmail, usageAccountHash } from "./usage-hash";

// Test value only; the real secret comes from USAGE_HASH_SECRET.
const SECRET = "test-usage-hash-secret-0123456789abcdef";

describe("canonicalEmail (AC-16)", () => {
  it.each([
    ["lowercases and trims", "  Ada.Lovelace@Example.COM ", "ada.lovelace@example.com"],
    ["removes a +tag on any domain", "ada+studio@example.com", "ada@example.com"],
    ["removes everything after the first +", "ada+a+b@example.com", "ada@example.com"],
    ["removes Gmail dots", "a.d.a@gmail.com", "ada@gmail.com"],
    ["maps googlemail.com to gmail.com", "Ada.L@GoogleMail.com", "adal@gmail.com"],
    ["combines all Gmail rules", "A.Da+yt@googlemail.com", "ada@gmail.com"],
    ["keeps dots outside Gmail", "a.d.a@example.com", "a.d.a@example.com"],
    ["leaves an address without @ lowercased", "NotAnEmail", "notanemail"],
    ["keeps a tag only local part as is", "+tag@example.com", "+tag@example.com"],
  ])("%s", (_label, input, expected) => {
    expect(canonicalEmail(input)).toBe(expected);
  });

  it("maps every Gmail variant of one person to one value", () => {
    const variants = [
      "ada@gmail.com",
      "A.D.A@gmail.com",
      "ada+x@googlemail.com",
      "a.da+1@GMAIL.com",
    ];
    expect(new Set(variants.map(canonicalEmail))).toEqual(new Set(["ada@gmail.com"]));
  });
});

describe("usageAccountHash (AC-16)", () => {
  it("is HMAC_SHA256 of the canonical email, as lowercase hex", async () => {
    const expected = createHmac("sha256", SECRET).update("ada@gmail.com").digest("hex");
    await expect(usageAccountHash("A.Da+yt@googlemail.com", SECRET)).resolves.toBe(expected);
  });

  it("gives the same hash for variants and a different one for another secret", async () => {
    const a = await usageAccountHash("ada+one@gmail.com", SECRET);
    const b = await usageAccountHash("a.da@googlemail.com", SECRET);
    const other = await usageAccountHash("ada@gmail.com", `${SECRET}-other`);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(other).not.toBe(a);
  });
});
