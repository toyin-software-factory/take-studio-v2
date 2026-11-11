import { describe, expect, it } from "vitest";
import { type ResendLike, createEmailSender, sendErrorFrom } from "./send";

const MAIL = { to: "a@example.com", subject: "s", html: "<p>h</p>", text: "h" };
const FROM = "Take Studio <hello@mail.vowmory.com>";

function fake(
  result: Awaited<ReturnType<ResendLike["emails"]["send"]>> | Error,
  calls: unknown[] = [],
): ResendLike {
  return {
    emails: {
      send: async (payload, options) => {
        calls.push({ payload, options });
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
}

describe("createEmailSender (AC-7, AC-8)", () => {
  it("sends from EMAIL_FROM with the idempotency key and headers, returns the id", async () => {
    const calls: unknown[] = [];
    const send = createEmailSender(fake({ data: { id: "em_1" }, error: null }, calls), FROM);
    const sent = await send({
      ...MAIL,
      idempotencyKey: "take-email-job1",
      headers: { "List-Unsubscribe": "<https://x>" },
    });
    expect(sent).toEqual({ ok: true, data: { id: "em_1" } });
    expect(calls).toEqual([
      {
        payload: { from: FROM, ...MAIL, headers: { "List-Unsubscribe": "<https://x>" } },
        options: { idempotencyKey: "take-email-job1" },
      },
    ]);
  });

  it("turns Resend errors and thrown failures into typed errors", async () => {
    const limited = createEmailSender(
      fake({ data: null, error: { name: "daily_quota_exceeded", statusCode: 429 } }),
      FROM,
    );
    expect(await limited(MAIL)).toEqual({ ok: false, error: "rate_limited" });
    const rejected = createEmailSender(
      fake({ data: null, error: { name: "validation_error", statusCode: 422 } }),
      FROM,
    );
    expect(await rejected(MAIL)).toEqual({ ok: false, error: "rejected" });
    const down = createEmailSender(
      fake({ data: null, error: { name: "application_error", statusCode: 500 } }),
      FROM,
    );
    expect(await down(MAIL)).toEqual({ ok: false, error: "unavailable" });
    const thrown = createEmailSender(fake(new Error("network")), FROM);
    expect(await thrown(MAIL)).toEqual({ ok: false, error: "unavailable" });
  });

  it("classifies errors by status and name", () => {
    expect(sendErrorFrom({ statusCode: 429 })).toBe("rate_limited");
    expect(sendErrorFrom({ name: "monthly_quota_exceeded" })).toBe("rate_limited");
    expect(sendErrorFrom({ statusCode: 403 })).toBe("rejected");
    expect(sendErrorFrom({ statusCode: null })).toBe("unavailable");
  });
});
