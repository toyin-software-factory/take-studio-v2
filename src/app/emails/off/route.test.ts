import { beforeEach, describe, expect, it, vi } from "vitest";

const turnOff = vi.fn(async () => "off" as const);
const getDb = vi.fn(async () => ({}));
vi.mock("@/server/email/turn-off", () => ({ turnOffTakeEmails: turnOff }));
vi.mock("@/server/request", () => ({ getDb }));

const EMAIL_ENV = {
  BETTER_AUTH_URL: "https://app.example.com",
  RESEND_API_KEY: "re_test",
  EMAIL_FROM: "Take Studio <hello@example.com>",
  EMAIL_LINK_SECRET: "x".repeat(32),
};

const URL_OFF = "https://app.example.com/emails/off?u=user-1&s=abc";

beforeEach(() => {
  turnOff.mockClear();
  getDb.mockClear();
  vi.unstubAllEnvs();
  for (const [name, value] of Object.entries(EMAIL_ENV)) vi.stubEnv(name, value);
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

  describe("with a setting missing or a failure underneath: never a 500 (HRF-T05)", () => {
    const post = async (body: Record<string, string>) => {
      const { POST } = await import("./route");
      return POST(new Request(URL_OFF, { method: "POST", body: new URLSearchParams(body) }));
    };

    it("answers 400 to the one click and sends the page to status=invalid with no email env", async () => {
      for (const name of Object.keys(EMAIL_ENV)) vi.stubEnv(name, "");
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const oneClick = await post({ "List-Unsubscribe": "One-Click" });
      expect(oneClick.status).toBe(400);
      const page = await post({ from: "page" });
      expect(page.status).toBe(303);
      expect(page.headers.get("location")).toBe(
        "https://app.example.com/emails/off/done?status=invalid",
      );
      expect(turnOff).not.toHaveBeenCalled();
      expect(getDb).not.toHaveBeenCalled();
      // Names only: no value reaches the log.
      const logged = log.mock.calls.flat().join(" ");
      expect(logged).toContain("EMAIL_LINK_SECRET");
      expect(logged).toContain("RESEND_API_KEY");
      log.mockRestore();
    });

    it("answers 400 when only the link secret is too short", async () => {
      vi.stubEnv("EMAIL_LINK_SECRET", "short");
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      expect((await post({ "List-Unsubscribe": "One-Click" })).status).toBe(400);
    });

    it("answers 400 / invalid when the database cannot be reached", async () => {
      getDb.mockRejectedValueOnce(new Error("no connection"));
      expect((await post({ "List-Unsubscribe": "One-Click" })).status).toBe(400);
      getDb.mockRejectedValueOnce(new Error("no connection"));
      const page = await post({ from: "page" });
      expect(page.headers.get("location")).toContain("status=invalid");
    });
  });
});
