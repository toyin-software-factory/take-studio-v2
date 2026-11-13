// Defaults, and loading a project's design-check.json.
import fs from "node:fs";
import path from "node:path";

export const DEFAULTS = {
  viewports: ["desktop", "phone"],
  maxRounds: 5,
  // A failure whose measured values have not changed for this many rounds in a row is "stuck":
  // it goes to you instead of back to the builder. The loop stops when only stuck items remain.
  repeatLimit: 2,
  tolerance: {
    position: 2, // px, measured against the nearest tagged parent
    size: 2, // px
    fontSize: 0.5, // px
    lineHeight: 1, // px
    letterSpacing: 0.25, // px
    spacing: 2, // px, padding / margin / gap
    radius: 1, // px
    color: 2.5, // delta E (OKLab x100); about 2 is the edge of what most people notice
    alpha: 0.05,
    opacity: 0.05,
    motionDuration: 0.2, // 20 %, with a 100 ms floor
    motionDurationFloorMs: 100,
    pixelRatio: 0.02, // share of differing pixels in a section before the judge is asked about it
  },
  judge: { type: "jev" }, // see README: jev | command | http | anthropic | none
  confidence: 0.8, // judge answers below this go to you
  outDir: ".design-check",
  settleMs: 1500,
  hover: true,
  // "design" (default): flag motion the design has and the build lacks or does differently.
  // "strict": also send back motion the build adds that the design does not have.
  motion: "design",
};

export function loadConfig(file, overrides = {}) {
  let cfg = {};
  let base = process.cwd();
  const found = file || (fs.existsSync("design-check.json") ? "design-check.json" : null);
  if (found) {
    cfg = JSON.parse(fs.readFileSync(found, "utf8"));
    base = path.dirname(path.resolve(found));
  }
  const merged = {
    ...DEFAULTS,
    ...cfg,
    ...stripUndefined(overrides),
    tolerance: { ...DEFAULTS.tolerance, ...(cfg.tolerance || {}), ...(overrides.tolerance || {}) },
    judge: { ...DEFAULTS.judge, ...(cfg.judge || {}), ...(overrides.judge || {}) },
  };
  merged.base = base;
  merged.outDir = path.resolve(base, merged.outDir);
  return merged;
}

function stripUndefined(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

export const log = (...a) => console.error("[design-check]", ...a);
