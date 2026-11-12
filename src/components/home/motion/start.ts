import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { prefersReducedMotion } from "./eases";
import { setupEntrances, setupWordReveals } from "./enter";
import { setupFan } from "./fan";
import { playIntro } from "./intro";
import { watchNav } from "./nav";
import { setupReel } from "./reel";
import { startSmoothScroll, wireAnchors } from "./scroll";

/**
 * Starts all the homepage motion (spec 0010, AC-4, AC-5, AC-8) and returns one teardown. This
 * file and its neighbours are the only places `gsap` and `lenis` are imported, and they load
 * only from the homepage's client component, so signed in pages never fetch them.
 *
 * Reduced motion: no intro, entrances, word splitting, loops, scrubs or smooth scroll; the nav
 * keeps its states, the fan is a still picture and every piece of content is visible.
 */
export function startHomeMotion(): () => void {
  const root = document.querySelector<HTMLElement>(".home");
  if (!root) return () => undefined;
  gsap.registerPlugin(ScrollTrigger);
  const reduced = prefersReducedMotion();
  document.documentElement.classList.add("js");

  const teardown: (() => void)[] = [];
  const smooth = reduced ? null : startSmoothScroll();
  if (smooth) {
    document.documentElement.classList.add("lenis");
    teardown.push(() => {
      document.documentElement.classList.remove("lenis");
      smooth.stop();
    });
  }
  teardown.push(wireAnchors(root, smooth?.lenis ?? null));

  const ctx = gsap.context(() => {
    teardown.push(watchNav(root));
    const fan = setupFan(root, reduced);
    teardown.push(fan.stop);
    const reel = setupReel(root);
    teardown.push(() => reel.revert());
    if (!reduced) {
      playIntro(root);
      setupWordReveals(root);
      teardown.push(setupEntrances(root));
    }
  }, root);
  teardown.push(() => ctx.revert());

  // Layout shifts after images and fonts load: measure again.
  const refresh = () => ScrollTrigger.refresh();
  window.addEventListener("load", refresh);
  teardown.push(() => window.removeEventListener("load", refresh));

  return () => {
    teardown.reverse().forEach((fn) => fn());
    document.documentElement.classList.remove("js");
  };
}
