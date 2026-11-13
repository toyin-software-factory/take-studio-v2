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
// Output folder per page: readable slug plus a short hash, so "a/b" and "a-b" never share files.
const pageDir = (name) =>
  `${slug(name)}-${crypto.createHash("sha1").update(String(name)).digest("hex").slice(0, 6)}`;

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

// Local files the design links to (stylesheets, scripts, images, fonts), so editing one of them
// invalidates the cached measurements too.
function localDependencies(file) {
  const html = fs.readFileSync(file, "utf8");
  const dir = path.dirname(file);
  const refs = new Set();
  for (const m of html.matchAll(
    /(?:src|href|poster)\s*=\s*["']([^"'#?]+)|url\(\s*["']?([^"')#?]+)/gi,
  )) {
    const ref = m[1] || m[2];
    if (!ref || /^(?:[a-z]+:|\/\/|#)/i.test(ref)) continue;
    let rel = ref;
    try {
      rel = decodeURIComponent(ref);
    } catch {} // e.g. "save-20%.html": use the reference as written
    const p = path.resolve(dir, rel);
    try {
      if (fs.statSync(p).isFile()) refs.add(p);
    } catch {}
  }
  return [...refs].sort();
}

const fileHash = (f) => {
  try {
    return crypto.createHash("sha1").update(fs.readFileSync(f)).digest("hex").slice(0, 12);
  } catch {
    return "";
  }
};

// The design does not change between rounds, so its measurements are cached by file content.
async function extractDesign(browser, page, vp, dir, cfg) {
  let key = null;
  let prefix = "design";
  if (page.designFile && fs.existsSync(page.designFile)) {
    const hash = crypto.createHash("sha1").update(fs.readFileSync(page.designFile));
    for (const dep of localDependencies(page.designFile))
      hash.update(dep).update(fs.readFileSync(dep));
    // A new version of the measuring code invalidates the cache too.
    for (const f of ["probe.js", "extract.js"])
      hash.update(fs.readFileSync(new URL(`./${f}`, import.meta.url)));
    const h = hash.digest("hex").slice(0, 12);
    prefix = `design-${h}${cfg.hover ? "" : "-nohover"}`;
    key = path.join(dir, `${prefix}-${vp}.json`);
    if (fs.existsSync(key)) {
      const cached = JSON.parse(fs.readFileSync(key, "utf8"));
      if (cached.shots.every((s) => !s.file || fs.existsSync(s.file))) return cached;
    }
  }
  const res = await extractPage(browser, page.design, vp, {
    outDir: dir,
    prefix,
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
      const dir = path.join(cfg.outDir, pageDir(page.name));
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
          prefix: quick ? "live-build" : "build", // watch never overwrites a full check's captures
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
          if (!bs) {
            // A label missing from the build is already a "missing" finding for the builder. Any
            // other unmatched section (e.g. the label is on a non-section element) was never compared.
            const inBuild = B.elements.some((e) => e.label === ds.label);
            if (inBuild || !ds.file)
              pr.questions.push({
                noJudge: true,
                id: `${vp}:${ds.label}:capture`,
                page: page.name,
                viewport: vp,
                label: ds.label,
                kind: "capture",
                question: "Could the section be captured and compared?",
                answer: {
                  pass: null,
                  confidence: 0,
                  reason: !ds.file
                    ? `design screenshot failed: ${ds.error || "unknown error"}`
                    : "the build has this label, but not on a section element, so the section screenshots were not compared",
                },
              });
            continue;
          }
          if (!ds.file || !bs.file || ds.truncated || bs.truncated) {
            // A section that could not be captured in full was never compared, so it cannot pass.
            const why = !ds.file
              ? `design screenshot failed: ${ds.error || "unknown error"}`
              : !bs.file
                ? `build screenshot failed: ${bs.error || "unknown error"}`
                : "the section is taller than one screenshot can hold, so only its top part was compared";
            pr.questions.push({
              noJudge: true,
              id: `${vp}:${ds.label}:capture`,
              page: page.name,
              viewport: vp,
              label: ds.label,
              kind: "capture",
              question: "Could the section be captured and compared?",
              answer: { pass: null, confidence: 0, reason: why },
            });
            if (!ds.file || !bs.file) continue;
          }
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
              visualOnly: true,
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
    // Question ids carry the page, so two pages with the same section label never share an answer.
    // `sig` is a fingerprint of what was judged, so the loop only calls a failure "unchanged"
    // when the builder's section really did not change.
    for (const p of result.pages)
      for (const q of p.questions) {
        q.id = `${p.name}:${q.id}`;
        if (q.group) q.group = `${p.name}:${q.group}`;
        q.sig = crypto
          .createHash("sha1")
          .update(JSON.stringify(q.facts?.build ?? q.question))
          .update((q.images || []).map((i) => fileHash(i.path)).join(","))
          .digest("hex")
          .slice(0, 12);
      }
    const all = result.pages.flatMap((p) => p.questions).filter((q) => !q.noJudge);
    if (all.length) log(`asking the judge (${cfg.judge.type}) ${all.length} question(s)`);
    const answers = await runJudge(cfg, all);
    const byId = new Map(answers.map((a) => [a.id, a]));
    for (const p of result.pages)
      for (const q of p.questions) if (!q.noJudge) q.answer = byId.get(q.id);
  }
  return result;
}
