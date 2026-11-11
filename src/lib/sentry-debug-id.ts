/**
 * Makes the Worker bundle's own debug ID the one Sentry sees (spec 0005, AC-6).
 * The bundle holds a debug ID snippet for every chunk and package inside it, and the SDK keeps
 * the last one registered for a file name. `sentry-cli sourcemaps inject` adds its snippet at
 * the top, so it runs first and loses: events carried an ID with no matching map, and every
 * frame came back `js_invalid_sourcemap_location`. This adds the same snippet again just
 * before the `//# debugId=` comment at the end, so it runs last and wins.
 */

const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const COMMENT = new RegExp(`^//# debugId=(${ID})[ \\t]*$`, "gim");

export type WinningDebugId =
  { readonly ok: true; readonly data: string } | { readonly ok: false; readonly error: string };

/** The snippet the Sentry bundler plugins write, for `id`. */
export function debugIdSnippet(id: string): string {
  return (
    '!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:' +
    '"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{};' +
    `e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[(new e.Error).stack]="${id}",` +
    `e._sentryDebugIdIdentifier="sentry-dbid-${id}"}catch(e){}}();`
  );
}

/** `source` with the snippet for its final `//# debugId=` comment placed right before it. */
export function withWinningDebugId(source: string): WinningDebugId {
  const comments = [...source.matchAll(COMMENT)];
  const last = comments.at(-1);
  if (!last) return { ok: false, error: "No //# debugId= comment: run sentry-cli inject first." };
  const snippet = `${debugIdSnippet(last[1]!)}\n`;
  const before = source.slice(0, last.index);
  // Running it twice must not add a second copy.
  if (before.endsWith(snippet)) return { ok: true, data: source };
  return { ok: true, data: `${before}${snippet}${source.slice(last.index)}` };
}
