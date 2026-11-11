import { beforeEach, describe, expect, it, vi } from "vitest";

const turnOff = vi.fn(async () => "off" as const);
const getDb = vi.fn(async () => ({}));
vi.mock("@/server/email/turn-off", () => ({ turnOffTakeEmails: turnOff }));
vi.mock("@/server/request", () => ({ getDb }));
vi.mock("@/lib/env", () => ({
  parseEmailEnv: () => ({ EMAIL_LINK_SECRET: "x".repeat(32) }),
}));

const URL_OFF = "https://app.example.com/emails/off?u=user-1&s=abc";

beforeEach(() => {
  turnOff.mockClear();
  getDb.mockClear();
});

describe("/emails/off (spec 0006, AC-6)", () => {
  it("GET changes nothing: no database, no turn off, only a redirect to the confirmation page", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request(URL_OFF));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://app.example.com/emails/off/confirm?u=user-1&s=abc",
    );
    expect(getDb).not.toHaveBeenCalled();
    expect(turnOff).not.toHaveBeenCalled();
  });

  it("POST from the mail client's one click answers 200 (or 400) with no page", async () => {
    const { POST } = await import("./route");
    const body = new URLSearchParams({ "List-Unsubscribe": "One-Click" });
    const res = await POST(new Request(URL_OFF, { method: "POST", body }));
    expect(res.status).toBe(200);
    expect(turnOff).toHaveBeenCalledWith(
      {},
      { userId: "user-1", signature: "abc" },
      expect.any(String),
    );
    turnOff.mockResolvedValueOnce("invalid" as never);
    expect((await POST(new Request(URL_OFF, { method: "POST", body }))).status).toBe(400);
  });

  it("POST from the confirmation form redirects to the result page", async () => {
    const { POST } = await import("./route");
    const body = new URLSearchParams({ from: "page" });
    const res = await POST(new Request(URL_OFF, { method: "POST", body }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://app.example.com/emails/off/done?status=off");
  });
});
