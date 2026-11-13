import { gsap } from "gsap";
import { EASE } from "./eases";

/**
 * The page load sequence (design.md section 6, no preloader). Everything above the fold is in
 * the first paint: the bar, the headline and the lead are never hidden and never moved, so the
 * page is complete as soon as it is drawn (Speed Index, spec 0010 AC-10). Only the fan panel
 * rises, by transform. Not run under reduced motion.
 */
export function playIntro(root: HTMLElement): gsap.core.Timeline {
  const tl = gsap.timeline();
  tl.from(root.querySelector(".h-fan"), { y: 40, duration: 0.7, ease: EASE.enter }, 0.1);
  return tl;
}
