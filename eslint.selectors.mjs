// Selectors and messages for rules that used to be prose in AGENTS.md (ROLE.md "Corrections become checks").
// Used by eslint.config.mjs; src/lint-rules*.test.ts proves each one fires.
const sonnerSource = String.raw`/^sonner(\/|$)|sonner-impl$/`;
// Any declarator of a top level `const`, `let` or `var`, and the db calls it may not hold.
const topLevelDeclarator =
  ":matches(Program, ExportNamedDeclaration) > VariableDeclaration > VariableDeclarator";
const eager =
  ":matches(AwaitExpression, ObjectExpression, Property, ArrayExpression, SpreadElement, SequenceExpression, ConditionalExpression, LogicalExpression, TSAsExpression, TSNonNullExpression, TSSatisfiesExpression)";
const dbCall = "CallExpression[callee.name=/^(getDb|createWebDb)$/]";
const fullscreenMethod = "/^(requestFullscreen|webkitRequestFullscreen|webkitEnterFullscreen)$/";

export const zodSource = String.raw`/^zod(\/v[34])?$/`;
export const zodMessage =
  'The browser reads responses through zod/mini only: `import * as z from "zod/mini"` (B2-T108).';
export const fetchMessage =
  "Browser calls to our API go through `callApi` from @/components/takes/browser-io: it times out after 30 seconds.";

export const proseSelectors = [
  ...[
    "ImportDeclaration",
    "ImportExpression",
    "ExportNamedDeclaration",
    "ExportAllDeclaration",
  ].map((node) => ({
    selector: `${node}[source.value=${sonnerSource}]`,
    message:
      "Toasts go through `notify` from @/components/ui/sonner. Importing sonner or sonner-impl directly puts about 32 KB back in the first load (B2-T109).",
  })),
  ...[
    `MemberExpression[property.name=${fullscreenMethod}]`,
    `MemberExpression[computed=true][property.value=${fullscreenMethod}]`,
  ].map((selector) => ({
    selector,
    message:
      "Full screen goes through `enterFullscreen` from @/lib/fullscreen, which falls back to the WebKit methods iPhone Safari needs.",
  })),
  // Each depth is one more step through a node that evaluates at once (`{ db: await getDb() }`,
  // `[getDb()]`, `a ?? getDb()`); a function in between is not listed, so a call inside one is fine.
  ...[0, 1, 2, 3, 4, 5].map((depth) => ({
    selector: `${topLevelDeclarator} > ${`${eager} > `.repeat(depth)}${dbCall}`,
    message:
      "Never keep a database client at module level: call `getDb()` inside the request (src/db/AGENTS.md).",
  })),
];
