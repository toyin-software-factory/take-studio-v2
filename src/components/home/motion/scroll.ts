import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * Smooth scroll: Lenis driven by GSAP's ticker and kept in step with ScrollTrigger (design.md
 * section 6). Touch devices keep native scrolling (Lenis's default). Returns a teardown, and
 * the instance for anchor scrolling.
 */
export function startSmoothScroll(): { readonly lenis: Lenis; readonly stop: () => void } {
  const lenis = new Lenis({ lerp: 0.1, smoothWheel: true, wheelMultiplier: 1 });
  lenis.on("scroll", ScrollTrigger.update);
  const tick = (time: number) => lenis.raf(time * 1000);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);
  return {
    lenis,
    stop: () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
    },
  };
}

/**
 * In page links (`#studio`): scroll there (smoothly when Lenis runs), then move focus to the
 * target so keyboard and screen reader users land where the page did. Returns a teardown.
 */
export function wireAnchors(root: HTMLElement, lenis: Lenis | null): () => void {
  const onClick = (event: MouseEvent) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
    if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey) return;
    const target = document.querySelector<HTMLElement>(link.getAttribute("href") ?? "");
    if (!target) return;
    event.preventDefault();
    if (lenis) lenis.scrollTo(target, { offset: -80 });
    else target.scrollIntoView();
    // preventDefault stopped the browser updating the address: do it, so the section's URL can be
    // copied and Back returns to the previous place.
    const hash = link.getAttribute("href") ?? "";
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  };
  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
}
