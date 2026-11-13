// One round: render the design and the build at each viewport, diff them in code, compare the
// section screenshots, and ask the judge (Jev) the questions code cannot settle.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { compareElements, compareMotion } from "./compare.js";
import { extractPage, openBrowser, toUrl } from "./extract.js";
import { comparePixels } from "./pixels.js";
import { runJudge } from "./judge.js";
import { log } from "./config.js";

const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "page";

// Pages come from the config ("pages": [{ name, design, build }]) or from --design/--build.
export function resolvePages(cfg, only) {
  const pages = (cfg.pages || []).map((p) => ({
    name: p.name || slug(p.design),
    design: toUrl(p.design, cfg.base),
    build: toUrl(p.build, cfg.base),
    designFile: /^https?:/.test(p.design) ? null : path.resolve(cfg.base, p.design),
    storageState:
      p.storageState || cfg.storageState
        ? path.resolve(cfg.base, p.storageState || cfg.storageState)
        : undefined,
  }));
  if (!pages.length)
    throw new Error(
      'No pages to check. Add "pages" to design-check.json, or pass --design and --build.',
    );
  if (!only) return pages;
  const sel = pages.filter((p) => p.name === only);
  if (!sel.length)
    throw new Error(`No page named "${only}". Pages: ${pages.map((p) => p.name).join(", ")}`);
  return sel;
}

// The design does not change between rounds, so its measurements are cached by file content.
async function extractDesign(browser, page, vp, dir, cfg) {
  let key = null;
  if (page.designFile && fs.existsSync(page.designFile)) {
    const h = crypto
      .createHash("sha1")
      .update(fs.readFileSync(page.designFile))
      .digest("hex")
      .slice(0, 12);
    key = path.join(dir, `design-${vp}-${h}${cfg.hover ? "" : "-nohover"}.json`);
    if (fs.existsSync(key)) {
      const cached = JSON.parse(fs.readFileSync(key, "utf8"));
      if (cached.shots.every((s) => !s.file || fs.existsSync(s.file))) return cached;
    }
  }
  const res = await extractPage(browser, page.design, vp, {
    outDir: dir,
    prefix: "design",
    settleMs: cfg.settleMs,
    hover: cfg.hover,
  });
  if (key) fs.writeFileSync(key, JSON.stringify(res));
  return res;
}

// Compact description of one section's elements, for the judge.
function sectionFacts(snapshot, sectionLabel) {
  const byLabel = new Map(snapshot.elements.map((e) => [e.label, e]));
  const inSection = (e) => {
    for (let p = e.label, guard = 0; p && guard < 20; p = byLabel.get(p)?.parent, guard++)
      if (p === sectionLabel) return true;
    return false;
  };
  const sec = byLabel.get(sectionLabel);
  return snapshot.elements
    .filter(inSection)
    .filter((e) => e.visible)
    .slice(0, 40)
    .map((e) => ({
      label: e.label,
      tag: e.tag,
      text: e.text ? e.text.slice(0, 50) : undefined,
      x: sec ? e.box.x - sec.box.x : e.box.x,
      y: sec ? e.box.y - sec.box.y : e.box.y,
      w: e.box.w,
      h: e.box.h,
      font: e.ownText
        ? `${e.style.fontFamily} ${e.style.fontSize}px/${e.style.lineHeight} ${e.style.fontWeight}`
        : undefined,
      color: e.ownText ? e.style.color : undefined,
      background: e.style.effectiveBackground,
    }));
}

export async function runRound(cfg, pages, { quick = false } = {}) {
  const browser = await openBrowser();
  const result = { at: new Date().toISOString(), quick, pages: [] };
  try {
    for (const page of pages) {
      const dir = path.join(cfg.outDir, slug(page.name));
      fs.mkdirSync(dir, { recursive: true });
      const pr = {
        name: page.name,
        design: page.design,
        build: page.build,
        viewports: [],
        findings: [],
        questions: [],
        visuals: [],
      };
      for (const vp of cfg.viewports) {
        log(`${page.name} @ ${vp}`);
        const D = await extractDesign(
          browser,
          page,
          vp,
          dir,
          quick ? { ...cfg, hover: false } : cfg,
        );
        const B = await extractPage(browser, page.build, vp, {
          outDir: dir,
          prefix: "build",
          settleMs: cfg.settleMs,
          hover: !quick && cfg.hover,
          storageState: page.storageState,
        });
        pr.viewports.push({
          viewport: vp,
          designElements: D.elements.length,
          buildElements: B.elements.length,
          buildErrors: B.consoleErrors,
        });
        pr.findings.push(...compareElements(D, B, vp, cfg.tolerance));
        const [motion, motionQs] = compareMotion(D, B, vp, cfg.tolerance);
        pr.findings.push(...motion);
        if (quick) continue;
        pr.questions.push(
          ...motionQs.map((q) => ({
            ...q,
            page: page.name,
            facts: { viewport: vp, element: q.label },
          })),
        );

        // Sections: pixel diff, then the judgment questions for Jev.
        for (const ds of D.shots) {
          const bs = B.shots.find((s) => s.label === ds.label);
          if (!ds.file || !bs || !bs.file) continue;
          const px = await comparePixels(
            browser,
            ds.file,
            bs.file,
            path.join(dir, `${vp}-${ds.label.replace(/[^a-z0-9#_-]+/gi, "_")}`),
          );
          const sectionFindings = pr.findings.filter(
            (f) =>
              f.viewport === vp &&
              (f.label === ds.label || sectionFacts(D, ds.label).some((e) => e.label === f.label)),
          );
          pr.visuals.push({
            viewport: vp,
            label: ds.label,
            ratio: px.ratio,
            heightDiff: px.heightDiff,
            images: { design: px.design, build: px.build, diff: px.diff },
            codeFindings: sectionFindings.length,
          });
          // Jev is asked only once the code checks in this section pass and the pixels still differ.
          if (px.ratio <= cfg.tolerance.pixelRatio || sectionFindings.length) continue;
          const facts = {
            viewport: vp,
            section: ds.label,
            note: "x and y are pixels from the top-left of the section; w and h are sizes",
            design: sectionFacts(D, ds.label),
            build: sectionFacts(B, ds.label),
          };
          const group = `${page.name}:${vp}:${ds.label}`;
          const images = [
            { role: "design", path: px.design },
            { role: "build", path: px.build },
          ];
          pr.questions.push(
            {
              id: `${vp}:${ds.label}:hierarchy`,
              group,
              page: page.name,
              viewport: vp,
              label: ds.label,
              kind: "hierarchy",
              facts,
              images,
              question:
                "Does the build section keep the same visual hierarchy as the design: the same element reads first, second and third, with the same relative emphasis from size, weight and colour?",
            },
            {
              id: `${vp}:${ds.label}:arrangement`,
              group,
              page: page.name,
              viewport: vp,
              label: ds.label,
              kind: "arrangement",
              facts,
              images,
              question:
                "Does the build section arrange its elements the same way as the design: same order, same columns or rows, same alignment, and nothing overlapping or cut off that is not in the design?",
            },
          );
          if (ds.media)
            pr.questions.push({
              id: `${vp}:${ds.label}:imagery`,
              group,
              page: page.name,
              viewport: vp,
              label: ds.label,
              kind: "imagery",
              facts,
              images,
              question:
                "Do the images, video or canvas areas in the build section take the same place, size and crop as in the design?",
            });
        }
      }
      result.pages.push(pr);
    }
  } finally {
    await browser.close();
  }
  if (!quick) {
    const all = result.pages.flatMap((p) => p.questions);
    if (all.length) log(`asking the judge (${cfg.judge.type}) ${all.length} question(s)`);
    const answers = await runJudge(cfg, all);
    const byId = new Map(answers.map((a) => [a.id, a]));
    for (const p of result.pages) for (const q of p.questions) q.answer = byId.get(q.id);
  }
  return result;
}
