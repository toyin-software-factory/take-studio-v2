/**
 * The emails (spec 0006, AC-5, AC-6, AC-7): sign in link, take ready, take failed. Plain HTML
 * and a text version, no images, only the take title and a link to the app (never video,
 * transcript or storage links). Voice follows design.md: friendly, short, "you", sentence
 * case, errors say what happened then what to do. Pure functions, no I/O.
 */

import { formatClock } from "@/lib/take-display";

export type Email = {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
};

const BRAND = "Take Studio";

/** HTML escape for text placed in markup or attributes. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type Block = {
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly button?: { readonly label: string; readonly url: string };
  readonly footer?: readonly string[];
  readonly footerLink?: { readonly label: string; readonly url: string };
};

function render(block: Block): { readonly html: string; readonly text: string } {
  const p = (t: string) =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#003049">${escapeHtml(t)}</p>`;
  const button = block.button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(block.button.url)}" style="display:inline-block;padding:12px 20px;background:#C1121F;color:#ffffff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:600">${escapeHtml(block.button.label)}</a></p>`
    : "";
  const footer = (block.footer ?? [])
    .map(
      (t) =>
        `<p style="margin:0 0 8px;font-size:13px;line-height:20px;color:#4C6A73">${escapeHtml(t)}</p>`,
    )
    .join("");
  const footerLink = block.footerLink
    ? `<p style="margin:0;font-size:13px;line-height:20px"><a href="${escapeHtml(block.footerLink.url)}" style="color:#4C6A73">${escapeHtml(block.footerLink.label)}</a></p>`
    : "";
  const html = `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#FDF0D5;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif"><div style="max-width:520px;margin:0 auto"><h1 style="margin:0 0 16px;font-size:22px;line-height:28px;color:#003049">${escapeHtml(block.heading)}</h1>${block.paragraphs.map(p).join("")}${button}${footer}${footerLink}</div></body></html>`;
  const text = [
    block.heading,
    "",
    ...block.paragraphs.flatMap((t) => [t, ""]),
    ...(block.button ? [`${block.button.label}: ${block.button.url}`, ""] : []),
    ...(block.footer ?? []),
    ...(block.footerLink ? [`${block.footerLink.label}: ${block.footerLink.url}`] : []),
  ]
    .join("\n")
    .trimEnd();
  return { html, text };
}

/** Sign in link (always sent, no unsubscribe). Valid 15 minutes, works once. */
export function signInEmail(input: { readonly url: string }): Email {
  const { html, text } = render({
    heading: "Your sign in link",
    paragraphs: [`Use this link to sign in to ${BRAND}. It works once and expires in 15 minutes.`],
    button: { label: "Sign in", url: input.url },
    footer: [
      "If you didn't ask for this, you can ignore this email. Nobody can sign in without the link.",
    ],
  });
  return { subject: `Your ${BRAND} sign in link`, html, text };
}

type TakeEmailBase = {
  readonly title: string;
  /** Absolute link to the take page in the app. */
  readonly takeUrl: string;
  /** Absolute signed link that turns take emails off (AC-6). */
  readonly unsubscribeUrl: string;
};

/** Times in emails use the app's own `formatClock` (take-display), so both always agree. */
const NOTES: Record<"no_audio" | "no_cuts", string> = {
  no_audio: "This video has no sound, so there were no pauses to trim.",
  no_cuts: "We found no pauses to trim, so your video is unchanged.",
};

const FOOTER_LINES = ["You get this email when a take finishes processing."] as const;

/** Take ready: link to the take page, time removed or the no pauses note (AC-5). */
export function takeReadyEmail(
  input: TakeEmailBase & {
    readonly removedMs: number;
    readonly note: "no_audio" | "no_cuts" | null;
  },
): Email {
  const detail = input.note
    ? NOTES[input.note]
    : `We removed ${formatClock(input.removedMs)} of pauses.`;
  const { html, text } = render({
    heading: `Your take "${input.title}" is ready`,
    paragraphs: [detail, "Open it to play, download or change the cuts."],
    button: { label: "Open your take", url: input.takeUrl },
    footer: FOOTER_LINES,
    footerLink: { label: "Turn off these emails", url: input.unsubscribeUrl },
  });
  return { subject: `Your take "${input.title}" is ready`, html, text };
}

/** Take failed: the friendly message already says what to do next (AC-5). */
export function takeFailedEmail(input: TakeEmailBase & { readonly message: string }): Email {
  const { html, text } = render({
    heading: `Your take "${input.title}" didn't finish`,
    paragraphs: [input.message],
    button: { label: "Open your take", url: input.takeUrl },
    footer: FOOTER_LINES,
    footerLink: { label: "Turn off these emails", url: input.unsubscribeUrl },
  });
  return { subject: `Your take "${input.title}" didn't finish`, html, text };
}
