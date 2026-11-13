import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { EASE } from "./eases";

const WIDE = "(min-width: 810px)";

/**
 * Drift rows (recipe 7.12): the two rows in the proof section slide sideways in opposite
 * directions while the section scrolls (about 7% of their width). Wide screens only; the
 * `is-drift` class widens the rows so nothing is clipped. Runs inside a `gsap.context`.
 */
export function setupDrift(root: HTMLElement): () => void {
  const rows = gsap.utils.toArray<HTMLElement>(".h-drift", root);
  if (!rows.length) return () => undefined;
  const mm = gsap.matchMedia();
  mm.add(WIDE, () => {
    rows.forEach((row, i) => {
      row.classList.add("is-drift");
      gsap.fromTo(
        row,
        { xPercent: i % 2 ? 7.04 : -7.04 },
        {
          xPercent: i % 2 ? -7.04 : 7.04,
          ease: "none",
          scrollTrigger: { trigger: row, start: "top bottom", end: "bottom top", scrub: true },
        },
      );
    });
    return () => rows.forEach((row) => row.classList.remove("is-drift"));
  });
  return () => mm.revert();
}

/**
 * Flip counters (recipe 7.12): each digit of a limit rolls up a 0 to 9 column once, when the
 * number is 85% down the viewport. The real text stays in the page, visually hidden, and the
 * rolling copy is `aria-hidden`, so readers and search see the number from the start. The
 * column cells are the same height as the number, so nothing in the layout moves (CLS).
 * Not built under reduced motion. Returns a teardown that puts the original markup back.
 */
export function setupFlip(root: HTMLElement): () => void {
  const undo: (() => void)[] = [];
  root.querySelectorAll<HTMLElement>(".h-stat-num > span:first-child").forEach((value) => {
    const text = value.textContent ?? "";
    if (!/^\d+$/.test(text)) return;
    const flip = document.createElement("span");
    flip.className = "h-flip";
    flip.setAttribute("aria-hidden", "true");
    const cols: HTMLElement[] = [];
    for (const ch of text) {
      const cell = document.createElement("span");
      cell.className = "h-flip-cell";
      const col = document.createElement("span");
      col.className = "h-flip-col";
      col.innerHTML = Array.from({ length: 10 }, (_, d) => `<span>${d}</span>`).join("");
      cell.append(col);
      flip.append(cell);
      cols.push(col);
      gsap.set(col, { yPercent: 0 });
      col.dataset.digit = ch;
    }
    value.classList.add("h-sr-only");
    value.after(flip);
    gsap.to(cols, {
      yPercent: (_i, el: HTMLElement) => -Number(el.dataset.digit) * 10,
      duration: 0.6,
      ease: EASE.out,
      stagger: 0.08,
      scrollTrigger: { trigger: flip, start: "top 85%", once: true },
    });
    undo.push(() => {
      flip.remove();
      value.classList.remove("h-sr-only");
    });
  });
  return () => undo.forEach((fn) => fn());
}

/**
 * Progressive bottom edge blur (recipe 7.13): the `.edge-blur` layer shows over the dark
 * studio floor on wide screens, and is off over the footer, whose text must stay sharp.
 */
export function watchEdgeBlur(root: HTMLElement): () => void {
  const layer = root.querySelector<HTMLElement>(".edge-blur");
  if (!layer) return () => undefined;
  const triggers = gsap.utils
    .toArray<HTMLElement>('[data-theme="dark"]:not(footer)', root)
    .map((section) =>
      ScrollTrigger.create({
        trigger: section,
        start: "top bottom",
        end: "bottom bottom",
        onToggle: (self) => layer.classList.toggle("is-on", self.isActive),
      }),
    );
  return () => {
    triggers.forEach((t) => t.kill());
    layer.classList.remove("is-on");
  };
}

/** The FAQ panels change the page's height as they open: measure the triggers again after. */
export function refreshOnFaq(root: HTMLElement): () => void {
  const onEnd = (event: Event) => {
    if ((event as TransitionEvent).propertyName === "grid-template-rows") ScrollTrigger.refresh();
  };
  root.querySelectorAll(".h-acc-panel").forEach((p) => p.addEventListener("transitionend", onEnd));
  return () =>
    root
      .querySelectorAll(".h-acc-panel")
      .forEach((p) => p.removeEventListener("transitionend", onEnd));
}
