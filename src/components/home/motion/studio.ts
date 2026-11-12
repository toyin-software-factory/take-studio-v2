import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { EASE } from "./eases";
import { fieldSupport } from "./field-support";

type Browser = Navigator & {
  readonly connection?: { readonly saveData?: boolean };
  readonly deviceMemory?: number;
};

/** True when the browser can create a WebGL context (the probe context is released at once). */
function hasWebgl(): boolean {
  const probe = document.createElement("canvas");
  const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  return gl !== null;
}

/** Scroll distance over which one statement line fills (recipe 7.8, Redstone measured 403 px). */
const FILL_PX = 403;

/**
 * The studio floor (spec 0010, AC-6, AC-8; design.md recipes 7.6 to 7.8): the arc that flattens as
 * the dark stage arrives, the giant words that swap one per screen while the section is pinned,
 * the scroll fill statement lines, and the particle field, which is loaded lazily and only
 * where the browser can afford it. Everything here is skipped under reduced motion except the
 * field's one still frame. Runs inside the caller's `gsap.context`. Returns a teardown.
 */
export function setupStudio(root: HTMLElement, reduced: boolean): () => void {
  const section = root.querySelector<HTMLElement>(".h-studio");
  const canvas = section?.querySelector<HTMLCanvasElement>(".h-studio-field");
  const wordBlock = section?.querySelector<HTMLElement>(".h-studio-words");
  if (!section || !canvas || !wordBlock) return () => undefined;
  const teardown: (() => void)[] = [];

  if (!reduced) {
    // 7.6: the arc flattens from full height to a quarter as the section arrives.
    gsap.fromTo(
      section,
      { "--arc-k": 1 },
      {
        "--arc-k": 0.25,
        ease: "none",
        scrollTrigger: { trigger: section, start: "top bottom", end: "top 30%", scrub: true },
      },
    );

    // 7.8: each statement line fills as it climbs the screen.
    gsap.utils.toArray<HTMLElement>("[data-fill]", section).forEach((line) => {
      const apply = (progress: number) =>
        line.style.setProperty("--fill-progress", `${(progress * 100).toFixed(2)}%`);
      // The inline value would outlive the motion and keep the white copy clipped after a switch
      // to reduced motion: remove it on the way out so the CSS default (fully filled) applies.
      teardown.push(() => line.style.removeProperty("--fill-progress"));
      ScrollTrigger.create({
        trigger: line,
        start: "top 80%",
        end: `+=${FILL_PX}`,
        scrub: true,
        onUpdate: (self) => apply(self.progress),
        onRefresh: (self) => apply(self.progress),
      });
    });

    // 7.7: the three giant words, one per screen, while the stage stays pinned.
    const words = gsap.utils.toArray<HTMLElement>(".h-studio-word", wordBlock);
    section.classList.add("is-staged");
    gsap.set(words, { yPercent: 100, opacity: 0 });
    gsap.set(words[0] ?? [], { yPercent: 0, opacity: 1 });
    words.forEach((word, i) => {
      const previous = words[i - 1];
      if (!previous) return;
      const to = (el: HTMLElement, vars: gsap.TweenVars) =>
        gsap.to(el, { duration: 0.7, ease: EASE.enter, ...vars });
      ScrollTrigger.create({
        trigger: wordBlock,
        start: `top+=${(i / words.length) * 100}% top`,
        onEnter: () => {
          to(previous, { yPercent: -100, opacity: 0 });
          to(word, { yPercent: 0, opacity: 1 });
        },
        onLeaveBack: () => {
          to(word, { yPercent: 100, opacity: 0 });
          to(previous, { yPercent: 0, opacity: 1 });
        },
      });
    });
    teardown.push(() => {
      section.classList.remove("is-staged");
      gsap.set(words, { clearProps: "all" });
    });
  }

  // The field: the cheap limits (save data, memory) are checked now, so a device that should not
  // draw it never even requests the Three.js chunk; the WebGL probe, which creates a context,
  // waits until the section is near. The CSS glow behind the canvas stays whatever happens.
  const browser = navigator as Browser;
  const limits = fieldSupport({
    saveData: browser.connection?.saveData,
    deviceMemory: browser.deviceMemory,
    webgl: true,
  });
  if (!limits.ok) {
    canvas.dataset.field = "skipped";
    canvas.dataset.fieldReason = limits.reason;
    return () => teardown.reverse().forEach((fn) => fn());
  }

  let stopped = false;
  let dispose: (() => void) | null = null;
  const skip = (reason: string) => {
    canvas.dataset.field = "skipped";
    canvas.dataset.fieldReason = reason;
  };
  const load = async () => {
    if (!hasWebgl()) return skip("no-webgl");
    canvas.dataset.field = "loading";
    try {
      const { mountField } = await import("./field");
      if (stopped) return;
      dispose = mountField({ canvas, section, words: wordBlock, reduced });
      if (!dispose) skip("no-context");
    } catch {
      // The chunk did not load (network): the glow stays and nothing is left "loading".
      if (!stopped) skip("load-failed");
    }
  };
  // Within one viewport of coming on screen (recipe 7.7), once.
  ScrollTrigger.create({
    trigger: section,
    start: "top bottom+=100%",
    once: true,
    onEnter: () => void load(),
  });
  teardown.push(() => {
    stopped = true;
    dispose?.();
    dispose = null;
  });
  return () => teardown.reverse().forEach((fn) => fn());
}
