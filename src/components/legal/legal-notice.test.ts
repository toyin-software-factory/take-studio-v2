import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AGREEMENT } from "@/lib/legal-facts";
import { LEGAL_LINKS } from "@/lib/legal-links";
import { VIDEO_RETENTION_DAYS } from "@/lib/take-rules";
import { SignInNotice, UploadNote } from "./legal-notice";

const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);
const hrefs = (markup: string) => [...markup.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

describe("legal links (spec 0015 AC-2)", () => {
  it("the sign in notice links Terms and Privacy and asks for no checkbox", () => {
    const out = html(createElement(SignInNotice));
    expect(hrefs(out)).toEqual([LEGAL_LINKS.terms.href, LEGAL_LINKS.privacy.href]);
    expect(out).not.toContain("<input");
    expect(AGREEMENT).toBe("notice");
  });
  it("the upload note states the retention days and links Privacy", () => {
    const out = html(createElement(UploadNote));
    expect(out).toContain(`${VIDEO_RETENTION_DAYS} days`);
    expect(hrefs(out)).toEqual([LEGAL_LINKS.privacy.href]);
  });
  it("the routes are the ones the pages and sitemap serve", () => {
    expect(LEGAL_LINKS.privacy.href).toBe("/privacy");
    expect(LEGAL_LINKS.terms.href).toBe("/terms");
  });
});
