// Loads one page in Chromium at one viewport and returns what it actually renders:
// measured boxes and computed styles of every [data-check] element, the motion seen on
// load / scroll / hover, and one screenshot per tagged section.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { autoTag, motionRecorder, probeElements, readHoverStyle } from "./probe.js";

const MAX_SHOT_HEIGHT = 12000;

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1280, height: 800 },
  tablet: { width: 834, height: 1112, isMobile: true, hasTouch: true },
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true },
};

// Use whichever Playwright the project already has.
async function loadChromium() {
  for (const name of ["playwright", "@playwright/test", "playwright-core"]) {
    try {
      const m = await import(name);
      if (m.chromium) return m.chromium;
    } catch {}
  }
  throw new Error(
    "Playwright not found. Install it in this project (npm i -D playwright) and run: npx playwright install chromium",
  );
}

export async function openBrowser() {
  const chromium = await loadChromium();
  const executablePath = process.env.DESIGN_CHECK_CHROMIUM || undefined;
  return chromium.launch({
    executablePath,
    args: ["--disable-gpu-vsync", "--force-color-profile=srgb"],
  });
}

export function toUrl(target, base = process.cwd()) {
  if (/^(https?|file):/i.test(target)) return target;
  return pathToFileURL(path.resolve(base, target)).href;
}

async function newContext(browser, vpName, js = true, storageState) {
  const vp = VIEWPORTS[vpName];
  if (!vp)
    throw new Error(
      `Unknown viewport "${vpName}". Use one of: ${Object.keys(VIEWPORTS).join(", ")}`,
    );
  return browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: !!vp.isMobile,
    hasTouch: !!vp.hasTouch,
    deviceScaleFactor: 1,
    javaScriptEnabled: js,
    reducedMotion: "no-preference",
    ...(storageState ? { storageState } : {}),
  });
}

async function scrollTour(page) {
  const vh = page.viewportSize().height;
  for (let i = 0; i < 60; i++) {
    const done = await page.evaluate(
      () => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4,
    );
    if (done) break;
    await page.mouse.wheel(0, Math.round(vh * 0.6));
    await page.waitForTimeout(140);
  }
  await page.waitForTimeout(500);
  await page.mouse.wheel(0, -100000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
}

async function hoverProbe(page, elements) {
  const out = {};
  const targets = elements.filter((e) => e.interactive && e.visible).slice(0, 30);
  for (const e of targets) {
    try {
      const [name, nth] = e.label.split("#");
      const loc = page
        .locator(`[data-check="${name.replace(/"/g, '\\"')}"]`)
        .nth(nth ? Number(nth) - 1 : 0);
      await loc.scrollIntoViewIfNeeded({ timeout: 2000 });
      await page.mouse.move(0, 0);
      await page.waitForTimeout(150);
      const before = await loc.evaluate(readHoverStyle);
      await loc.hover({ timeout: 2000, force: true });
      await page.waitForTimeout(700);
      const after = await loc.evaluate(readHoverStyle);
      const changes = {};
      for (const k of Object.keys(before))
        if (before[k] !== after[k]) changes[k] = [before[k], after[k]];
      if (Object.keys(changes).length) out[e.label] = changes;
    } catch {}
  }
  await page.mouse.move(0, 0);
  return out;
}

async function sectionShots(page, elements, outDir, prefix, vpName) {
  const vp = page.viewportSize();
  let sections = elements.filter((e) => e.section && e.visible && e.box.h > 20);
  // Keep top-level sections only.
  const labels = new Set(sections.map((s) => s.label));
  sections = sections.filter((s) => !s.parent || !labels.has(s.parent));
  if (!sections.length) {
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0, i = 1; y < h && i <= 12; y += vp.height, i++)
      sections.push({
        label: `slice-${i}`,
        box: { x: 0, y, w: vp.width, h: Math.min(vp.height, h - y) },
      });
  }
  const shots = [];
  for (const s of sections) {
    const file = path.join(
      outDir,
      `${prefix}-${vpName}-${s.label.replace(/[^a-z0-9#_-]+/gi, "_")}.png`,
    );
    try {
      await page.evaluate((y) => window.scrollTo(0, Math.max(0, y)), s.box.y);
      await page.waitForTimeout(450);
      // Motion is already recorded, so screenshots are taken with animations stopped: two captures
      // of the same page then give the same pixels. Very tall sections are capped and marked.
      const height = Math.max(1, Math.min(s.box.h, MAX_SHOT_HEIGHT));
      await page.screenshot({
        path: file,
        fullPage: true,
        clip: { x: 0, y: s.box.y, width: vp.width, height },
        animations: "disabled",
      });
      shots.push({
        label: s.label,
        file,
        h: s.box.h,
        truncated: s.box.h > MAX_SHOT_HEIGHT || undefined,
        media: elements.some((e) => (e.label === s.label || e.parent === s.label) && e.media),
      });
    } catch (err) {
      shots.push({ label: s.label, file: null, error: String(err.message || err) });
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  return shots;
}

export async function extractPage(
  browser,
  url,
  vpName,
  { outDir, prefix, settleMs = 1500, hover = true, storageState },
) {
  fs.mkdirSync(outDir, { recursive: true });
  const ctx = await newContext(browser, vpName, true, storageState);
  await ctx.addInitScript(motionRecorder);
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e.message || e).slice(0, 200)));
  try {
    await page.goto(url, { waitUntil: "load", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
    await page.waitForTimeout(settleMs);
    await page.evaluate(() => window.__dc && window.__dc.setPhase("scroll"));
    await scrollTour(page);
    await page.evaluate(() => window.__dc && window.__dc.setPhase("idle"));
    // Let finite animations land on their end state, so we measure the resting layout.
    await page.evaluate(() => {
      for (const a of document.getAnimations()) {
        try {
          if (a.effect.getTiming().iterations !== Infinity) a.finish();
        } catch {}
      }
    });
    await page.waitForTimeout(300);
    const probe = await page.evaluate(probeElements);
    let hoverChanges = {};
    if (hover && !VIEWPORTS[vpName].hasTouch) {
      await page.evaluate(() => window.__dc && window.__dc.setPhase("hover"));
      hoverChanges = await hoverProbe(page, probe.elements);
    }
    const motion = (await page.evaluate(() => (window.__dc ? window.__dc.dump() : []))).filter(
      (m) => m.trigger !== "idle",
    );
    for (const [label, changes] of Object.entries(hoverChanges))
      motion.push({
        label,
        on: "self",
        trigger: "hover",
        kind: "hover-style",
        props: Object.keys(changes),
        changes,
      });
    const shots = await sectionShots(page, probe.elements, outDir, prefix, vpName);
    return { url, viewport: vpName, ...probe, motion, shots, consoleErrors };
  } finally {
    await ctx.close();
  }
}

// Writes a copy of an untagged design with data-check labels added.
export async function tagDesign(browser, file, outFile) {
  const ctx = await newContext(browser, "desktop", false);
  const page = await ctx.newPage();
  try {
    await page.goto(toUrl(file), { waitUntil: "load", timeout: 45000 });
    const labels = await page.evaluate(autoTag);
    const html = await page.evaluate(() => {
      const dt = document.doctype ? `<!DOCTYPE ${document.doctype.name}>\n` : "<!DOCTYPE html>\n";
      return dt + document.documentElement.outerHTML;
    });
    fs.writeFileSync(outFile, html);
    return labels;
  } finally {
    await ctx.close();
  }
}
