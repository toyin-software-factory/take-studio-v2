// Run with: node --test tools/design-check/src/page-flags.test.js
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { pagesFromFlags } from "./page-flags.js";

const PLACEHOLDER = "http://localhost:3000/takes/TAKE_ID";
const pages = [
  { name: "home", design: "docs/design/home.html", build: "/" },
  { name: "take-page-v2", design: "docs/design/take-page-v2.html", build: PLACEHOLDER },
];

test("--design and --build make one page from the two", () => {
  const out = pagesFromFlags(pages, { design: "docs/design/x.html", build: "http://a/b" });
  assert.deepEqual(out, [
    { name: "x", design: path.resolve("docs/design/x.html"), build: "http://a/b" },
  ]);
});

test("--page with --build replaces only that page's URL", () => {
  const url = "http://localhost:3000/takes/real-id";
  const out = pagesFromFlags(pages, { page: "take-page-v2", build: url });
  assert.equal(out.find((p) => p.name === "take-page-v2").build, url);
  assert.equal(out.find((p) => p.name === "home").build, "/");
  assert.equal(pages[1].build, PLACEHOLDER, "the config is not changed");
});

test("--build alone with several pages fails and names the pages", () => {
  assert.throws(
    () => pagesFromFlags(pages, { build: "http://a/b" }),
    /--page <name>.*home, take-page-v2/,
  );
});

test("--build alone applies to the only page", () => {
  const out = pagesFromFlags([pages[1]], { build: "http://a/b" });
  assert.equal(out[0].build, "http://a/b");
});

test("--build with an unknown --page fails, and no --build changes nothing", () => {
  assert.throws(
    () => pagesFromFlags(pages, { page: "nope", build: "http://a/b" }),
    /No page named "nope"/,
  );
  assert.equal(pagesFromFlags(pages, { page: "home" }), pages);
});

test("a page with no name is picked by the slug of its design, as resolvePages does", () => {
  const unnamed = [{ design: "docs/design/Take Page.html", build: PLACEHOLDER }, pages[0]];
  const out = pagesFromFlags(unnamed, { page: "docs-design-take-page-html", build: "http://a/b" });
  assert.equal(out[0].build, "http://a/b");
  assert.equal(out[1].build, "/");
  assert.equal(unnamed[0].build, PLACEHOLDER, "the input is not changed");
  assert.equal(unnamed[0].name, undefined);
});
