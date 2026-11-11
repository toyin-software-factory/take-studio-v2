import { describe, expect, it } from "vitest";
import { escapeHtml, formatClock, signInEmail, takeFailedEmail, takeReadyEmail } from "./templates";

const URLS = {
  takeUrl: "https://app.example.com/takes/abc",
  unsubscribeUrl: "https://app.example.com/emails/off?u=u1&s=sig",
};

describe("email templates (AC-5, AC-6, AC-7)", () => {
  it("sign in: link, 15 minutes, single use, no unsubscribe", () => {
    const mail = signInEmail({ url: "https://app.example.com/api/auth/magic-link/verify?token=t" });
    expect(mail.subject).toBe("Your Take Studio sign in link");
    for (const body of [mail.html, mail.text]) {
      expect(body).toContain("magic-link/verify?token=t");
      expect(body).toContain("15 minutes");
      expect(body).not.toContain("Turn off these emails");
    }
  });

  it("ready: title, removed time, link and the one click turn off link", () => {
    const mail = takeReadyEmail({ title: "Cafe take", removedMs: 83_000, note: null, ...URLS });
    expect(mail.subject).toBe('Your take "Cafe take" is ready');
    for (const [body, unsubscribe] of [
      [mail.html, escapeHtml(URLS.unsubscribeUrl)], // `&` is `&amp;` in HTML
      [mail.text, URLS.unsubscribeUrl],
    ] as const) {
      expect(body).toContain("We removed 1:23 of pauses.");
      expect(body).toContain(URLS.takeUrl);
      expect(body).toContain(unsubscribe);
      expect(body).toContain("Turn off these emails");
    }
  });

  it("ready with the AC-7 notes instead of a removed time", () => {
    const silent = takeReadyEmail({ title: "T", removedMs: 0, note: "no_audio", ...URLS });
    const none = takeReadyEmail({ title: "T", removedMs: 0, note: "no_cuts", ...URLS });
    expect(silent.text).toContain("no sound");
    expect(none.text).toContain("no pauses to trim");
    expect(silent.text).not.toContain("We removed");
  });

  it("failed: the friendly message and the next step, with the turn off link", () => {
    const mail = takeFailedEmail({
      title: "Cafe take",
      message: "Processing took too long and stopped. Try again.",
      ...URLS,
    });
    expect(mail.subject).toBe('Your take "Cafe take" didn\'t finish');
    expect(mail.text).toContain("Processing took too long and stopped. Try again.");
    expect(mail.text).toContain(URLS.unsubscribeUrl);
  });

  it("escapes the title in HTML and keeps it plain in text; no storage or media links", () => {
    const mail = takeReadyEmail({
      title: '<script>alert("x")</script> & co',
      removedMs: 1000,
      note: null,
      ...URLS,
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.text).toContain('<script>alert("x")</script> & co');
    for (const body of [mail.html, mail.text]) {
      expect(body).not.toMatch(/r2\.|cloudflarestorage|\.mp4|\/api\/takes\/[^"\s]*\/media/);
      expect(body).not.toContain("<img");
    }
  });

  it("formats clocks like the app (m:ss, h:mm:ss over an hour)", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(59_400)).toBe("0:59");
    expect(formatClock(61_000)).toBe("1:01");
    expect(formatClock(3_725_000)).toBe("1:02:05");
    expect(escapeHtml(`a&b<c>"d"'e'`)).toBe("a&amp;b&lt;c&gt;&quot;d&quot;&#39;e&#39;");
  });
});
