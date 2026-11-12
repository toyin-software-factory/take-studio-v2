import { ScrollTrigger } from "gsap/ScrollTrigger";

/** Scroll distance after which the bar floats into the pill (design.md recipe 7.4). */
export const NAV_FLOAT_AT = 202;

/**
 * The top bar's two states (recipe 7.4): `is-float` once the page is scrolled past 202 px, and
 * `is-dark` while a `[data-theme="dark"]` section is under the bar. The state changes also run
 * under reduced motion (the CSS sets their transitions to 0 ms). Returns a teardown.
 */
export function watchNav(root: HTMLElement): () => void {
  const nav = root.querySelector<HTMLElement>(".h-nav");
  if (!nav) return () => undefined;
  const triggers = [
    ScrollTrigger.create({
      // Far past the end of any page: "max" would turn the trigger off at the very bottom.
      start: NAV_FLOAT_AT,
      end: 1e7,
      onToggle: (self) => nav.classList.toggle("is-float", self.isActive),
    }),
    ...Array.from(root.querySelectorAll<HTMLElement>('[data-theme="dark"]')).map((section) =>
      ScrollTrigger.create({
        trigger: section,
        start: "top 40px",
        end: "bottom 40px",
        onToggle: (self) => nav.classList.toggle("is-dark", self.isActive),
      }),
    ),
  ];
  return () => {
    triggers.forEach((trigger) => trigger.kill());
    nav.classList.remove("is-float", "is-dark");
  };
}
