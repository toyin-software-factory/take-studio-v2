import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { legalTextHash, normalizeLegalText } from "@/lib/legal-facts";
import { MINUTES_TOKEN } from "./allowance-note";
import { ENTITY_TEMPLATE } from "./operator";
import { PrivacyCopy } from "./privacy-copy";
import { TermsCopy } from "./terms-copy";

/** Markup to plain text: tags become spaces, the few entities React writes are decoded. */
export function markupToText(markup: string): string {
  return normalizeLegalText(
    markup
      .replace(/<[^>]*>/g, " ")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&"),
  );
}

const render = (node: Parameters<typeof renderToStaticMarkup>[0]): string =>
  markupToText(renderToStaticMarkup(node));

/**
 * The text a page's hash is made of: the copy with every allowance wording (limit on with the
 * minutes as a token, limit off, unavailable) and every entity field as a token. Used by the tests
 * and the launch gate only, never by a page.
 */
export function legalCopyText(page: "privacy" | "terms"): string {
  const Copy = page === "privacy" ? PrivacyCopy : TermsCopy;
  const on = { kind: "on", minutes: MINUTES_TOKEN } as const;
  const parts = [on, { kind: "off" }, { kind: "unavailable" }] as const;
  return parts
    .map((allowance) => render(createElement(Copy, { entity: ENTITY_TEMPLATE, allowance })))
    .join(" ");
}

export const legalCopyHash = (page: "privacy" | "terms"): Promise<string> =>
  legalTextHash(legalCopyText(page));
