import { describe, expect, it } from "vitest";
import { signUnsubscribe, unsubscribeUrl, verifyUnsubscribe } from "./email-links";

// Test values only; the real secret is EMAIL_LINK_SECRET.
const SECRET = "test-email-link-secret-0123456789abcdef";

describe("signed unsubscribe links (AC-6)", () => {
  it("verifies the exact signature for the same user and secret", async () => {
    const sig = await signUnsubscribe("user-1", SECRET);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyUnsubscribe("user-1", sig, SECRET)).toBe(true);
  });

  it("rejects another user, another secret, a changed or empty signature", async () => {
    const sig = await signUnsubscribe("user-1", SECRET);
    expect(await verifyUnsubscribe("user-2", sig, SECRET)).toBe(false);
    expect(await verifyUnsubscribe("user-1", sig, `${SECRET}x`)).toBe(false);
    expect(await verifyUnsubscribe("user-1", `${sig.slice(0, -1)}z`, SECRET)).toBe(false);
    expect(await verifyUnsubscribe("user-1", sig.slice(0, 10), SECRET)).toBe(false);
    expect(await verifyUnsubscribe("user-1", "", SECRET)).toBe(false);
    expect(await verifyUnsubscribe("", sig, SECRET)).toBe(false);
  });

  it("builds an absolute link to /emails/off carrying the user and the signature", async () => {
    const link = new URL(
      await unsubscribeUrl("https://app.example.com/anything", "user-1", SECRET),
    );
    expect(link.origin + link.pathname).toBe("https://app.example.com/emails/off");
    expect(link.searchParams.get("u")).toBe("user-1");
    expect(await verifyUnsubscribe("user-1", link.searchParams.get("s") ?? "", SECRET)).toBe(true);
  });
});
