// Exact comparisons, done in code with tolerances. Each finding has a stable id so the loop can
// tell when the same failure comes back with the same numbers.

// --- colour --------------------------------------------------------------------
function parseColor(c) {
  if (!c) return null;
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?\s*\)/i.exec(c);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
  return null;
}
function oklab({ r, g, b }) {
  const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
export function colorDelta(a, b) {
  const A = parseColor(a),
    B = parseColor(b);
  if (!A || !B) return a === b ? { de: 0, da: 0 } : { de: Infinity, da: 0 };
  const [x, y] = [oklab(A), oklab(B)];
  return { de: Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) * 100, da: Math.abs(A.a - B.a) };
}
const hex = (c) => {
  const p = parseColor(c);
  if (!p) return c;
  const h = "#" + [p.r, p.g, p.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  return p.a < 1 ? `${h} at ${Math.round(p.a * 100)}%` : h;
};

// --- helpers -------------------------------------------------------------------
const num = (v) =>
  typeof v === "number" ? v : v == null || v === "normal" || v === "auto" ? null : parseFloat(v);
const fmt = (v, unit = "px") =>
  v == null ? String(v) : typeof v === "number" ? `${Math.round(v * 10) / 10}${unit}` : String(v);

function finding(vp, label, prop, design, build, message, extra = {}) {
  return {
    id: `${vp}:${label}:${prop}`,
    source: "code",
    viewport: vp,
    label,
    prop,
    design,
    build,
    message,
    ...extra,
  };
}

// --- structure & style -----------------------------------------------------------
export function compareElements(D, B, vp, tol) {
  const out = [];
  const dMap = new Map(D.elements.map((e) => [e.label, e]));
  const bMap = new Map(B.elements.map((e) => [e.label, e]));
  if (!D.elements.length) {
    out.push(
      finding(
        vp,
        "(page)",
        "labels",
        0,
        B.elements.length,
        "The design has no data-check labels. Run 'node tools/design-check/src/cli.js tag <design.html>' on it first so elements can be matched.",
        { severity: "setup" },
      ),
    );
    return out;
  }
  if (Math.abs(D.pageWidth - B.pageWidth) > tol.size && B.pageWidth > (VIEW_W[vp] || 0) + 1)
    out.push(
      finding(
        vp,
        "(page)",
        "overflow",
        D.pageWidth,
        B.pageWidth,
        `page scrolls sideways: content is ${B.pageWidth}px wide, the design is ${D.pageWidth}px`,
      ),
    );

  for (const [label, d] of dMap) {
    const b = bMap.get(label);
    if (!b) {
      out.push(
        finding(
          vp,
          label,
          "missing",
          "present",
          "missing",
          `missing: no element with data-check="${label.split("#")[0]}"${d.text ? ` (design text: "${d.text.slice(0, 40)}")` : ""}`,
        ),
      );
      continue;
    }
    if (d.visible !== b.visible) {
      out.push(
        finding(
          vp,
          label,
          "visible",
          d.visible,
          b.visible,
          d.visible
            ? "is hidden or zero-size in the build but visible in the design"
            : "is visible in the build but hidden in the design",
        ),
      );
      continue;
    }
    if (!d.visible) continue;

    // Position: x against the nearest tagged parent; y against the element just above it in the
    // same parent (or the parent's top). So one taller heading does not fail everything below it.
    const pd = d.parent && dMap.get(d.parent),
      pb = d.parent && bMap.get(d.parent);
    const hasParent = !!(pd && pb);
    const above = aboveOf(D.elements, d, dMap);
    const bAbove = above && bMap.get(above.label);
    const xd = d.box.x - (hasParent ? pd.box.x : 0),
      xb = b.box.x - (hasParent ? pb.box.x : 0);
    let yd, yb, whereY;
    if (above && bAbove && bAbove.visible) {
      yd = d.box.y - (above.box.y + above.box.h);
      yb = b.box.y - (bAbove.box.y + bAbove.box.h);
      whereY = `gap below ${above.label}`;
    } else {
      yd = d.box.y - (hasParent ? pd.box.y : 0);
      yb = b.box.y - (hasParent ? pb.box.y : 0);
      whereY = hasParent ? `top edge inside ${d.parent}` : "top edge on the page";
    }
    const whereX = hasParent ? `inside ${d.parent}` : "on the page";
    if (Math.abs(xd - xb) > tol.position)
      out.push(finding(vp, label, "x", xd, xb, `left edge ${whereX}: ${xb}px, design ${xd}px`));
    if (Math.abs(yd - yb) > tol.position)
      out.push(finding(vp, label, "y", yd, yb, `${whereY}: ${yb}px, design ${yd}px`));
    if (Math.abs(d.box.w - b.box.w) > tol.size)
      out.push(
        finding(vp, label, "width", d.box.w, b.box.w, `width ${b.box.w}px, design ${d.box.w}px`),
      );
    if (Math.abs(d.box.h - b.box.h) > tol.size)
      out.push(
        finding(vp, label, "height", d.box.h, b.box.h, `height ${b.box.h}px, design ${d.box.h}px`),
      );

    const s = d.style,
      t = b.style;
    if (d.ownText || b.ownText) {
      if (s.fontFamily !== t.fontFamily)
        out.push(
          finding(
            vp,
            label,
            "font-family",
            s.fontFamily,
            t.fontFamily,
            `font "${t.fontFamily}", design "${s.fontFamily}"`,
          ),
        );
      else if (s.fontLoaded && !t.fontLoaded)
        out.push(
          finding(
            vp,
            label,
            "font-loaded",
            true,
            false,
            `font "${s.fontFamily}" is named but never loads, so a fallback font renders`,
          ),
        );
      cmpNum(out, vp, label, "font-size", s.fontSize, t.fontSize, tol.fontSize);
      if (String(s.fontWeight) !== String(t.fontWeight))
        out.push(
          finding(
            vp,
            label,
            "font-weight",
            s.fontWeight,
            t.fontWeight,
            `font-weight ${t.fontWeight}, design ${s.fontWeight}`,
          ),
        );
      if (s.fontStyle !== t.fontStyle)
        out.push(
          finding(
            vp,
            label,
            "font-style",
            s.fontStyle,
            t.fontStyle,
            `font-style ${t.fontStyle}, design ${s.fontStyle}`,
          ),
        );
      cmpNum(out, vp, label, "line-height", s.lineHeight, t.lineHeight, tol.lineHeight);
      cmpNum(out, vp, label, "letter-spacing", s.letterSpacing, t.letterSpacing, tol.letterSpacing);
      if (s.textTransform !== t.textTransform)
        out.push(
          finding(
            vp,
            label,
            "text-transform",
            s.textTransform,
            t.textTransform,
            `text-transform ${t.textTransform}, design ${s.textTransform}`,
          ),
        );
      if (
        s.textAlign !== t.textAlign &&
        !(/start|left/.test(s.textAlign) && /start|left/.test(t.textAlign))
      )
        out.push(
          finding(
            vp,
            label,
            "text-align",
            s.textAlign,
            t.textAlign,
            `text-align ${t.textAlign}, design ${s.textAlign}`,
          ),
        );
      cmpColor(out, vp, label, "color", s.color, t.color, tol);
    }
    cmpColor(out, vp, label, "background", s.effectiveBackground, t.effectiveBackground, tol);
    if (s.backgroundImage !== t.backgroundImage)
      out.push(
        finding(
          vp,
          label,
          "background-image",
          s.backgroundImage,
          t.backgroundImage,
          `background is ${t.backgroundImage === "none" ? "flat" : "a " + t.backgroundImage}, design ${s.backgroundImage === "none" ? "flat" : "a " + s.backgroundImage}`,
        ),
      );
    const pads = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];
    if (pads.some((p) => Math.abs((num(s[p]) || 0) - (num(t[p]) || 0)) > tol.spacing)) {
      const show = (o) => pads.map((p) => fmt(num(o[p]) || 0)).join(" ");
      out.push(
        finding(
          vp,
          label,
          "padding",
          show(s),
          show(t),
          `padding ${show(t)}, design ${show(s)} (top right bottom left)`,
        ),
      );
    }
    for (const p of ["marginTop", "marginBottom"])
      cmpNum(out, vp, label, kebab(p), s[p], t[p], tol.spacing);
    // Gaps only matter on flex and grid containers, and "normal" there means 0. When row and
    // column gaps differ the same way, that is one finding, not two.
    const gaps = (o) =>
      /flex|grid/.test(o.display || "") ? [num(o.gap) || 0, num(o.columnGap) || 0] : [0, 0];
    const [sr, sc] = gaps(s),
      [tr, tc] = gaps(t);
    const rowOff = Math.abs(sr - tr) > tol.spacing,
      colOff = Math.abs(sc - tc) > tol.spacing;
    if (rowOff && colOff && sr === sc && tr === tc)
      out.push(finding(vp, label, "gap", sr, tr, `gap ${fmt(tr)}, design ${fmt(sr)}`));
    else {
      if (rowOff)
        out.push(finding(vp, label, "row-gap", sr, tr, `row-gap ${fmt(tr)}, design ${fmt(sr)}`));
      if (colOff)
        out.push(
          finding(vp, label, "column-gap", sc, tc, `column-gap ${fmt(tc)}, design ${fmt(sc)}`),
        );
    }
    cmpNum(out, vp, label, "border-radius", s.borderRadius, t.borderRadius, tol.radius);
    cmpNum(out, vp, label, "border-width", s.borderWidth, t.borderWidth, 0.5);
    if (s.borderColor && t.borderColor)
      cmpColor(out, vp, label, "border-color", s.borderColor, t.borderColor, tol);
    if (s.boxShadow !== t.boxShadow)
      out.push(
        finding(
          vp,
          label,
          "box-shadow",
          s.boxShadow,
          t.boxShadow,
          t.boxShadow === "none"
            ? "has no shadow, the design has one"
            : "has a shadow, the design has none",
        ),
      );
    cmpNum(out, vp, label, "opacity", s.opacity, t.opacity, tol.opacity, "");
    // Transforms move and resize what is drawn without changing the layout box.
    // Elements that never stopped moving (a marquee, a timer loop) have no resting position to
    // compare; their motion is compared separately.
    if (
      !d.moving &&
      !b.moving &&
      s.rendered &&
      t.rendered &&
      "sx" in s.rendered &&
      "sx" in t.rendered
    ) {
      const a = s.rendered,
        b = t.rendered;
      if (
        Math.abs(a.dx - b.dx) > tol.position ||
        Math.abs(a.dy - b.dy) > tol.position ||
        Math.abs(a.sx - b.sx) > 0.02 ||
        Math.abs(a.sy - b.sy) > 0.02
      )
        out.push(
          finding(
            vp,
            label,
            "transform",
            a,
            b,
            `a transform draws it shifted ${b.dx},${b.dy}px at scale ${b.sx}×${b.sy}; design shifted ${a.dx},${a.dy}px at scale ${a.sx}×${a.sy}`,
          ),
        );
    }
    if (s.objectFit && t.objectFit && s.objectFit !== t.objectFit)
      out.push(
        finding(
          vp,
          label,
          "object-fit",
          s.objectFit,
          t.objectFit,
          `object-fit ${t.objectFit}, design ${s.objectFit} (image crops differently)`,
        ),
      );
  }
  // Clipping and overlap: things a screenshot would show but single styles would not.
  for (const [label, b] of bMap) {
    const d = dMap.get(label);
    if (d && b.visible && b.clipped && !d.clipped)
      out.push(
        finding(
          vp,
          label,
          "clipped",
          false,
          true,
          "content is cut off (overflows its box); in the design it fits",
        ),
      );
  }
  const kids = (map) => {
    const g = new Map();
    for (const e of map.values())
      if (e.visible && e.parent && !e.section)
        (g.get(e.parent) || g.set(e.parent, []).get(e.parent)).push(e);
    return g;
  };
  // Where the element is drawn: its layout box moved and scaled by any resting transform.
  const drawn = (e) => {
    const r = e.style && e.style.rendered;
    if (!r || !("sx" in r)) return e.box;
    return { x: e.box.x + r.dx, y: e.box.y + r.dy, w: e.box.w * r.sx, h: e.box.h * r.sy };
  };
  const overlap = (a, b) =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const nested = (a, b) =>
    a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
  for (const [parent, list] of kids(bMap)) {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i],
          C = list[j];
        const [a, c] = [drawn(A), drawn(C)];
        if (nested(a, c) || nested(c, a)) continue;
        const area = overlap(a, c);
        // Ignore slivers from sub-pixel rounding: the overlap must be at least 2 px deep.
        const depth = Math.min(
          Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x),
          Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y),
        );
        if (area < 64 || depth < 1.5) continue;
        const dA = dMap.get(A.label),
          dC = dMap.get(C.label);
        const dArea = dA && dC ? overlap(drawn(dA), drawn(dC)) : 0;
        if (!dA || !dC || dArea >= area * 0.5) continue;
        out.push(
          finding(
            vp,
            A.label,
            `overlap:${C.label}`,
            Math.round(dArea),
            Math.round(area),
            `overlaps ${C.label} inside ${parent} by ${Math.round(area)} px²; in the design ${dArea ? `by ${Math.round(dArea)} px²` : "they do not touch"}`,
          ),
        );
      }
  }
  const extra = [...bMap.keys()].filter((l) => !dMap.has(l));
  if (extra.length)
    out.push({
      ...finding(
        vp,
        "(page)",
        "extra-labels",
        null,
        extra,
        `labels in the build that the design does not have: ${extra.slice(0, 8).join(", ")}`,
      ),
      severity: "info",
    });
  linkRelated(out, D, tol);
  return out;
}

// One wrong size usually shows up on several elements: a narrower column makes every child that
// fills it narrower too, and a taller item makes its list and section taller. Mark those knock-on
// findings with `relatedTo` (the element whose fix should clear them), so the builder sees the
// cause once, with a count, instead of a line per element.
function linkRelated(findings, D, tol) {
  const parent = new Map(D.elements.map((e) => [e.label, e.parent]));
  const ancestors = (label) => {
    const out = [];
    for (let p = parent.get(label), g = 0; p && g < 30; p = parent.get(p), g++) out.push(p);
    return out;
  };
  const delta = (f) => Number(f.build) - Number(f.design);
  const near = (a, b) => Math.abs(a - b) <= tol.size * 2;
  const sized = (prop) =>
    new Map(
      findings.filter((f) => f.prop === prop && Number.isFinite(delta(f))).map((f) => [f.label, f]),
    );
  const widths = sized("width"),
    heights = sized("height");
  // Width flows down: a child that changed by the same amount as an ancestor follows it.
  for (const f of widths.values())
    for (const a of ancestors(f.label)) {
      const af = widths.get(a);
      if (af && near(delta(af), delta(f))) f.relatedTo = a;
    }
  // Height flows up: an ancestor that grew by the same amount as a descendant follows it.
  // The deepest such descendant is the cause.
  for (const f of heights.values()) {
    for (const a of ancestors(f.label)) {
      const af = heights.get(a);
      if (af && near(delta(af), delta(f)) && !af.relatedTo) af.relatedTo = f.label;
    }
  }
  // Point every chain at its root.
  const byLabel = { width: widths, height: heights };
  for (const [prop, m] of Object.entries(byLabel))
    for (const f of m.values()) {
      let root = f.relatedTo;
      for (let g = 0; root && m.get(root)?.relatedTo && g < 30; g++) root = m.get(root).relatedTo;
      if (root) f.relatedTo = root;
      if (root) f.relatedProp = prop;
    }
}
// The visible element directly above `e` in the same tagged parent (in the design's layout):
// the nearest one whose bottom edge sits at or above e's top and that overlaps it horizontally.
function aboveOf(list, e, map) {
  let best = null;
  for (const o of list) {
    if (o === e || o.parent !== e.parent || !o.visible || o.section !== e.section) continue;
    if (o.label.split("#")[0] === e.label.split("#")[0]) continue;
    const bottom = o.box.y + o.box.h;
    if (bottom > e.box.y + 1) continue;
    const overlapX = Math.min(o.box.x + o.box.w, e.box.x + e.box.w) - Math.max(o.box.x, e.box.x);
    if (overlapX <= 0) continue;
    if (!best || bottom > best.box.y + best.box.h) best = o;
  }
  return best;
}
const VIEW_W = { desktop: 1440, laptop: 1280, tablet: 834, phone: 390 };
const kebab = (s) => s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());

function cmpNum(out, vp, label, prop, a, b, tolerance, unit = "px") {
  const x = num(a),
    y = num(b);
  if (x == null && y == null) return;
  if (x == null || y == null) {
    if (String(a) !== String(b))
      out.push(finding(vp, label, prop, a, b, `${prop} ${fmt(b, unit)}, design ${fmt(a, unit)}`));
    return;
  }
  if (Math.abs(x - y) > tolerance)
    out.push(finding(vp, label, prop, x, y, `${prop} ${fmt(y, unit)}, design ${fmt(x, unit)}`));
}
function cmpColor(out, vp, label, prop, a, b, tol) {
  const { de, da } = colorDelta(a, b);
  if (de > tol.color || da > tol.alpha)
    out.push(
      finding(
        vp,
        label,
        prop,
        hex(a),
        hex(b),
        `${prop} ${hex(b)}, design ${hex(a)} (difference ${de === Infinity ? "unknown" : de.toFixed(1)})`,
      ),
    );
}

// --- motion ----------------------------------------------------------------------
const EASE = {
  linear: "cubic-bezier(0, 0, 1, 1)",
  ease: "cubic-bezier(0.25, 0.1, 0.25, 1)",
  "ease-in": "cubic-bezier(0.42, 0, 1, 1)",
  "ease-out": "cubic-bezier(0, 0, 0.58, 1)",
  "ease-in-out": "cubic-bezier(0.42, 0, 0.58, 1)",
  none: "cubic-bezier(0, 0, 1, 1)",
};
const normEase = (e) => (e ? EASE[e] || String(e).replace(/\s+/g, " ").trim() : e);

// GSAP's named eases as their standard cubic-bezier equivalents, so most easing comparisons
// can be settled in code instead of going to the judge.
const GSAP_FAMILY = {
  power1: "quad",
  quad: "quad",
  power2: "cubic",
  cubic: "cubic",
  power3: "quart",
  quart: "quart",
  power4: "quint",
  quint: "quint",
  strong: "quint",
  sine: "sine",
  expo: "expo",
  circ: "circ",
};
const GSAP_CURVES = {
  quad: {
    in: [0.55, 0.085, 0.68, 0.53],
    out: [0.25, 0.46, 0.45, 0.94],
    inOut: [0.455, 0.03, 0.515, 0.955],
  },
  cubic: {
    in: [0.55, 0.055, 0.675, 0.19],
    out: [0.215, 0.61, 0.355, 1],
    inOut: [0.645, 0.045, 0.355, 1],
  },
  quart: {
    in: [0.895, 0.03, 0.685, 0.22],
    out: [0.165, 0.84, 0.44, 1],
    inOut: [0.77, 0, 0.175, 1],
  },
  quint: { in: [0.755, 0.05, 0.855, 0.06], out: [0.23, 1, 0.32, 1], inOut: [0.86, 0, 0.07, 1] },
  sine: {
    in: [0.47, 0, 0.745, 0.715],
    out: [0.39, 0.575, 0.565, 1],
    inOut: [0.445, 0.05, 0.55, 0.95],
  },
  expo: { in: [0.95, 0.05, 0.795, 0.035], out: [0.19, 1, 0.22, 1], inOut: [1, 0, 0, 1] },
  circ: {
    in: [0.6, 0.04, 0.98, 0.335],
    out: [0.075, 0.82, 0.165, 1],
    inOut: [0.785, 0.135, 0.15, 0.86],
  },
};
// Control points [x1, y1, x2, y2] for an easing, or null when it is not a plain curve
// (steps, elastic, bounce, back, custom eases): those still go to the judge.
export function easeCurve(e) {
  if (!e) return null;
  const s = String(e).trim();
  const css = normEase(s);
  const m = /^cubic-bezier\(\s*([^)]+)\)$/.exec(css);
  if (m) {
    const v = m[1].split(",").map(Number);
    return v.length === 4 && v.every(Number.isFinite) ? v : null;
  }
  const g = /^([a-z0-9]+)(?:\.(in|out|inOut))?$/i.exec(s);
  if (!g) return null;
  const fam = GSAP_FAMILY[g[1].toLowerCase()];
  return fam ? GSAP_CURVES[fam][g[2] || "out"] : null; // GSAP defaults to .out
}
// Largest vertical gap between two curves, sampled across the timeline (0 = identical).
export function curveGap(a, b) {
  const at = ([x1, y1, x2, y2], x) => {
    let lo = 0,
      hi = 1,
      t = x;
    for (let i = 0; i < 30; i++) {
      t = (lo + hi) / 2;
      const bx = 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
      if (bx < x) lo = t;
      else hi = t;
    }
    return 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  };
  let max = 0;
  for (let i = 1; i < 20; i++) max = Math.max(max, Math.abs(at(a, i / 20) - at(b, i / 20)));
  return max;
}
const triggerGroup = (t) => (t === "scroll-scrub" ? "scroll-scrub" : t);
const describe = (m) =>
  `${m.trigger}: ${m.kind}${m.props && m.props.length ? " of " + m.props.slice(0, 4).join(", ") : ""}${m.duration ? ` ${m.duration}ms` : ""}${m.easing ? " " + m.easing : ""}${m.on === "child" ? " (on a child)" : ""}`;

// Returns [findings, judgeQuestions]. Easings written in different systems (a GSAP name vs a
// CSS cubic-bezier) cannot be compared in code, so those become questions for the judge.
export function compareMotion(D, B, vp, tol) {
  const out = [],
    questions = [];
  const labels = new Set(D.elements.map((e) => e.label.split("#")[0]));
  const byLabel = (list) => {
    const m = new Map();
    for (const x of list) {
      if (!labels.has(x.label)) continue;
      if (!m.has(x.label)) m.set(x.label, []);
      m.get(x.label).push(x);
    }
    return m;
  };
  const dm = byLabel(D.motion),
    bm = byLabel(B.motion);
  for (const [label, dList] of dm) {
    const bList = bm.get(label) || [];
    for (const trig of new Set(dList.map((m) => triggerGroup(m.trigger)))) {
      const ds = dList.filter((m) => triggerGroup(m.trigger) === trig);
      const bs = bList.filter((m) => triggerGroup(m.trigger) === trig);
      const id = `${vp}:${label}:motion-${trig}`;
      if (!bs.length) {
        out.push({
          id,
          source: "code",
          viewport: vp,
          label,
          prop: `motion-${trig}`,
          design: ds.map(describe),
          build: "none",
          message: `no ${trig} motion; design has ${ds.slice(0, 3).map(describe).join("; ")}`,
        });
        continue;
      }
      const dProps = new Set(ds.flatMap((m) => m.props || []).map(propFamily));
      const bProps = new Set(bs.flatMap((m) => m.props || []).map(propFamily));
      const missing = [...dProps].filter((p) => !bProps.has(p));
      if (missing.length)
        out.push({
          id: id + ":props",
          source: "code",
          viewport: vp,
          label,
          prop: `motion-${trig}-props`,
          design: [...dProps],
          build: [...bProps],
          message: `${trig} motion does not move ${missing.join(", ")}; design moves ${[...dProps].join(", ")}, build moves ${[...bProps].join(", ")}`,
        });
      // Hover: the end values must match too, not only which properties change.
      const dh = ds.find((m) => m.kind === "hover-style"),
        bh = bs.find((m) => m.kind === "hover-style");
      if (dh && bh) {
        const diffs = [];
        for (const [k, [, dTo]] of Object.entries(dh.changes || {})) {
          const bTo = (bh.changes || {})[k]?.[1];
          // Checked per exact property: the family check above can hide e.g. a missing
          // border-color when the build changes border-width.
          if (bTo == null) {
            diffs.push({ k, dTo, bTo: "unchanged" });
            continue;
          }
          const isColor = /color/i.test(k);
          let same = dTo === bTo;
          if (isColor) {
            const c = colorDelta(dTo, bTo);
            same = c.de <= tol.color && c.da <= tol.alpha;
          }
          if (!same) diffs.push({ k, dTo, bTo });
        }
        if (diffs.length)
          out.push({
            id: id + ":values",
            source: "code",
            viewport: vp,
            label,
            prop: `motion-${trig}-values`,
            design: Object.fromEntries(diffs.map((d) => [d.k, d.dTo])),
            build: Object.fromEntries(diffs.map((d) => [d.k, d.bTo])),
            message: `on hover ${diffs
              .map(
                (d) =>
                  `${d.k} becomes ${/color/i.test(d.k) && d.bTo !== "unchanged" ? hex(d.bTo) : d.bTo}, design ${/color/i.test(d.k) ? hex(d.dTo) : d.dTo}`,
              )
              .join("; ")}`,
          });
      }
      const dMain = ds.find((m) => m.duration) || ds[0];
      const bMain = bs.find((m) => m.duration) || bs[0];
      if (dMain.duration && bMain.duration && trig !== "scroll-scrub") {
        const diff = Math.abs(dMain.duration - bMain.duration);
        if (diff > Math.max(tol.motionDurationFloorMs, dMain.duration * tol.motionDuration))
          out.push({
            id: id + ":duration",
            source: "code",
            viewport: vp,
            label,
            prop: `motion-${trig}-duration`,
            design: dMain.duration,
            build: bMain.duration,
            message: `${trig} motion lasts ${bMain.duration}ms, design ${dMain.duration}ms`,
          });
      }
      if (dMain.easing && bMain.easing) {
        const a = normEase(dMain.easing),
          b = normEase(bMain.easing);
        const ca = easeCurve(dMain.easing),
          cb = easeCurve(bMain.easing);
        if (a !== b && ca && cb) {
          // Both are plain curves: compare their shapes. A gap above 0.1 of the full movement is
          // visible; below it the two feel the same.
          if (curveGap(ca, cb) > (tol.easing ?? 0.1))
            out.push({
              id: id + ":easing",
              source: "code",
              viewport: vp,
              label,
              prop: `motion-${trig}-easing`,
              design: dMain.easing,
              build: bMain.easing,
              message: `${trig} easing ${bMain.easing}, design ${dMain.easing} (the curves differ by ${Math.round(curveGap(ca, cb) * 100)}% at most)`,
            });
        } else if (a !== b) {
          const comparable = /^steps/.test(a) && /^steps/.test(b);
          if (comparable)
            out.push({
              id: id + ":easing",
              source: "code",
              viewport: vp,
              label,
              prop: `motion-${trig}-easing`,
              design: dMain.easing,
              build: bMain.easing,
              message: `${trig} easing ${bMain.easing}, design ${dMain.easing}`,
            });
          else
            questions.push({
              id: id + ":easing",
              viewport: vp,
              label,
              kind: "easing",
              images: [],
              question: `Do these two easing curves feel the same to a viewer (same acceleration and settle)? Design: "${dMain.easing}" (${dMain.kind}). Build: "${bMain.easing}" (${bMain.kind}). Treat GSAP ease names and CSS cubic-bezier as equivalent when their curves match closely.`,
            });
        }
      }
    }
  }
  for (const [label, bList] of bm) {
    // Build-only trigger groups, also on labels that have other motion in the design.
    const dTrigs = new Set((dm.get(label) || []).map((m) => triggerGroup(m.trigger)));
    const trigs = [...new Set(bList.map((m) => triggerGroup(m.trigger)))].filter(
      (t) => !dTrigs.has(t),
    );
    if (!trigs.length) continue;
    out.push({
      id: `${vp}:${label}:motion-extra`,
      source: "code",
      viewport: vp,
      label,
      prop: "motion-extra",
      design: dTrigs.size ? [...dTrigs] : "none",
      build: trigs,
      message: `has ${trigs.join(", ")} motion that the design does not have (${describe(bList.find((m) => trigs.includes(triggerGroup(m.trigger))))})`,
    });
  }
  return [out, questions];
}
function propFamily(p) {
  p = String(p).toLowerCase();
  if (
    /^(transform|translate|x|y|xpercent|ypercent|scale|scalex|scaley|rotate|rotation|skew)/.test(p)
  )
    return "transform";
  if (/^(opacity|autoalpha|alpha)$/.test(p)) return "opacity";
  if (/clip/.test(p)) return "clip-path";
  if (/color|background/.test(p)) return "color";
  return p;
}
