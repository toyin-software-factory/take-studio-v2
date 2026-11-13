import { gsap } from "gsap";
import { EASE } from "./eases";
import { splitWords } from "./split";

/**
 * Set on `<html>` by the inline script in `intro-guard.tsx` before the first paint, while scripts
 * run and motion is allowed. `home.css` hides the bar, headline and lead under it; the intro
 * takes it off once every start state is set inline (or the CSS failsafe lets go after 3 s).
 */
export const INTRO_PENDING = "h-intro-pending";

/**
 * The page load sequence (design.md section 6, home-v2 intro; Toyin's decision overrides spec
 * 0010 AC-10 as first written): the bar fades in, the headline words rise in their masks, the lead
 * fades and rises, then the fan panel rises. Values are the draft's. Until this runs, `home.css`
 * hides the bar, headline and lead (only while scripts run and motion is allowed), so the
 * first paint never shows them half way. Not run under reduced motion: the text shows at once.
 */
export function playIntro(root: HTMLElement): gsap.core.Timeline {
  const tl = gsap.timeline();
  const nav = root.querySelector(".h-nav");
  const heading = root.querySelector<HTMLElement>(".h-hero .h-h1");
  const lead = root.querySelector(".h-hero-lead");
  const html = document.documentElement;

  if (nav) tl.fromTo(nav, { opacity: 0 }, { opacity: 1, duration: 0.46, ease: "none" }, 0);
  heading?.querySelectorAll<HTMLElement>("[data-line]").forEach((line, i) => {
    tl.from(
      splitWords(line),
      { yPercent: 105, duration: 1.5, ease: EASE.reveal, stagger: 0.04 },
      0.1 + i * 0.2,
    );
  });
  if (lead) {
    tl.fromTo(
      lead,
      { y: 20, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.7, ease: EASE.enter },
      0.6,
    );
  }
  tl.from(root.querySelector(".h-fan"), { y: 40, duration: 0.7, ease: EASE.enter }, 0.7);

  // Every start state is now set inline, so the CSS hiding can let go without a flash.
  html.classList.remove(INTRO_PENDING);
  tl.eventCallback("onComplete", () => {
    gsap.set([nav, lead].filter(Boolean), { clearProps: "opacity,transform" });
  });
  return tl;
}
