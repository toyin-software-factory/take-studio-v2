import { gsap } from "gsap";
import { EASE } from "./eases";
import { splitWords } from "./split";

/**
 * Staggered entrances (recipe 7.3): an element in a `[data-enter-group]` marked `[data-enter]`
 * fades and rises once, when 15% of it is visible, with a 70 ms delay per index. The CSS hides
 * `[data-enter]` only while `html.js` is set and motion is allowed. Returns a teardown.
 */
export function setupEntrances(root: HTMLElement): () => void {
  root.querySelectorAll<HTMLElement>("[data-enter-group]").forEach((group) => {
    group
      .querySelectorAll<HTMLElement>("[data-enter]")
      .forEach((el, i) => el.style.setProperty("--i", String(i)));
  });
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      }),
    { threshold: 0.15 },
  );
  root.querySelectorAll("[data-enter]").forEach((el) => io.observe(el));
  return () => io.disconnect();
}

/**
 * Section headings (recipe 7.1): the words slide up inside masks when the top of the heading
 * crosses 85% of the viewport, once. Runs inside a `gsap.context`, so it is reverted with it.
 */
export function setupWordReveals(root: HTMLElement): void {
  gsap.utils.toArray<HTMLElement>("[data-reveal-words]", root).forEach((heading) => {
    gsap.from(splitWords(heading), {
      yPercent: 105,
      duration: 1.5,
      ease: EASE.reveal,
      stagger: 0.04,
      scrollTrigger: { trigger: heading, start: "top 85%", once: true },
    });
  });
}
