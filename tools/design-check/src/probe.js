// In-page functions. Each one is handed to Playwright, so it must be self-contained.

// Runs before any page script. Records motion and attributes it to the nearest [data-check]
// element: CSS animations and transitions, Web Animations, GSAP tweens, and inline style
// changes (scroll-linked motion). The phase says what triggered it: load, scroll or hover.
export function motionRecorder() {
  if (window.__dc) return;
  const S = { phase: "load", anims: new Map(), styles: new Map(), tweens: [] };
  const labelOf = (el) => {
    try {
      const t = el && el.closest ? el.closest("[data-check]") : null;
      return t ? { label: t.getAttribute("data-check"), self: t === el } : null;
    } catch {
      return null;
    }
  };
  const sample = () => {
    let list = [];
    try {
      list = document.getAnimations();
    } catch {}
    for (const a of list) {
      try {
        const target = a.effect && a.effect.target;
        const l = labelOf(target);
        if (!l) continue;
        const t = a.effect.getTiming();
        let props = [];
        try {
          props = [
            ...new Set(
              a.effect
                .getKeyframes()
                .flatMap((k) =>
                  Object.keys(k).filter(
                    (x) => !["offset", "easing", "composite", "computedOffset"].includes(x),
                  ),
                ),
            ),
          ];
        } catch {}
        if (a.transitionProperty) props = [a.transitionProperty];
        let easing = t.easing;
        try {
          if (a.animationName)
            easing = getComputedStyle(target).animationTimingFunction.split(",")[0].trim();
          else if (easing === "linear") {
            const k = a.effect.getKeyframes().find((x) => x.easing && x.easing !== "linear");
            if (k) easing = k.easing;
          }
        } catch {}
        const kind = a.animationName
          ? "css-animation"
          : a.transitionProperty
            ? "css-transition"
            : "web-animation";
        const key = [
          S.phase,
          l.label,
          kind,
          a.animationName || "",
          props.join(","),
          t.duration,
        ].join("|");
        if (!S.anims.has(key))
          S.anims.set(key, {
            label: l.label,
            on: l.self ? "self" : "child",
            trigger: S.phase,
            kind,
            name: a.animationName || undefined,
            props,
            duration: typeof t.duration === "number" ? Math.round(t.duration) : null,
            delay: Math.round(t.delay || 0),
            easing,
            iterations: t.iterations === Infinity ? "infinite" : t.iterations,
          });
      } catch {}
    }
  };
  setInterval(sample, 80);
  const PROPS = [
    "transform",
    "opacity",
    "clip-path",
    "filter",
    "translate",
    "scale",
    "rotate",
    "width",
    "height",
    "top",
    "left",
    "stroke-dashoffset",
    "background-position",
  ];
  const start = () => {
    try {
      new MutationObserver((ms) => {
        for (const m of ms) {
          const l = labelOf(m.target);
          if (!l) continue;
          const st = m.target.getAttribute("style") || "";
          const changed = PROPS.filter((p) => new RegExp("(^|;)\\s*" + p + "\\s*:").test(st));
          if (!changed.length) continue;
          const key = l.label + "|" + S.phase;
          const r = S.styles.get(key) || {
            label: l.label,
            on: l.self ? "self" : "child",
            trigger: S.phase,
            kind: "inline-style",
            props: new Set(),
            changes: 0,
          };
          changed.forEach((p) => r.props.add(p));
          r.changes++;
          S.styles.set(key, r);
        }
      }).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["style"],
        subtree: true,
      });
    } catch {}
  };
  if (document.documentElement) start();
  else document.addEventListener("readystatechange", start, { once: true });

  // GSAP: wrap to/from/fromTo as soon as the page sets window.gsap.
  const resolve = (t) => {
    try {
      if (typeof t === "string") return [...document.querySelectorAll(t)];
      if (t && t.tagName) return [t];
      if (t && typeof t.length === "number") return [...t].filter((x) => x && x.tagName);
    } catch {}
    return [];
  };
  const SKIP = new Set([
    "ease",
    "duration",
    "delay",
    "scrollTrigger",
    "stagger",
    "repeat",
    "yoyo",
    "paused",
    "immediateRender",
    "overwrite",
    "id",
    "onComplete",
    "onUpdate",
    "onStart",
  ]);
  const record = (method, args) => {
    if (S.tweens.length > 300) return;
    const els = resolve(args[0]);
    const l = labelOf(els[0]);
    if (!l) return;
    const vars = (method === "fromTo" ? args[2] : args[1]) || {};
    const props = Object.keys(method === "fromTo" ? { ...(args[1] || {}), ...vars } : vars).filter(
      (k) => !SKIP.has(k) && !k.startsWith("on"),
    );
    const st = vars.scrollTrigger;
    S.tweens.push({
      label: l.label,
      on: l.self ? "self" : "child",
      kind: "gsap",
      method,
      props,
      duration: typeof vars.duration === "number" ? Math.round(vars.duration * 1000) : 500,
      delay: typeof vars.delay === "number" ? Math.round(vars.delay * 1000) : 0,
      easing: typeof vars.ease === "string" ? vars.ease : vars.ease ? "custom" : "power1.out",
      trigger: st ? (st.scrub ? "scroll-scrub" : "scroll") : S.phase,
      stagger: vars.stagger ? true : undefined,
    });
  };
  const wrap = (g) => {
    if (!g || g.__dc) return;
    g.__dc = true;
    for (const m of ["to", "from", "fromTo"]) {
      const o = g[m];
      if (typeof o === "function")
        g[m] = function (...a) {
          try {
            record(m, a);
          } catch {}
          return o.apply(this, a);
        };
    }
    const tl = g.timeline;
    if (typeof tl === "function")
      g.timeline = function (...a) {
        const t = tl.apply(this, a);
        const st = a[0] && a[0].scrollTrigger;
        for (const m of ["to", "from", "fromTo"]) {
          const o = t[m];
          if (typeof o === "function")
            t[m] = function (...b) {
              try {
                const v = m === "fromTo" ? b[2] : b[1];
                if (st && v && !v.scrollTrigger) v.scrollTrigger = st;
                record(m, b);
                if (st && v && v.scrollTrigger === st) delete v.scrollTrigger;
              } catch {}
              return o.apply(this, b);
            };
        }
        return t;
      };
  };
  let cur;
  try {
    Object.defineProperty(window, "gsap", {
      configurable: true,
      get: () => cur,
      set: (v) => {
        cur = v;
        wrap(v);
      },
    });
  } catch {}

  window.__dc = {
    setPhase(p) {
      sample();
      S.phase = p;
    },
    dump() {
      sample();
      return [
        ...S.anims.values(),
        ...[...S.styles.values()]
          .filter((r) => r.changes >= 2)
          .map((r) => ({ ...r, props: [...r.props] })),
        ...S.tweens,
      ];
    },
  };
}

// Measures every [data-check] element as it renders now.
export function probeElements() {
  const cvs = document.createElement("canvas").getContext("2d");
  const norm = (c) => {
    if (!c) return null;
    try {
      cvs.fillStyle = "#000";
      cvs.fillStyle = c;
      return cvs.fillStyle; // '#rrggbb' or 'rgba(r, g, b, a)'
    } catch {
      return c;
    }
  };
  const alphaOf = (c) => {
    const m = /rgba\([^)]*,\s*([\d.]+)\)/.exec(c || "");
    return m ? parseFloat(m[1]) : 1;
  };
  const effectiveBg = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = norm(getComputedStyle(n).backgroundColor);
      if (alphaOf(c) > 0.01) return c;
    }
    return norm(getComputedStyle(document.body).backgroundColor) || "#ffffff";
  };
  const px = (v) =>
    v === "normal" || v === "auto" || v == null ? v : Math.round(parseFloat(v) * 100) / 100;
  const fontFaces = [...(document.fonts || [])]
    .filter((f) => f.status === "loaded")
    .map((f) => f.family.replace(/["']/g, "").trim().toLowerCase());
  const counts = {};
  const out = [];
  for (const el of document.querySelectorAll("[data-check]")) {
    let label = el.getAttribute("data-check");
    counts[label] = (counts[label] || 0) + 1;
    if (counts[label] > 1) label += "#" + counts[label];
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    let box;
    if (el instanceof HTMLElement && cs.position !== "fixed") {
      let x = 0,
        y = 0;
      for (let n = el; n; n = n.offsetParent) {
        x += n.offsetLeft;
        y += n.offsetTop;
      }
      box = { x, y, w: el.offsetWidth, h: el.offsetHeight };
    } else box = { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
    const parentEl = el.parentElement && el.parentElement.closest("[data-check]");
    const family = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim().toLowerCase();
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const tag = el.tagName.toLowerCase();
    const bgImage = (n) => /url\(/.test(getComputedStyle(n).backgroundImage);
    const media =
      el.matches("img,video,canvas,svg,picture") ||
      !!el.querySelector("img,video,canvas,picture") ||
      bgImage(el) ||
      [...el.querySelectorAll("*")].slice(0, 400).some(bgImage);
    out.push({
      label,
      tag,
      section:
        el.matches("section,header,footer,nav,[data-check-section]") ||
        el.hasAttribute("data-check-section"),
      parent: parentEl ? parentEl.getAttribute("data-check") : null,
      text: (el.innerText || el.getAttribute("alt") || "").trim().replace(/\s+/g, " ").slice(0, 80),
      ownText: ownText || /^(h[1-6]|p|a|button|label|li|span|figcaption|blockquote)$/.test(tag),
      media,
      interactive: el.matches("a,button,[role=button],input,select,textarea,[data-check-hover]"),
      clipped:
        (cs.overflowX !== "visible" && el.scrollWidth > el.clientWidth + 2) ||
        (cs.overflowY !== "visible" &&
          cs.overflowY !== "auto" &&
          cs.overflowY !== "scroll" &&
          el.scrollHeight > el.clientHeight + 2) ||
        (cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1),
      visible:
        r.width > 0 &&
        r.height > 0 &&
        cs.visibility !== "hidden" &&
        cs.display !== "none" &&
        parseFloat(cs.opacity) > 0.01,
      box: {
        x: Math.round(box.x),
        y: Math.round(box.y),
        w: Math.round(box.w),
        h: Math.round(box.h),
      },
      style: {
        fontFamily: family,
        fontLoaded: fontFaces.includes(family) || null,
        fontSize: px(cs.fontSize),
        fontWeight: cs.fontWeight,
        fontStyle: cs.fontStyle,
        lineHeight: px(cs.lineHeight),
        letterSpacing: px(cs.letterSpacing),
        textTransform: cs.textTransform,
        // Where transforms put the element, relative to its layout box. The layout box stays the
        // base for position checks (it ignores in-flight motion); this catches resting transforms.
        rendered: {
          dx: Math.round(r.left + scrollX - box.x),
          dy: Math.round(r.top + scrollY - box.y),
          sx: box.w ? Math.round((r.width / box.w) * 100) / 100 : 1,
          sy: box.h ? Math.round((r.height / box.h) * 100) / 100 : 1,
        },
        textAlign: cs.textAlign,
        color: norm(cs.color),
        background: norm(cs.backgroundColor),
        effectiveBackground: effectiveBg(el),
        backgroundImage:
          cs.backgroundImage === "none"
            ? "none"
            : cs.backgroundImage.includes("gradient")
              ? "gradient"
              : "image",
        paddingTop: px(cs.paddingTop),
        paddingRight: px(cs.paddingRight),
        paddingBottom: px(cs.paddingBottom),
        paddingLeft: px(cs.paddingLeft),
        marginTop: px(cs.marginTop),
        marginBottom: px(cs.marginBottom),
        gap: px(cs.rowGap),
        columnGap: px(cs.columnGap),
        borderRadius: px(cs.borderTopLeftRadius),
        borderWidth: px(cs.borderTopWidth),
        borderColor: parseFloat(cs.borderTopWidth) > 0 ? norm(cs.borderTopColor) : null,
        boxShadow: cs.boxShadow === "none" ? "none" : "shadow",
        opacity: px(cs.opacity),
        display: cs.display,
        objectFit: media ? cs.objectFit : undefined,
        transition:
          cs.transitionDuration !== "0s"
            ? `${cs.transitionProperty} ${cs.transitionDuration} ${cs.transitionTimingFunction}`
            : null,
      },
    });
  }
  return {
    elements: out,
    pageHeight: document.documentElement.scrollHeight,
    pageWidth: document.documentElement.scrollWidth,
    title: document.title,
  };
}

// Hover changes: computed style before and after the pointer sits on the element.
export function readHoverStyle(el) {
  const cs = getComputedStyle(el);
  return {
    color: cs.color,
    backgroundColor: cs.backgroundColor,
    transform: cs.transform,
    opacity: cs.opacity,
    boxShadow: cs.boxShadow,
    borderColor: cs.borderTopColor,
    textDecoration: cs.textDecorationLine,
    scale: cs.scale,
    translate: cs.translate,
  };
}

// Adds data-check labels to an untagged design (run with JavaScript off, so the saved HTML
// keeps its scripts untouched). Existing labels are kept.
export function autoTag() {
  const slug = (s) =>
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .split("-")
      .slice(0, 3)
      .join("-");
  const used = new Set(
    [...document.querySelectorAll("[data-check]")].map((e) => e.getAttribute("data-check")),
  );
  const give = (el, name) => {
    if (el.hasAttribute("data-check")) return el.getAttribute("data-check");
    let n = name,
      i = 2;
    while (used.has(n)) n = `${name}-${i++}`;
    used.add(n);
    el.setAttribute("data-check", n);
    return n;
  };
  const tagged = [];
  const nav = document.querySelector("header nav, nav");
  const header = document.querySelector("body > header, header");
  if (header) tagged.push(give(header, "header"));
  if (nav) tagged.push(give(nav, "nav"));
  let secs = [
    ...document.querySelectorAll("main > section, body > section, main > div > section, section"),
  ].filter((s) => !s.parentElement.closest("section"));
  if (!secs.length)
    secs = [...(document.querySelector("main") || document.body).children].filter(
      (c) => c.offsetHeight > 200 || c.querySelector("h1,h2"),
    );
  secs.forEach((s, i) => {
    const h = s.querySelector("h1,h2,h3");
    const base = give(s, `s${i + 1}-${slug(s.id || (h && h.textContent)) || "section"}`);
    s.setAttribute("data-check-section", "");
    tagged.push(base);
    s.querySelectorAll("h1,h2,h3").forEach((x, j) => {
      if (j < 6) tagged.push(give(x, `${base}-heading${j ? "-" + (j + 1) : ""}`));
    });
    const lead = s.querySelector("h1 ~ p, h2 ~ p, p");
    if (lead) tagged.push(give(lead, `${base}-text`));
    [
      ...s.querySelectorAll(
        'a.btn, a.button, button, [class*="btn"], [class*="cta"], a[role=button]',
      ),
    ]
      .slice(0, 4)
      .forEach((x, j) => tagged.push(give(x, `${base}-cta${j ? "-" + (j + 1) : ""}`)));
    [...s.querySelectorAll("img, video, canvas, picture")]
      .filter((x) => !x.closest("picture") || x.tagName === "PICTURE")
      .slice(0, 4)
      .forEach((x, j) => tagged.push(give(x, `${base}-media${j ? "-" + (j + 1) : ""}`)));
    // repeated cards / items: tag the first one so their size and spacing are checked
    const grid = [...s.querySelectorAll("ul, ol, div")].find(
      (d) =>
        d.children.length >= 3 &&
        [...d.children].every(
          (c) => c.tagName === d.children[0].tagName && c.className === d.children[0].className,
        ),
    );
    if (grid) {
      tagged.push(give(grid, `${base}-list`));
      tagged.push(give(grid.children[0], `${base}-item`));
    }
  });
  const footer = document.querySelector("footer");
  if (footer) tagged.push(give(footer, "footer"));
  return [...new Set(tagged)].map((l) => {
    const el = document.querySelector(`[data-check="${l}"]`);
    return {
      label: l,
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || el.getAttribute("alt") || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 60),
    };
  });
}
