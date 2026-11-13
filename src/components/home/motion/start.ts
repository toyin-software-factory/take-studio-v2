import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { setupCursor } from "./cursor";
import { refreshOnFaq, setupDrift, setupFlip, watchEdgeBlur } from "./details";
import { setupEntrances, setupWordReveals } from "./enter";
import { setupFan } from "./fan";
import { playIntro } from "./intro";
import { watchNav } from "./nav";
import { setupReel } from "./reel";
import { setupStudio } from "./studio";
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
  document.documentElement.classList.add("js");

  // The motion is built for the current setting and rebuilt when the visitor changes it while
  // the page is open (turning reduced motion on stops Lenis and the loops at once).
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  let stopCurrent = run(root, query.matches);
  const onChange = (event: MediaQueryListEvent) => {
    stopCurrent();
    stopCurrent = run(root, event.matches);
  };
  query.addEventListener("change", onChange);

  return () => {
    query.removeEventListener("change", onChange);
    stopCurrent();
    document.documentElement.classList.remove("js");
  };
}

/** One build of the motion for `reduced` (see `startHomeMotion`); returns its teardown. */
function run(root: HTMLElement, reduced: boolean): () => void {
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
    teardown.push(setupStudio(root, reduced));
    teardown.push(watchEdgeBlur(root));
    teardown.push(refreshOnFaq(root));
    if (!reduced) {
      teardown.push(setupDrift(root));
      teardown.push(setupFlip(root));
      teardown.push(setupCursor(root));
      playIntro(root);
      setupWordReveals(root);
      teardown.push(setupEntrances(root));
    }
  }, root);
  teardown.push(() => ctx.revert());

  // Setup changes the page's height (the studio floor's pinned word block), which moves every
  // trigger created before it: measure them all again now, and again once images and fonts load.
  ScrollTrigger.refresh();
  const refresh = () => ScrollTrigger.refresh();
  window.addEventListener("load", refresh);
  teardown.push(() => window.removeEventListener("load", refresh));

  return () => teardown.reverse().forEach((fn) => fn());
}
