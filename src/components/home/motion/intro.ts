import { gsap } from "gsap";
import { EASE } from "./eases";
import { splitWords } from "./split";

/**
 * The page load sequence (design.md section 6, no preloader): the bar fades in, the two
 * headline sentences slide up word by word inside their masks, the lead enters, the fan panel
 * rises and the cards open from a stack. The h1 itself never starts at opacity 0 (it is the
 * LCP element); only its words move inside masks. Not run under reduced motion.
 */
export function playIntro(root: HTMLElement): gsap.core.Timeline {
  const tl = gsap.timeline();
  tl.from(root.querySelector(".h-nav"), { opacity: 0, duration: 0.46, ease: "none" }, 0);
  root.querySelectorAll<HTMLElement>(".h-hero [data-line]").forEach((line, i) => {
    tl.from(
      splitWords(line),
      { yPercent: 105, duration: 1.5, ease: EASE.reveal, stagger: 0.04 },
      0.1 + i * 0.2,
    );
  });
  tl.from(
    root.querySelector(".h-hero-lead"),
    { y: 20, opacity: 0, duration: 0.7, ease: EASE.enter },
    0.6,
  );
  tl.from(root.querySelector(".h-fan"), { y: 40, duration: 0.7, ease: EASE.enter }, 0.7);
  return tl;
}
