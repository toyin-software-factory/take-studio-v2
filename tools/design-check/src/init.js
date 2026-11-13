// design-check init: set a repo up in one step. Finds every reference draft in docs/design/,
// writes a tagged copy of each (data-check labels), and writes design-check.json with one page
// per draft and a route guessed from the file name. Existing pages and settings are kept.
import fs from "node:fs";
import path from "node:path";
import { openBrowser, tagDesign } from "./extract.js";

const HOME = /^(home|index|landing|homepage)$/i;

// "home-v2.html" -> "/", "pricing.html" -> "/pricing", "blog-post-v3.html" -> "/blog-post".
// A draft can name its route itself: <meta name="design-check-route" content="/takes/demo">.
export function guessRoute(file) {
  try {
    const m = /<meta[^>]+name=["']design-check-route["'][^>]+content=["']([^"']+)["']/i.exec(
      fs.readFileSync(file, "utf8").slice(0, 20000),
    );
    if (m && m[1].startsWith("/")) return { route: m[1], guessed: false };
  } catch {}
  const name = path
    .basename(file)
    .replace(/\.html?$/i, "")
    .replace(/[-_.]v\d+$/i, "");
  if (HOME.test(name)) return { route: "/", guessed: true };
  return {
    route:
      "/" +
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
    guessed: true,
  };
}

export async function init({
  dir = "docs/design",
  baseUrl,
  retag = false,
  configFile = "design-check.json",
}) {
  const root = process.cwd();
  const designDir = path.resolve(root, dir);
  if (!fs.existsSync(designDir))
    throw new Error(`No ${dir} folder. Put the reference drafts there (one .html file per page).`);
  const drafts = fs
    .readdirSync(designDir)
    .filter((f) => /\.html?$/i.test(f) && !/\.tagged\.html?$/i.test(f))
    .sort();
  if (!drafts.length) throw new Error(`No .html drafts in ${dir}.`);

  const cfgPath = path.resolve(root, configFile);
  const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : {};
  const pages = Array.isArray(cfg.pages) ? cfg.pages : [];
  const origin =
    baseUrl ||
    (() => {
      for (const p of pages)
        try {
          return new URL(p.build).origin;
        } catch {}
      return "http://localhost:3000";
    })();

  const browser = await openBrowser();
  const rows = [];
  try {
    for (const f of drafts) {
      const draft = path.join(designDir, f);
      const tagged = draft.replace(/\.html?$/i, ".tagged.html");
      const rel = path.relative(root, tagged).split(path.sep).join("/");
      let labels = null;
      // A tagged copy may have hand edits, so it is only rewritten on --retag.
      if (retag || !fs.existsSync(tagged))
        labels = (await tagDesign(browser, draft, tagged)).length;
      const existing = pages.find(
        (p) => p.design === rel || p.design === path.relative(root, draft),
      );
      const name = path.basename(f).replace(/\.html?$/i, "");
      let route, guessed;
      if (existing) {
        existing.design = rel;
        route = (() => {
          try {
            return new URL(existing.build).pathname;
          } catch {
            return existing.build;
          }
        })();
        guessed = false;
      } else {
        ({ route, guessed } = guessRoute(draft));
        pages.push({ name, design: rel, build: new URL(route, origin).href });
      }
      rows.push({
        name: existing?.name || name,
        design: rel,
        route,
        guessed,
        labels,
        existing: !!existing,
      });
    }
  } finally {
    await browser.close();
  }

  const out = {
    ...cfg,
    pages,
    viewports: cfg.viewports || ["desktop", "phone"],
    watch: cfg.watch || ["src"],
    judge: cfg.judge || { type: "jev" },
  };
  fs.writeFileSync(cfgPath, JSON.stringify(out, null, 2) + "\n");

  // Two drafts for the same route (e.g. home-v2 and home-v3) are both kept; say so.
  const byRoute = new Map();
  for (const r of rows) byRoute.set(r.route, [...(byRoute.get(r.route) || []), r.name]);
  const lines = [`Wrote ${path.relative(root, cfgPath)} with ${pages.length} page(s):`, ""];
  for (const r of rows)
    lines.push(
      `  ${r.name}: ${r.design} -> ${r.route}` +
        (r.labels != null ? `  (tagged, ${r.labels} labels)` : "  (tagged copy kept)") +
        (r.guessed ? "  [route guessed from the file name: check it]" : "") +
        (r.existing ? "  [already configured]" : ""),
    );
  const dupes = [...byRoute].filter(([, n]) => n.length > 1);
  if (dupes.length) {
    lines.push("");
    for (const [route, names] of dupes)
      lines.push(
        `  Note: ${names.join(" and ")} all point at ${route}. Remove the page you are not building from design-check.json.`,
      );
  }
  lines.push(
    "",
    "Next: put the same data-check labels on the matching elements in the build (open each .tagged.html to see them).",
    'If a route is wrong, fix "build" in design-check.json, or add <meta name="design-check-route" content="/real/path"> to the draft and run init again.',
  );
  return lines.join("\n");
}
