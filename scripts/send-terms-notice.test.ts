import { describe, expect, it } from "vitest";
import type { EmailSender } from "../src/lib/email/send";
import {
  NOTICES,
  NOTICE_ID,
  noticeKey,
  selectRecipients,
  termsNoticeEmail,
  type Recipient,
} from "../src/lib/email/terms-notice";
import { sendAll } from "./send-terms-notice";

const user = (id: string, over: Partial<Recipient> = {}): Recipient => ({
  id,
  email: `${id}@example.test`,
  guest: false,
  takeEmails: true,
  ...over,
});
const email = termsNoticeEmail(NOTICES["2026-11-credit"]!, "https://app.example.test");
const noWait = async () => {};

describe("selectRecipients", () => {
  it("skips guests and empty addresses, and ignores the take email opt out", () => {
    const got = selectRecipients([
      user("a"),
      user("b", { guest: true }),
      user("c", { takeEmails: false }),
      user("d", { email: " " }),
    ]);
    expect(got.map((u) => u.id)).toEqual(["a", "c"]);
  });
});

describe("noticeKey", () => {
  it("is one stable key per notice and user", () => {
    expect(noticeKey("2026-11-credit", "u1")).toBe("terms-2026-11-credit-u1");
    expect(noticeKey("2026-11-credit", "u1")).toBe(noticeKey("2026-11-credit", "u1"));
    expect(noticeKey("2026-11-credit", "u1")).not.toBe(noticeKey("2026-11-credit", "u2"));
  });
  it("accepts every registered notice id", () => {
    for (const id of Object.keys(NOTICES)) expect(id).toMatch(NOTICE_ID);
  });
});

describe("termsNoticeEmail", () => {
  it("links to the Terms and carries the date, with no marketing", () => {
    expect(email.text).toContain("https://app.example.test/terms");
    expect(email.text).toContain("16 November 2026");
    expect(email.html).toContain("https://app.example.test/terms");
  });
});

describe("sendAll", () => {
  it("sends one email each with the key, and logs no address", async () => {
    const sent: { to: string; key?: string }[] = [];
    const send: EmailSender = async (m) => {
      sent.push({ to: m.to, key: m.idempotencyKey });
      return { ok: true, data: { id: "x" } };
    };
    const logs: string[] = [];
    const r = await sendAll([user("a"), user("b")], "n-1-x", email, send, noWait, (l) =>
      logs.push(l),
    );
    expect(r).toEqual({ recipients: 2, sent: 2, failed: [] });
    expect(sent.map((s) => s.key)).toEqual(["terms-n-1-x-a", "terms-n-1-x-b"]);
    expect(logs.join("\n")).not.toContain("@");
  });

  it("retries a rate limit, then keeps a hard failure by id only", async () => {
    let calls = 0;
    const send: EmailSender = async (m) => {
      calls += 1;
      if (m.to.startsWith("a"))
        return calls === 1 ? { ok: false, error: "rate_limited" } : { ok: true, data: { id: "x" } };
      return { ok: false, error: "rejected" };
    };
    const logs: string[] = [];
    const r = await sendAll([user("a"), user("b")], "n-1-x", email, send, noWait, (l) =>
      logs.push(l),
    );
    expect(r).toEqual({ recipients: 2, sent: 1, failed: ["b"] });
    expect(logs).toEqual(["terms-notice: failed for user b"]);
  });
});
