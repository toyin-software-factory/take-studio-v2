import path from "node:path";

export const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "page";

// The name a page is selected by (--page): its own name, else a slug of its design.
export const pageName = (p) => p.name || slug(p.design);

// Applies --design, --build and --page to the pages from design-check.json.
//   --design and --build: one page made from the two (named after the design file).
//   --build alone: the URL of the page picked with --page; with no --page it is only allowed
//   when the config has a single page, because with several pages there is no way to know which.
export function pagesFromFlags(pages, { design, build, page }) {
  const list = pages || [];
  if (design && build)
    return [
      {
        name: path.basename(design).replace(/\.[a-z]+$/i, ""),
        design: path.resolve(design),
        build,
      },
    ];
  if (!build) return list;
  const names = list.map(pageName).join(", ");
  if (!list.length)
    throw new Error('--build needs a page to apply to. Add "pages" to design-check.json.');
  if (!page && list.length > 1)
    throw new Error(
      `--build needs --page <name> or --design: there are ${list.length} pages (${names}).`,
    );
  if (page && !list.some((p) => pageName(p) === page))
    throw new Error(`No page named "${page}". Pages: ${names}`);
  return list.map((p) => (!page || pageName(p) === page ? { ...p, build } : p));
}
