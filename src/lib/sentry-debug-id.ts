/**
 * Makes the Worker bundle's own debug ID the one Sentry sees (spec 0005, AC-6).
 * The bundle holds a debug ID snippet for every chunk and package inside it, and the SDK keeps
 * one ID per file name: the last one registered. Many of those snippets sit inside modules the
 * bundle loads lazily, on the first request, so they run after anything we add to the file
 * (events carried a chunk's ID with no matching map, and every frame came back
 * `js_invalid_sourcemap_location`, even with ours placed last). So ours replaces the registry
 * with one that holds only our ID and quietly ignores every later write.
 */

const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const COMMENT = new RegExp(`^//# debugId=(${ID})[ \\t]*$`, "gim");

export type WinningDebugId =
  { readonly ok: true; readonly data: string } | { readonly ok: false; readonly error: string };

/**
 * The snippet for `id`. It runs once, when the bundle loads: it sets `_sentryDebugIds` to a
 * read only view that holds this ID, then ignores writes (no error, so the other snippets, which
 * are wrapped in try and catch, carry on without effect).
 */
export function debugIdSnippet(id: string): string {
  return (
    '!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:' +
    '"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},m={};' +
    `m[(new e.Error).stack]="${id}";` +
    "var p=new Proxy(m,{set:function(){return!0},defineProperty:function(){return!0}," +
    "deleteProperty:function(){return!0}});" +
    'Object.defineProperty(e,"_sentryDebugIds",{get:function(){return p},set:function(){},' +
    "configurable:!1,enumerable:!0});" +
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
