import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";

gsap.registerPlugin(CustomEase);

/**
 * The GSAP ease map, the one source (design.md section 6): each name matches a CSS ease token.
 * `out`, `reveal`, `inOut` and `loop` are GSAP's own; `enter` and `snap` are custom curves.
 */
export const EASE = {
  out: "power4.out",
  reveal: "power2.out",
  inOut: "power2.inOut",
  loop: "sine.inOut",
  enter: CustomEase.create("enter", "0.22,0.61,0.36,1"),
  snap: CustomEase.create("snap", "0.35,0,0,1"),
} as const;

/** True when the visitor asked for less motion (read when used, so a change is picked up). */
export const prefersReducedMotion = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
