import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LEGAL_VERSION } from "@/lib/legal-facts";
import { LEGAL_LINKS } from "@/lib/legal-links";
import { TERMS_NOTICE_DAYS, TermsUpdateNotice, termsNoticeVisible } from "./terms-update-notice";

describe("the Terms updated notice (spec 0026 AC-13, C3)", () => {
  const v = "2026-11-16";
  it("shows from the version date for the notice days, never before or after", () => {
    expect(termsNoticeVisible(new Date("2026-11-15T23:59:59Z"), v)).toBe(false);
    expect(termsNoticeVisible(new Date("2026-11-16T00:00:00Z"), v)).toBe(true);
    const last = new Date(Date.parse(`${v}T00:00:00Z`) + TERMS_NOTICE_DAYS * 86_400_000 - 1);
    expect(termsNoticeVisible(last, v)).toBe(true);
    expect(termsNoticeVisible(new Date(last.getTime() + 1), v)).toBe(false);
  });
  it("shows nothing for a bad version date", () => {
    expect(termsNoticeVisible(new Date("2026-11-16T00:00:00Z"), "not a date")).toBe(false);
  });
  it("names the credit, links the Terms and asks for nothing", () => {
    const out = renderToStaticMarkup(
      createElement(TermsUpdateNotice, { now: new Date(`${LEGAL_VERSION.terms}T12:00:00Z`) }),
    );
    expect(out).toContain("Edited with Take Studio");
    expect(out).toContain(`href="${LEGAL_LINKS.terms.href}"`);
    expect(out).not.toContain("<input");
  });
});
